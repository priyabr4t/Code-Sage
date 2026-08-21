# 05 — Probable Questions (with model answers)

> Practice these out loud. Answers are grounded in the actual code. Mark ones you stumble on and redo them.

---

## A. Project walkthrough / overview

**Q1. Tell me about a project you're proud of.**
A: CodeSage, an AI code-review bot for GitHub PRs. When a PR is opened or updated, GitHub sends a webhook. We verify it with an HMAC signature, enqueue a job on a Redis-backed BullMQ queue, and respond 200 instantly. A worker fetches the diff, sends the changed lines to Google Gemini as a structured-JSON request, validates every issue against the real diff, and posts inline comments plus a summary back on the PR. Async by design, retry-safe, line-accurate. TypeScript + Express, BullMQ/Redis, Gemini, Octokit.

**Q2. What problem does it solve?**
A: Manual PR review doesn't scale and is inconsistent. CodeSage gives every PR an immediate, consistent first-pass automated review — catching bugs, security issues, logic errors, and maintainability problems — so human reviewers focus on the important parts. It's fully automatic; no developer action needed after setup.

**Q3. What is your role in the project?**
A: I designed and built the entire backend — from the webhook signature verification and queueing, through the diff parsing and LLM integration, to posting reviews back to GitHub — plus the test suite.

**Q4. Walk me through the main flow.**
A: (Draw diagram from `03-flow-diagram.md`.) Webhook → requestId middleware → HMAC verify (401 on failure) → filter to opened/synchronize → enqueue job → 200. Worker: fetch PR → fetch files (paginated) → prepareReviewFiles with parsePatch → build prompt → Gemini returns JSON → parseReview (strip fences + zod) → filterReviewIssues (line must be a changed line) → if none valid, stop; else createReview posts inline comments + summary.

**Q5. What was the hardest technical problem?**
A: Making line numbers reliable. LLMs love to invent or shift line numbers, and GitHub rejects or misplaces inline comments that don't point at the diff. I solved it in two layers: (1) parsePatch walks the unified diff and computes exact new-file line numbers for added lines; (2) filterReviewIssues drops any issue whose file/line isn't in that set before we ever call GitHub. The parser also strips markdown fences and zod-validates the shape.

---

## B. Webhooks & security

**Q6. How do you verify a GitHub webhook is authentic?**
A: GitHub signs the raw body with HMAC-SHA256 using a shared secret. We receive it in the `X-Hub-Signature-256` header as `sha256=<hex>`. We recompute `crypto.createHmac('sha256', secret).update(rawBody)` and compare with `crypto.timingSafeEqual` to prevent timing attacks. Fail → 401.

**Q7. Why do you need the raw body?**
A: The HMAC is computed over the exact bytes GitHub sent. If we JSON.parse and re-serialize, the byte sequence changes and the signature won't match. That's why the webhook route uses `express.raw({ type: "application/json" })` and keeps the body as a Buffer; we parse it only *after* verification.

**Q8. Why `timingSafeEqual` instead of `===`?**
A: `===` on strings short-circuits at the first differing character, so an attacker can measure response time to guess the signature byte-by-byte. `timingSafeEqual` always takes the same time regardless of how much matches. Note it requires equal lengths, so we also guard length before comparing.

**Q9. What events do you process and why?**
A: `opened` (new PR) and `synchronize` (new commits pushed). Anything else — edited, closed, labeled, etc. — is answered with `200 { ignored: true }` and no job, so GitHub doesn't retry and we don't waste work.

**Q10. What if a malicious actor hits your webhook endpoint?**
A: Without a valid signature they get 401. The secret is only in `.env` (gitignored), validated at startup by zod. Even a correct-signature spammer just enqueues jobs — the queue absorbs it and we never post wrong content because issues are validated against the diff.

---

## C. Queueing & async design

**Q11. Why a queue instead of doing the work inline?**
A: GitHub expects a webhook response fast, and the LLM call takes seconds. Inline would block the request, risk timeouts and retries, and serialize all reviews. With the queue we respond immediately, retries and backoff come free, and we can scale workers independently. (Details in `04-system-design.md`.)

**Q12. What queue technology and why?**
A: BullMQ on Redis. BullMQ is a mature, feature-rich job queue for Node: job persistence, retries, exponential backoff, stalled-job handling, worker concurrency, and job events for observability. Redis gives durability and is trivial to run locally with Docker.

**Q13. How do retries work?**
A: `defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 2000 } }`. If the worker throws, the job is retried after 2s, then ~4s, up to 3 attempts, then stays failed in Redis. Only the worker can throw — the webhook already returned 200. We never post a partial/broken comment because a review is only published at the end of a fully successful pipeline.

