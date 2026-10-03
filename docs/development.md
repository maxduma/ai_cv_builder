# Development

Commands, configuration, the code layout and what the tests cover. Getting the app running is in the [README](../README.md#quick-start).

## Everyday commands

| Task                                    | Command                                                                                                           |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Start / stop                            | `docker compose up` / `docker compose down`                                                                       |
| Follow API logs                         | `docker compose logs -f api`                                                                                      |
| Create a migration after editing schema | `docker compose exec api pnpm db:migrate --name <change>`                                                         |
| Apply a changed API key                 | `docker compose up -d`                                                                                            |
| After adding or removing dependencies   | `docker compose up --build -V`                                                                                    |
| Reset the database                      | `docker compose down -v`                                                                                          |
| Prisma Studio (from the host)           | `DATABASE_URL=postgresql://cvbuilder:cvbuilder@localhost:54320/cvbuilder pnpm --filter @cv-builder/api db:studio` |

## Configuration

Docker Compose reads `.env` (copy `.env.example`), and the only value in it is `ANTHROPIC_API_KEY`. Without it the API runs on development mocks (demo mode).

Everything else is a constant next to the code it tunes, so there is nothing else to set:

| What                                                   | Where                                                                                                                                      |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude model and effort                                | `CLAUDE_MODEL` and `EFFORT` in `integrations/ai/claude-client.ts`                                                                          |
| Job deadlines (4 minutes per generation, 2 per answer) | `jobTimeoutMs` and `answerTimeoutMs` in `modules/generation/generation.worker.ts`                                                          |
| Pace and failure rate of the demo mocks                | `STEP_MS` and `FAIL_RATE` in `mock-cv-generator.ts` and `answers/mock-answer-updater.ts` (set `FAIL_RATE` to 1 to see the failure screens) |
| Log level                                              | `LOG_LEVEL` in `lib/logger.ts`                                                                                                             |
| Host ports (5173, 4000 and 54320) and database login   | `docker-compose.yml`; a busy port can be moved with `WEB_PORT=5174 docker compose up` (also `API_PORT`, `DB_PORT`)                         |

`NODE_ENV`, `PORT`, `DATABASE_URL` and `UPLOAD_DIR` (uploaded PDFs, in the `uploads` volume) are set in `docker-compose.yml`. Sessions are signed with `JWT_SECRET` when the process has one; Compose gives it none, so the API uses a public development secret and logs a warning. Production (`NODE_ENV=production`) refuses to start without a private `JWT_SECRET` and an `ANTHROPIC_API_KEY`. The API validates its environment at startup and exits with a readable message if anything is invalid.

## Project structure

```
apps/
  api/                      REST API (Express)
    prisma/                 schema.prisma + migrations
    prisma.config.ts        Prisma CLI config (schema/migrations paths, database URL)
    src/
      server.ts             process entry: config → logger → DB → HTTP server + worker, graceful shutdown
      app.ts                createApp(): middleware, /api routes, 404, error handler
      config/               environment validation (Zod)
      db/                   Prisma client (node-postgres driver adapter), DB ping, repositories wiring,
                            and the opt-in PostgreSQL test suite
      http/                 Express wiring: router (composition root), middleware, the isolation test
      modules/<domain>/     routes → service → repository (+ mapper) per domain: auth (sign-up,
                            login, sessions), users, cvs (incl. saving edited content),
                            source-documents (PDF upload), questions (the AI's questions and
                            answers), generation (jobs and worker for generations and answers,
                            Claude in claude/, answers/ for applying an answer, the
                            development mocks), cv-pdf (the PDF download)
      integrations/         ai (Anthropic client), storage (uploaded files on disk),
                            extraction (PDF → text with unpdf), pdf (CV → A4 PDF with
                            React-PDF; the Geist fonts in pdf/fonts)
      lib/                  logger, error types
      types/                Express type augmentation (the signed-in user on the request)
      test/                 test harness: the app on a random port, in-memory repositories,
                            fixtures, the isolation checks shared with the PostgreSQL suite
      generated/prisma/     generated Prisma client (git-ignored)
  web/                      React SPA (Vite)
    src/
      app/                  router, layout, route error boundary
      pages/                the not-found page
      features/auth/        log in and sign up pages, the current session
      features/cvs/         dashboard (My CVs), create (the form), status (generation progress)
      features/clarify/     "A few quick questions": answering the AI's questions after a draft
      features/editor/      the CV editor: sections, live preview, autosave session, questions card
      features/preview/     the CV at full size and the PDF download
      ui/                   shared pieces from the design: status chips, state panels, CV page and
                            thumbnail, icons
      styles/               design tokens and base/component CSS (from the design canvas)
      lib/                  API client (incl. upload with progress), query client, formatting
packages/
  shared/                   types and Zod schemas shared by web and api (DTOs, error shape, enums),
                            the three-way merge of CV content both sides use, and the CV as its
                            page shows it (cv-view.ts), which the preview and the PDF both draw
docker-compose.yml          db + api + web for local development
Dockerfile.dev              dev image: Node 22 + pnpm + installed dependencies
```

## Tests in detail

**How the tests are built.** `pnpm test` is hermetic: no Docker, database or network. Route tests start the real Express app (`createApp()`) on a random port with in-memory repositories and fake integrations (Claude, PDF text extraction, file storage, PDF rendering), and call it over HTTP with real session cookies where it matters. The pieces those fakes stand in for are tested on their own: the Claude client runs the real Anthropic SDK against a fake `fetch`, the PDF extractor parses real PDFs, and the PDF renderer renders real PDFs and reads them back. The opt-in PostgreSQL suite (`apps/api/src/db/repositories.postgres.test.ts`) runs the real Prisma repositories: it only accepts a database whose name ends in `_test`, creates and migrates it if needed, and empties it before every test. Without `TEST_DATABASE_URL` it is skipped.

What the tests cover, by area:

- **Authentication:** sign-up, login, logout and `me`; the same answer for a wrong password and an unknown email; tampered, expired and `alg: none` tokens; a token for a deleted account; cookie flags (`HttpOnly`, `SameSite`, `Secure`); password hashing; tokens kept out of logs. The stateless-session trade-off (a copied token stays valid until it expires) is pinned by a test.
- **User isolation:** `http/ownership.test.ts` sends every request that names a CV, job or question as another account (404, nothing changes) and without a session (401). On PostgreSQL the same checks run over HTTP, and every repository method is called with another user's id.
- **CV creation and updates:** validation and limits (including the largest CV the limits allow, in 3-byte characters, against the 1 MB body limit), U+0000 in text, optimistic locking (`409 CONTENT_CONFLICT` with the newer content), and on PostgreSQL two saves over one version at once.
- **Generation state transitions:** PENDING → PROCESSING → COMPLETED/FAILED through the worker; deadlines (`AI_TIMEOUT`), a lost lease, stale jobs requeued and failed after three attempts (`WORKER_LOST`), jobs handed back on shutdown, a database error mid-job, retrying after a failure, and the CV's status in every state. On PostgreSQL: concurrent starts, `SKIP LOCKED` claims, answers first and one per CV, writes from a stale lease ignored, and a generation's CV and questions written in one transaction.
- **AI output validation:** invalid JSON, schema mismatches, refusals, truncation and broken streams (with the one retry); lists cut to their limits; advisory items dropped instead of failing; the contact guard and the headline guard; answers kept to their section and entry, contact details only from the answer, and one follow-up at most.
- **Uploads and PDF export:** size, type, signature, page and text limits, malformed multipart bodies, clean-up of stored files on failure, file name cleaning, a parse deadline that really stops pdf.js; A4 pages, embedded fonts, selectable text, links, Cyrillic, and pagination of the largest CV.
- **The whole flow:** `src/journey.test.ts` signs up, creates a CV, generates it with the real worker, answers a question, edits by hand, downloads the PDF and reads its text back, over HTTP with real sessions (only Claude is replaced by the development mocks).
- **HTTP basics:** security headers, `Cache-Control: no-store`, and the sanitising of a client-supplied `X-Request-Id`.
- **PDF text layer:** accented letters rendered first must not damage the text of the PDFs that follow.
- **The web app:** unit tests for the editor's autosave and merge session (`features/editor/editor-session.test.ts`: debounce, one save in flight, `409` merge and retry, newer copies applied after a save, values held back, undo) and for the create form kept across reloads (`features/cvs/create/saved-form.test.ts`).

The rest of the web app (pages, forms, layout) has no automated tests (see the [README](../README.md#simplified-for-the-time-limit)). It was checked by hand in a browser: the whole flow on desktop and at 320 and 375 px, iOS zoom on touch screens, failed and offline saves, a failed background refetch, an API restart and crash mid-generation, and cancelling an upload while the server reads it.
