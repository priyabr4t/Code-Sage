# CodeSage — Interview Prep

A collection of markdown notes for preparing to talk about **CodeSage**, the AI code-review bot for GitHub pull requests, in technical interviews.

All content is derived from the actual code in `backend/` (`src/`, `README.md`, `architecture.md`, `context.md`) — not from memory or guesswork. Read the code alongside these notes and you will be ready for both "explain your project" and deep technical grilling.

---

## How to use this folder

| Order | Read this first | If you have this much time |
| --- | --- | --- |
| 1 | `01-overview.md` — the 30-second pitch | 5 min |
| 2 | `03-flow-diagram.md` — how data moves | 10 min |
| 3 | `02-architecture.md` — every file, its job | 20 min |
| 4 | `05-probable-questions.md` — practice out loud | 30+ min |
| 5 | `06-cross-questions.md` — follow-up grilling | 30+ min |
| 6 | `07-tech-decisions.md` — the "why" behind choices | 15 min |
| 7 | `04-system-design.md` — scalability + trade-offs | 15 min |
| 8 | `08-key-concepts.md` — concept refreshers | skim |
| 9 | `09-behavioral-story.md` — STAR story + talking points | 10 min |

**Recommended routine:** read `01`–`03` first to internalize the architecture, then repeatedly practice `05`/`06` out loud. Have a friend ask you the cross-questions.

---

## The 30-second pitch

> CodeSage is an AI code-review bot for GitHub. When a pull request is opened or updated, GitHub sends a webhook to our Express server. We verify the payload with an HMAC-SHA256 signature, then hand the work to a BullMQ queue on Redis so we can respond `200` instantly. A worker pulls the job, fetches the PR's changed files from the GitHub API, parses the unified diff to extract exact changed-line numbers, builds a prompt, and asks Google Gemini for a structured JSON list of review issues. Every returned issue is validated against the actual diff — line number must match a changed line — before we post inline comments plus a summary back to the PR. It's async by design, retry-safe with exponential backoff, and line-accurate.

---

## File index

| File | Contents |
| --- | --- |
| `01-overview.md` | What the project is, tech stack, key properties, built vs deferred |
| `02-architecture.md` | Full component map, module responsibilities, connection ledger |
| `03-flow-diagram.md` | ASCII end-to-end flow, worker pipeline, data shapes, process topology |
| `04-system-design.md` | Design rationale, failure modes, scalability, upgrade paths |
| `05-probable-questions.md` | Categorized likely questions with model answers |
| `06-cross-questions.md` | Deep follow-up / "what if" questions with answers |
| `07-tech-decisions.md` | Decision log — why every major choice was made |
| `08-key-concepts.md` | Refreshers on webhooks, HMAC, BullMQ, GitHub Review API, diff format, structured LLM output |
| `09-behavioral-story.md` | STAR project story, resume bullets, "what would you improve" answers |

---

## Quick facts to remember

- **Name:** CodeSage
- **Repo:** `priyabr4t/Code-Sage` (backend is the only component)
- **Stack:** Node.js + TypeScript, Express 5, BullMQ + Redis, Google Gemini (structured JSON), Octokit (GitHub REST v3), Zod, Pino, Vitest
- **Entry points:** `npm run dev` (API), `npm run worker` (queue consumer) — two separate processes
- **Endpoints:** `POST /webhooks/github` (HMAC-verified, enqueues), `GET /health`
- **Job retries:** 3 attempts, exponential backoff starting at 2s
- **Known gaps (own them in interviews):** no idempotency yet (Prisma/Postgres scaffolded but unwired), PAT-based auth (GitHub App is a planned upgrade), no job dedup on webhook bursts
