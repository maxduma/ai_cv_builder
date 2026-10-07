> Plan for step 7, approved in Claude Code's plan mode on 2026-10-03 and implemented in [PR #7](https://github.com/maxduma/ai_cv_builder/pull/7). Copied verbatim from the session. One sentence of personal notes is left out and marked `[omitted: …]`.

---

# Plan: Final polish of AI CV Builder before submission

## Context

The project is a hiring take-home ("AI CV Builder", 10-hour test task). A 14-reviewer read-only audit
(98 findings → 59 clusters; the 16 medium+ clusters were each attacked by two skeptics) found **no
blockers**: all product requirements are met, tests/lint/typecheck pass, repo is public, `main`
contains PR #6, no secrets in history, `docker compose up` works without `.env`.

What remains is one real gap against the assignment's wording, README problems against the
"short README" deliverable, and a list of small, low-risk improvements the user chose to do.

User decisions: relevance-first experience order; README → short README + `docs/`; do all four
optional groups (quick code fixes, mobile CSS, tests + CI, PDF investigation); create-form
persistence via `beforeunload` + `sessionStorage`.

Constraints from the repo's own rules: reply in Ukrainian, UI copy stays English; keep scope to
what is listed below (see "Deferred"); run `pnpm test` in the foreground (~10–60 s, see
test-env-throttling memory); never read/print `.env`.

## Git workflow

