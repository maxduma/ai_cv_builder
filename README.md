# AI CV Builder

A fullstack app that turns a PDF or a few notes plus a target role into a CV draft written by Claude, which you review, edit and download as an A4 PDF. Built as a take-home assignment.

**Status:** the whole flow works end to end. You sign up, create a CV from a PDF and/or notes, follow the generation (a background job that survives reloads), answer the questions the AI asks about what is missing, edit every field, and download the PDF. 566 automated tests (plus 16 on PostgreSQL) cover the API, the shared code and the editor's autosave.

| Layer    | Stack                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| Web      | React 19, TypeScript, Vite 8, React Router 7, TanStack Query 5, plain CSS                |
| API      | Node.js 22, TypeScript, Express 5 (REST), Zod 4, pino                                    |
| Database | PostgreSQL 17, Prisma 7                                                                  |
| AI       | Anthropic API: Claude (Opus 5.5 by default) with structured output (`@anthropic-ai/sdk`) |
| PDF      | React-PDF (`@react-pdf/renderer`) on the API, with Geist embedded; unpdf to read uploads |
| Tooling  | Docker Compose, pnpm workspaces, Vitest, ESLint, Prettier, GitHub Actions                |

**The five things the assignment asks this README to explain:** [run the project and the tests](#quick-start) · [architecture and main decisions](#architecture) · [how the AI is kept from inventing facts](#preventing-invented-facts) · [what I simplified, and what I would do differently](#simplified-for-the-time-limit) · [how I used AI tools](#how-i-used-ai-tools).
More detail: [docs/architecture.md](docs/architecture.md) · [docs/api.md](docs/api.md) · [docs/development.md](docs/development.md) (commands, configuration, code layout, what the tests cover).

## Quick start

Prerequisite: Docker Desktop (or Docker Engine with Compose v2). Nothing else is needed to run the app.

```bash
cp .env.example .env          # then set ANTHROPIC_API_KEY in .env
docker compose up
```

- Web app: http://localhost:5173 (sign up, then "Create a new CV")
- API health: http://localhost:4000/api/health

The first start builds the dev image and installs dependencies, which takes a few minutes. The API then generates the Prisma client and applies the database migrations before it listens, so wait for `API listening on port 4000` in `docker compose logs -f api` before opening the app. After that, `docker compose up` starts in seconds (add `--build` after changing dependencies).

**The only value you must provide is `ANTHROPIC_API_KEY`**, from `.env` or from your shell (`ANTHROPIC_API_KEY=… docker compose up`). `JWT_SECRET` is optional in development: without it the API signs sessions with a public development secret and logs a warning (it is required only when `NODE_ENV=production`, which this development-only Compose file never sets). **Without the API key the app runs in demo mode:** development mocks walk through the real steps and save clearly labelled sample content, so the whole flow can be tried for free; the health check then reports AI as `not_configured`. The other settings (model, timeouts, ports, log level) are optional and listed in `.env.example` and [docs/development.md](docs/development.md#configuration).

### Open it on your phone

With your phone on the same network, open `http://<your-computer-ip>:5173`. On macOS, `ipconfig getifaddr en0` prints that IP. Only the web port is reachable from the network; the browser talks to the API through the dev server's `/api` proxy. The database and API ports are bound to localhost.

## Testing

| What                              | Command                                                                                                             | Needs                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| All tests (API and shared)        | `pnpm test`                                                                                                         | Node 22 + pnpm on the host  |
| The same, with Docker only        | `docker compose exec -w /app api pnpm test`                                                                         | the running `api` container |
| Data layer on PostgreSQL (opt-in) | `docker compose exec -e TEST_DATABASE_URL=postgresql://cvbuilder:cvbuilder@db:5432/cvbuilder_test api pnpm test:db` | the running stack           |
| Lint, types, formatting           | `pnpm lint && pnpm typecheck && pnpm format:check`                                                                  | Node 22 + pnpm on the host  |

On the host: install Node 22, enable pnpm with `corepack enable`, and run `pnpm install` once (it also gives your editor types for every package). To run the PostgreSQL suite from the host against the Compose database: `TEST_DATABASE_URL=postgresql://cvbuilder:cvbuilder@localhost:54320/cvbuilder_test pnpm --filter @cv-builder/api test:db` (use your `DB_PORT` if you changed it). `pnpm format` rewrites files; `format:check` only checks.

`pnpm test` is hermetic: no Docker, database or network. Route tests start the real Express app (`createApp()`) on a random port with in-memory repositories and fakes for Claude, PDF text extraction, file storage and the PDF renderer; the pieces those fakes stand in for are tested on their own (the Claude client runs the real Anthropic SDK against a fake `fetch`; the PDF renderer renders real PDFs and reads their text back). `apps/api/src/journey.test.ts` runs the whole flow once, from sign-up to the PDF, over HTTP. The opt-in PostgreSQL suite runs the real Prisma repositories (locks, `SKIP LOCKED`, constraints, user isolation) on a database whose name ends in `_test`; CI runs it too.

What is covered, in short: authentication and the isolation of users on every endpoint; generation state transitions, deadlines and crash recovery; validation of the AI's output; uploads and PDF export; the editor's autosave and merge. The full list is in [docs/development.md](docs/development.md#tests-in-detail). The pages and layout of the web app have no automated tests (see [Simplified](#simplified-for-the-time-limit)); I checked them by hand in a browser: the whole flow on desktop and at 320 and 375 px, iOS zoom on touch screens, failed and offline saves, a failed background refetch, an API restart and crash mid-generation, and cancelling an upload while the server reads it.

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|"/ and /api/*"| V[Vite dev server :5173]
  V -->|proxy /api| A[API :4000]
  A --> P[(PostgreSQL)]
  A -->|CV generation, answers| C[Anthropic API]
```

The browser only calls relative `/api/*` URLs and the Vite dev server proxies them to the API, so requests are same-origin: no CORS configuration is needed and the app works unchanged on a phone.

- **Layers.** Routes validate input with shared Zod schemas and call a service; services hold the business logic and take the acting user's id; repositories own every Prisma query; integrations (Anthropic, file storage, PDF extraction, PDF rendering) sit behind small interfaces. Dependencies are wired by hand in `http/router.ts`, and `createApp()` takes them as arguments, which is how the tests run it with fakes. Every error has one shape, `{ error: { code, message, details?, requestId } }`, produced in one place.
- **Authentication and ownership.** Email and password; passwords hashed with scrypt; a JWT in an `HttpOnly`, `SameSite=Lax` cookie. Every query made for a request is filtered by the session's user (another user's CV is a `404`), and composite foreign keys `(cv_id, user_id)` make it impossible for a job, document or question to exist for someone who doesn't own the CV.
- **CV generation is a persistent job in PostgreSQL.** `POST /api/cvs/:id/generations` stores the job and answers `202` at once. A worker inside the API process claims jobs (an advisory lock plus `FOR UPDATE SKIP LOCKED`), heartbeats while it runs, enforces a deadline, and records the result in the same database. The client polls the job, so the person can reload, close the tab or come back from another device and still see the CV being written. Jobs of a crashed process are requeued (and failed after three attempts); a restart hands running jobs back. Details and the state diagram: [docs/architecture.md](docs/architecture.md#cv-generation-as-a-persistent-job).
- **The AI's output is untrusted.** Claude answers in JSON constrained by a schema; the API validates it with strict Zod schemas before anything is saved, checks contact details against the person's own material, and never stores or logs the raw output. [How invented facts are prevented](#preventing-invented-facts).
- **Questions and edits.** What is missing or vague becomes a question; an answer is applied as a background job that can change only its own section. Saves are versioned (optimistic locking) and merged three ways, so a manual edit and an applied answer never overwrite each other; manual edits win a conflict. [Details](docs/architecture.md#editing-and-the-ais-questions).
- **PDF.** React-PDF on the API draws the same view of the CV (`packages/shared/src/cv-view.ts`) that the on-screen preview shows: A4 pages, Geist embedded (Latin and Cyrillic), real selectable text. [Details](docs/architecture.md#pdf-export).

## Preventing invented facts

A CV must only state what the person told us. The pipeline has several layers, from instructions to deterministic checks to the person's own review:

1. **Sources are data, instructions are fixed.** The system prompt says to use only the facts in the material and never to invent employers, job titles, dates, degrees, metrics or contact details; to keep the target role out of the headline; to put what matters for the role first; and to report what is missing instead of filling it. The PDF text, the notes and the target role arrive in delimited blocks (their delimiters neutralised), so text inside them can't pose as instructions. There are no tools for the model to call.
2. **The schema lets the model leave things out.** Every field is required, but an empty string is the documented answer for anything the sources don't give, and no field has a format (such as an email pattern) that would push the model to produce something plausible.
3. **Output is validated, never trusted.** Strict Zod schemas (unknown keys and over-long values rejected), checked again by the worker before saving. Ids are assigned by the server.
4. **Contact details and the headline are checked deterministically** (`claude/contact-guard.ts`, `claude/headline-guard.ts`). An email, phone number or link stays only if it appears in the person's material, allowing for formatting (spacing and line breaks from the PDF, case, a URL's scheme, `www.` or trailing slash, phone punctuation); a link without an address is dropped too. Whatever is removed becomes a question ("What email address should employers use…"), so a CV never shows a guessed way to reach someone. The headline is the person's own job title: one that is only the target role is cleared unless the sources name that title too, and the person is asked for their own.
5. **Gaps become questions.** Missing or unclear facts are asked about, most important first, instead of being filled in. The questions are worded neutrally: they never presuppose a title, responsibility or result the sources don't state, because an answer to a leading question ("how many engineers did you lead?") could turn into an invented achievement.
6. **Answers are confined.** An answer can only change its own section (each section has its own schema) and, for a question about one role or school, only that entry; changes the model attributes to other entries are dropped. An empty value means "keep", nothing can be deleted, contact details must be typed in the answer itself, and a vague answer gets one follow-up question instead of a guess.
7. **The person has the last word.** The person's edits always win over an applied answer (see [Editing and the AI's questions](docs/architecture.md#editing-and-the-ais-questions)), everything is editable, and the PDF is rendered only from the saved CV the person sees.

The limits, honestly: only contact details are checked against the sources mechanically. Employers, titles, dates, numbers, skills and the headline rely on the prompt, the schema and the person's review; a mechanical check for them would also flag correct rewording ("2019–21" for "2019 to 2021", a role title written more formally), so it would cost questions on correct CVs. Questions about gaps other than removed contact details depend on Claude listing them, and the entry a question is about is identified by the model's position index (range-checked, not cross-checked against the question's label). The contact check is a match against the material, so a fragment of a real detail (part of an address) would pass. Text in a PDF that a person can't see (white text, a hidden layer) is read like any other text.

## Decisions and trade-offs

- **Postgres as the job queue** instead of Redis or BullMQ: it's one less service, the job state is transactional with the data it produces, and it's plenty for this workload. Claims run under an advisory lock (so two answers to one CV never run at once) together with `FOR UPDATE SKIP LOCKED`.
- **Hermetic tests plus an opt-in PostgreSQL suite** instead of a test container for every run: `pnpm test` runs anywhere in about ten seconds, and the SQL (locks, `SKIP LOCKED`, fencing, constraints) is still tested against the Compose database when `TEST_DATABASE_URL` is set. Both kinds share the isolation checks.
- **Shared package without a build step:** `@cv-builder/shared` exports TypeScript source, which Vite and tsx compile directly.
- **Pinned versions:**
  - Prisma `7.10.0` exactly. npm's `latest` tag for the `prisma` CLI points at an 8.0 release candidate.
  - TypeScript 6.0. typescript-eslint doesn't support TypeScript 7 yet.
  - React Router 7. v8 was released very recently.
  - React-PDF `4.9.0` exactly, so the PDF's page layout only changes with a deliberate upgrade.
- **Default ports:** API on 4000 and PostgreSQL on 54320, which avoids clashing with common local services on 3000 and 5432. Override them in `.env`.
- **Stateless sessions:** the server keeps no session list, so logging out only removes the cookie. A token that leaked stays valid until it expires (7 days at most). Revoking tokens would need a session table or a per-user token version.
- **Manual edits win:** when an applied answer and a manual edit change the same field, the edit is kept. A CV with content can't be generated again (`409 CV_ALREADY_GENERATED`): that would replace the person's edits.
- **PDFs with React-PDF, not a headless browser:** printing the HTML preview with Chromium would match it to the pixel, but would add a ~300 MB browser to the image and a process to keep alive. React-PDF is plain JavaScript; the template is drawn again from the same view of the CV, with the design's measurements.
- **Whole-document saves:** each save sends the whole CV (a few KB). Patches per field would save bandwidth, but versioned whole-document saves plus a merge are simpler to get right.
- **Sign-up reveals taken emails** (`409 EMAIL_TAKEN`), which a helpful sign-up form can't avoid without email verification. Login doesn't.

## Simplified for the time limit

The assignment had a 10-hour budget, so some things were deliberately left out or kept simple:

- **Product scope:** a CV can't be regenerated, renamed or deleted; one CV template, A4 only; uploads are PDF only (no DOCX, no OCR for scanned PDFs); the UI is in English; the PDF fonts cover Latin and Cyrillic only.
- **Accounts:** no email verification or password reset; sessions can't be revoked (see above); no login rate limiting yet. Limiting by client IP needs `trust proxy` set for whatever proxy runs in front of the API, or every client shares one IP. Meanwhile each guess costs a full scrypt hash, which also holds one of Node's four threadpool threads for a few hundred milliseconds, so a flood of logins would slow other requests too.
- **Infrastructure:** development-only Docker (the source is bind-mounted for hot reload; no production images, deployment or HTTPS); uploaded PDFs on a local volume; the job worker, PDF text extraction and PDF rendering all run in the API process. A crafted PDF (one compressed page with millions of text operators) can keep the API busy for seconds: the 15 s parse deadline stops pdf.js only when it yields. Moving extraction and rendering to `worker_threads` is the next step.
- **Testing:** the web app's pages and layout have no unit or browser end-to-end tests (the editor's autosave and merge and the saved create form do); I checked them by hand (see [Testing](#testing)). The repositories are tested on PostgreSQL in a suite that `pnpm test` skips unless `TEST_DATABASE_URL` is set; CI runs it.
- **Data:** the extracted text of a removed PDF stays in the snapshots of the jobs that used it (kept for auditing).

Known limitations of the UI:

- The create form sends the role and description to the server when Generate is pressed (the draft itself, with its PDF, is saved at once). Until then they are kept in the tab: a reload brings them back and closing the tab asks first, but leaving by a link discards them.
- Phones held sideways get the tablet layout. On short screens the header and the editor's bars scroll away instead of staying pinned, but the editor's bottom bar stays and some controls there are smaller than 44 px.
- Moving between pages doesn't move keyboard focus to the new page's heading (pages that load work, such as the generation status, do move it).
- Logging in as another account in another tab isn't noticed by an open tab until it is reloaded.
- Reading a PDF: text comes out in the PDF's content order, so a two-column or sidebar CV may interleave; the address behind a link's text is not extracted (a "LinkedIn" link becomes a question). A CV in Ukrainian or Russian gets English section headings and "Present" in the PDF, and the AI's questions are in English.

## What I would do differently with more time

The choice I doubt most is running the job worker, the PDF text extraction and the PDF rendering **inside the API process**. It kept the system to three containers and the job state transactional with the data, but a crafted PDF or a 95-page CV can occupy the event loop for seconds, and a restart aborts, and bills again, a Claude call in flight. With more time they would move to a separate worker process (at least `worker_threads`), with the queue unchanged.

After that, in order of how much each would matter:

1. **Sessions that can be revoked, and login rate limiting.** Stateless JWTs keep logout simple, but a leaked token lives up to 7 days. A session table (or a per-user token version) and a limiter keyed by email go together.
2. **Server-sent events instead of polling** for generation and answer progress: less load and instant updates. Polling is simple and survives any proxy.
3. **Production Docker and HTTPS:** multi-stage images, no bind mounts, a reverse proxy. The development-only Compose file is enough for this assignment.
4. **Mechanical checks beyond contact details:** a check that only flags (never deletes) a number or year in the draft that the sources don't contain, tuned on a small evaluation set of real CVs so that it doesn't flag correct rewording such as "2019–21".
5. **A browser end-to-end test** of the main flow, and the features I cut: regenerating, renaming and deleting CVs.

## How I used AI tools

I built the project with AI coding tools and directed and reviewed the result:

- **Design.** I designed the screens, desktop and mobile with their states (loading, errors, empty), first on Claude's design canvas. The web app's markup and CSS follow that design.
- **Implementation.** The code was written with Claude Code (mostly Claude Opus 5.5), one roadmap step at a time. For each step I wrote the requirements; Claude Code read the code base and proposed a plan in plan mode, asking about the decisions it couldn't make alone (scope, trade-offs); I corrected or approved the plan; then it implemented it, ran lint, type checks and the tests, and walked through the flow in a browser. I reviewed the changes and the pull requests. Commits carry a `Co-Authored-By: Claude` trailer.
- **Review.** Before submitting I ran a multi-agent review of the whole project: reviewers by area (authentication and isolation, validation and errors, uploads, LLM output, job persistence, web states, mobile, tests and documentation), skeptical verifiers that tried to refute each finding, and critics of the fix plan. A second review compared the code with the assignment text sentence by sentence. The confirmed findings were fixed with tests, and I walked the flow through again end to end (with the mock, and with Claude).
- **What the review caught in AI-written code.** A few examples, each fixed with a test: a U+0000 character in pasted text made PostgreSQL reject the write and the API answer `500` (`fe5cde3`); `crypto.randomUUID` doesn't exist on `http://<computer-ip>:5173`, so adding a row did nothing when the app was opened from a phone (`784a05b`); the prompt asked for roles "most recent first" although the assignment says most relevant first; the headline could be set to the target role, a title the person might not hold; and after a CV with an accented letter the PDFs that followed lost the text mapping of some letters.
- **What stayed with me:** the requirements, the product and scope decisions, approving each plan, and reviewing the result.

Claude is also part of the product itself: the API calls the Claude API to write CVs and apply answers (see [Generation with Claude](docs/architecture.md#generation-with-claude)). That is separate from the tools used to build it.

## Troubleshooting

- **Port already in use:** set `WEB_PORT`, `API_PORT` or `DB_PORT` in `.env`, then run `docker compose up -d`.
- **Module not found after changing dependencies:** run `docker compose up --build -V` to rebuild the image and refresh the container `node_modules` volumes.
- **The web app stopped after switching git branches:** the Vite dev server can exit when files disappear for a moment during a checkout. Run `docker compose up -d web`.
- **Code changes aren't picked up:** the project folder must be shared with Docker Desktop. On macOS, allow Docker to access the folder (e.g. Desktop or Documents) if prompted.
- **Editor can't find `generated/prisma`:** run `pnpm --filter @cv-builder/api db:generate`. `pnpm typecheck` also generates it.
- **Generation fails right away:** run `docker compose logs api` and look for `Claude rejected the request`: it names the cause. Check that the key is valid and that its account has access to the model, or set another model with `ANTHROPIC_MODEL` in `.env` (the request uses Opus 5.5 features, adaptive thinking and server-side fallbacks, so other models may reject it).
- **Permission errors on Linux:** the containers run as root, so files they create in the project folder (`node_modules` mount points, `apps/api/src/generated`) are root-owned. Run the tests inside Docker (`docker compose exec -w /app api pnpm test`), or `sudo chown -R $USER .` before installing on the host.
