> Plan for step 1, approved in Claude Code's plan mode on 2026-10-02 and implemented in [PR #1](https://github.com/maxduma/ai_cv_builder/pull/1). Copied verbatim from the session.

---

# AI CV Builder — Step 1: Project foundation & architecture

## Context

The repo is empty (one commit, a one-line `README.md`). This step builds a clean, runnable, extensible fullstack foundation that later steps extend:
- React + TS web app
- Node + TS REST API
- PostgreSQL via Prisma
- Anthropic, wired up later

`docker compose up` starts everything. **Out of scope:** auth, AI generation, PDF generation, the full UI.

Principles from the brief that shape the design:
- The backend is the source of truth.
- CV generation is a persistent job; nothing depends on an open browser request.
- Every CV and job belongs to a user.
- All input is validated.
- LLM output is never trusted.
- Keep it simple, with no Redis, queues or microservices.

## Environment facts the plan accounts for

- **Docker:** Desktop **4.22.1 (2023)**, which ships Docker 24.0.5 / Compose 2.20.2, running on **macOS 26.6**. It is **not running** right now.
  - It may need an update to start, and macOS may ask the user to allow it to access `~/Desktop`.
  - Compose 2.20 has no `develop.watch`, no `env_file.required` and no healthcheck `start_interval`, so the plan doesn't use them.
- **Ports:** 3000 is taken by a local process. 4000, 5173 and 5432 are free. **API → 4000.**
- **API key:** `ANTHROPIC_API_KEY` is not set, so the stack has to boot without it.
- **Package versions:**
  - npm's `latest` tag for `prisma` points at **`8.0.0-rc.19`** (a release candidate), while `@prisma/client` latest is 7.10.0. → **Pin `prisma`, `@prisma/client` and `@prisma/adapter-pg` to exactly `7.10.0`.**
  - TypeScript `latest` is 7.0, but typescript-eslint only supports `<6.1`. → **TS `~6.0.3`.**
  - react-router latest is v8. → **Use v7.18** (stable API, cheap to upgrade later).
- **Runtime facts I checked:**
  - Prisma 7 (from its docs):
    - `prisma.config.ts` holds the datasource URL.
    - `env()` throws when the variable is missing, so use `process.env.DATABASE_URL ?? ''`.
    - The `prisma-client` generator needs an `output` path.
    - A driver adapter is required.
    - `.env` is not auto-loaded.
    - `migrate dev` no longer runs generate or seed.
    - The generated client has `// @ts-nocheck`, is ESM, and its WASM is platform-independent.
  - Node 22.22, pnpm 9.15 (corepack) and catalogs are supported.

## Key decisions

- **Monorepo:** pnpm workspaces only, with `packageManager: pnpm@9.15.0`, `.nvmrc` 22, and a pnpm `catalog:` pinning shared versions (zod, typescript, @types/node, vitest) so every package loads one zod.
- **API:**
  - Express 5 (async errors go to the error handler natively), Zod 4, pino + pino-http (`pino-pretty` as a stream in development), helmet.
  - Prisma 7.10 with the `prisma-client` generator, `prisma.config.ts` and `@prisma/adapter-pg`.
  - tsx runs it.
- **Web:** Vite 8, React 19, React Router 7, TanStack Query 5 (polling later), Tailwind 4 via `@tailwindcss/vite`, mobile-first.
- **Shared:** `@cv-builder/shared` is a "just-in-time" TS package. `exports` points at `./src/index.ts` with no build step; tsx and Vite compile it through the pnpm symlink, which resolves outside node_modules.
- **Same-origin API:**
  - The web app calls relative `/api/*`, and Vite proxies it to the API (`API_PROXY_TARGET`).
  - No CORS needed.
  - A phone on the LAN can use `http://<lan-ip>:5173`.