Current branch `chore/final-review` is already merged (PR #6) and local `main` is 6 commits behind.
Before any commit: `git checkout main && git pull && git checkout -b chore/submission-polish`.
One logical commit per step below (readable history is a graded deliverable); commit message
trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Open the PR and push only after
the user confirms; after opening, use the ccd_pr tools (`get_status`, `bind_pr`) rather than polling.

## Steps (in order)

### 1. Experience ordered by relevance (the one real gap vs the brief)
Brief: "the most relevant experience comes first". Today roles are "most recent first".
- `apps/api/src/modules/generation/claude/prompt.ts:24`: roles "ordered by relevance to the target
  role, most relevant first; most recent first among equally relevant". Line 12 already says
  "in which order" (now consistent). Keep education "most recent first" (line 25 / schema).
- `claude/cv-draft.schema.ts:97`: same wording for the experience list description (line 112
  education stays).
- Fix the false comments: `cv-draft.schema.ts:8`, `claude-cv-generator.ts:99`,
  `claude-answer-updater.ts:21` ("Lists come most relevant first") so they are accurate; with the new
  ordering `cutLists` (keeps first N) now keeps the most relevant roles.
- Check `claude/prompt.test.ts` for assertions on the changed wording; add one test pinning the
  new sentence in `SYSTEM_PROMPT`.
- Needs one real-key generation afterwards (step 9) with a CV whose latest job is unrelated, to
  confirm order, dates and bullets hold.

### 2. Quick code fixes
- **Notes limit:** `packages/shared/src/cv.ts:11` `SOURCE_TEXT_MAX_LENGTH` 5_000 → 20_000;
  `apps/web/src/features/cvs/create/FormSteps.tsx:15` `TEXT_WARN_AT` → `Math.floor(MAX * 0.9)`;
  `apps/api/src/modules/cvs/cvs.routes.test.ts:130,307` use `SOURCE_TEXT_MAX_LENGTH + 1`; check
  `useCvDraft.ts:272` slice and the largest-CV/1 MB body test still hold; add a README line.
- **Flaky test:** `apps/api/src/test/start-app.ts:90-92` make `afterEach` async: for each server
  `closeAllConnections()` and await `close`. Re-run `pnpm test` ≥10 times.
- **UI copy that overpromises:** `FormSteps.tsx:67` → "We tailor the wording, skills and the order
  of your achievements to it."; `status/CvStatusPage.tsx:207` "A one-page draft" → "A first draft";
  `dashboard/CvListPage.tsx:51` and `auth/SignUpPage.tsx:26` "Create, edit and manage" → "Create and
  edit your CVs".
- **Drop unused `cvs.job_description`** (reads as the out-of-scope "tailoring to a job
  description"): remove `jobDescription` at `apps/api/prisma/schema.prisma:33`, add a new migration
  `drop_cv_job_description` (never edit the init migration; timestamp after
  `20261002221745`), verify no drift with `prisma migrate diff`, run `test:db`, remove README mentions
  (:234, :354 — or the moved docs).
- **Neutral questions:** `prompt.ts` Issues section (:30-37): add "Ask neutrally: never presuppose a
  title, responsibility, tool or result the source doesn't state; ask whether the person has it."
  Mirror in the `question` description (`cv-draft.schema.ts:128-130`).
- **Headline guard:** in `toGeneratedCv` (`claude-cv-generator.ts` ~:156-175), if the normalised
  headline equals the normalised target role and does not appear in the sources, clear it
  (reuse contact-guard's normalisation/"appears" helper; consider an "ambiguous" issue "What is your
  current or most recent job title?"). Test beside `contact-guard.test.ts`; change
  `mock-cv-generator.ts:76` (`headline: input.targetRole`) to `''` and fix any mock test that asserts it.
- **Neutral failure message:** `generation.failures.ts:44-48` reword `AI_REQUEST_REJECTED` so it
  doesn't blame the user's PDF ("The AI service rejected this request. If your description or PDF is
  very long, shorten it; otherwise try again later."); update tests asserting the old text.

### 3. Create-form persistence (`beforeunload` + `sessionStorage`)
Files: `apps/web/src/features/cvs/create/useCvDraft.ts` (state in `latest.current`; `ensureDraft`
:133-158, `start` :284-312), pattern from `apps/web/src/app/AppLayout.tsx:31-37`.
- While role/text are non-empty and not yet saved to the draft, register a `beforeunload`
  `preventDefault()` guard (clear it once `ensureDraft`/`start` has sent the values).
- Mirror `{role, text}` to `sessionStorage` (try/catch, key per tab, e.g. `cvb:create-form`),
  restore on mount only when the form is empty and no draft is being edited, clear after
  `start()` succeeds.
- Clear the key on logout/login (`apps/web/src/features/auth/api.ts` `removeUserData`, :52) so one
  account's typed text can't appear for another in the same tab.
- Update the README limitation (:358).

### 4. Mobile CSS (all low risk, CSS-only unless noted)
- `features/auth/auth.css:5` add `min-height: 100dvh` after the `100vh`; `preview/preview.css:653` →
  `calc(100dvh - 48px)`; `editor/cv-preview.css:74` same.
- `app/layout.css` (≤599px block): `.nav-link, .back-link { height: 44px }`; `styles/components.css`
  (≤599px): `.control > .icon-btn { top:0; right:0; width:44px; height:44px }`.
- `ui/cv-page.css:6`: `overflow-wrap: anywhere` on `.cvp-page`.
- `editor/sections/sections.css:617`: `@supports not (field-sizing: content) { .bl-input { min-height: 112px } }`.
- `sections.css:761` link rows ≤599px: `grid-template-columns: minmax(0,1fr) 44px` with the type select on
  its own row.
- Landscape phones: `@media (max-height: 500px)` make `.app-header, .ed-bar, .fp-bar, .sec-nav`
  `position: static` (bottom bars stay fixed); side padding
  `max(32px, env(safe-area-inset-left/right))` on the bars/containers instead of removing
  `viewport-fit=cover` (keeps the design's full-bleed bars).
- Verify in the built-in browser with `resize_window` (mobile 375×812, then custom 812×375, and 320 wide).
  Remember hidden-pane polling pause (memory: test-env-throttling).

### 5. Tests and CI
- **Journey test** `apps/api/src/journey.test.ts` using `startApp` (`apps/api/src/test/start-app.ts`)
  with `sessions: 'real'` and the real `createReactPdfCvRenderer()`: sign up → `POST /api/cvs` →
  `POST generations` → `worker.tick()` with the mock generator (stepMs 0, failRate 0) → read job and CV →
  answer a question → tick → `PUT content` with an edit → `GET /pdf` → extract text with unpdf and
  assert it contains the edited summary. Foreground run.
- **Web unit test** for `apps/web/src/features/editor/editor-session.ts`: add `"test": "vitest run"`
  and `vitest: catalog:` to `apps/web/package.json` (update `pnpm-lock.yaml`; note
  `docker compose up --build -V` after dependency changes). `editor-session.test.ts` with
  `vi.useFakeTimers` and `vi.mock('../cvs/api')`: two quick edits → one save with `baseVersion`;
  `CONTENT_CONFLICT` merges and retries; network failure → `retry()` recovers; `receive()` mid-flight
  applies after settle; invalid email held back. Update README :63/:353/:387 accordingly.
- **Small API tests:** `app.test.ts` security headers (`x-content-type-options`, CSP, no
  `x-powered-by`) and `X-Request-Id` sanitising (200-char id and id with spaces replaced); add
  `apps/api/vitest.config.ts` with `testTimeout: 20_000` (no retries).
- **CI** `.github/workflows/ci.yml` (~20 lines): Node 22, `corepack enable`,
  `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test`, plus a
  `postgres:17-alpine` service and `TEST_DATABASE_URL=postgresql://cvbuilder:cvbuilder@localhost:5432/cvbuilder_test pnpm --filter @cv-builder/api test:db`.
  If the PG step is red on the first run, drop that step rather than ship a red check.
  Check via ccd_pr `get_status` after pushing.

### 6. PDF text-layer investigation (time-boxed ~30–45 min)
Skeptic reproduced it: one shared fontkit glyph cache (`integrations/pdf/react-pdf-cv-renderer.tsx:38-54`,
single renderer at `server.ts:82`) — after rendering a CV with e.g. "Zürich", a later PDF with "Linux"
extracts as `Lin\u0004x` (base glyph cached with empty code points).
- Write a scratch regression in `react-pdf-cv-renderer.test.ts`: render "Zürich", then "Linux Ubuntu",
  extract with unpdf, assert text intact.
- If it reproduces: try the smallest fix (prime the cache after `Font.register`: for weights
  400/500/600/700, `Font.getFont(...)` → `await f.load()` → `f.data.layout(printable ASCII + U+00C0-017F + U+0400-04FF + U+1E00-1EFF)`;
  registration becomes async and awaited in `render()`). React-PDF is pinned at 4.9.0, so internals
  won't drift. Keep the test.
- If the fix is not a few clean lines, document it in the README limits instead and don't ship the hack.
- Also correct README :326 ("blanks"): unsupported glyphs fall back to Helvetica and print as wrong
  symbols; optionally in `packages/shared/src/cv-view.ts:51-75` apply `normalize('NFC')`, map exotic
  spaces to `' '`, strip zero-width/bidi characters, map U+2010/2011 to `-`, with `cv-view.test.ts` cases.

### 7. README → short README + `docs/`
Target: root `README.md` ≈150 lines covering the five required items, everything else linked.
- **Keep in README:** title + 3-line status; Quick start (plain `docker compose up` first; "set
  `ANTHROPIC_API_KEY` in `.env`; without it the app runs in demo mode with clearly labelled sample
  content"; "wait for `API listening on port 4000`"; the only value you must provide is
  `ANTHROPIC_API_KEY`, `JWT_SECRET` is optional in dev); How to run the tests (short table);
  Architecture overview (diagram + ~8 bullets + link to docs); **Preventing invented facts**
  (H2, the 7 layers + "the limits, honestly"; add the sentence that questions beyond cleared contact
  details depend on Claude listing them, and that a question's entry is identified by the model's
  position index); Decisions and trade-offs; Simplified; **What I would do differently with more time**
  (retitled from "Next steps", moved before the AI section, "the choice I doubt most" first, then
  in-process worker/PDF → separate process/worker_threads, stateless JWT → session table,
  polling → SSE, dev-only Docker → production images + HTTPS, web tests); **How I used AI tools**;
  short Troubleshooting (+ Claude rejection: `docker compose logs api`, find "Claude rejected the
  request", check key/model access, set `ANTHROPIC_MODEL`; + Linux root-owned files line); Contents
  line using the assignment's five labels first.
- **Move to `docs/`:** `docs/architecture.md` (backend layers, data model + ER diagram, persistent
  job + state diagram, generation with Claude, editing/merge, PDF export), `docs/api.md` (REST table
  incl. `GET /api/health`, error shape, auth and ownership, job error codes),
  `docs/development.md` (everyday commands, configuration table, project structure incl. `pages/`
  and `types/`, testing details).
- **Factual fixes while moving:** "About 500 tests" → "515 tests (+16 on PostgreSQL)"; "an earlier
  model" → "a fallback model Anthropic picks"; ER columns `cv_questions.kind/target`; advisory lock
  makes claims exclusive, `SKIP LOCKED` is belt and braces; remove `job_description` mentions;
  line 264 ordering statement matches step 1; 5,000 → 20,000 limit; add limits bullets
  (two-column PDFs interleave, link URLs behind link text aren't extracted, Cyrillic CV gets English
  section headings in the PDF, questions in English).
- **AI-tools section in first person** with 3–4 concrete, TRUE cases tied to commits (fe5cde3 U+0000 →
  500 on PostgreSQL; 784a05b `crypto.randomUUID` missing on `http://<LAN-IP>`; 4b9e3e9 README
  corrections; 333aecf iOS zoom). **Do not write who found each one until the user confirms**; add what
  was checked by hand with a real key (date, model, tokens/seconds from `docker compose logs api`).
  Optionally one honest sentence with real focused hours — only if the user supplies the number.
- After the split: grep all `](#...)` anchors and relative links, run `pnpm format`, `pnpm format:check`.

### 8. Full verification (foreground)
`pnpm typecheck && pnpm lint && pnpm format:check && pnpm test` (repeat `pnpm test` ×10 to confirm
the flake is gone); `docker compose exec -e TEST_DATABASE_URL=postgresql://cvbuilder:cvbuilder@db:5432/cvbuilder_test api pnpm test:db`
(needs the stack up; includes the new migration); browser checks for steps 3 and 4.

### 9. Clean-clone, real-key run (the most valuable check)
In a temp directory: `git clone https://github.com/maxduma/ai_cv_builder` (after the PR is merged) →
`ANTHROPIC_API_KEY=… docker compose up --build` (only the key; the user supplies it, I never read
`.env`) → sign up → create with a PDF + role (+ some text) → watch progress, reload mid-generation →
check relevance-first order, questions, answer a question, edit a field, download the PDF and
check A4 + selectable text → repeat at 375 px width. Record tokens/seconds/model for the README.

## Deferred (not selected — mention, don't build)
Number-token guard for invented metrics (prototype gave false positives; keep the honest README
paragraph), deterministic backstop for empty email/phone/dates, login rate limiting and per-user
quotas, cancel/delete/rename CV, status-page "reconnecting" hint and shared load-error panel,
textarea for question answers and education details (C35/C36 — if C36 reproduces in the browser as
words being glued, it is a real bug worth a one-line fix), skills paste-split and reorder of
achievements/skills, `ScrollRestoration`, "Waiting for a free slot…" label, aria cleanups,
copy-pasted helper dedup, LICENSE, history rewrite. [omitted: personal interview-prep notes, not about the code]

## Critical files
`apps/api/src/modules/generation/claude/{prompt.ts,cv-draft.schema.ts,claude-cv-generator.ts,claude-answer-updater.ts}`,
`apps/api/src/modules/generation/{generation.failures.ts,mock-cv-generator.ts}`,
`apps/api/src/integrations/pdf/react-pdf-cv-renderer.tsx`, `apps/api/prisma/schema.prisma` (+ new migration),
`apps/api/src/test/start-app.ts`, `packages/shared/src/{cv.ts,cv-view.ts}`,
`apps/web/src/features/cvs/create/{useCvDraft.ts,FormSteps.tsx}`, `apps/web/src/features/editor/editor-session.ts`,
web CSS files listed in step 4, `README.md` + new `docs/*.md`, new `.github/workflows/ci.yml`.

## Verification summary
Green `typecheck`/`lint`/`format:check`/`test` (×10), green `test:db`, browser check at 320/375/812×375,
green CI on the PR, and the clean-clone real-key run in step 9.
