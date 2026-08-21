# 03 — Flow Diagrams

> All the ASCII diagrams you need to draw from memory on a whiteboard or in an interview doc.

---

## 1. End-to-end flow (top level)

```
 GitHub (PR opened / synchronize)
        │  POST /webhooks/github
        │  (raw JSON body + X-Hub-Signature-256 header)
        ▼
┌───────────────────────────────────────────┐
│  Express API (server.ts → app.ts)          │
│  requestId middleware ─► req.requestId=UUID│
│                                           │
│  1. verifyGithubSignature ──► 401 on fail │
│  2. action ∈ {opened, synchronize}?        │
│       else ──► 200 {ignored:true}          │
│  3. reviewQueue.add("review-pr", job) ─────┼──┐
│  4. 200 { queued: true }  (fast!)          │   │
└───────────────────────────────────────────┘   │
                                                ▼
                           ┌──────────────────────────────────┐
                           │  BullMQ "review-queue"  (Redis)  │
                           │  attempts=3, exponential backoff │
                           └──────────────────────────────────┘
                                                │
                        delivers job.data to a worker
                                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Worker (review.worker.ts)                                       │
│  [owner, repo] = repository.split("/")                           │
│                                                                 │
│  1. getPullRequest(owner, repo, pr) ─────────► PR metadata       │
│  2. getPullRequestFiles(owner, repo, pr) ────► files[] (paginated│
│  3. prepareReviewFiles(files) ───────────────► ReviewFile[]      │
│        (parsePatch → changedLines per file)                     │
│  4. buildReviewPrompt(context) ──────────────► prompt: string    │
│  5. generateReview(prompt) ──────────────────► ReviewIssue[]     │
│        Gemini(JSON mime) → parseReview → zod                    │
│  6. filterReviewIssues(issues, files) ───────► {valid, filtered} │
│        if valid.length === 0 ──► log, STOP (no GitHub call)     │
│  7. buildReviewSummary(valid)                                   │
│  8. createReview(...) ───────────────────────► posts to PR      │
└─────────────────────────────────────────────────────────────────┘
                                                │
                                                ▼
                          GitHub PR  ◄── inline comments (side RIGHT)
                          reviewed   ◄── summary body
```

---

## 2. Webhook handler detail (`github.controller.ts`)

```
request (raw Buffer)
   │
   ▼
verifyGithubSignature(req) ──── false ──► 401 { message: "Invalid signature" }
   │ true
   ▼
payload = JSON.parse(req.body.toString())
   │
   ▼
action === "opened" || "synchronize" ? ── no ──► 200 { ignored: true }
   │ yes
   ▼
job = reviewQueue.add("review-pr", {
  requestId: req.requestId,
  repository: repository.full_name,   // "owner/repo"
  prNumber: pull_request.number,
  sha: pull_request.head.sha,
})
   │
   ▼
200 { queued: true }
```

- Anything thrown → catch → `500 { message: "Internal server error" }`.

---

## 3. Patch parsing (`parsePatch`) — the diff walk

Input: a unified diff hunk like:

```
@@ -10,5 +12,6 @@
 const x = 1;
+const y = 2;
 const z = 3;
-const w = 4;
+const v = 5;
```

Walk:

| Line | Action |
| --- | --- |
| `@@ -10,5 +12,6 @@` | regex `\+(\d+)(?:,\d+)?` → `newLine = 12` (starting new-file line) |
| ` const x = 1;` | context → `newLine++` → 13 |
| `+const y = 2;` | **added** → record `{ line: 13, code: "const y = 2;" }`, `newLine++` → 14 |
| ` const z = 3;` | context → `newLine++` → 15 |
| `-const w = 4;` | deleted → skip (only advance nothing) |
| `+const v = 5;` | **added** → record `{ line: 15, code: "const v = 5;" }`, `newLine++` → 16 |

Result: `[{line: 13, code: "const y = 2;"}, {line: 15, code: "const v = 5;"}]`

> This is what makes line numbers accurate: the hunk header gives the true starting line number in the *new* file, then added lines are recorded with the running counter, and deleted lines are skipped (they don't exist in the new file).

---

## 4. Worker pipeline (call chain per job)

```
getPullRequest ─► getPullRequestFiles ─► prepareReviewFiles ─► buildReviewPrompt
      ─► generateReview ─► filterReviewIssues ─► buildReviewSummary ─► createReview
```

Early-exit branches:
- Invalid repo format → throw (retry) — won't happen after validation but guarded.
- `valid.length === 0` → log "No actionable issues found", **stop before any GitHub API call**.
- `filtered.length > 0` → warn-log the dropped issues (e.g. LLM hallucinated a line number).

---

## 5. Process topology

```
┌──────────────────────┐        ┌──────────────────────┐
│  API process         │        │  Worker process      │
│  npm run dev         │        │  npm run worker      │
│                      │        │                      │
│  server.ts           │        │  review.worker.ts    │
│   └─ app.ts          │        │       │              │
│      ├─ POST /webhooks│        │   consumes jobs     │
│      ├─ GET /health  │        │   (fetch → prompt →  │
│                      │        │    LLM → validate →  │
│      └─ queues       │        │    publish)          │
└──────────┬───────────┘        └──────────┬───────────┘
           │                               │
           │        ┌─────────────┐        │
           └────────►│    Redis    │◄───────┘
                     │ (BullMQ)    │
                     └─────────────┘
              (Postgres/Prisma reserved — unwired)
```

Scale point: add more worker processes/instances to consume faster; the queue decouples the two.

---

## 6. Failure & retry flow

```
worker throws (Gemini timeout, GitHub 5xx, network)
   │
   ▼
BullMQ marks job failed, attempt counter++
   │
   ▼
attempt 2 after backoff delay (exponential: 2s, then 4s, ...)
   │
   ▼
attempt 3 …
   │
   ▼
attempts exhausted ──► job "failed" state (stays in Redis, visible via dashboard/API)
```

- Only the *worker* can throw and trigger a retry; the webhook already returned `200` long ago.
- A review is **never posted** unless the whole pipeline succeeds → no broken/partial comments.