- **TS settings:**
  - `module: Preserve` + `moduleResolution: Bundler` (extensionless imports, all ESM).
  - `noEmit`.
  - `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, with explicit `types`/`lib`/`target`, because TS 6 changed several defaults.
  - **No** `exactOptionalPropertyTypes` (clashes with Prisma inputs).
- **Env:**
  - A single root `.env`, read **only by Docker Compose** (interpolation). The app never loads `.env` files itself.
  - `ANTHROPIC_API_KEY` is the only secret. The API boots without it:
    - it logs a warning;
    - health reports `ai: not_configured`;
    - the UI shows a banner;
    - AI endpoints will later return a clear error.
  - `ANTHROPIC_MODEL` defaults to `claude-opus-5-5`, set only in `env.ts`.
- **Identity without auth:**
  - `server.ts` upserts a demo user once at startup.
  - The `currentUser` middleware takes a resolver (`(req) => Promise<CurrentUser | null>`), sets `req.user`, and returns 401 if it gets null.
  - Services and repositories take `userId` explicitly and scope every query by it.
  - Real auth later swaps only the resolver.
- **Generation jobs** (modeled now, implemented later):
  - Postgres is the queue: a `generation_jobs` table claimed with `FOR UPDATE SKIP LOCKED`, plus heartbeat/stale recovery.
  - An in-process worker; no Redis or queue service.
- **Reference slice:** a minimal user-scoped CVs API (list/create/get) plus a list/create UI.
  - It proves browser → proxy → API → DB.
  - It sets the module pattern for later steps.

## Repository layout

```
apps/api/
  prisma/schema.prisma, prisma/migrations/<ts>_init/
  prisma.config.ts                 # schema/migrations paths; datasource.url = process.env.DATABASE_URL ?? ''
  src/
    server.ts                      # parseEnv(process.env) (exit 1 on error) → logger → prisma → ensure demo user
                                   # → createApp → listen (handle listen errors) → graceful shutdown
    app.ts                         # createApp(deps): helmet, json(1mb), pino-http, /api router, 404, error handler
    config/env.ts                  # pure parseEnv(env) + Config type (safe to import in tests)
    db/prisma.ts                   # createPrismaClient(url) w/ PrismaPg {connectionTimeoutMillis: 5000}; pingDatabase(timeout)
    lib/logger.ts, lib/errors.ts   # pino factory; AppError(status, code, message, details) + NotFound/Unauthorized
    http/router.ts                 # composition root: repos → services → routers (plain factories, no DI lib)
    http/middleware/{current-user,error-handler,not-found}.ts
    modules/health/{health.routes,health.service}.ts
    modules/users/users.repository.ts           # upsertByEmail (used for the demo user)
    modules/cvs/{cvs.routes,cvs.service,cvs.repository,cvs.mapper}.ts
    types/express.d.ts             # Request.user
    generated/prisma/              # gitignored (prisma generate)
    config/env.test.ts, app.test.ts
apps/web/
  index.html                       # viewport-fit=cover, theme-color
  vite.config.ts                   # react(), tailwindcss(); server {host: true, port 5173, strictPort, proxy /api}
  src/main.tsx, index.css
  src/app/{router.tsx, AppLayout.tsx, RouteError.tsx}
  src/lib/{api-client.ts, query-client.ts}
  src/features/health/{useHealth.ts, ApiStatus.tsx}     # status pill + AI-not-configured notice
  src/features/cvs/{api.ts, CvListPage.tsx, CreateCvForm.tsx}
  src/pages/NotFoundPage.tsx