**Q14. What happens if the worker crashes mid-job?**
A: BullMQ's stalled-job detection re-delivers the job to another worker (at-least-once semantics). Because the review is only posted at the very end and re-processing the same PR is idempotent-ish for content, the worst case today is a possible duplicate review — which the planned `ReviewedPR` dedup closes.

**Q15. Can two workers process the same job?**
A: BullMQ locks jobs while processing; a job is only re-processed if it's stalled (worker died without completing/acknowledging). So normally no. This is the at-least-once trade-off of message queues — exactly-once isn't possible in distributed systems without an idempotency layer.

---

## D. GitHub API & diff handling

**Q16. How do you fetch a PR and its changes?**
A: Octokit (`@octokit/rest`), authenticated with a PAT. `pulls.get` for PR metadata; `pulls.listFiles` paginated (100 per page) via `github.paginate` to get all files with their patches.

**Q17. How do you get accurate line numbers from a diff?**
A: parsePatch reads the unified diff. The `@@ -a,b +c,d @@` hunk header gives the starting line number in the new file. Added lines (`+`) get recorded with the running new-file line counter and their code; deleted lines are skipped; context lines advance the counter. This yields exact, real source-file line numbers for added lines.

**Q18. What does "side: RIGHT" mean?**
A: In GitHub's review API, `RIGHT` is the new (after) version of the file. Since we only comment on added lines in the new version, side must be RIGHT. Using the wrong side or a line that isn't in the diff makes GitHub reject the comment.

**Q19. How do you post the review?**
A: `pulls.createReview` with `commit_id` (the head SHA), `event: "COMMENT"`, a summary `body`, and `comments[]` — each `{ path, line, side: "RIGHT", body }`. One API call posts all inline comments plus the summary. We only call this if there's at least one valid issue.

**Q20. What about files with no patch / binary files?**
A: `prepareReviewFiles` filters out files without a `patch` (binaries, images, etc. — GitHub doesn't include patches for them). Those files simply never reach the LLM.

---

## E. AI / LLM integration

**Q21. How do you get structured output from Gemini?**
A: Two layers. (1) `responseMimeType: "application/json"` tells the model to emit JSON. (2) `parseReview` is defense-in-depth: it strips markdown fences, JSON.parses, checks it's an array, and zod-validates each object's shape (`filename`, `line: int`, `explanation`, optional `suggestedFix`). Any failure → return `[]`, never throw garbage.

**Q22. What does the prompt look like?**
A: Four sections built by `buildReviewPrompt`: system instructions (senior engineer persona, report only bugs/security/logic/performance/maintainability, explicit list of what NOT to report, and "return empty array if nothing actionable"), PR title + description, the changed files each with numbered changed lines (`42 | const token = ...`), and strict output instructions (valid JSON only, exact line numbers, one object per issue).

**Q23. What if the model returns issues on unchanged lines?**
A: `filterReviewIssues` builds a `Map<filename, Set<line>>` from the parsed changed lines and drops any issue not in it. That's a hard correctness gate between the model and GitHub — hallucinated or shifted line numbers can't reach the PR. Dropped ones are warn-logged with `requestId`.

**Q24. What if the model returns nothing?**
A: Fine by design. The prompt explicitly says to return `[]` when there's nothing actionable. `valid.length === 0` → we log "No actionable issues found" and stop — no GitHub call at all.

**Q25. How do you prevent prompt injection or bad reviews?**
A: The prompt scopes the model hard: only changed lines provided, do not assume code not in the patch, return only issues, use the given line numbers. Output is schema-validated. We don't execute anything from model output — it's text comments only.

**Q26. Why Gemini?**
A: Good structured-output support, JSON mime type, cost-effective, simple SDK. The `ai.service` is thin so a different provider could be swapped in (a noted V2 idea is provider-agnostic multi-model support).

---

## F. Parsing, validation & types

**Q27. Why zod?**
A: Runtime validation of untrusted input. It validates env config at startup (fail fast on typos/missing values) and validates the LLM's JSON output (shape guarantees before we touch GitHub's API). TypeScript types are compile-time only; zod is the runtime safety net.

