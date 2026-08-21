# 06 — Cross-Questions (deep follow-ups / grilling)

> These are the questions a good interviewer asks *after* you've explained the project — the "what if", "why not", and "edge case" probes. Answer them out loud.

---

## 1. Signature & webhook correctness

**Q: What happens if GitHub sends a `sha1=` signature instead of `sha256=`?**
A: We only look at `X-Hub-Signature-256`. We'd never see a plain `X-Hub-Signature` header — and if the 256 header is missing we reject with 401. GitHub webhooks are configured with a secret and send the 256 header; that's the secure default.

**Q: What if two different secrets sign two requests — can a length check leak anything?**
A: We guard `digest.length !== signature.length` before `timingSafeEqual`, so mismatched lengths return false immediately. An attacker learns nothing from that because they can't produce a valid signature anyway without the secret.

**Q: Your code parses `req.body.toString()` after verifying. What if the JSON is malformed?**
A: It throws, caught by the controller's try/catch → `500 { message: "Internal server error" }`. We could respond 400 Bad Request instead, but 500 is safe — GitHub will treat it as a delivery failure and retry. Not a correctness problem.

**Q: Why do you verify the signature before parsing the body?**
A: Two reasons: (1) the signature is over the exact raw bytes, so we must not transform the body before verifying; (2) reject-as-early-as-possible keeps untrusted work minimal. An unverified body should never be parsed or acted on.

**Q: Could someone replay a captured webhook?**
A: Yes — webhooks are not protected against replay, GitHub doesn't include a timestamp that we validate. If an attacker captured a valid request (they'd need network access) they could replay it. Impact: an extra queued job → potentially a duplicate review. Low risk; idempotency would make replays harmless. If we wanted to be stricter we could check a `X-GitHub-Delivery` header we've seen before, or store `requestId`/delivery IDs.

## 2. Queue / BullMQ internals

**Q: What exactly does "attempts: 3" mean?**
A: The job can be processed up to 3 times total. If the worker throws on attempt 1, BullMQ moves it to a delayed/waiting state and re-delivers after the backoff delay; each failure increments the counter. After 3 failed attempts the job is moved to the `failed` state in Redis.

**Q: How does exponential backoff actually compute the delay?**
A: BullMQ's `exponential` backoff uses `delay * 2^(attempt-1)` capped at 30s. With delay=2000ms: attempt 2 waits ~2s, attempt 3 waits ~4s. The randomness and cap are internal details, but the shape is "grow the wait between retries."

**Q: What failure types do you retry vs not retry?**
A: Right now we retry everything the worker throws — transient stuff (Gemini timeout, GitHub 5xx, network) and permanent stuff alike. A better design distinguishes them: transient → retry with backoff; permanent (e.g., PR closed mid-review) → fail fast / dead-letter. I'd refine this with a typed error model in the worker.

**Q: Is Redis a single point of failure?**
A: In the current setup, yes. Mitigations: run Redis with persistence (AOF/RDB) and a replica, or use a managed service (Upstash/Redis Cloud). Redis isn't the source of truth for review *content* — it's a job queue — so losing it means retried/dropped jobs, not corrupt data.

**Q: Why BullMQ and not just Redis lists + BRPOPLPUSH?**
A: BullMQ gives: delayed jobs, retries + backoff, stalled-job recovery, worker locking, job events/observability, a dashboard, and a solid API. Hand-rolling BRPOPLPUSH would mean reimplementing every one of those and debugging it myself. BullMQ is the mature choice.

## 3. Diff parsing edge cases