packages/shared/src/{index,errors,health,cv,generation-job}.ts
docker-compose.yml, Dockerfile.dev, .dockerignore, .env.example
package.json, pnpm-workspace.yaml (workspaces + catalog), tsconfig.base.json
eslint.config.js, .prettierrc.json, .prettierignore, .editorconfig, .nvmrc, .gitignore, README.md
```

No empty placeholder folders. The README lists where later work goes:
- `modules/{documents,generation-jobs}`
- `jobs/worker.ts`
- `integrations/{ai,storage,extraction,pdf}`

## Database schema (`apps/api/prisma/schema.prisma`)

**Schema conventions:**
- Generator: `provider = "prisma-client"`, `output = "../src/generated/prisma"`.
- The datasource is `postgresql` with no `url`.
- IDs are `uuid(7)` with `@db.Uuid`.
- All `DateTime` columns are `@db.Timestamptz(3)`.
- snake_case tables, columns and enums via `@@map`/`@map`.

**Tables and enum:**
- **users:**
  - `email` (unique), `name?`, timestamps.
- **cvs:**
  - `user_id → users` (cascade), `title`, `target_role?`, `job_description?`.
  - `content Json?`: the current structured CV document. It's a value object always read and written with its CV, and it carries its own `schemaVersion`.
  - `content_version Int @default(0)`: optimistic-locking counter for later edits and AI writes.
  - Timestamps.
  - `@@unique([id, userId])` so other tables can reference (CV, owner) as a composite key.
  - `@@index([userId, updatedAt])`.
- **generation_jobs:**
  - `cv_id`, `user_id`, `status` (enum below, default `QUEUED`).
  - `input Json`: validated snapshot of the request parameters.
  - `result Json?`: validated AI output, kept for audit/restore and copied to `cvs.content` in one transaction.
  - `attempts`, `error_code?`, `error_message?`, `started_at?`, `heartbeat_at?`, `finished_at?`, timestamps.
  - **Relation `(cvId, userId) → cvs(id, userId)`, cascade.** The database itself guarantees a job's owner equals its CV's owner. There's no separate user relation.
  - Indexes on `(status, created_at)` for the worker, `(cv_id, created_at)` and `(user_id, created_at)`.
- **generation_job_status** (enum): `QUEUED | RUNNING | SUCCEEDED | FAILED`.
- **source_documents:**
  - `cv_id`, `user_id`, `original_name`, `mime_type`, `size_bytes`, `storage_key` (unique), `extracted_text?`, timestamps.
  - Same composite relation to `cvs`, cascade.
  - Index on `(cv_id, created_at)`.
  - Documents belong to a CV (and so to its user). This is a deliberate simplification: no reuse across CVs.

The initial migration is created once with `prisma migrate dev --name init` and committed. Containers apply it with `prisma migrate deploy`.

## Backend details (`apps/api`)

- **Config:**
  - `parseEnv(env)` uses Zod and turns empty strings into `undefined`. It returns a typed `config`:
    - `nodeEnv`
    - `port` (default 4000)
    - `logLevel` (default info)
    - `databaseUrl` (required URL)
    - `anthropic: { apiKey?, model }`
  - `server.ts` prints readable issues and exits 1 when the env is invalid.
- **Errors:** responses use the shared `ApiErrorBody` shape: `{ error: { code, message, details?, requestId? } }`. The handler maps:
  - `ZodError` → 400 `VALIDATION_ERROR` (with issues)
  - `entity.parse.failed` → 400 `INVALID_JSON`
  - `entity.too.large` → 413 `PAYLOAD_TOO_LARGE`
  - `AppError` → its status
  - anything else → 500 `INTERNAL_ERROR` (logged with the stack, never leaked)

  Unknown routes return 404 `NOT_FOUND`.
- **Logging:** pino-http request ids use the incoming `x-request-id` or a random UUID, echoed in the `X-Request-Id` header and in error bodies.
- **Validation:** handlers call `Schema.parse(req.body / req.params)` with the shared Zod schemas. `req.query` is never mutated (it's read-only in Express 5).
- **Routing:** `/api/health` is public. Then the `currentUser` middleware applies to everything below it, so routes are protected by default. Then `/api/cvs`.
- **Health:** `GET /api/health` returns:

  ```
  {
    status: "ok" | "degraded" | "error",
    uptimeSeconds,
    timestamp,
    checks: {
      database: { status, latencyMs },
      ai: { status: "configured" | "not_configured", model }
    }
  }
  ```

  - 503 when the DB ping (`SELECT 1` with a 2s timeout) fails.
  - Status is `degraded` when the AI key is missing.
  - Health requests aren't request-logged, because the UI polls it.
- **CVs:**
  - `GET /api/cvs` returns `{ items: CvSummary[] }`. It selects explicit columns and never loads `content`.
  - `POST /api/cvs` with `{ title 1–120, targetRole? ≤120, jobDescription? ≤20k }` returns 201 `CvDetail`.
  - `GET /api/cvs/:cvId` returns `CvDetail`. A missing CV or one owned by another user gives 404, so existence never leaks. A malformed UUID gives 400.
  - Repository queries always include `userId`.
  - Mappers convert entities to shared DTOs with ISO dates, so Prisma types never reach HTTP.
- **Lifecycle:**
  - On SIGTERM/SIGINT the API closes the server, calls `prisma.$disconnect()`, and force-exits after 10s.
  - The compose command `exec`s tsx so signals reach node.

## Shared (`packages/shared`)

- `errors.ts`: `ERROR_CODES`, `ErrorCode`, `ApiErrorBody`.
- `health.ts`: `HealthResponse`.
- `cv.ts`: `CreateCvRequestSchema`, `CvIdParamsSchema`, `CvSummary`, `CvDetail`, `CvListResponse`.
- `generation-job.ts`: `GENERATION_JOB_STATUSES`, `GenerationJobStatus`, `isTerminalJobStatus()`.

The CV content Zod schema is deliberately **deferred to the AI step**. It has to be designed together with the prompt and within structured-output JSON-Schema limits (no length limits, `additionalProperties: false`, no recursion).

## Frontend shell (`apps/web`)

- **Layout:**
  - Sticky header with the app name and an `ApiStatus` pill. The pill polls `/api/health` and shows online / offline / DB down.
  - An "AI generation disabled until ANTHROPIC_API_KEY is set" notice when the key is missing.
  - Content area: `mx-auto w-full max-w-3xl px-4`, with safe-area insets.
- **Routes:** `/` is the CV list with an inline create form, `*` is the 404 page, plus a route-level error element.
- **Mobile:**
  - Mobile-first Tailwind.
  - Tap targets ≥44px (`min-h-11`).
  - Inputs `text-base` (16px, so iOS doesn't zoom).
  - No horizontal overflow at 375px.
- **API client:** `api-client.ts` is a `fetch` wrapper that uses relative `/api` and JSON. It throws `ApiError {status, code, message}` built from the shared error body. The QueryClient doesn't retry 4xx errors.

## Docker & environment

**`Dockerfile.dev`** (shared by api and web) contains the toolchain and dependencies only:
1. `node:22-bookworm-slim`, plus `openssl ca-certificates` for Prisma's schema engine.
2. `corepack enable` with `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
3. Copy the root `package.json`, `pnpm-lock.yaml` and `pnpm-workspace.yaml`, and each workspace's `package.json`.
4. `pnpm install --frozen-lockfile`.
5. No `COPY . .` and no postinstall: source comes in through the bind mount.

