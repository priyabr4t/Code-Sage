# 02 — Architecture

> Layer-by-layer breakdown of the backend. Cross-reference with `03-flow-diagram.md` for movement of data and `04-system-design.md` for the reasoning.

---

## 1. Layer map

```
┌─────────────────────────────────────────────────────────────────────┐
│  RUNTIME / ENTRY                                                     │
│  src/server.ts              boot Express on env.PORT, dotenv         │
│  src/app.ts                 Express app: middleware + routes + /health│
│                                                                      │
│  CONFIG                                                              │
│  src/config/env.ts          zod-validated env singleton              │
│  src/shared/logger.ts       pino logger                              │
│  src/middleware/requestId.middleware.ts  UUID per request            │
│                                                                      │
│  CLIENTS (lib)                                                       │
│  src/lib/github.ts          Octokit (PAT authed)                     │
│  src/lib/redis.ts           BullMQ connection { url }                │
│  src/lib/prisma.ts          Prisma client + pg adapter (UNUSED)      │
│                                                                      │
│  MODULES                                                             │
│  github/     webhook route→controller→signature, service, publish    │
│  review/     patch parsing, file prep, issue filtering               │
│  ai/         prompt build, Gemini client, response parser            │
│                                                                      │
│  QUEUES / WORKERS                                                    │
│  src/queues/review.queue.ts      BullMQ Queue (retries + backoff)    │
│  src/queues/review.job.ts        ReviewJob payload type              │
│  src/workers/review.worker.ts    consumes jobs, runs the pipeline    │
│                                                                      │
│  TESTS / SCRIPTS                                                     │
│  src/**/*.test.ts             vitest suites                          │
│  src/scripts/*                dev helpers (not in runtime path)      │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. File-by-file component map

### Entry & wiring

| File | Role |
| --- | --- |
| `src/server.ts` | Loads `dotenv`, boots the Express app on `env.PORT`. |
| `src/app.ts` | Creates the app; mounts `requestId` middleware globally; mounts `POST /webhooks/github` with `express.raw({ type: "application/json" })` (needed to keep the body as a Buffer for HMAC); mounts JSON parsing for everything else; adds `GET /health`. |

> **Why `express.raw`?** The webhook route needs the *exact raw bytes* to compute the HMAC. `express.json()` would parse the body and destroy the original byte sequence, breaking signature verification. So the webhook route uses a raw body parser, and a JSON parser is applied *after* (only affects the other routes).

### Config / cross-cutting

| File | Role |
| --- | --- |
| `src/config/env.ts` | Zod schema for every env var (`PORT`, `DATABASE_URL`, `REDIS_URL`, `GITHUB_TOKEN`, `GITHUB_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `GEMINI_MODEL`). Fails fast at startup if something is missing/wrong. Single exported `env` object. |
| `src/shared/logger.ts` | Pino logger (pretty transport in dev). Every handler includes `requestId`. |
| `src/middleware/requestId.middleware.ts` | Sets `req.requestId = randomUUID()` on every request. Augments Express's `Request` type via module declaration. |

### Clients

| File | Role |
| --- | --- |
| `src/lib/github.ts` | Singleton Octokit client authed with `GITHUB_TOKEN`. |
| `src/lib/redis.ts` | Exports `redisConnection = { url: env.REDIS_URL }` — the shared connection config for both queue and worker. |
| `src/lib/prisma.ts` | Prisma client with the Postgres adapter. **Dead code today** — instantiated but never imported. |

### Module: github (webhook ingestion + GitHub API)

| File | Role |
| --- | --- |
| `src/modules/github/github.routes.ts` | Express router; wires `POST /` → `webhookRequestHandler`. Mounted at `/webhooks/github`. |
| `src/modules/github/github.controller.ts` | `webhookRequestHandler`: verify signature → parse payload → filter to `opened`/`synchronize` → enqueue job → `200`. Wrapped in try/catch → `500` on error. |
| `src/modules/github/verifyGithubSignature.ts` | HMAC-SHA256 of raw body vs `X-Hub-Signature-256`; `crypto.timingSafeEqual` comparison; rejects missing header / non-Buffer body. |
| `src/modules/github/github.service.ts` | `getPullRequest` (PR metadata) and `getPullRequestFiles` (paginated file list via `github.paginate`, 100/page). |
| `src/modules/github/review.service.ts` | `createReview` — maps issues → inline comment objects (`path`, `line`, `side: "RIGHT"`, `body`) and calls `github.pulls.createReview` with `event: "COMMENT"`, summary body. |
| `src/modules/github/github.types.ts` | `PullRequestWebhookPayload` type (action, repository, pull_request, sender, changes). |

### Module: review (diff processing)

| File | Role |
| --- | --- |
| `src/modules/review/review.types.ts` | `ReviewFile { filename, patch, changedLines: ChangedLines[] }`, `ChangedLines { line, code }`. |
| `src/modules/review/patch-parser.ts` | `parsePatch(patch)` — walks a unified diff: hunk header `@@` sets the starting new-file line, `+` lines are recorded with their real line number and code, deleted/context lines only advance the counter. |
| `src/modules/review/review.service.ts` | `prepareReviewFiles(files)` — drops files without a patch, attaches `changedLines` per file. `filterReviewIssues(issues, files)` — keeps only issues whose `filename`+`line` is in the changed set. |

