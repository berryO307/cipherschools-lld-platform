# LLD Practice Platform (MVP)

A focused practice loop for Low-Level Design: **Choose problem → Design → Submit →
Get AI feedback → Review → Try again.**

See [docs/Research_Note.md](docs/Research_Note.md) for the problem this solves,
[docs/Design_Note.md](docs/Design_Note.md) for the domain model and architecture,
and [AI_USAGE.md](AI_USAGE.md) for a log of notable AI-assisted decisions made while
building it.

## Architecture (PERN)

| Layer      | Tech                                          | Role |
|------------|------------------------------------------------|------|
| Frontend   | React 19 + Vite + Tailwind + shadcn/ui-pattern components | Dashboard, practice workspace, history accordion, feedback rendering |
| Backend    | Node.js + Express 5                           | REST API, deterministic validation, async evaluation orchestration |
| Database   | PostgreSQL via **Neon** + Drizzle ORM         | `users`, `problems`, `attempts`, `evaluations` |
| LLM        | Gemini (`@google/genai`)                      | Architectural-judgment evaluation (Responsibility Clarity, Coupling & Cohesion, SOLID & Pattern Adherence, Extensibility & Trade-offs) |

Domain logic lives in `server/src/domain/` (`Submission`, `EvaluationEngine` +
`LLMEvaluator`, `Attempt` state machine, `Rubric`/`Feedback`, `SubmissionValidator`)
and is deliberately decoupled from Express/Drizzle so it's unit-testable without a
live database or API key — see `Design_Note.md` for how this satisfies the two
required "Change Tests" (new submission formats, new evaluator strategies).

## Project layout

```
docs/     — Research Note, Design Note
server/   — Express API, Drizzle schema, domain logic, tests
client/   — React frontend (Vite)
AI_USAGE.md, README.md — at repo root
```

## Prerequisites

- Node.js 20+
- A [Neon](https://neon.tech) Postgres database (free tier works) — or any
  Postgres 14+ instance, since the schema uses standard SQL features
- A [Gemini API key](https://aistudio.google.com/apikey) (for the LLM-based evaluator)

## 1. Backend setup (`server/`)

```bash
cd server
npm install
cp .env.example .env
```

Edit `.env`:

```
DATABASE_URL=postgresql://user:password@ep-example.neon.tech/lld_practice?sslmode=require
PORT=4000
GEMINI_API_KEY=your-gemini-api-key-here
FRONTEND_URL=http://localhost:5173
SUBMIT_RATE_LIMIT=5
```

Generate and run the database migration, then seed the 3 practice problems and a
demo user (the seed is idempotent — safe to re-run after a schema/rubric change):

```bash
npm run db:generate   # generates SQL migration files from src/db/schema.ts into drizzle/
npm run db:migrate    # applies migrations to DATABASE_URL
npm run db:seed       # inserts/updates the 3 seeded problems + a demo user
```

Start the API:

```bash
npm run dev           # http://localhost:4000
```

## 2. Running tests

```bash
cd server
npm test
```

This runs the full Vitest suite:
- `src/domain/*.test.ts` — pure unit tests for the `Attempt` state machine,
  `SubmissionValidator`, and `LLMEvaluator` (Gemini calls mocked, no network/API key
  required).
- `src/__tests__/attempt.test.ts` — integration-style tests against the real Express
  app via `supertest`, with the database replaced by an in-memory fake: deterministic
  `400` rejection on `POST /api/attempts`, the `failed → evaluating` retry transition
  and its `409`/`404` error paths, and evaluation-pipeline resilience (an evaluator
  error is caught and persisted as `failed` without an unhandled rejection or a
  crashed process).

No `DATABASE_URL` or `GEMINI_API_KEY` is needed to run the test suite — everything
external is mocked or injected.

## 3. Frontend setup (`client/`)

```bash
cd client
npm install
npm run dev            # http://localhost:5173
```

The dev server proxies `/api/*` requests to `http://localhost:4000` (see
`client/vite.config.ts`), so no separate frontend env var is needed for local
development. Open http://localhost:5173, pick a seeded problem, and submit a
design to see the async evaluation flow end to end.

## 4. Running both together

Two terminals:

```bash
# terminal 1
cd server && npm run dev

# terminal 2
cd client && npm run dev
```

## Deployment notes

- **Backend → Railway:**
  - Build command: `npm run build` (compiles `src/` to `dist/` via `tsc`).
  - Start command: `npm start` (runs `node dist/server.js`).
  - Environment variables: `DATABASE_URL`, `GEMINI_API_KEY`, `FRONTEND_URL` (your
    deployed Vercel URL, e.g. `https://your-app.vercel.app` — used for the CORS
    allow-list), and optionally `SUBMIT_RATE_LIMIT`. `PORT` is provided by Railway
    automatically; the app reads `process.env.PORT` and falls back to `4000` only
    when unset.
  - Run `npm run db:migrate` and `npm run db:seed` once against the production
    `DATABASE_URL` before first use.
- **Frontend → Vercel:**
  - Build command: `npm run build`; output directory: `dist/`.
  - Environment variable: `VITE_API_URL` set to your deployed Railway backend's
    base URL plus `/api` (e.g. `https://your-api.up.railway.app/api`). The client
    reads this via `import.meta.env.VITE_API_URL` (see `client/src/api/client.ts`)
    and falls back to the relative `/api` path — which only works locally, where
    Vite's dev proxy forwards it to `http://localhost:4000` (see
    `client/vite.config.ts`). **`VITE_API_URL` must be set on Vercel** — there is no
    proxy in a static production build.

## Troubleshooting

- **`DATABASE_URL is not set`** — you skipped `cp .env.example .env` in `server/`.
- **`GEMINI_API_KEY is not configured for LLMEvaluator`** — evaluations will fail at
  the AI-judgment stage until this is set. The submission is still saved and can be
  retried once a key is configured (`POST /api/attempts/:id/retry`).
- **`Too many submissions from this client`** — `POST /api/attempts` and
  `POST /api/attempts/:id/retry` share one rate limiter (`SUBMIT_RATE_LIMIT`,
  default 5 per 15 minutes per client) to protect the Gemini API key from abuse;
  wait for the window to reset or raise the limit locally.
- **`Evaluation failed` in the UI** — the attempt and its original submission are
  never deleted on a failed evaluation. Use the "Retry Evaluation" button in the
  History accordion (or `POST /api/attempts/:id/retry` directly) to re-run it.
- **Migrations fail against Neon** — confirm `sslmode=require` is present in the
  connection string.