`.dockerignore` excludes `**/node_modules`, `**/src/generated`, `.git`, `.env`, `**/dist` and `**/coverage`.

**`docker-compose.yml`** (project name `ai-cv-builder`):

The api and web services share an `x-node-app` anchor:
- `build: Dockerfile.dev`
- `init: true`
- volumes:
  - `.:/app`
  - `/app/node_modules`
  - `/app/apps/api/node_modules`
  - `/app/apps/web/node_modules`
  - `/app/packages/shared/node_modules`

The anonymous volumes keep Linux dependencies separate from the macOS host's. After dependency changes, run `docker compose up --build -V`.

- **db:**
  - `postgres:17-alpine`, dev credentials `cvbuilder` (not secret).
  - Volume `pgdata:/var/lib/postgresql/data`.
  - Healthcheck `pg_isready -h 127.0.0.1 -U cvbuilder -d cvbuilder`. It checks over **TCP** so it doesn't pass during Postgres's temporary init server.
  - Port `127.0.0.1:${DB_PORT:-5432}:5432`.
- **api:**
  - `working_dir /app/apps/api`.
  - `command: sh -c "pnpm db:generate && pnpm db:deploy && exec ./node_modules/.bin/tsx watch --clear-screen=false src/server.ts"`.
  - `restart: on-failure`.
  - `depends_on db: service_healthy`.
  - Port `127.0.0.1:${API_PORT:-4000}:4000`.
  - Env:
    - `NODE_ENV=development`
    - `PORT=4000`
    - `DATABASE_URL=postgresql://cvbuilder:cvbuilder@db:5432/cvbuilder`
    - `ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}`
    - `ANTHROPIC_MODEL: ${ANTHROPIC_MODEL:-}`
    - `LOG_LEVEL: ${LOG_LEVEL:-}`
