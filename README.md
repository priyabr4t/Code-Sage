# CodeSage

An automated pull request review service powered by AI. CodeSage listens for GitHub webhook events, processes PR diffs through Google Gemini, and posts inline code review comments directly on the pull request.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [API Endpoints](#api-endpoints)
- [Worker Pipeline](#worker-pipeline)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Running Tests](#running-tests)
- [License](#license)

---

## How It Works

When a pull request is opened or updated on a connected GitHub repository, GitHub sends a webhook event to CodeSage. The service verifies the request signature using HMAC-SHA256, then enqueues a review job via BullMQ (backed by Redis) and immediately responds with a 200 to avoid blocking GitHub.

A separate worker process picks up the job and executes the review pipeline: it fetches the PR metadata and changed files from the GitHub API, parses the diff patches to extract the exact lines that were added, builds a structured prompt, and sends it to Google Gemini. The AI response is parsed from JSON, validated against a Zod schema, and then filtered so that only issues referencing actual changed lines survive. If any actionable issues remain, the worker posts them as inline review comments on the PR along with a summary.

Every request is tagged with a `requestId` (UUID) that propagates from the webhook handler through the queue and into the worker, providing end-to-end traceability across the entire pipeline.

---

## Architecture

```mermaid
flowchart TD
    A["GitHub PR Event\n(opened / synchronize)"] -->|"POST /webhooks/github"| B["Express API"]

    subgraph API ["API Layer"]
        B --> C["HMAC Signature Verification"]
        C --> D["requestId Middleware"]
        D --> E["Webhook Controller"]
    end

    E -->|"Enqueue ReviewJob"| F["BullMQ Queue"]
    F --- G[("Redis")]

    F -->|"Deliver job to worker"| H["Review Worker"]

    subgraph Worker ["Worker Pipeline"]
        H --> I["Fetch PR Metadata\n(Octokit)"]
        I --> J["Fetch Changed Files\n(paginated)"]
        J --> K["Parse Patches\n(extract changed lines)"]
        K --> L["Build Review Prompt"]
        L --> M["Call Gemini API\n(JSON response)"]
        M --> N["Parse + Validate Response\n(Zod schema)"]
        N --> O["Filter Issues\n(changed lines only)"]
    end

    O -->|"Valid issues found"| P["Post Review to GitHub\n(inline comments + summary)"]
    O -->|"No issues found"| Q["Skip -- log and finish"]

    P --> R["GitHub Pull Request\n(comments appear on PR)"]

    subgraph Infrastructure ["Infrastructure"]
        G
        S[("PostgreSQL\n(reserved)")]
    end
```

---

## Tech Stack

| Layer      | Technology                      | Purpose                                                        |
| ---------- | ------------------------------- | -------------------------------------------------------------- |
| Runtime    | Node.js + TypeScript            | Application runtime and type safety                            |
| Framework  | Express 5                       | HTTP server and routing                                        |
| Queue      | BullMQ + Redis                  | Job queuing with automatic retry and exponential backoff       |
| AI         | Google Gemini (`@google/genai`) | Code review generation with JSON output mode                   |
| GitHub     | Octokit (`@octokit/rest`)       | GitHub REST API v3 client for fetching PRs and posting reviews |
| Database   | PostgreSQL + Prisma             | Persistence layer (schema defined, not yet wired into runtime) |
| Validation | Zod                             | Environment variable and AI response schema validation         |
| Logging    | Pino + pino-pretty              | Structured JSON logging with pretty-print for development      |
| Testing    | Vitest                          | Unit test runner                                               |

---

## Project Structure

```
backend/
  src/
    app.ts                          # Express app setup, mounts routes and middleware
    server.ts                       # Entry point, starts the HTTP server
    test-setup.ts                   # Vitest setup file

    config/
      env.ts                        # Zod-validated environment variable singleton

    lib/
      github.ts                     # Singleton Octokit client (PAT auth)
      redis.ts                      # BullMQ Redis connection config
      prisma.ts                     # Prisma client with pg adapter (reserved)

    middleware/
      requestId.middleware.ts       # Assigns a UUID requestId to every request

    modules/
      github/
        github.routes.ts            # POST / route (mounted at /webhooks/github)
        github.controller.ts        # Verifies signature, filters events, enqueues job
        github.service.ts           # getPullRequest, getPullRequestFiles (paginated)
        review.service.ts           # createReview -- posts inline comments to GitHub
        verifyGithubSignature.ts    # HMAC-SHA256 signature verification
        github.types.ts             # PullRequestWebhookPayload type

      ai/
        ai.client.ts                # Singleton GoogleGenAI client
        ai.service.ts               # generateReview -- calls Gemini, parses response
        parser.ts                   # parseReview -- strips fences, JSON.parse, Zod gate
        parser.types.ts             # ReviewIssue type
        prompt.service.ts           # buildReviewPrompt -- assembles the LLM prompt
        prompt.types.ts             # ReviewContext type

      review/
        review.service.ts           # prepareReviewFiles, filterReviewIssues
        patch-parser.ts             # parsePatch -- extracts added lines from diff hunks
        review.types.ts             # ReviewFile, ChangedLines types

    queues/
      review.queue.ts               # BullMQ queue ("review-queue"), 3 attempts, exp backoff
      review.job.ts                 # ReviewJob payload type

    workers/
      review.worker.ts              # Consumes jobs: fetch, prepare, prompt, review, post

    shared/
      logger.ts                     # Pino logger with pretty transport

    scripts/
      test-github.ts                # Dev helper: test GitHub API calls
      test-modelsList.ts            # Dev helper: list available Gemini models
      test-signature.ts             # Dev helper: test webhook signature verification

  prisma/
    schema.prisma                   # Review model + ReviewStatus enum (PostgreSQL)

  docker-compose.yml                # PostgreSQL 16 + Redis 7 (Alpine)
  package.json
  tsconfig.json
  vitest.config.ts
  prisma.config.ts
```

---

## API Endpoints

### Implemented

#### `POST /webhooks/github`

Receives GitHub webhook events for pull request activity.

| Aspect      | Detail                                                                               |
| ----------- | ------------------------------------------------------------------------------------ |
| **Headers** | `X-Hub-Signature-256` (required), `X-GitHub-Event`, `Content-Type: application/json` |
| **Body**    | Raw JSON payload from GitHub (parsed as a Buffer for signature verification)         |
| **Auth**    | HMAC-SHA256 signature verified against `GITHUB_WEBHOOK_SECRET`                       |

**Behavior:**

1. Verifies the `X-Hub-Signature-256` header using HMAC-SHA256. Returns `401` if invalid.
2. Parses the payload and checks the `action` field. Only `opened` and `synchronize` actions proceed. All other actions return `200 { ignored: true }`.
3. Enqueues a `review-pr` job to BullMQ with the payload `{ requestId, repository, prNumber, sha }`.
4. Returns `200 { queued: true }`.

**Error response:** `500 { message: "Internal server error" }` if an unexpected error occurs.

---

#### `GET /health`

Liveness check endpoint.

| Aspect       | Detail                 |
| ------------ | ---------------------- |
| **Response** | `200 { status: "ok" }` |

---

### Planned (Not Yet Implemented)

The following endpoints are documented in the project design but are not present in the current source code. They are planned for a future iteration that wires up the Prisma persistence layer.

| Method | Path                                     | Description                                                             |
| ------ | ---------------------------------------- | ----------------------------------------------------------------------- |
| `GET`  | `/reviews`                               | List recent reviewed PRs. Supports `?repo=owner/name` filter.           |
| `GET`  | `/reviews/:repoFullName/:prNumber`       | Get review status and history for a specific PR, including log entries. |
| `POST` | `/reviews/:repoFullName/:prNumber/retry` | Manually re-trigger a review for a specific PR.                         |

---

## Worker Pipeline

The review worker (`review.worker.ts`) runs as a separate process and consumes jobs from the `review-queue`. Each job goes through the following steps:

1. **Fetch PR metadata** -- Calls `getPullRequest(owner, repo, prNumber)` via Octokit to retrieve the PR title, description, state, and author.

2. **Fetch changed files** -- Calls `getPullRequestFiles(owner, repo, prNumber)` with pagination (`per_page: 100`) to get all files modified in the PR, including their patches.

3. **Prepare review files** -- Filters out files without a patch (e.g., binary files). For each remaining file, runs `parsePatch()` to extract the exact added lines and their line numbers from the diff hunks.

4. **Build review prompt** -- Assembles a structured prompt containing system instructions (what to report, what to ignore), the PR title and description, and the changed lines for each file with their exact line numbers.

5. **Generate AI review** -- Sends the prompt to Gemini with `responseMimeType: "application/json"`. The JSON response is stripped of any markdown code fences, parsed, and validated against a Zod schema to produce a `ReviewIssue[]` array.

6. **Filter issues** -- Compares each `ReviewIssue` against the actual changed lines. Any issue referencing a file or line number not present in the diff is discarded. This prevents hallucinated line references from reaching the PR.

7. **Post or skip** -- If no valid issues remain, the worker logs "No actionable issues found" and finishes without calling GitHub. Otherwise, it builds a summary (issue counts per file) and posts a review via `pulls.createReview` with inline comments on the `RIGHT` side of the diff.

**Retry policy:** The queue is configured with 3 attempts and exponential backoff (starting at 2000ms). If the worker throws an error, BullMQ retries the job automatically.

---

## Environment Variables

All variables are validated at startup via Zod. The server will fail to start if any required variable is missing or invalid.

| Variable                | Type         | Required | Default | Description                                          |
| ----------------------- | ------------ | -------- | ------- | ---------------------------------------------------- |
| `PORT`                  | number       | No       | `3000`  | Port the Express server listens on                   |
| `DATABASE_URL`          | string (URL) | Yes      | --      | PostgreSQL connection string                         |
| `REDIS_URL`             | string (URL) | Yes      | --      | Redis connection string for BullMQ                   |
| `GITHUB_TOKEN`          | string       | Yes      | --      | GitHub Personal Access Token with repo access        |
| `GITHUB_WEBHOOK_SECRET` | string       | Yes      | --      | Secret used to verify GitHub webhook HMAC signatures |
| `GEMINI_API_KEY`        | string       | Yes      | --      | Google Gemini API key                                |
| `GEMINI_MODEL`          | string       | Yes      | --      | Gemini model identifier (e.g., `gemini-2.0-flash`)   |

---

## Getting Started

### Prerequisites

- Node.js (v20 or later recommended)
- Docker and Docker Compose (for PostgreSQL and Redis)
- A GitHub Personal Access Token with `repo` scope
- A GitHub webhook secret (any random string you configure on your repo webhook)
- A Google Gemini API key

### Setup

1. **Clone the repository**

```bash
git clone https://github.com/priyabr4t/Code-Sage.git
cd Code-Sage/backend
```

2. **Install dependencies**

```bash
npm install
```

3. **Configure environment variables**

```bash
cp .env.examples .env
```

Edit `.env` and fill in all required values:

```
PORT=3000
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/prreview
REDIS_URL=redis://localhost:6379
GITHUB_TOKEN=ghp_your_token_here
GITHUB_WEBHOOK_SECRET=your_webhook_secret
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
```

4. **Start infrastructure services**

```bash
docker compose up -d
```

This starts PostgreSQL (port 5433) and Redis (port 6379).

5. **Generate Prisma client**

```bash
npm run prisma:generate
```

6. **Start the API server**

```bash
npm run dev
```

7. **Start the worker** (in a separate terminal)

```bash
npm run worker
```

8. **Configure a GitHub webhook** on your repository pointing to your server's `/webhooks/github` endpoint with the content type set to `application/json` and the secret matching your `GITHUB_WEBHOOK_SECRET`. Select "Pull requests" as the event trigger.

---

## Running Tests

The project uses Vitest for unit testing. Tests cover the patch parser, AI response parser, review issue filtering, review publishing, signature verification, and webhook controller logic.

```bash
npm test
```

---

## License

ISC
