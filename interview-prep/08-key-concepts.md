# 08 — Key Concepts

> Rapid refreshers on the concepts this project exercises. If an interviewer asks about any of these terms, here's the one-paragraph answer grounded in how we use them.

---

## 1. Webhooks

An HTTP callback: instead of GitHub polling your API, GitHub POSTs an event to a URL you registered the moment something happens. Headers like `X-GitHub-Event` and `X-Hub-Signature-256` accompany the body. **Delivery is at-least-once** — GitHub retries on failure and may deliver duplicates — which is the root of our idempotency gap.

We register `https://your-host/webhooks/github` for `Pull requests` events, receive `opened` / `synchronize`, and must respond fast (our `200` after enqueueing).

## 2. HMAC & timing-safe comparison

- **HMAC-SHA256:** a keyed hash. GitHub computes `HMAC(secret, rawBody)` and sends `sha256=<hex>` in `X-Hub-Signature-256`. We recompute it with the same secret and compare.
- **`crypto.timingSafeEqual`:** compares two Buffers in constant time so an attacker can't infer the signature byte-by-byte from response timing. Requires equal length → we check length first.

## 3. Unified diff format

The patch format GitHub returns in `pulls.listFiles`. Structure:

```
diff --git a/file b/file
--- a/file
+++ b/file
@@ -oldStart,oldCount +newStart,newCount @@
 context
+added line
-deleted line
```

- `@@` hunk header encodes the starting line numbers in old and new files.
- `+`/`-`/space prefix = added / deleted / context.
- `+++`/`---` are file headers, **not** added/deleted lines (our parser guards against this).
- The hunk header's new-start number + a running counter = the exact new-file line number of each added line.

## 4. GitHub Review API (`pulls.createReview`)

Post a review to a PR. Key fields:

- `commit_id` — the SHA to anchor the review to (we use the head SHA from the webhook)
- `event` — `COMMENT` / `APPROVE` / `REQUEST_CHANGES` (we use `COMMENT`, non-blocking)
- `body` — summary markdown
- `comments[]` — inline comments, each `{ path, line, side }` where `side` is `LEFT` (old file) or `RIGHT` (new file). We always use `RIGHT` because we review added lines.

If any inline comment points at a line GitHub considers not in the diff, the call can fail → one more reason to validate before posting.

## 5. BullMQ job queue

- **Queue:** producers add jobs; persists them in Redis.
- **Worker:** consumers poll the queue, process jobs, and report success/failure.
- **Job lifecycle:** `waiting → active → completed | failed`. Failed jobs with attempts remaining go back to `waiting` after a delay (backoff).
- **Backoff:** `exponential` grows the delay between attempts.
- **Stalled jobs:** if a worker dies mid-job without completing, BullMQ detects the job as stalled and re-delivers it (at-least-once).
- **Our config:** `attempts: 3`, `backoff: { type: "exponential", delay: 2000 }`.

## 6. At-least-once vs exactly-once

Message delivery guarantees. At-least-once: every job is delivered ≥1 time (duplicates possible). Exactly-once is impossible in distributed systems — you approximate it with idempotent consumers. Our consumer's side effect (posting a review) can repeat → we need idempotency (SHA dedup) to make repeats harmless.

## 7. Idempotency

A duplicate operation produces the same result as the first. For us: reviewing the same head SHA twice should produce one review, not two. Planned via a `ReviewedPR` row keyed by `(repoFullName, prNumber)` storing `lastReviewedSha`.

## 8. Structured LLM output

Instead of asking the model to "write a review," you constrain the response shape:

- **JSON output mode:** `responseMimeType: "application/json"` tells Gemini to emit JSON.
- **Schema validation:** we zod-validate the parsed JSON (`filename`, `line`, `explanation`, `suggestedFix`).
- **Structured outputs / function calling (future):** passing a schema to the provider so it *enforces* the shape before returning — stronger than prompt-only JSON.

Why it matters: we must consume the output as typed data and post it to GitHub. Garbage text = no review; the validation gates keep it safe.

## 9. Prompt engineering for reliability

Our prompt is four parts: **system instructions** (what to report / not report), **context** (PR title + description), **data** (files with numbered changed lines), **output contract** (valid JSON, exact line numbers, one object per issue, empty array when clean). Combined with filtering, this is defense-in-depth: prompt guides, validation enforces.

## 10. Pagination (GitHub API)

`GET /pulls/{n}/files` returns up to 100 per page; links give the next page. Octokit's `github.paginate` iterates all pages automatically and returns the full array. Important for PRs with many changed files.

## 11. request correlation ID

A UUID (`requestId`) generated per incoming request, propagated across process boundaries (into the queue job) so every log line for one logical operation shares an ID. Enables end-to-end debugging of async pipelines. Our middleware + Pino make it work.

## 12. Zod runtime validation

TypeScript types vanish at runtime. Zod re-validates untrusted data at runtime: env config at boot (fail fast) and LLM output (shape gate before posting). `safeParse` returns success/failure instead of throwing.

## 13. Express raw body parser

`express.raw()` keeps the request body as a `Buffer` of the exact bytes sent. Required for HMAC (which hashes raw bytes). `express.json()` would re-encode and break the signature. Ordering matters: the webhook route mounts the raw parser *before* the global JSON parser.

## 14. Singleton clients

Octokit and GoogleGenAI are instantiated once and shared (module singletons). Avoids re-auth/re-handshake per request; SDKs manage connection pooling internally.

## 15. Exponential backoff

Retry strategy: wait longer after each failure (e.g., `delay × 2^attempt`). Prevents hammering a failing dependency and gives transient errors time to clear. BullMQ implements it for us.

## 16. Pino

Fast, low-overhead JSON logger for Node. Structured output means logs are machine-searchable (grep by `requestId`) and ready for log aggregation. Pretty-printed in dev.

## 17. PAT vs GitHub App (auth models)

- **PAT:** a single user token with broad scope; simple, but shared credentials and lower rate limits.
- **GitHub App:** installs per repo/org, issues short-lived *installation tokens* scoped to that installation; higher rate limits, fine-grained permissions, no shared secret. Our planned V2 upgrade.

## 18. Dead letter / failed job state

When retries are exhausted, a job enters the `failed` state in BullMQ instead of being dropped silently — it's inspectable and can be retried manually. Combined with a `ReviewLog`/`ReviewedPR` status, this gives operations a way to recover from outages.

## 19. Token budget / context window

LLMs accept a fixed max context. We keep prompts small by sending only *changed lines* with line numbers (not full files), which also lowers cost and latency. Large PRs risk exceeding the window → future work: per-file caps or chunking.

## 20. RAG (Retrieval-Augmented Generation)

Inject relevant external knowledge (e.g., the repo's other files, docs) into the LLM prompt so it reviews with context beyond the diff. Our V2 idea; open questions are chunking granularity, staleness, and token budget.
