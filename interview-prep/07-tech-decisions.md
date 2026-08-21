# 07 — Tech Decisions

> Every major engineering choice, why it was made, and what the alternative would have cost. This file is your "I make deliberate trade-offs" evidence.

---

## 1. Async queue over inline processing

**Decision:** Webhook handler verifies + enqueues only, responds `200` immediately. All slow work happens in the worker.

**Why:** GitHub expects a fast webhook response. An LLM call takes seconds; doing it inline would time out GitHub deliveries, cause retries, and serialize reviews behind one slow PR. The queue decouples "accept" from "process."

**Alternative considered:** Inline processing. Rejected — blocking, no retry story, serialized.

**Trade-off accepted:** An extra Redis dependency + idempotency gap + a second process to run.

## 2. BullMQ (with Redis) for the queue

**Decision:** BullMQ on Redis via ioredis.

**Why:** Mature Node job queue with persistence, retries, exponential backoff, stalled-job recovery, worker concurrency, and job events. The author's prior experience (VideoFlow) meant low learning cost. "Real exponential backoff for free instead of hand-rolled retry logic."

**Alternatives:** Hand-rolled Redis lists (`BRPOPLPUSH`) — would require reimplementing retries, delayed jobs, stalled handling. Kafka — overkill for low-volume, high-value jobs.

## 3. HMAC-SHA256 signature verification

**Decision:** Verify every webhook against `X-Hub-Signature-256` using `crypto.createHmac` + `crypto.timingSafeEqual`, over the **raw body Buffer**.

**Why:** Webhooks arrive over a public URL; anyone can POST to it. The shared-secret HMAC proves GitHub sent it. `timingSafeEqual` prevents timing-based signature forgery. Raw body is required because the HMAC is computed over the exact bytes GitHub sent.

## 4. Structured JSON output from Gemini (not raw text)

**Decision:** `responseMimeType: "application/json"` + a strict prompt + zod-validated `parseReview`.

**Why:** We need machine-usable `ReviewIssue[]` to post comments. JSON mode + validation "reduces failure modes by construction." Raw-text prompting for JSON would need fragile regex parsing and repair code.

**Note (honest gap):** The design doc (`context.md`) wanted *structured outputs / function calling* (provider-enforced schemas) rather than JSON-in-prompt. Current code uses the JSON mime type + zod — close in spirit, less strict than function-calling. Be ready to say: "Today we use JSON output mode plus zod; the next step is provider-side function-calling schemas which enforce shape before we parse."

## 5. Zod everywhere it hurts

**Decision:** Zod for (a) env validation at startup and (b) LLM output validation.

**Why:** Env: fail fast — a missing/mistyped var fails loudly in seconds. LLM output: untrusted, non-deterministic; validate shape before touching GitHub. TypeScript gives compile-time; zod gives runtime.

## 6. `express.raw` for the webhook route

**Decision:** The webhook route is mounted with `express.raw({ type: "application/json" })`; JSON parsing is registered *after*.

**Why:** The HMAC must be computed over the exact raw bytes. `express.json()` would re-encode the body and break the signature.

## 7. `requestId` end-to-end tracing

**Decision:** A UUID generated per request by middleware, carried in the BullMQ job payload, and attached to every log line from webhook → worker → publish.

**Why:** The pipeline spans two processes and an async queue. Without a correlation ID, a failure can't be traced. Pino structured logs make it greppable.

## 8. Filter issues against the diff (`filterReviewIssues`)

**Decision:** A hard validation gate between the model and GitHub: an issue is only posted if its `filename` + `line` is in the actual changed set.

**Why:** LLMs hallucinate/shift line numbers. GitHub rejects inline comments on unchanged lines. This gate makes the system line-accurate and prevents bad API calls. The single `pulls.createReview` call is all-or-nothing, so one bad line rejects the whole review — this gate protects that.

## 9. Added-lines-only review scope

**Decision:** `parsePatch` records added lines (`+`) with their new-file numbers; deleted lines are skipped.