**Q: Your parser handles `@@` and `+`/`-`/space lines. What about `+++` file headers and `---`?**
A: Handled by the guards `!line.startsWith("+++")` and `!line.startsWith("---")` — a `+++ b/file.ts` header starts with `+++` and must not be treated as an added line. Same for `---`. Also `\ No newline at end of file` lines start with `\`, which neither increments nor records — they're ignored.

**Q: What about a hunk header like `@@ -1 +1,2 @@` (no comma on the old side)?**
A: The regex `\+(\d+)(?:,\d+)?` makes the `,count` part optional, so `+1,2` and `+1` both parse; we only need the starting new-file line number.

**Q: What about multiple hunks in one patch?**
A: Each `@@` header resets `newLine` to that hunk's new-file start. So changed lines from later hunks get correct numbers even after earlier deletions shifted things. Covered in the parsePatch tests.

**Q: Your parser records added lines only. What if you wanted to comment on deleted lines?**
A: Deleted lines don't exist in the new file — GitHub can't anchor an inline comment there via `pulls.createReview` (you'd need the old-file position/side LEFT, which requires more complex anchoring). For V1, reviewing added lines is the right scope: new bugs are introduced by added code. Deleting-bad-code suggestions can live in the summary. This is a deliberate scope choice.

**Q: What if a diff line contains a `+` but is actually a context line (e.g., `++` in a string)?**
A: Not an issue — in unified diff format, the *position* of the character is what matters: a line starting with `+` in the patch body is, by format definition, an added line. The actual code content starts after that marker. (The `+++` guard exists only because file headers also start with `+`.)

**Q: How do you handle a file renamed with changes?**
A: GitHub's patch for a renamed+modified file contains hunks against the new filename, so our parser treats it normally — the new filename is what `pull_request.file.filename` reports and what we comment on.

## 4. LLM / output robustness

**Q: You ask for `responseMimeType: "application/json"`. What if the model still returns markdown or extra text?**
A: That's why `parseReview` strips code fences (` ```json ` / ` ``` `) and trims before parsing. Defense-in-depth: the mime type is the primary lever, the parser is the safety net. If it still can't parse → `[]`, logged.

**Q: The prompt says "return empty array if nothing." Can you trust the model to follow it?**
A: Not fully — that's why we *also* validate: any issue not pointing at a changed line is filtered, and malformed JSON is rejected. Even a "chatty" model can't get bad content through to GitHub. The filter is a hard correctness gate independent of the model's compliance.

**Q: What about the model inventing an issue about code NOT in the diff?**
A: Three defenses: the prompt forbids assuming code not present; only changed lines are even shown to the model; and `filterReviewIssues` only keeps issues on changed lines. The model physically can't get a filename we didn't pass into the pipeline.

**Q: What if Gemini is rate-limited or down for an hour?**
A: Every job retries 3 times with backoff, then sits failed. A long outage means failed jobs that need reprocessing — another reason idempotency/status tracking (`ReviewLog`, `status=FAILED`) matters for operations. In production I'd add an alert on failed-job rate and a manual re-trigger endpoint.

**Q: How do you keep the prompt within token limits for huge PRs?**
A: We already filter patchless files and send only *changed lines* (not the whole file, not the whole patch verbatim) with line numbers — that's compact. For very large PRs, next step is a per-file size cap and/or splitting the review into multiple jobs and aggregating.

**Q: Do you log the full prompt or any secrets?**
A: The design doc planned to store the prompt in `ReviewLog` for debugging. We don't log the PAT or API keys. Secrets never appear in logs; logging is structured (Pino) so we control exactly what's emitted.

## 5. GitHub publish correctness

**Q: What does the GitHub API do if one comment in the array has a bad line?**
A: It can reject the whole review creation call. That's a strong reason to validate everything before calling `pulls.createReview` — and why `filterReviewIssues` exists. All-or-nothing single API call keeps the PR consistent.

**Q: `commit_id` uses the head SHA from the webhook. What if it's stale by the time the worker runs?**
A: The review is anchored to the commit we fetched the diff for — that's actually correct behavior: the review matches the code we analyzed. If the PR moved on, a fresh `synchronize` webhook arrives and triggers a new review. No mismatch problem.

**Q: Why `event: "COMMENT"` rather than `"REQUEST_CHANGES"` or `"APPROVE"`?**
A: CodeSage reports issues; it shouldn't block merges or gate CI. `COMMENT` posts feedback without changing review status — a bot that auto-approves is risky, and auto-requesting changes on every issue would be noisy. Non-blocking by design.

**Q: What if the same issue shows up on two lines or the model returns duplicates?**
A: We don't dedupe today. Minor noise risk. Could add a dedupe keyed on `filename:line:explanation` before publishing. Not a correctness issue since each is validated.

## 6. Idempotency & the "double review" trap

**Q: GitHub is at-least-once. Walk me through the duplicate scenario.**
A: GitHub retries undelivered/errored webhooks, and a PR that's opened then gets a push produces `opened` then `synchronize`. Both enqueue jobs for (possibly) the same SHA. Two jobs → two workers → two LLM calls → two `pulls.createReview` calls → two reviews on one PR. Content is identical so it's not *wrong*, just duplicated and wasteful.

**Q: How do you stop that?**
A: Cheapest fix: deterministic BullMQ job ID (`${repo}#${pr}#${sha}`) — `queue.add` with the same `jobId` is a no-op. Robust fix: a `ReviewedPR` row per (repo, pr); before enqueueing, skip if `lastReviewedSha === head.sha`; worker upserts status. Both are designed; the DB one is the documented V1-next plan.

**Q: Is the queue at-least-once or exactly-once?**
A: At-least-once. BullMQ can re-deliver a job after a worker crash/stall. Exactly-once in distributed systems is impossible; you add idempotency at the consumer instead. Our consumer's "side effect" (posting a review) is the idempotency target.

