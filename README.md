# AI CV Builder

A fullstack app for building tailored CVs with Claude.

**Status:** the main flow works end to end. Users sign up and log in with an email and password; "My CVs" lists their CVs; "Create a new CV" takes a target role plus an uploaded PDF and/or a description, and Claude writes the CV in a background job whose progress the UI follows. The CV editor and PDF export come in later steps (see [Roadmap](#roadmap)).

| Layer    | Stack                                                                       |
| -------- | --------------------------------------------------------------------------- |
| Web      | React 19, TypeScript, Vite 8, React Router 7, TanStack Query 5, plain CSS   |
| API      | Node.js 22, TypeScript, Express 5 (REST), Zod 4, pino                       |
| Database | PostgreSQL 17, Prisma 7                                                     |
| AI       | Anthropic API: Claude Opus 5.5 with structured output (`@anthropic-ai/sdk`) |
| Tooling  | Docker Compose, pnpm workspaces, Vitest, ESLint, Prettier                   |

## Quick start

Prerequisite: Docker Desktop (or Docker Engine with Compose v2).

```bash
cp .env.example .env          # then set ANTHROPIC_API_KEY in .env
docker compose up --build
```

- Web app: http://localhost:5173
- API health: http://localhost:4000/api/health

The first start builds the dev image and installs dependencies, which takes a few minutes. After that, `docker compose up` is enough. Database migrations are applied automatically when the API starts.

`ANTHROPIC_API_KEY` and `JWT_SECRET` are the only secrets. Production refuses to start without either; in development both can stay empty. Without the API key, CVs are "generated" by a development mock that walks through the real steps and saves clearly labelled sample content (the health check reports AI as `not_configured`). Without `JWT_SECRET` the API signs sessions with a public development secret and logs a warning.

### Open it on your phone

With your phone on the same network, open `http://<your-computer-ip>:5173`. On macOS, `ipconfig getifaddr en0` prints that IP. Only the web port is reachable from the network; the browser talks to the API through the dev server's `/api` proxy. The database and API ports are bound to localhost.

### Run checks on your machine (optional)

Install Node 22 and enable pnpm with `corepack enable`. Then run `pnpm install`, which also gives your editor types for every package, and:

```bash
pnpm typecheck   # all packages (also generates the Prisma client)
pnpm lint
pnpm test
pnpm format      # Prettier
```

## Everyday commands

| Task                                    | Command                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Start / stop                            | `docker compose up` / `docker compose down`                                                                       |
| Follow API logs                         | `docker compose logs -f api`                                                                                      |
| Create a migration after editing schema | `docker compose exec api pnpm db:migrate --name <change>`                                                         |
| Apply changes to `.env`                 | `docker compose up -d`                                                                                            |
| After adding or removing dependencies   | `docker compose up --build -V`                                                                                    |
| Reset the database                      | `docker compose down -v`                                                                                          |
| Prisma Studio (from the host)           | `DATABASE_URL=postgresql://cvbuilder:cvbuilder@localhost:54320/cvbuilder pnpm --filter @cv-builder/api db:studio` |

## Configuration

Docker Compose reads `.env` (copy `.env.example`).

| Variable                    | Default           | Purpose                                                                             |
| --------------------------- | ----------------- | ----------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`         | none              | Claude API key. Required in production; development without it uses a mock          |
| `ANTHROPIC_MODEL`           | `claude-opus-5-5` | Claude model for generation. Requests use Opus 5.5 features; others may reject them |
| `GENERATION_TIMEOUT_MS`     | `240000`          | Deadline for one CV generation, retries included; then it fails with `AI_TIMEOUT`   |
| `JWT_SECRET`                | dev fallback      | Signs login sessions. Required in production: `openssl rand -base64 48`             |
| `LOG_LEVEL`                 | `info`            | API log level (`fatal` … `trace`, `silent`)                                         |
| `MOCK_GENERATION_STEP_MS`   | `2500`            | Duration of each of the mock generator's four steps                                 |
| `MOCK_GENERATION_FAIL_RATE` | `0`               | Share of mock generations that fail (0–1); `1` shows the failure screen             |
| `WEB_PORT`                  | `5173`            | Host port for the web app                                                           |
| `API_PORT`                  | `4000`            | Host port for the API (localhost only)                                              |
| `DB_PORT`                   | `54320`           | Host port for PostgreSQL (localhost only)                                           |

`NODE_ENV`, `PORT`, `DATABASE_URL` and `UPLOAD_DIR` (uploaded PDFs, in the `uploads` volume) are set in `docker-compose.yml`. The API validates its whole environment at startup and exits with a readable message if anything is invalid.

## Project structure

```
apps/
  api/                      REST API (Express)
    prisma/                 schema.prisma + migrations
    prisma.config.ts        Prisma CLI config (schema/migrations paths, database URL)
    src/
      server.ts             process entry: config → logger → DB → HTTP server, graceful shutdown
      app.ts                createApp(): middleware, /api routes, 404, error handler
      config/               environment validation (Zod)
      db/                   Prisma client (node-postgres driver adapter), DB ping, repositories wiring
      http/                 Express wiring: router (composition root), middleware
      modules/<domain>/     routes → service → repository (+ mapper) per domain: auth (sign-up,
                            login, sessions), users, cvs, source-documents (PDF upload),
                            generation (jobs, worker, the Claude generator in claude/, the
                            development mock)
      integrations/         ai (Anthropic client), storage (uploaded files on disk),
                            extraction (PDF → text with unpdf)
      lib/                  logger, error types
      test/                 in-memory repositories and app harness for tests
      generated/prisma/     generated Prisma client (git-ignored)
  web/                      React SPA (Vite)
    src/
      app/                  router, layout, route error boundary
      features/auth/        log in and sign up pages, the current session
      features/cvs/         dashboard (My CVs), create (the form), status (generation progress)
      ui/                   shared pieces from the design: status chips, state panels, CV thumbnail, icons
      styles/               design tokens and base/component CSS (from the design canvas)
      lib/                  API client (incl. upload with progress), query client, formatting
packages/
  shared/                   types and Zod schemas shared by web and api (DTOs, error shape, enums)
docker-compose.yml          db + api + web for local development
Dockerfile.dev              dev image: Node 22 + pnpm + installed dependencies
```

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|"/ and /api/*"| V[Vite dev server :5173]
  V -->|proxy /api| A[API :4000]
  A --> P[(PostgreSQL)]
  A -->|CV generation| C[Anthropic API]
```

The browser only calls relative `/api/*` URLs, and the Vite dev server proxies them to the API. Requests are therefore same-origin: no CORS configuration is needed, and the app works unchanged on a phone.

### Backend layers

Each concern has its own place, so it can be reviewed and replaced on its own:

- **HTTP** (`http/`, `modules/*/*.routes.ts`): Express wiring. Route handlers validate input with the shared Zod schemas, call a service, and map results to DTOs. They contain no business logic.
- **Business logic** (`modules/*/*.service.ts`): framework-agnostic. Services take the acting user's id plus validated input.
- **Data access** (`modules/*/*.repository.ts`, `db/`): every Prisma query lives here and is scoped to the owning user. Mappers make sure database rows never leak to HTTP.
- **Integrations**: `integrations/ai` (Anthropic), `integrations/storage` (uploaded files) and `integrations/extraction` (PDF/DOCX to text); `integrations/pdf` (CV rendering) is planned. Each sits behind a small interface used by the services.

Dependencies are wired by hand in `http/router.ts` (repositories, then services, then routers); there is no DI container. `createApp()` takes all of its dependencies as arguments, so tests run it with stubs on a random port.

Errors are handled in one place. Every error response has the shape `{ error: { code, message, details?, requestId } }`, and the request id is also returned in the `X-Request-Id` header. The handler maps errors as follows:

- Zod validation errors → `400 VALIDATION_ERROR`
- malformed JSON → `400 INVALID_JSON`
- `AppError` subclasses → their own status
- anything else → a logged `500 INTERNAL_ERROR` that doesn't leak internals

### REST API

Apart from `/api/health` and signing up, logging in and logging out, every route acts on behalf of the logged-in user and answers 401 without a session. Another user's CV or job answers 404.

| Method and path                         | Purpose                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/signup`                 | Create an account `{ name, email, password }` and log in; `409` if taken                               |
| `POST /api/auth/login`                  | Log in `{ email, password }`: sets the session cookie, or `401`                                        |
| `POST /api/auth/logout`                 | Log out: clears the session cookie (`204`)                                                             |
| `GET /api/auth/me`                      | The logged-in user, or `401` without a valid session                                                   |
| `GET /api/cvs`                          | The user's CVs with their status (`draft`, `generating`, `failed`, `ready`)                            |
| `POST /api/cvs`                         | Create a draft `{ targetRole?, sourceText? }`                                                          |
| `GET /api/cvs/:cvId`                    | A CV with its sources, latest generation and generated `content` (`null` until a generation completes) |
| `PATCH /api/cvs/:cvId`                  | Save the target role and/or the free-text source (`""`/`null` clears)                                  |
| `PUT /api/cvs/:cvId/source-document`    | Upload the source PDF (multipart field `file`); replaces the previous one                              |
| `DELETE /api/cvs/:cvId/source-document` | Remove the source PDF                                                                                  |
| `POST /api/cvs/:cvId/generations`       | Start generation → `202` + `Location`; `409` while one is running                                      |
| `GET /api/generation-jobs/:jobId`       | A generation's status, current step and `issues` (what the AI found missing or unclear), for polling   |

Uploads are checked before anything is stored: CV ownership (before the body is read), size (10 MB), type (declared type and the `%PDF-` signature), page count (20) and readable text. Files are stored under keys the API generates; the client's file name is only displayed.

### Authentication and ownership

Users sign up with a name, an email and a password. Emails are stored trimmed and lowercased, so they are unique regardless of case. Passwords are hashed with scrypt from `node:crypto` (OWASP parameters, a random salt per password, the parameters stored with each hash). Login errors don't reveal whether an email has an account: an unknown email gets the same `401` as a wrong password and costs the same hash check.

Signing up or logging in sets the session cookie `cvb_session`: `HttpOnly` (page scripts can't read it), `SameSite=Lax`, `Path=/api`, and `Secure` in production. It holds a JWT signed with `JWT_SECRET` (HS256 only), which expires after 7 days. The `currentUser` middleware verifies it and loads the user on every route except health, sign-up, login and logout. Services take the owner only from that session; no endpoint accepts a user id from the client.

Cross-site requests can't act with the session: `SameSite=Lax` keeps the cookie off cross-site POSTs, and the API only parses JSON bodies, which an HTML form can't send.

Ownership is enforced at two levels:

- **Queries:** every repository query filters by `user_id`. Another user's CV returns 404, so its existence is not revealed.
- **Database:** `generation_jobs` and `source_documents` reference `(cv_id, user_id)` → `cvs(id, user_id)`. A job or document therefore cannot exist for a user who doesn't own its CV.

### Data model

```mermaid
erDiagram
  users ||--o{ cvs : owns
  cvs ||--o{ generation_jobs : "generated by"
  cvs ||--o{ source_documents : "built from"
  users { uuid id  text email  text name  text password_hash }
  cvs { uuid id  uuid user_id  text title  text target_role  text job_description  text source_text  jsonb content  int content_version }
  generation_jobs { uuid id  uuid cv_id  uuid user_id  enum status  int progress_step  jsonb input  jsonb result  jsonb issues  int attempts  timestamptz heartbeat_at }
  source_documents { uuid id  uuid cv_id  uuid user_id  text original_name  int page_count  text storage_key  text extracted_text }
```

- **CV content** is a structured JSON document stored on the CV, because it is always read and written together with its CV. It is validated against a shared Zod schema before every write. `content_version` provides optimistic locking, so an AI result can't silently overwrite a user's edits.
- **Generation jobs** keep a validated snapshot of their `input`, plus their validated `result` and `issues`, which allows auditing and restoring.
- **Source documents** store file metadata and extracted text. The files themselves will live in file storage.
- IDs are UUIDv7 (time-ordered) and all timestamps are `timestamptz`.

### CV generation as a persistent job

Generation runs without a queue service, inside the API process:

```mermaid
stateDiagram-v2
  [*] --> PENDING: POST /api/cvs/:id/generations → 202
  PENDING --> PROCESSING: worker claims job (FOR UPDATE SKIP LOCKED)
  PROCESSING --> COMPLETED: output validated and saved to the CV
  PROCESSING --> FAILED: error, timeout, invalid output, or attempts exhausted
  PROCESSING --> PENDING: shutdown, or heartbeat went stale (worker crashed)
  COMPLETED --> [*]
  FAILED --> [*]
```

1. The API stores the job and immediately responds `202 Accepted`. Nothing depends on the browser request staying open.
2. A worker inside the API process claims pending jobs from PostgreSQL with `SELECT … FOR UPDATE SKIP LOCKED` and updates `heartbeat_at` while it runs. It runs up to three jobs at a time, so one user's minute-long generation doesn't hold up everyone else's. If the process dies, jobs with a stale heartbeat are re-queued or failed.
3. Every job has a deadline, `GENERATION_TIMEOUT_MS` (4 minutes by default), that covers the generator's own retries. The worker enforces it: the generator's abort signal fires, a generator that doesn't stop is abandoned anyway, and the job fails with `AI_TIMEOUT`.
4. The client polls `GET /api/generation-jobs/:id`, or leaves and checks later. The database is the source of truth for job state. On shutdown (including `tsx watch` restarts) the worker hands its jobs back to the queue; every write a worker makes is fenced by the job's attempt number, so a job taken over after going stale can't be overwritten by the old run. A restart therefore aborts an in-flight Claude request, and the job runs again from the start (and is billed again).
5. LLM output is never trusted. It is validated with strict Zod schemas before anything is saved, and the raw output is never stored or logged.

#### Generation with Claude

`modules/generation/claude/` implements the generator on top of the Anthropic client in `integrations/ai/claude-client.ts`. Without an API key (development only), `mock-cv-generator.ts` stands in.

- **Model:** `claude-opus-5-5`, streamed, with adaptive thinking and effort `medium`. The effort is a constant in `claude-client.ts`; raise it to `high` if the quality falls short (slower and more expensive).
- **Server-side refusal fallback:** if Opus 5.5's safety classifiers decline a request (a CV in security or biology can trip them), the Anthropic API hands it over to an earlier Opus model instead of refusing.
- **Prompt:** the system prompt holds only the instructions: use the facts in the material and never invent employers, titles, dates, degrees, metrics or contact details; put what matters for the target role first; write short, action-led bullets; report what is missing. The user's PDF text and notes and the target role follow in separate delimited blocks, and the prompt treats their content as data, not instructions.
- **Structured output:** Claude answers in JSON constrained by a schema. The API checks the stop reason, parses the JSON and validates it with a strict Zod schema, then maps it to the shared CV content schema, which the worker checks once more before saving. Invalid JSON or a schema mismatch gets one retry within the same deadline.
- **Contact guard:** a deterministic check removes any email, phone number or link that doesn't appear in the user's material, and reports it as an issue, so a CV never carries invented contact details.
- **Issues:** what the AI found missing, ambiguous or incomplete (a role without dates, no email), phrased as questions for the user. They are stored with the job and returned as `issues` by `GET /api/generation-jobs/:id`.

#### Job error codes

A failed job stores a code and a message. The CV's page shows the message, which says what happened and what to try, and the code as "Ref. CODE" (see `modules/generation/generation.failures.ts`).

| Code                  | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `INVALID_INPUT`       | The job's saved input couldn't be read                                     |
| `INVALID_OUTPUT`      | The generator's result failed the worker's final check (a backstop)        |
| `INTERNAL_ERROR`      | An unexpected error                                                        |
| `WORKER_LOST`         | Its worker stopped responding, and the job had used all 3 attempts         |
| `AI_TIMEOUT`          | The job's deadline passed, or the connection to Anthropic timed out        |
| `AI_RATE_LIMITED`     | Anthropic's rate limit was hit                                             |
| `AI_UNAVAILABLE`      | Anthropic was unreachable, overloaded or failing                           |
| `AI_NOT_CONFIGURED`   | The API key, its account (billing, permissions) or the model name is wrong |
| `AI_REQUEST_REJECTED` | Anthropic rejected the request, e.g. as too large                          |
| `AI_REFUSED`          | Claude declined to write the CV                                            |
| `AI_OUTPUT_TRUNCATED` | The answer hit the output limit before it was complete                     |
| `AI_INVALID_JSON`     | The answer wasn't valid JSON, twice                                        |
| `AI_SCHEMA_MISMATCH`  | The answer didn't match the CV schema, twice                               |

## Decisions and trade-offs

- **Postgres as the job queue** instead of Redis or BullMQ: it's one less service, the job state is transactional with the data it produces, and it's plenty for this workload.
- **Development-only containers:** the source is bind-mounted for hot reload and `node_modules` lives in container-only volumes. No production images are built, since deployment is out of scope.
- **Shared package without a build step:** `@cv-builder/shared` exports TypeScript source, which Vite and tsx compile directly.
- **Pinned versions:**
  - Prisma `7.10.0` exactly. npm's `latest` tag for the `prisma` CLI points at an 8.0 release candidate.
  - TypeScript 6.0. typescript-eslint doesn't support TypeScript 7 yet.
  - React Router 7. v8 was released very recently.
- **Default ports:** API on 4000 and PostgreSQL on 54320, which avoids clashing with common local services on 3000 and 5432. Override them in `.env`.
- **Stateless sessions:** the server keeps no session list, so logging out only removes the cookie. A token that leaked stays valid until it expires (7 days at most). Revoking tokens would need a session table or a per-user token version.
- **No login rate limiting yet:** limiting by client IP needs `trust proxy` configured for whatever proxy runs in front of the API; without it every client shares the proxy's IP and one attacker could lock everyone out. It is a follow-up. Meanwhile every guess costs a full scrypt hash.
- **Sign-up reveals taken emails** (`409 EMAIL_TAKEN`), which a helpful sign-up form can't avoid without email verification. Login doesn't.

## Troubleshooting

- **Port already in use:** set `WEB_PORT`, `API_PORT` or `DB_PORT` in `.env`, then run `docker compose up -d`.
- **Module not found after changing dependencies:** run `docker compose up --build -V` to rebuild the image and refresh the container `node_modules` volumes.
- **Code changes aren't picked up:** the project folder must be shared with Docker Desktop. On macOS, allow Docker to access the folder (e.g. Desktop or Documents) if prompted.
- **Editor can't find `generated/prisma`:** run `pnpm --filter @cv-builder/api db:generate`. `pnpm typecheck` also generates it.

## Roadmap

1. ~~Foundation: monorepo, Docker, database schema, API and web shells~~
2. ~~Document upload and text extraction~~
3. ~~AI CV generation: persistent jobs and worker, Claude structured output, validation~~
4. CV editor UI
5. PDF export
6. ~~Authentication~~
