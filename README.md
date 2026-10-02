# AI CV Builder

A fullstack app for building tailored CVs with Claude.

**Status:** project foundation. The architecture, local environment, database schema, health check, app shell and a small CV list/create slice are in place. Authentication, AI generation, document upload and PDF export come in later steps (see [Roadmap](#roadmap)).

| Layer    | Stack                                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Web      | React 19, TypeScript, Vite 8, React Router 7, TanStack Query 5, Tailwind CSS 4 |
| API      | Node.js 22, TypeScript, Express 5 (REST), Zod 4, pino                          |
| Database | PostgreSQL 17, Prisma 7                                                        |
| AI       | Anthropic API (Claude), not yet wired up                                       |
| Tooling  | Docker Compose, pnpm workspaces, Vitest, ESLint, Prettier                      |

## Quick start

Prerequisite: Docker Desktop (or Docker Engine with Compose v2).

```bash
cp .env.example .env          # then set ANTHROPIC_API_KEY in .env
docker compose up --build
```

- Web app: http://localhost:5173
- API health: http://localhost:4000/api/health

The first start builds the dev image and installs dependencies, which takes a few minutes. After that, `docker compose up` is enough. Database migrations are applied automatically when the API starts.

`ANTHROPIC_API_KEY` is the only secret. The app also starts without it: the health check reports AI as `not_configured` and the UI shows a notice.

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

| Variable            | Default           | Purpose                                     |
| ------------------- | ----------------- | ------------------------------------------- |
| `ANTHROPIC_API_KEY` | none              | The only secret. Required for AI features   |
| `ANTHROPIC_MODEL`   | `claude-opus-5-5` | Claude model used for generation            |
| `LOG_LEVEL`         | `info`            | API log level (`fatal` … `trace`, `silent`) |
| `WEB_PORT`          | `5173`            | Host port for the web app                   |
| `API_PORT`          | `4000`            | Host port for the API (localhost only)      |
| `DB_PORT`           | `54320`           | Host port for PostgreSQL (localhost only)   |

`NODE_ENV`, `PORT` and `DATABASE_URL` are set in `docker-compose.yml`. The API validates its whole environment at startup and exits with a readable message if anything is invalid.

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
      db/                   Prisma client (node-postgres driver adapter), DB ping
      http/                 Express wiring: router (composition root), middleware
      modules/<domain>/     routes → service → repository (+ mapper) per domain
      lib/                  logger, error types
      generated/prisma/     generated Prisma client (git-ignored)
  web/                      React SPA (Vite)
    src/
      app/                  router, layout, route error boundary
      features/<feature>/   UI + data hooks per feature (health, cvs)
      lib/                  API client, query client
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
  A -.->|later| C[Anthropic API]
```

The browser only calls relative `/api/*` URLs, and the Vite dev server proxies them to the API. Requests are therefore same-origin: no CORS configuration is needed, and the app works unchanged on a phone.

### Backend layers

Each concern has its own place, so it can be reviewed and replaced on its own:

- **HTTP** (`http/`, `modules/*/*.routes.ts`): Express wiring. Route handlers validate input with the shared Zod schemas, call a service, and map results to DTOs. They contain no business logic.
- **Business logic** (`modules/*/*.service.ts`): framework-agnostic. Services take the acting user's id plus validated input.
- **Data access** (`modules/*/*.repository.ts`, `db/`): every Prisma query lives here and is scoped to the owning user. Mappers make sure database rows never leak to HTTP.
- **Integrations** (planned): `integrations/ai` (Anthropic), `integrations/storage` (uploaded files), `integrations/extraction` (PDF/DOCX to text) and `integrations/pdf` (CV rendering). Each sits behind a small interface used by the services.

Dependencies are wired by hand in `http/router.ts` (repositories, then services, then routers); there is no DI container. `createApp()` takes all of its dependencies as arguments, so tests run it with stubs on a random port.

Errors are handled in one place. Every error response has the shape `{ error: { code, message, details?, requestId } }`, and the request id is also returned in the `X-Request-Id` header. The handler maps errors as follows:

- Zod validation errors → `400 VALIDATION_ERROR`
- malformed JSON → `400 INVALID_JSON`
- `AppError` subclasses → their own status
- anything else → a logged `500 INTERNAL_ERROR` that doesn't leak internals

### Users and ownership

Authentication is out of scope for now. The `currentUser` middleware takes a resolver function, and the current resolver always returns a demo user that the API upserts at startup. Every route below `/api/health` goes through this middleware, and adding real auth later means replacing only the resolver.

Ownership is enforced at two levels:

- **Queries:** every repository query filters by `user_id`. Another user's CV returns 404, so its existence is not revealed.
- **Database:** `generation_jobs` and `source_documents` reference `(cv_id, user_id)` → `cvs(id, user_id)`. A job or document therefore cannot exist for a user who doesn't own its CV.

### Data model

```mermaid
erDiagram
  users ||--o{ cvs : owns
  cvs ||--o{ generation_jobs : "generated by"
  cvs ||--o{ source_documents : "built from"
  users { uuid id  text email }
  cvs { uuid id  uuid user_id  text title  text target_role  text job_description  jsonb content  int content_version }
  generation_jobs { uuid id  uuid cv_id  uuid user_id  enum status  jsonb input  jsonb result  int attempts  timestamptz heartbeat_at }
  source_documents { uuid id  uuid cv_id  uuid user_id  text original_name  text storage_key  text extracted_text }
```

- **CV content** is a structured JSON document stored on the CV, because it is always read and written together with its CV. It will be validated against a shared Zod schema before every write. `content_version` provides optimistic locking, so an AI result can't silently overwrite a user's edits.
- **Generation jobs** keep a validated snapshot of their `input` and their validated `result`, which allows auditing and restoring.
- **Source documents** store file metadata and extracted text. The files themselves will live in file storage.
- IDs are UUIDv7 (time-ordered) and all timestamps are `timestamptz`.

### CV generation as a persistent job

Generation is modeled in the database now. It will be implemented in a later step without a queue service:

```mermaid
stateDiagram-v2
  [*] --> QUEUED: POST /api/cvs/:id/generations → 202
  QUEUED --> RUNNING: worker claims job (FOR UPDATE SKIP LOCKED)
  RUNNING --> SUCCEEDED: output validated and saved to the CV
  RUNNING --> FAILED: error, invalid output, or attempts exhausted
  RUNNING --> QUEUED: heartbeat went stale (worker crashed)
  SUCCEEDED --> [*]
  FAILED --> [*]
```

1. The API stores the job and immediately responds `202 Accepted`. Nothing depends on the browser request staying open.
2. A worker inside the API process claims queued jobs from PostgreSQL with `SELECT … FOR UPDATE SKIP LOCKED` and updates `heartbeat_at` while it runs. If the process dies, jobs with a stale heartbeat are re-queued or failed.
3. The client polls `GET /api/generation-jobs/:id`, or leaves and checks later. The database is the source of truth for job state.
4. LLM output is never trusted. Claude is called with a structured-output schema, and the response is validated again with Zod before anything is saved. Invalid output fails the job.

## Decisions and trade-offs

- **Postgres as the job queue** instead of Redis or BullMQ: it's one less service, the job state is transactional with the data it produces, and it's plenty for this workload.
- **Development-only containers:** the source is bind-mounted for hot reload and `node_modules` lives in container-only volumes. No production images are built, since deployment is out of scope.
- **Shared package without a build step:** `@cv-builder/shared` exports TypeScript source, which Vite and tsx compile directly.
- **Pinned versions:**
  - Prisma `7.10.0` exactly. npm's `latest` tag for the `prisma` CLI points at an 8.0 release candidate.
  - TypeScript 6.0. typescript-eslint doesn't support TypeScript 7 yet.
  - React Router 7. v8 was released very recently.
- **Default ports:** API on 4000 and PostgreSQL on 54320, which avoids clashing with common local services on 3000 and 5432. Override them in `.env`.

## Troubleshooting

- **Port already in use:** set `WEB_PORT`, `API_PORT` or `DB_PORT` in `.env`, then run `docker compose up -d`.
- **Module not found after changing dependencies:** run `docker compose up --build -V` to rebuild the image and refresh the container `node_modules` volumes.
- **Code changes aren't picked up:** the project folder must be shared with Docker Desktop. On macOS, allow Docker to access the folder (e.g. Desktop or Documents) if prompted.
- **Editor can't find `generated/prisma`:** run `pnpm --filter @cv-builder/api db:generate`. `pnpm typecheck` also generates it.

## Roadmap

1. ~~Foundation: monorepo, Docker, database schema, API and web shells~~
2. Document upload and text extraction
3. AI CV generation: worker, Claude structured output, validation
4. CV editor UI
5. PDF export
6. Authentication
