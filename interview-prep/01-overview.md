# 01 — Project Overview

## What is CodeSage?

**CodeSage is an AI code-review bot for GitHub pull requests.**

It listens to GitHub webhooks. On PR `opened` / `synchronize` events it:

1. Verifies the webhook payload via HMAC-SHA256 signature
2. Enqueues a review job on a BullMQ queue (Redis) and responds `200` immediately
3. A worker fetches the PR diff, parses the changed lines, sends them to Google Gemini for structured analysis
4. Validates every issue against the real diff, then posts inline comments + a summary back on the PR

The entire pipeline runs automatically on every push to a PR. No human in the loop.

---

## Tech stack

| Layer | Choice | Why it matters here |
| --- | --- | --- |
| Runtime | Node.js + TypeScript | Async I/O suits an event-driven webhook service |
| Framework | Express 5 | Thin, well-known HTTP layer |
| Queue | BullMQ + Redis (ioredis) | Decouples the webhook from slow work; gives retries/backoff for free |
| LLM | Google Gemini (`@google/genai`) | Generates the review; asked for structured JSON (`responseMimeType: "application/json"`) |
| GitHub integration | Octokit (REST API v3) + webhooks | Fetch PR/files, post review via `pulls.createReview`; PAT auth |
| Config | Zod-validated `env` | Fails fast on misconfigured environment |
| Logging | Pino + pino-pretty | Structured JSON logs; every line carries `requestId` |
| Tests | Vitest | Unit tests for parser, patch parsing, filtering, publish, signature, webhook routing |
| Database | PostgreSQL (Prisma) — **scaffolded, not wired** | Reserved for idempotency/analytics, deferred to V1-next |

---

## Key properties (memorize these — they are your talking points)

1. **Async by design** — the webhook handler does only signature-verify + enqueue + `200`. All slow work (GitHub fetches, LLM call, comment posting) happens in the worker. GitHub expects a webhook response within ~10s; an LLM call can take 10–60s+. Enqueueing is what makes this work.

2. **SHA-verified** — every payload is checked against `X-Hub-Signature-256` (HMAC-SHA256 over the raw body) before being processed. Invalid → `401`. Uses `crypto.timingSafeEqual` to avoid timing attacks.

3. **Retry-safe** — queue jobs retry up to **3 attempts** with **exponential backoff** (starts at 2s). A review is only posted once, after a successful LLM pass — we never post a broken/partial comment.

4. **Line-accurate** — Gemini is instructed to return exact source-file line numbers, and every returned issue is validated against the parsed patch (`filterReviewIssues`). Issues pointing at unchanged lines are dropped before posting.

5. **Traceable** — a `requestId` UUID is generated per webhook and threaded through queue job → worker → all log lines, so a single review can be traced end-to-end on failure.

---

## What is built (current state)

- Webhook endpoint with HMAC verification and event filtering (`opened` / `synchronize` only)
- BullMQ queue + worker with retry/backoff
- Diff → changed-lines parsing (`parsePatch`, unified diff format)
- Prompt builder (system rules + PR context + numbered changed lines + strict output format)
- Gemini call with JSON output mode
- AI response parser + Zod validation (handles markdown-wrapped, malformed, non-array, wrong-schema)
- Issue filtering against the diff (line + file must match)
- Review publishing to GitHub: inline comments (`side: "RIGHT"`) + summary body, via `pulls.createReview`
- Paginated file fetching (`github.paginate`, 100 per page)
- Request ID tracing middleware + Pino structured logging
- Vitest test coverage across the core modules

---

## What is deliberately deferred (own these in interviews)

| Deferred item | Status | Why deferred |
| --- | --- | --- |
| **Idempotency (DB layer)** | Prisma schema + client scaffolded, **not wired** | Duplicate webhook deliveries for the same SHA can double-review today |
| **GitHub App auth** | PAT-based today | Real setup cost (App creation, installation tokens, JWT); upgrade path documented |
| **Job dedup on bursts** | Not built | `opened → synchronize` in quick succession can enqueue multiple reviews for the same head SHA |
| **RAG-augmented review** | Not built (V2 idea) | Codebase/doc context beyond the diff; chunking/staleness/token questions unresolved |
| **Multi-model / repo rules / dashboard / GitLab** | Ideas | Not core signal |

These are scoping decisions, not oversights — the core pipeline works end-to-end first.

---

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| `POST` | `/webhooks/github` | Raw-body webhook entry; HMAC-verify → filter events → enqueue → `200 { queued: true }` |
| `GET` | `/health` | Liveness check → `200 { status: "ok" }` |

---

## Two processes

- `npm run dev` → API/webhook process (`src/server.ts` → `src/app.ts`)
- `npm run worker` → queue consumer (`src/workers/review.worker.ts`)

Both must run for end-to-end behavior. This split is itself a design point (scale the worker independently, see `04-system-design.md`).
