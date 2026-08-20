# 04 — System Design

> The "why" and the "what if we scale" file. Use this when interviewers push you beyond "explain your project" into design judgment.

---

## 1. Requirements recap (what we're really building)

- **Trigger:** any push to a GitHub PR (opened/synchronize events)
- **Work:** analyze the diff with an LLM, produce actionable, line-accurate review comments
- **Delivery:** inline comments + summary on the PR
- **Constraints:** GitHub webhooks expect a fast response; LLM calls are slow and unreliable; the service must not spam duplicate reviews; failures must not produce garbage comments

---

## 2. Core design decision: async queue decoupling

**Why not process inline in the webhook handler?**

| Inline | With queue |
| --- | --- |
| Webhook blocks 10–60s+ on LLM | Webhook returns in ~ms |
| GitHub may retry/deliver-timeout | GitHub sees a fast `200` |
| One slow PR blocks subsequent webhooks | Consumers process in parallel |
| No retry story | BullMQ retries (3 attempts, exp backoff) |
| Tight coupling | API and worker scale independently |

**What the queue gives us for free:**

- At-least-once delivery of the job (persisted in Redis until processed)
- Retries with exponential backoff (2s → 4s → …) — hand-rolled retry logic would be worse
- Worker concurrency — scale horizontally by adding worker processes
- Job metadata (attempt count, timestamps) for observability

**What it costs us:** an idempotency gap (see below), a Redis dependency, and a second process to operate.

---

## 3. Failure modes & how we handle them

| Failure | What happens | Mitigation |
| --- | --- | --- |
| Invalid/absent signature | `401`, rejected at the door | HMAC + `timingSafeEqual` |
| Unsupported event | `200 { ignored: true }`, no job | Event filtering |
| Gemini timeout / 5xx / rate limit | Worker throws → job retries | BullMQ attempts=3 + exp backoff |
| Gemini returns malformed JSON | `parseReview` → `[]`; job succeeds, no comments posted | Zod validation + code-fence stripping |
| Gemini returns issues on wrong lines | `filterReviewIssues` drops them; warn-log | Filter against actual patch |
| Gemini returns nothing | `valid.length === 0` → stop, never call GitHub | Early exit |
| GitHub API error on publish | Worker throws → retry (safe-ish; see §6) | Queue retry |
| Webhook delivered twice | **Current gap:** double review possible | Idempotency (deferred, see §4) |
| Worker crashes mid-job | Job re-delivered by BullMQ (stalled job detection) | BullMQ's built-in stalled-job handling |

---

## 4. The idempotency gap (be ready for this)

**Problem:** GitHub webhooks are delivered **at-least-once**. A retry or a burst of `opened → synchronize` for the same head SHA can enqueue multiple jobs → multiple reviews on one PR.

**Current state:** no dedup. Documented as a known limitation.

**The planned fix (V1-next):** a `ReviewedPR` table (Prisma schema is already scaffolded):

```prisma
model ReviewedPR {
  id              String   @id @default(cuid())
  repoFullName    String
  prNumber        Int
  lastReviewedSha String
  status          ReviewStatus @default(PENDING)
  requestId       String?
  reviewSummary   String?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  @@unique([repoFullName, prNumber])
}
```

Flow becomes: webhook handler checks `ReviewedPR` → if `lastReviewedSha === head.sha`, skip enqueueing. Worker upserts `status=COMPLETED` after posting.

**Alternative dedup (queue-level):** BullMQ job ID = `${repo}#${pr}#${sha}` → `queue.add` with the same `jobId` is a no-op. Even simpler, doesn't need a DB. Good answer to "how would you fix it today."

---

## 5. Scaling the pipeline

| Dimension | What happens at scale | Direction |
| --- | --- | --- |
| More PRs | Webhook rate is trivial (ms per request) | API instance count barely matters |
| More/faster reviews | LLM call dominates latency | **Scale workers** (more processes) — the queue is the natural buffer |
| Large diffs | Files fetch paginated (100/page); prompt grows; token limits | Chunk files per job, or process per-file and aggregate |
| Redis single point | BullMQ needs Redis | Use managed Redis w/ persistence + replicas; or BullMQ Pro |
| GitHub rate limits | Paginated fetch + API calls count against limits | GitHub App auth (higher limits) — deferred |
| Cost | Every push burns Gemini tokens | Diff-only prompt keeps tokens bounded; add size caps |

---

## 6. At-least-once publishing risk

`createReview` can succeed on GitHub but the job still retries (response lost / timeout after post). Result: a duplicate review. This is the classic **exactly-once is impossible** trade-off:

- Current: at-least-once → rare duplicate review possible.
- Better: check `ReviewedPR` status before posting (idempotency also fixes this).
- You should be able to say: *"We accept at-least-once. We never produce a wrong review, only potentially a duplicate, and idempotency closes that gap."*

---

## 7. Security design

| Concern | Control |
| --- | --- |
| Fake webhooks | HMAC-SHA256 signature (`X-Hub-Signature-256`), `timingSafeEqual` |
| Secret in code | `.env` only, `.gitignore`d; Zod validates at startup |
| Raw body integrity | Route uses `express.raw` so HMAC is over exact bytes |
| Secrets in logs | Logging is structured; don't log tokens/payload secrets |
| PAT compromise | Single token; **GitHub App auth** (scoped installation tokens) is the upgrade |

---

## 8. Upgrade paths (the "what next" answers)

1. **Idempotency first** — `ReviewedPR` check (DB) or BullMQ deterministic `jobId`.
2. **GitHub App auth** — installation-scoped tokens instead of a PAT; higher rate limits; multi-repo install.
3. **Job dedup on bursts** — debounce same-SHA jobs.
4. **RAG-augmented reviews** — index the codebase (pgvector) and give the LLM file context beyond the diff. Deferred for good reasons: chunking granularity, staleness, token budget.
5. **Dashboard/analytics** — `ReviewLog` table already designed (prompt, model, tokensUsed, latencyMs).
6. **Multi-model / provider-agnostic** — abstract the `ai.service` behind an interface.
7. **Repo-specific rules** — `codesage.yml` per repo.
8. **Retry strategy refinement** — distinguish transient (retry) from permanent (dead-letter) failures.

---

## 9. One-sentence design summary

> An at-least-once webhook receiver that does only verification + enqueue, backed by a Redis queue, consumed by a horizontally-scalable worker that fetches the diff, asks an LLM for structured JSON, filters for line accuracy, and posts only complete reviews — with exponential-backoff retries and an accepted (and planned-for) idempotency gap.
