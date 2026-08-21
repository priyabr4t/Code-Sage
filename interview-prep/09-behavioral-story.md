# 09 — Behavioral Story & Talking Points

> How to tell the CodeSage story in interviews — STAR format, resume bullets, and the "tell me about a time" answers. Personalize the italicized placeholders with your actual experience.

---

## 1. Resume-ready summary bullets

- Designed and built **CodeSage**, a fully-automated AI code-review bot for GitHub: webhook receiver (HMAC-SHA256 verified) → BullMQ/Redis queue → worker → Google Gemini structured review → inline comments + summary posted via the GitHub Review API.
- Engineered **line-accurate AI reviews** by parsing unified diffs into exact new-file line numbers and hard-validating every model-returned issue against the diff before publishing — eliminating hallucinated-line comments.
- Built a **retry-safe, async pipeline**: webhook responds `200` in milliseconds, LLM work runs in a worker with exponential backoff (3 attempts); a malformed or empty model response never results in a broken GitHub post.
- Added **end-to-end observability** with a `requestId` correlation ID threaded through webhook → queue → worker → GitHub, and structured Pino JSON logging.
- Wrote a **Vitest suite** covering patch parsing, AI-response parsing/validation, issue filtering, review publishing (mocked Octokit), signature verification, and webhook event routing.
- Stack: TypeScript, Express 5, BullMQ + Redis, Google Gemini, Octokit, Zod, Pino, Vitest.

## 2. The 60-second story (memorize)

> "I built an AI code-review bot for GitHub. When a PR is opened or updated, GitHub posts a webhook. We verify it with an HMAC-SHA256 signature so we know it's really from GitHub, then we immediately enqueue a job on a Redis-backed BullMQ queue and return 200 — GitHub is happy and the slow work hasn't started yet. A worker picks the job up, fetches the PR and its changed files from the GitHub API, parses the diff to get exact changed-line numbers, and sends those lines to Google Gemini asking for a structured JSON list of issues. Every issue the model returns is validated against the actual diff — the line must really be a changed line — and only then do we post inline comments plus a summary back on the PR. The whole thing is async, retry-safe with exponential backoff, and line-accurate. Two notable things: I used a raw-body parser on the webhook so the HMAC is computed over the exact bytes, and I added a requestId that threads through the entire async pipeline for tracing."

## 3. STAR stories

### Story A — Solving unreliable AI line numbers (the technical highlight)

- **Situation:** The core problem was that LLMs hallucinate or shift line numbers. GitHub rejects inline comments that don't anchor to the actual diff, so a single bad line could fail the whole review.
- **Task:** Make automated reviews line-accurate and robust against model output.
- **Action:** Two-layer defense. First, a patch parser that walks unified diffs — reads the `@@` hunk header to get the true starting line number in the new file, records added lines with the running counter, and skips deleted lines. Second, a filter that builds a `Map<filename, Set<line>>` of real changed lines and drops any model issue not in it before publishing. I also hardened the JSON parser to strip markdown fences, reject non-arrays, and zod-validate each issue's shape, returning `[]` instead of crashing.
- **Result:** Malformed or off-target model output can't reach GitHub; the pipeline never posts a broken review. This is covered by tests and is the part of the project I'd defend hardest in a review.

### Story B — Async-first design under a webhook constraint

- **Situation:** GitHub webhooks expect a fast response, but the actual work is an LLM call that takes seconds.
- **Task:** Accept webhooks reliably without timing out or serializing reviews.
- **Action:** Split the system into a thin webhook handler (verify signature → filter events → enqueue → `200`) and a worker that does fetch → prompt → LLM → validate → publish. Used BullMQ so retries and exponential backoff came free rather than hand-rolled.
- **Result:** The webhook path is milliseconds; the worker scales independently; a slow or failing LLM never blocks webhook delivery. The trade-off — an idempotency gap and a second process — is documented.

### Story C — Deliberate scope discipline

- **Situation:** There was a long wishlist: GitHub App auth, RAG-augmented reviews, idempotency DB, job dedup, dashboards.
- **Task:** Ship a working core pipeline without getting stuck on nice-to-haves.
- **Action:** Prioritized the pipeline end-to-end, plus the two things most likely to matter in production judgment: signature verification and request tracing. Deferred the rest and wrote them into a documented decision log instead of silently dropping them.
- **Result:** A working bot with clear, honest limitations and an upgrade path — and I can articulate exactly why each deferred item is deferred.

---

## 4. Answer bank for common behavioral questions

**Q: Why did you build this?**
A: To scratch a real pain point — every PR deserves an immediate, consistent first-pass review, but humans are slow and inconsistent. It's also a project that exercises production backend judgment: webhooks, security, async processing, retries, third-party API integration, and validation of untrusted data.

**Q: What was the hardest part?**
A: Reliability of LLM output. It's non-deterministic and untrustworthy, but the output has to feed a strict API (GitHub's review API) with exact line numbers. The answer was defense-in-depth: prompt constraints + JSON mode + parsing/validation + a hard filter against the diff.

**Q: What would you do differently?**
A: Wire idempotency from day one — either a `ReviewedPR` DB row or deterministic BullMQ job IDs — so duplicate webhook deliveries can never double-review. And I'd move to GitHub App auth earlier. Both are documented upgrades, not regrets.

**Q: How do you handle feedback / work with others?** *(personalize)*
A: I write things down — the project has a decision log and an architecture doc precisely so future-me or teammates can see why choices were made. I'd review my own code with the same rigor: this is a solo-built project, so I lean on tests and documented trade-offs as the substitute for peer review.

**Q: Tell me about a time something failed / a bug.**
A: A malformed AI response or a model that "helpfully" returned issues on untouched lines. The first attempt trusted the model too much. I fixed it by adding validation layers (parser + zod + diff filter) and tests, so now a bad model response degrades to "no issues" and a warn log instead of a broken comment or crash.

**Q: How do you test something hard to test?**
A: Mock the boundaries — Octokit and Gemini — and test the pure logic in isolation: diff parsing with realistic hunks, response parsing with good/bad/markdown-wrapped JSON, filtering against changed-line sets, signature verification with valid/tampered payloads, and webhook routing across event types.

---

## 5. Numbers to have handy

- Queue retries: **3 attempts**, exponential backoff from **2s**
- Files fetched: paginated at **100 per page**
- Webhook path latency: **milliseconds** (verify + enqueue)
- Events handled: **`opened` / `synchronize`**
- Processes: **2** (API + worker)
- Test suites: patch-parser, parser, filtering, publish, signature, webhook routing
- Deferred: idempotency DB, GitHub App auth, job dedup, RAG, multi-model, repo rules

---

## 6. Two-sentence close (when they ask "anything else?")

> "The thing I'm most proud of is the correctness gate — the pipeline refuses to post anything that isn't validated against the real diff, so bad model output is safe by construction. The honest limitation is idempotency, and I've already designed the exact fix, which tells you I think about production trade-offs deliberately."