## 7. Architecture & code review of YOUR code

**Q: The worker does everything in one function — why not split into more services?**
A: The pipeline is linear and short: fetch → prepare → prompt → generate → filter → publish. A single orchestrator is readable and matches the flow; the *steps* are already separated into testable modules. I'd extract an orchestrator class only if the pipeline gained branching (e.g., per-file chunking, retry-on-specific-errors).

**Q: `express.raw` then `express.json` in app.ts — is the order right?**
A: Yes. Middleware applies in registration order per request. The webhook path matches the raw parser (mounted first on `/webhooks/github`), other paths fall through to `express.json()`. The webhook route never hits the JSON parser, so its body stays a Buffer.

**Q: Why is the requestId stored only on `req` and in the job — not on `res`?**
A: It's for end-to-end tracing of the review pipeline, which is async (webhook → worker → GitHub). Response correlation is less important here since we return 200 immediately. We could add an `X-Request-Id` response header for client-side correlation too — a nice-to-have.

**Q: What's the risk of a memory leak with the singleton Octokit/Gemini clients?**
A: None practically — both hold HTTP/keep-alive connections managed by the SDK. Singletons also avoid recreating auth contexts per call. The classic mistake (creating a client per request) is avoided.

## 8. Scale / load

**Q: 100 PRs a minute. What breaks first?**
A: Cost, not throughput. The webhook handler is cheap and Redis absorbs bursts. The bottleneck is LLM time/cost and GitHub rate limits. So: cap/skip trivial diffs, chunk large ones, and scale workers. Pagination already handles large file lists.

**Q: A PR with 500 files and a giant diff. What happens?**
A: We fetch all 500 (paginated), parse, build a big prompt. Risks: token limits, slow response, cost. Mitigations (not yet built): filter generated/lockfiles, per-file cap, split into multiple jobs, drop `dist/`/node_modules per design doc's filter plan.

**Q: Would you use a different queue at massive scale?**
A: BullMQ stays viable; Redis becomes the constraint. Options: BullMQ Pro (scalable client), or Kafka-style log for durable event streams. For this use case — low-volume, high-value jobs — BullMQ is the right simplicity/durability trade-off.

## 9. Security hardening

**Q: The webhook endpoint is public. Rate limit it?**
A: Worth adding at the ingress (reverse proxy / IP-based). But the real gate is the signature: unauthenticated callers get 401. Signature verification is cheap, so even floods are just rejected.

**Q: Should the summary body trust LLM output as markdown?**
A: It's posted to the PR as markdown, which GitHub renders. Since we control the prompt and it only reflects code we fed it, injection risk is low — but "never execute model output" is the rule. Sanitizing user-supplied PR description content that flows into the prompt is a consideration (a hostile PR description trying prompt injection). The prompt explicitly scopes the model to changed lines, which limits that.

**Q: Secrets in `.env` — what's the deploy story?**
A: `.env` is gitignored; `.env.examples` documents keys (with a duplicated secret line I should clean up). In production, env vars come from the platform's secret store, never committed. Zod validates presence/shape at boot.

## 10. What-if hypotheticals

**Q: What if GitHub deprecates REST v3?**
A: Octokit is the officially maintained SDK; migration to GraphQL would be contained in `lib/github.ts` + the two service files. The abstraction boundary is already there.

**Q: What if you had to support GitLab next week?**
A: The pipeline (queue → prompt → validate → publish) is provider-agnostic. I'd abstract a `VcsProvider` interface with `getPr`, `getFiles`, `createReview` behind `github/`'s current services, then add a GitLab implementation. The diff parser and AI layer wouldn't change.

**Q: What if the PR author is the bot itself (a bot pushing a fix commit)?**
A: Webhook would still fire and we'd review it. Could add a filter to skip reviews when `pull_request.user` is a bot, to avoid infinite feedback loops. Not currently handled; a real edge case worth a guard.

**Q: What if you want only security issues, no style nags?**
A: That's already the design — the prompt explicitly forbids style/naming/formatting and requires each issue to pass "does this cause incorrect behavior / security risk / performance impact / harder maintenance?" The output schema could add a `severity`/`category` field to make filtering explicit (the context.md design even sketched `counts: { security, performance, readability }`).

**Q: How would you add a "retry failed review" button?**
A: A `POST /reviews/:repo/:pr/retry` endpoint that re-enqueues a job with the current head SHA — it's in the context.md design for the V1 API surface. Pairs with `ReviewLog`/`ReviewedPR` status to only show retryable failures.