**Q28. What malformed LLM responses do you handle?**
A: Markdown-wrapped JSON (``` fences), leading/trailing whitespace, non-JSON text, JSON that isn't an array, arrays with missing fields/wrong types. Each path is handled and logged, returning `[]` rather than throwing — an empty review is better than a crash or a garbage comment.

**Q29. Why does `parseReview` return `[]` instead of throwing?**
A: A malformed AI response isn't a system failure worth 3 retries — it's a model output issue. Returning `[]` means the job completes cleanly with "no issues," which is a safe, honest outcome. We log the warning so it's observable.

---

## G. Architecture & code quality

**Q30. How is the code structured?**
A: Feature-based modules — `github/`, `review/`, `ai/` — each with their own routes/controllers/services/types, plus shared `config`, `lib`, `middleware`, `queues`, `workers`. This scales better than flat controllers/services and keeps related code together. See `02-architecture.md`.

**Q31. How do you trace a request end-to-end?**
A: `requestId` middleware assigns a UUID per request. The controller copies it into the BullMQ job payload. The worker threads it through every log call. So you can grep logs for one `requestId` and see webhook receipt → enqueue → worker steps → GitHub publish. Pino gives structured JSON logs.

**Q32. How do you handle configuration?**
A: All env vars are read through a single zod-validated `env` object. If any required var is missing/malformed, the app refuses to start. No magic strings scattered across the codebase.

**Q33. How do you handle errors at each layer?**
A: Controller → try/catch → 500 (webhook is best-effort after verification). Worker → throws on real failures so BullMQ retries; logs errors with requestId, jobId, repo, pr. AI parser → never throws on bad model output, returns []. GitHub service → lets API errors propagate to the worker for retry.

**Q34. Why TypeScript?**
A: Type safety across the pipeline (typed payloads, job shapes, issue shapes), better refactoring, and it catches a class of bugs at compile time. Zod covers the runtime/untrusted boundaries.

---

## H. Testing

**Q35. How do you test the pipeline without hitting real GitHub/Gemini?**
A: Vitest with mocks/fixtures. Test suites: patch-parser (hunks, added/deleted/context lines, file headers), parser (JSON, markdown-wrapped, malformed, non-array, zod failures), issue filtering, review publishing (mocked Octokit), signature verification (valid/tampered/missing), and webhook routing (open/synchronize vs ignored events).

**Q36. What's the riskiest thing to test and how do you test it?**
A: Line-number correctness, because a wrong line makes GitHub reject the comment. Covered directly by parsePatch tests (exact numbers across multi-hunk diffs) and by filterReviewIssues tests (issues on unchanged lines are dropped).

---

## I. Deployment & operations

**Q37. How do you run it in production?**
A: `npm run build` (tsc) + `npm start` for the API, plus a separate worker process. Docker Compose for Postgres + Redis. `docker compose up -d`. Deployment target was Railway/Render (per design doc). Webhook registered on the repo's GitHub settings pointing at the API host.

**Q38. What's your approach to environment setup?**
A: `.env.examples` documents every variable; `.env` is gitignored; zod validates at startup so a missing key fails loudly in seconds rather than mysteriously at runtime.

---

## J. Limitations & future work (asked as "what's missing")

**Q39. What are the current limitations?**
A: (1) No idempotency yet — Prisma/Postgres is scaffolded but not wired, so duplicate webhooks for the same SHA can double-review. (2) PAT-based auth rather than a GitHub App. (3) No job dedup on rapid bursts (opened → synchronize). (4) Diff-only context (no RAG). (5) Single model. All documented, none block the core pipeline.

**Q40. How would you fix the duplicate-review problem?**
A: Two options. Cheapest: deterministic BullMQ `jobId` = `${repo}#${pr}#${sha}`, so re-adding the same job is a no-op. More robust: `ReviewedPR` table — skip enqueueing if `lastReviewedSha === head.sha`, and upsert status after completion. The schema already exists.

**Q41. How would you make the review smarter?**
A: RAG-augmented reviews — index the codebase (e.g., pgvector) so the model sees relevant file context, not just the diff. Also repo-specific rules (`codesage.yml`), severity scoring, and multi-model support. Deferred deliberately because chunking/staleness/token questions need a proper design first.

**Q42. What would you do if reviews cost too much or took too long?**
A: Cost: bound prompt size (cap files/lines per job, drop generated/lockfiles), batch, choose cheaper model, cache identical diffs. Latency: more workers, per-file chunking with parallel LLM calls, model with lower latency.

---

## K. Personal / behavioral

**Q43. Why did you choose a queue + worker split?**
A: It's the correct architecture for "accept a fast webhook, do slow work." I'd built a similar queue pattern before, and BullMQ gave me proper backoff instead of hand-rolled retries. The trade-off (extra Redis dependency, idempotency gap) was worth it — and I documented the trade-offs in a decision log.

**Q44. What would you do differently if you started over?**
A: Wire the idempotency layer from day one (or use deterministic job IDs), and set up a GitHub App auth instead of a PAT. Those two would have prevented the duplicate-review limitation from ever existing. I'd also add request logging of payload size and add a `codesage.yml` rules file earlier.