- **web:**
  - `working_dir /app/apps/web`.
  - Runs Vite through its bin directly.
  - `API_PROXY_TARGET=http://api:4000`.
  - Port `${WEB_PORT:-5173}:5173`, on all interfaces for phone testing.
  - `depends_on: api` (started).

**`.env.example`:**
- `ANTHROPIC_API_KEY=` — "the only secret; needed for AI features, the app starts without it".
- Optional (commented out): `ANTHROPIC_MODEL`, `LOG_LEVEL`, `WEB_PORT`, `API_PORT`, `DB_PORT`.
- After editing `.env`, run `docker compose up -d` to recreate the containers.

## Tooling, scripts, tests

- **Root scripts:** `typecheck`, `test` (both `pnpm -r`), `lint` (`eslint .`), `format`, `format:check`.
- **API scripts:**
  - `dev`
  - `start`: `tsx src/server.ts`
  - `typecheck`: `prisma generate && tsc --noEmit`
  - `test`: `prisma generate && vitest run`
  - `db:generate`
  - `db:deploy`
  - `db:migrate`: forwards args to `prisma migrate dev`, then runs `prisma generate`
  - `db:studio`
- **Web scripts:** `dev`, `build` (`tsc --noEmit && vite build`), `preview`, `typecheck`.
- **Shared scripts:** `typecheck`.
- **ESLint:** minimal flat config. `@eslint/js` plus typescript-eslint recommended (not type-aware), react-hooks for web, `generated/` ignored.
- **Prettier.**
- **Tests** (API, run on the host, no DB needed):
  - `config/env.test.ts`: defaults; empty key → undefined; invalid port and invalid URL are rejected.
  - `app.test.ts`: `createApp` with a stubbed DB ping and user resolver, served on an ephemeral port and called with `fetch`:
    - health returns 200 with the right shape, and 503 when the ping fails;
    - an unknown route returns a 404 JSON body;
    - malformed JSON returns 400 `INVALID_JSON`;
    - an invalid create body returns 400 `VALIDATION_ERROR`.

## Implementation order

0. **Docker readiness.**
   - `open -a Docker`, then wait for `docker info`.
   - Smoke-test a bind mount: `docker run --rm -v "$PWD":/w alpine ls /w`.
   - If Docker Desktop won't start, or the bind mount fails, stop and ask the user to update Docker Desktop or grant it Desktop-folder access.
1. Root config files: workspace + catalog, tsconfig base, ESLint/Prettier, ignore files, `.env.example`, `.nvmrc`.
2. `packages/shared`.
3. `apps/api`:
   - package.json and tsconfig;
   - `prisma.config.ts` and the schema;
   - `src/`;
   - tests.