**Why:** New bugs come from new code. GitHub's review API anchors inline comments to the new version of a file (`side: RIGHT`); deleted lines don't exist there. Reviewing added lines is the correct, cheap-to-implement V1 scope.

## 10. `pulls.createReview` with `event: "COMMENT"`

**Decision:** One API call posts all inline comments + a summary body, non-blocking.

**Why:** All-or-nothing consistency (no partially posted reviews). `COMMENT` doesn't block merges or set review status — a review bot shouldn't gate CI or auto-approve.

## 11. PAT auth (for now)

**Decision:** GitHub Personal Access Token with `repo` scope; **GitHub App auth deferred to V2**.

**Why:** An App requires creation, installation flow, installation tokens, and JWT auth — real setup cost. PAT unblocks the core pipeline now. Upgrade path is documented, not lost. App auth also raises rate limits and enables multi-repo installs.

## 12. Idempotency deferred (documented, not ignored)

**Decision:** No SHA-based dedup yet. Prisma/Postgres `ReviewedPR` schema exists but isn't wired.

**Why:** "Idempotency (SHA tracking + requestId tracing) and signature verification prioritized over 'smarter' review logic — these are the parts most likely to come up in interview questions about production backend judgment." The core pipeline was proven end-to-end first; dedup is a follow-up, not a blocker.

**Cheap fix if asked:** deterministic BullMQ `jobId`.

## 13. Retries: 3 attempts, exponential backoff

**Decision:** `attempts: 3`, `backoff: { type: "exponential", delay: 2000 }`.

**Why:** Transient failures (timeouts, 5xx, rate limits) are common with LLMs and third-party APIs. 3 attempts balances resilience vs. noise. We never post a broken comment because publishing happens only at the end of a fully successful pipeline. Second-failure path: `status: FAILED`, logged with `requestId`, no comment posted.

## 14. No-op on `[]` review

**Decision:** If no valid issues, stop — no GitHub call.

**Why:** The prompt explicitly allows returning an empty array. Posting an empty/pointless review would be noise. Early-exit saves API calls and keeps the PR clean.

## 15. Malformed AI response → `[]`, not throw

**Decision:** `parseReview` returns an empty array on any parse/validation failure.

**Why:** A bad model response isn't a transient infrastructure failure worth 3 retries — it's model output. Completing the job with "no issues" is a safe, honest outcome; the warning is logged for observability.

## 16. Pino structured logging

**Decision:** Pino (JSON logs, pretty transport in dev).

**Why:** Structured logs are greppable by `requestId`, ship well to log aggregation, and are fast. Mature ecosystem.

## 17. Feature-based `modules/` folder layout

**Decision:** `github/`, `review/`, `ai/` each with their own routes/controllers/services/types.

**Why:** "Scales better and keeps related logic together" vs flat `controllers/services/routes` folders. Related code (webhook + signature + GitHub services) lives in one place.

## 18. Docker Compose for infra

**Decision:** `docker-compose.yml` runs Postgres + Redis locally.

**Why:** One-command local parity with production deps; Postgres reserved for the (future) idempotency/analytics layer, Redis required today for the queue.

## 19. TypeScript over JavaScript

**Decision:** Full TypeScript with strict typing across payloads, jobs, and issue shapes.

**Why:** Compile-time safety across a multi-module, queue-crossing pipeline; typed boundaries catch bugs before runtime. Zod covers the untrusted edges.

---

## Summary table (for quick recall)

| Decision | Chose | Instead of | Why |
| --- | --- | --- | --- |
| Processing model | Async queue | Inline | Fast webhook 200, retries, scalability |
| Queue | BullMQ + Redis | Hand-rolled lists | Retries/backoff/stalled recovery free |
| Webhook auth | HMAC-SHA256 + timingSafeEqual | Trusting URL | Public endpoint, timing-safe |
| LLM output | JSON mime + zod | Raw text parse | Less parsing, safe defaults |
| Line accuracy | parsePatch + filterReviewIssues | Trusting model | GitHub rejects bad lines |
| Auth | PAT (App later) | GitHub App today | Setup cost, core pipeline first |
| Idempotency | Deferred, schema ready | Built day 1 | Scope discipline; documented |