### Module: ai (LLM)

| File | Role |
| --- | --- |
| `src/modules/ai/ai.client.ts` | Singleton `GoogleGenAI` client from `@google/genai`. |
| `src/modules/ai/ai.service.ts` | `generateReview(prompt)` — calls `ai.models.generateContent` with `GEMINI_MODEL`, `responseMimeType: "application/json"`; passes the text to `parseReview`. Logs and rethrows errors (retry comes from the queue). |
| `src/modules/ai/parser.ts` | `parseReview(response)` — strips markdown code fences, `JSON.parse`, checks array, Zod-validates each object; returns `[]` instead of throwing on malformed input. |
| `src/modules/ai/parser.types.ts` | `ReviewIssue { filename, line, explanation, suggestedFix }`. |
| `src/modules/ai/prompt.service.ts` | `buildReviewPrompt(context)` — assembles system instructions + PR title/description + numbered changed lines + strict output instructions into one prompt string. |
| `src/modules/ai/prompt.types.ts` | `ReviewContext { title, description, files }`. |

### Queues / workers

| File | Role |
| --- | --- |
| `src/queues/review.queue.ts` | `Queue("review-queue", { connection, defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2000 } } })`. |
| `src/queues/review.job.ts` | `ReviewJob { requestId, repository, prNumber, sha }`. |
| `src/workers/review.worker.ts` | `Worker("review-queue", handler, { connection })`. Handler: parse `owner/repo` → fetch PR → fetch files → `prepareReviewFiles` → `buildReviewPrompt` → `generateReview` → `filterReviewIssues` → if none valid, stop; else build summary → `createReview`. Logs every step with `requestId`; rethrows to trigger BullMQ retry. |

---

## 3. Connection ledger (A sends →, ← B returns)

| A | B | A sends → | ← B returns |
| --- | --- | --- | --- |
| GitHub | `github.controller.ts` | raw JSON payload + `X-Hub-Signature-256` | HTTP `200` / `401` / `500` |
| `controller` | `verifyGithubSignature` | `req` (headers + raw Buffer) | `boolean` |
| `controller` | `reviewQueue.add` | `"review-pr"` + `ReviewJob` | `Job` (with `id`) |
| `reviewQueue` (Redis) | `review.worker.ts` | stored `ReviewJob.data` | processed result, or thrown error → retry (max 3, exp backoff) |
| `worker` | `getPullRequest` | `owner, repo, prNumber` | `PullRequest` (title, body, state, head.sha) |
| `worker` | `getPullRequestFiles` | `owner, repo, prNumber` | `PullRequestFile[]` (filename, patch) |
| `worker` | `prepareReviewFiles` | `PullRequestFile[]` | `ReviewFile[]` |
| `worker` | `buildReviewPrompt` | `ReviewContext` | `prompt: string` |
| `worker` | `generateReview` | `prompt` | `ReviewIssue[]` |
| `generateReview` | Gemini (`ai.client`) | prompt + model + JSON mime | `response.text` (JSON string) |
| `generateReview` | `parseReview` | JSON string | `ReviewIssue[]` or `[]` |
| `worker` | `filterReviewIssues` | issues + review files | `{ valid, filtered }` |
| `worker` | `createReview` | owner, repo, prNumber, sha, issues, summary | void (GitHub review created) |
| `createReview` | Octokit `pulls.createReview` | inline comments + summary body | review object (or API error) |

---

## 4. Data shapes (in-code)

```ts
// github.types.ts — incoming webhook payload
interface PullRequestWebhookPayload {
  action: string;                      // opened | synchronize | edited | closed …
  repository: { full_name: string };   // "owner/repo"
  pull_request: { number: number; head: { sha: string } };
  sender?: { login: string };
  changes: string;
}

// queues/review.job.ts — across queue → worker
interface ReviewJob {
  requestId: string;
  repository: string;                  // "owner/repo"
  prNumber: number;
  sha: string;
}

// review.types.ts
interface ReviewFile {
  filename: string;
  patch: string;
  changedLines: ChangedLines[];
}
interface ChangedLines { line: number; code: string }

// ai/parser.types.ts — what Gemini returns after validation
interface ReviewIssue {
  filename: string;
  line: number;
  explanation: string;
  suggestedFix: string;
}

// ai/prompt.types.ts
interface ReviewContext {
  title: string;
  description: string;
  files: ReviewFile[];
}
```

---

## 5. Module dependency direction

```
controller ──► verifyGithubSignature
controller ──► reviewQueue (queues)
worker ──► github.service ──► lib/github (Octokit)
worker ──► review.service ──► patch-parser
worker ──► prompt.service
worker ──► ai.service ──► ai.client + parser
worker ──► github/review.service (createReview)
all ──► config/env, shared/logger
```

Clean, layered: `modules` depend on `lib` and `config`; `queues`/`workers` orchestrate the modules. No circular dependencies.