4. `apps/web`: Vite + Tailwind, router, shell, CV list/create.
5. Run `pnpm install` on the host (this writes the lockfile and installs deps so the editor has types). Then `pnpm typecheck && pnpm lint && pnpm test`.
6. Write `Dockerfile.dev`, `docker-compose.yml` and `.dockerignore`.
7. Create the initial migration:
   - `docker compose up -d db`
   - `docker compose run --rm -T api sh -c "pnpm db:generate && pnpm exec prisma migrate dev --name init"`
   - The SQL lands on the host through the bind mount.
8. `docker compose up --build`, then run the full verification below.
9. README:
   - quick start
   - phone/LAN testing
   - common tasks:
     - migrations via `docker compose exec api pnpm db:migrate --name …`
     - Studio on the host with an inline `DATABASE_URL`
     - logs, resetting the DB, dependency changes
   - project structure
   - architecture: layers, request flow, data model, job lifecycle as a mermaid state machine
   - env var table
   - decisions and trade-offs
   - troubleshooting (ports, Docker file sharing, file watching)
10. No git commit unless the user asks.

## Verification

1. On the host, `pnpm typecheck`, `pnpm lint` and `pnpm test` all pass.
2. From a clean state with **no `.env`** (`docker compose down -v --rmi local`), `docker compose up --build` starts db, api and web.
   - The API log shows migrations applied, a missing-key warning, and listening on 4000.
   - Vite reports ready.
3. API checks:
   - `curl localhost:4000/api/health` returns 200 with `status: "degraded"`, database `ok` and ai `not_configured`.
   - `curl localhost:5173/api/health` returns the same response through the Vite proxy.
4. CV endpoints through the proxy:
   - `POST /api/cvs` with a valid body returns 201.
   - `GET /api/cvs` lists the new CV.
   - An empty title returns 400 `VALIDATION_ERROR`.
   - Malformed JSON returns 400.
   - A random UUID returns 404; `not-a-uuid` returns 400.
5. Browser pane at `http://localhost:5173`:
   - the shell renders and the API pill shows online;
   - the AI notice is visible;
   - creating a CV through the UI adds it to the list;
   - at the mobile preset (375×812), `scrollWidth <= clientWidth`;
   - no console errors.
6. Dev loop:
   - editing a web component hot-reloads;
   - editing an API file restarts tsx;
   - `docker compose stop api` exits cleanly with the shutdown logged, and well under 10s.
7. Persistence and reset: `docker compose down && docker compose up` keeps the CVs, and `down -v` then `up` re-applies migrations to an empty DB.
8. With `ANTHROPIC_API_KEY=dummy` in `.env` and `docker compose up -d api`, health shows ai `configured` and status `ok`. Remove the dummy key afterwards.

## Deferred (where later steps plug in)

- **Auth:** replaces the `currentUser` resolver.
- **Documents:**
  - `modules/documents`, with `integrations/storage` (local named volume) and `integrations/extraction` (PDF/DOCX → text) behind them.
  - `POST /api/cvs/:cvId/documents`.
  - List queries must not select `extracted_text`.
- **Generation:**
  - `POST /api/cvs/:cvId/generations` returns 202 with the job.
  - `GET /api/generation-jobs/:id` is for polling.
  - `jobs/worker.ts` claims jobs with `SKIP LOCKED`. Raw SQL must set `updated_at` itself, since `@updatedAt` and `uuid(7)` are filled in by Prisma, not the DB.
  - The worker keeps a heartbeat and requeues or fails stale jobs.
  - One active job per CV, enforced with Prisma's `partialIndexes` preview (7.4+).
  - `integrations/ai`:
    - `@anthropic-ai/sdk`, `client.messages.parse` + `zodOutputFormat(CvContentSchema)`, model `claude-opus-5-5`;
    - explicit effort (it defaults to medium);
    - refusal handling and the default server-side fallbacks;
    - output re-validated, then written to `job.result` and `cvs.content` with a `content_version` check.
- **PDF:** `integrations/pdf` plus `GET /api/cvs/:cvId/pdf`.
- **Full editor UI.**
