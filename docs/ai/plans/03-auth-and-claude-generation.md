> Plan for step 3, approved in Claude Code's plan mode on 2026-10-02 and implemented in [PR #3](https://github.com/maxduma/ai_cv_builder/pull/3). The plan is in Ukrainian. Copied verbatim from the session.

---

# План: автентифікація (2.1) + реальна генерація CV через Claude (2.3)

## Context

Частина 2.2 (дашборд, створення CV, завантаження PDF, персистентні джоби з mock-генерацією) вже злита в `main` (PR #2). Зараз API діє від імені захардкодженого demo-користувача (`apps/api/src/server.ts:14,28-31,39`), а генерація — `mock-cv-generator.ts`. Потрібно:

- **2.1** — реєстрація/логін email+пароль, безпечне хешування, JWT, захищені маршрути, збереження сесії на фронтенді, logout, зрозумілі помилки; UI логіну/реєстрації за дизайном; власник ресурсу — тільки з автентифікованого запиту.
- **2.3** — справжній пайплайн через Anthropic Claude: структурований JSON, строга валідація перед збереженням, статуси pending/processing/completed/failed, робота у фоні, REST-статус, розділені system-інструкції / дані CV / цільова роль, обробка збоїв Anthropic, невалідного JSON, помилок схеми, таймаутів.
- **2.2** — без змін у функціоналі; з появою auth власність CV стає реальною.

Рішення користувача: JWT у **httpOnly cookie**; статуси **перейменувати** в PENDING/PROCESSING/COMPLETED/FAILED; прогалини в даних — **лише в API** (UI Clarify пізніше); demo-користувача **видалити в міграції**.

**Не робимо** (є в дизайні або «можна було б», але не в промпті): OAuth-кнопки та роздільник «or», «Forgot password?», посилання Terms/Privacy (мертві лінки), екран Clarify, редактор, Cancel під час генерації, rate limiting логіну (потребує `trust proxy`; запишу в README як наступний крок), prompt caching (system-промпт малий — кешування лише подорожчає), відкликання JWT при logout (stateless, TTL 7 днів — задокументувати).

## Git
`feat/cv-create-flow` уже злита → `git checkout main && git pull && git checkout -b feat/auth-and-ai-generation`. Залежності додавати на хості (`pnpm --filter @cv-builder/api add jose cookie @anthropic-ai/sdk`) і комітити `pnpm-lock.yaml` (Docker робить `--frozen-lockfile`). Два коміти (auth; генерація), один PR.

---

## Частина A — Автентифікація (2.1)

### A1. БД
- `User`: `passwordHash String @map("password_hash")` (NOT NULL), `name` → NOT NULL (поле «Full name» обов'язкове в дизайні).
- Міграція: `pnpm db:migrate --name auth --create-only`, потім вручну: першим рядком `DELETE FROM "users";` (до auth існував лише demo-користувач без пароля; CV/джоби/документи — каскадом; PDF у volume стають сиротами → `docker compose down -v` за бажанням), далі `ADD COLUMN "password_hash" TEXT NOT NULL`, `ALTER COLUMN "name" SET NOT NULL`; потім `pnpm db:migrate`.

### A2. Shared (`packages/shared/src/auth.ts`, `errors.ts`)
- `SignUpRequestSchema` (strictObject `name`, `email`, `password`), `LoginRequestSchema`, `AuthUserDto {id, name, email}`, `AuthResponse {user}`. Без `preprocess`/`transform` (щоб на вебі `z.input` був простими рядками).
- Перевірений для zod 4.6 патерн: `z.string({error}).trim().toLowerCase().min(1,{error, abort:true}).max(254).pipe(z.email({error}))`; пароль не тримити, min 8 / max 128 (логін — непорожній, max 1024); ім'я trim 1–100.
- Тексти помилок з дизайну: «Enter your full name.», «Enter your email address.», «Enter a valid email address.», «Create a password.», «Use at least 8 characters.», «Enter your password.».
- Нові коди: `INVALID_CREDENTIALS`, `EMAIL_TAKEN`.

### A3. API
- **Хешування** `modules/auth/password-hasher.ts`: `node:crypto` scrypt, OWASP-набір `N=2^14, r=8, p=5` (16 MiB — вкладається в дефолтний `maxmem`, ~190 мс; `2^16/r8/p2` кидає `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`), сіль 16 Б, ключ 64 Б, формат `scrypt$14$8$5$<salt>$<hash>`; перевірка довжин перед `timingSafeEqual` (битий хеш = невдалий логін, не 500); dummy-хеш (рахується один раз) для невідомого email. Параметри інжектуються (дешеві в тестах).
- **JWT** `modules/auth/session-tokens.ts`: `jose`, HS256, `jwtVerify(..., {algorithms:['HS256'], issuer, audience, requiredClaims:['sub','exp']})`, TTL 7 днів, `sub` перевіряється `z.uuid()`; годинник інжектується через `currentDate`.
- **Cookie**: одна константа опцій `{httpOnly, sameSite:'lax', secure: production, path:'/api'}`; `res.cookie(name, token, {...opts, maxAge: TTL_MS})` (мс), `res.clearCookie(name, opts)` (той самий path, інакше не видалиться); читання — `parseCookie(req.headers.cookie ?? '')` з пакета `cookie` (пряма залежність). CSRF: SameSite=Lax + `express.json` парсить лише `application/json` (форми/text → 400, це блокує й login-CSRF).
- **Ендпоінти** `modules/auth/auth.routes.ts` + `auth.service.ts`:
  - `POST /api/auth/signup` → 201 `{user}` + cookie; дубль → 409 `EMAIL_TAKEN` з `details:[{path:'email', message:'An account with this email already exists.'}]` (без пре-чеку: hash → insert → P2002).
  - `POST /api/auth/login` → 200 `{user}` + cookie; 401 `INVALID_CREDENTIALS` «Incorrect email or password.» однаково для невідомого email і невірного пароля.
  - `POST /api/auth/logout` → 204, чистить cookie (публічний).
  - `GET /api/auth/me` → 200 `{user}` (за `currentUser`).
  - Валідація — наявний ZodError-хендлер → 400 `VALIDATION_ERROR` `[{path, message}]`.
- **Resolver** `createSessionResolver({tokens, users})` (у `http/middleware/current-user.ts` або `modules/auth`): cookie → verify → `users.findById` → `{id, email, name}`; `null` лише для `errors.JOSEError`/невалідного `sub`/видаленого користувача, помилки БД летять далі (500, а не масовий «logout»). `CurrentUser` отримує `name`; оновити докстрінг.
- **Users** `users.repository.ts`: прибрати `upsertByEmail`; `create()` → `{kind:'created', user} | {kind:'email_taken'}` (ловить `Prisma.PrismaClientKnownRequestError` `P2002` — у Prisma 7 + pg-адаптер `meta.target` немає, але `users` має лише один unique), `findCredentialsByEmail` (єдиний метод з хешем), `findById`. Додати `users` у `Repositories` і в `test/in-memory-repositories.ts` (`db.users`, унікальний email).
- **Wiring**: `AppDeps.auth = { passwordHasher, sessionTokens, secureCookies }`, `resolveCurrentUser` лишається інжектованим. `router.ts`: `/auth/signup|login|logout` до `currentUser`, `/auth/me` — після (невідомий `/api/*` без сесії тепер 401, не 404 — очікувано). `server.ts`: прибрати `DEMO_USER`.
- **Config** `env.ts`: `JWT_SECRET` ≥32 байти (через `TextEncoder`); у production обов'язковий і не може бути dev-дефолтом чи плейсхолдером з `.env.example`; у dev/test — фіксований dev-секрет + warning. `docker-compose.yml` (`JWT_SECRET: ${JWT_SECRET:-}`), `.env.example`, README.
- **Логи** `lib/logger.ts`: pino `redact` — `req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`.

### A4. Web
- **Сесія** `features/auth/api.ts` (як `features/cvs/api.ts`): `sessionKey=['session']`, `useSession()` → `GET /auth/me` (401 → `null`, `staleTime: Infinity`), `useLogin/useSignUp/useLogout`.
- **Глобальний 401**: `setUnauthorizedHandler` у `lib/api-client.ts`, викликається з `request()` і XHR `upload()` лише якщо `status===401 && code==='UNAUTHORIZED' && !path.startsWith('/auth/')` (так `INVALID_CREDENTIALS` форми логіну і `/auth/me` не зачіпаються). Обробник лише `setQueryData(sessionKey, null)` — без навігації/рефетчу (жодних циклів). Реєструється один раз на рівні модуля (`main.tsx`), не в компоненті (eslint `react-hooks`).
- **Маршрути** `app/router.tsx` (компонентні гарди, без loaders):
  - `GuestOnly` → `AuthLayout` + `<Outlet/>` для `/login`, `/signup`; залогінений → `Navigate` на `state.from` або `/`.
  - `RequireAuth` → `AppLayout` + існуючі маршрути (вкл. `*`): pending → порожній `main aria-busy`; `null` → `Navigate('/login', {state:{from}})`; помилка мережі/5xx → `StatePanel` з Retry (не редірект).
  - Сторінки після успіху **не** навігують самі — `GuestOnly` редіректить (без гонки). Лінки «Sign up»/«Log in» передають `state` далі.
  - `RouteError`: `ApiError` 401 → `Navigate('/login')` (щоб не блимало «Error 401»).
- **Login/Sign up** `features/auth/{AuthLayout,AuthAside,LoginPage,SignUpPage,PasswordField,PasswordStrength}.tsx` + `auth.css`:
  - Тексти, поля, autocomplete/inputmode, Show/Hide password, індикатор сили (Weak/Fair/Good/Strong за алгоритмом дизайну) + hint, «Logging in…»/«Creating account…», футер-лінки — дослівно з `Login.dc.html`/`SignUp.dc.html`; декоративний aside з трьома міні-CV (ховається ≤1023px), мобільні правила ≤599px.
  - Валідація на submit спільною zod-схемою, shake + фокус на першому невалідному полі, редагування поля прибирає його помилку; серверні `VALIDATION_ERROR`/`EMAIL_TAKEN` — під полями; `INVALID_CREDENTIALS`/мережа — `.alert.is-inline role="alert"` (патерн StateLibrary).
  - CSS: перевикористати наявні `.field/.control/.input/.has-clear/.icon-btn/.error/.btn-*/.spinner/.chip/.brand*` і keyframes; портувати лише відсутні: `.label/.hint/.link/.pw-meter/.meter*/.btn:disabled*/.alert*` → `styles/components.css`; `.auth*/.aside*/.is-shake-a|b` + `cvb-shake-a|b` + `cvb-float-aside` (−8px; `cvb-float` уже зайнятий у `state-panel.css`) → `auth.css`; `.pv-split/.pv-side/.pv-avatar/.pv-main/.b-ac` → `ui/cv-mini-page.css`.
- **Хедер** `AppLayout.tsx` + `layout.css`: user-menu з `Main.dc.html` (аватар-ініціали, ім'я, шеврон; меню з ім'ям/email і «Log out»; Escape/backdrop закривають; ≤599px без імені). Іконки eye/eye-off/logout/chevron у `ui/icons.tsx`.
- **Logout/зміна користувача без «блимання»**: logout → `cancelQueries` → `setQueryData(session, null)` → `navigate('/login', {replace})` → `removeQueries` усіх, крім session (не `clear()` — він змусить змонтовані observers рефетчити й ловити 401). Перед `setQueryData(session, user)` при login/signup — той самий `removeQueries`, щоб новий користувач не побачив кеш попереднього.

### A5. Тести
- `startApp({ sessions: 'real' })` у `test/start-app.ts` (будує реальний resolver поверх in-memory users; дефолт — заглушка `x-test-user` з `name`); дешевий hasher, тестовий секрет; cookie через `headers.getSetCookie()`.
- `auth.routes.test.ts`: signup → cookie (HttpOnly, SameSite=Lax, Path=/api) + `/me`; дубль 409; поля 400 з path; невірний пароль і невідомий email → однаковий 401; logout чистить cookie; підроблений/протухлий/відсутній токен → 401; у відповідях ніколи немає хешу.
- Ізоляція з реальними cookie: по одному тесту на CV, upload, старт генерації, job — B отримує 404 на ресурси A.
- Unit: hasher, tokens (expiry, чужий секрет, `alg:none`), env (`JWT_SECRET` у production; оновити `toEqual` у `env.test.ts`).

---

## Частина B — Генерація через Claude (2.3)

### B1. Статуси та дані
- Enum `PENDING|PROCESSING|COMPLETED|FAILED`. Міграція `--create-only` з ручним тілом (Prisma інакше згенерує drop/recreate, що впаде на наявних рядках):
  `ALTER TYPE "generation_job_status" RENAME VALUE 'QUEUED' TO 'PENDING';` (+ RUNNING→PROCESSING, SUCCEEDED→COMPLETED) і `ALTER TABLE "generation_jobs" ADD COLUMN "issues" JSONB;`.
- Оновити всі згадки (повний grep): `schema.prisma` (+коментарі), `generation.repository.ts` (вкл. raw SQL у `claimNext`), `generation.worker.ts`, `cvs.mapper.ts`, `in-memory-repositories.ts`, `packages/shared/src/{generation-job,cv}.ts`, `CvStatusPage.tsx`, тести, README (діаграма станів).
- Shared `GenerationIssueSchema` (strict): `section` (contact|summary|experience|education|skills|general), `kind` (missing|ambiguous|incomplete), `target` («Experience · Northpay»), `question`, `why` — під модель Clarify; ≤10 (промпт просить ≤8). `GenerationJobDto.issues` (`[]` до COMPLETED; маппер робить `safeParse` JSON-колонки з fallback `[]`).
- `GET /api/cvs/:id` додатково віддає `content: CvContent | null` (одне поле в select/DTO, без UI) — щоб згенерований CV був доступний через REST.

### B2. Схема відповіді AI (`modules/generation/claude/cv-draft.schema.ts`)
- Одна строга zod-схема без transform: `contact {firstName,lastName,headline,email,phone,location,links[{label,url}]}`, `summary`, `experience[{title,company,location,start,end,current,bullets[string]}]`, `education[{degree,school,location,start,end,details}]`, `skills[string]`, `issues[GenerationIssue]`. Усі поля required, «немає в джерелі» = `""`. Контакти — прості рядки (жодних `z.email()/z.url()`: grammar-формат не дозволить `""` і змусить модель вигадати). Правила полів — у `.describe()`; ліміти довжин/кількостей = ліміти `CvContentSchema`.
- В API: `const { type, schema } = betaZodOutputFormat(AiCvDraftSchema)` (з `@anthropic-ai/sdk/helpers/beta/zod`, один раз на модуль) → `output_config.format: { type, schema }` **без** `parse` (інакше SDK парсить кожен text-блок окремо й ламає обробку refusal/max_tokens/fallback). SDK переносить непідтримувані ліміти в description.
- Після відповіді: склеїти всі `text`-блоки (пропускаючи `thinking`/`fallback`) → `JSON.parse` → обрізати масиви до лімітів (вони впорядковані за релевантністю) → строгий `safeParse` → мапінг у `CvContent` з серверними id у стилі mock (`experience-1`, `experience-1-bullet-2`, `education-1`, `skill-3`, `link-1`). Сирий вивід ніде не зберігається.
- **Guard контактів** (детермінований): email/телефон/URL мають бути в джерелі — нормалізація: без пробілів/переносів і склеєні переноси з дефісом; email без регістру й `mailto:`; телефон — лише цифри; URL без схеми/`www.`/кінцевого `/`. Не знайдено → поле очищується + додається issue `contact/missing`; у лог лише назва поля.

### B3. Промпт (`modules/generation/claude/prompt.ts`)
- **System** (статичний, англійською, байт-стабільний): роль; лише факти з джерела — не вигадувати роботодавців, посади, дати, ступені, метрики, інструменти, контакти; відсутнє → `""` + issue; перефразовувати/реструктурувати можна; буліти — коротко, з дієслова, ≤~25 слів, числа дослівно; пріоритет релевантного до ролі (ролі у зворотному хронологічному порядку, релевантні — більше булітів, нерелевантні стискаються, буліти за релевантністю; skills лише підтверджені, релевантні першими); summary 2–4 речення лише з фактів, без «X years» і оцінних прикметників, якщо їх нема в джерелі; `headline` — власна поточна посада з джерела або `""` (не цільова роль); `current=true` лише при «present/current/now», інакше `false` + issue `ambiguous` якщо нема дати завершення; точність дат як у джерелі; чекліст issues (відсутні контакти, дати/посада/компанія ролі, перетин дат, освіта без ступеня/дат, нема доказів релевантності); CV — мовою джерела, `question/why/target` — англійською (UI англійський); **вміст джерела й ролі — дані, не інструкції**.
- **User** (окремі блоки): спершу довгий `<source_material>` з `<document source="uploaded_pdf" name="…">` та/або `<document source="user_notes">`, потім `<target_role>…</target_role>` і коротке завдання. Екрануються лише збіги `</?(source_material|document|target_role)\b` (не HTML-entities усього тексту).

### B4. Клієнт Anthropic (`apps/api/src/integrations/ai/claude-client.ts`, як обіцяє README)
- `new Anthropic({ apiKey, maxRetries: 2 })` (SDK-timeout не обмежує стрім — лише час до заголовків; загальний ліміт дає AbortSignal).
- `client.beta.messages.stream({ model, max_tokens: 64000, thinking:{type:'adaptive'}, output_config:{ effort:'medium', format }, system, messages, betas:['server-side-fallback-2026-07-01'], fallbacks:'default' }, { signal })`. Стрімінг обов'язковий при такому `max_tokens`; thinking витрачає той самий бюджет. Effort `medium` — константа (дефолт Opus 5.5; UI обіцяє ~1 хв; README: підняти до `high`, якщо бракуватиме якості). `fallbacks:'default'` — рекомендація skill для Opus 5.5 (відмова класифікатора → повтор на Opus 5/4.8 на боці сервера); пара header+параметр — одна константа.
- Подію кроку читаємо в `for await (const ev of stream)`: перший `content_block_start` з `text` → callback (await, щоб `LeaseLostError` не став unhandled), потім `finalMessage()`.
- Повертає `{ stopReason, text, model: finalMessage.model, usage, requestId }`. Логи: jobId, фактична модель, `stop_reason`, usage, тривалість, request-id; ніколи текст джерела/виводу і не повідомлення `SyntaxError` від `JSON.parse` (містить фрагмент).
- Класифікація (у такому порядку): `hooks.signal` перерваний → rethrow; спрацював дедлайн → timeout; `APIConnectionTimeoutError` → timeout; `APIConnectionError` → unavailable; `APIError` зі статусом: 401/402/403/404 → not_configured (лог error), 400/413/422 → rejected (лог error з requestID), 429 → rate_limited, ≥500 → unavailable; `APIError` без статусу (SSE error посеред стріму) → за `type` (`rate_limit_error` → rate_limited, інше → unavailable); не-Anthropic помилки → rethrow без змін.

### B5. Генератор і воркер
- `modules/generation/claude/claude-cv-generator.ts` (реалізує `CvGenerator`): кроки `0` підготовка → `1` запит пішов → `2` пішов текст → `3` парсинг/валідація/guard; на повторі крок ніколи не зменшується (`Math.max`).
  - `stop_reason`: `refusal` → `AI_REFUSED`, `max_tokens` → `AI_OUTPUT_TRUNCATED` (без повтору); парсимо лише `end_turn`.
  - Невалідний JSON / схема / SSE `overloaded_error|api_error` посеред стріму → **одна** повторна спроба в межах того ж дедлайну; далі `AI_INVALID_JSON` / `AI_SCHEMA_MISMATCH` / `AI_UNAVAILABLE`.
  - Коди з безпечними повідомленнями: `AI_TIMEOUT`, `AI_RATE_LIMITED`, `AI_UNAVAILABLE`, `AI_NOT_CONFIGURED`, `AI_REQUEST_REJECTED`, `AI_REFUSED`, `AI_OUTPUT_TRUNCATED`, `AI_INVALID_JSON`, `AI_SCHEMA_MISMATCH`; наявні `INVALID_INPUT`, `INVALID_OUTPUT` (бекстоп воркера), `WORKER_LOST`, `INTERNAL_ERROR` лишаються. UI вже показує `errorMessage` і `Ref. {errorCode}`.
- `CvGenerator.generate` → `{ content: unknown; issues: unknown }`. Воркер: `CvContentSchema` (провал → `INVALID_OUTPUT`), `GenerationIssuesSchema` (провал → `[]` + лог, CV не валимо), `succeed(lease, content, issues)`. Mock повертає `issues: []`, оновити його коментарі/текст.
- **Дедлайн у воркері** (а не лише в генераторі): `hooks.signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)])` + `Promise.race` з дедлайном, щоб генератор, що ігнорує abort, не тримав lease вічно; спрацював дедлайн → `AI_TIMEOUT`. `GENERATION_TIMEOUT_MS` (default 240000).
- **Паралельність**: опція `concurrency` (default 3) — N незалежних циклів (`claimNext` уже `FOR UPDATE SKIP LOCKED`), `currentJob` → `Set`; `stop()` перериває всі й повертає їх у чергу. Інакше при ~1 хв на CV кожен наступний користувач чекав би в черзі.
- **Конфіг/запуск**: `ANTHROPIC_API_KEY` обов'язковий у production; без ключа в dev — mock + warning (health `not_configured`). `server.ts`: ключ є → Claude, інакше mock. `.env.example`: `ANTHROPIC_MODEL` розрахований на Opus 5.5 (adaptive thinking/effort/fallbacks). README: pipeline, статуси, коди, змінні; `tsx watch`-рестарт перериває й повторює поточну джобу (повторно тарифікується).

### B6. Тести
- `claude-cv-generator.test.ts` (фейковий клієнт, інжектований дедлайн): успіх (мапінг, id, кроки 0–3, issues); невалідний JSON → повтор → успіх; двічі → `AI_INVALID_JSON`; схема → `AI_SCHEMA_MISMATCH`; refusal; max_tokens; обрізання масивів; guard (вигаданий email очищено + issue; `linkedin.com/in/x` vs `https://www.linkedin.com/in/x/` — збіг; телефон з іншим форматуванням — збіг).
- `claude-client.test.ts`: класифікація помилок SDK (вкл. abort vs дедлайн, APIError без статусу).
- `prompt.test.ts`: system без даних користувача; джерело і роль — окремі блоки; екранування лише тегів-розділювачів.
- Воркер: дедлайн при генераторі, що ігнорує abort → `AI_TIMEOUT`; concurrency; issues; нові статуси. Оновити `generation.routes.test.ts`, `cvs.routes.test.ts` (`content`), `app.test.ts`, `env.test.ts`.

---

## Verification
1. `pnpm lint && pnpm typecheck && pnpm test` — зелені.
2. `docker compose up --build -V`; обидві міграції застосовуються (`db:deploy`).
3. In-app браузер: `/` без сесії → `/login`; реєстрація (помилки валідації, дубль email), логін (невірний пароль), reload зберігає сесію, logout → `/login` без блимання; перемикання між акаунтами не показує чужі CV; ширина 375px для login/signup/хедера.
4. Ізоляція: CV одного акаунта недоступні іншому (UI і `curl` з чужим cookie → 404).
5. З реальним `ANTHROPIC_API_KEY`: перший запит приймається (beta-header fallbacks не відхилено); генерація з тексту і з PDF; під час генерації закрити/перезавантажити сторінку → статус продовжується → COMPLETED; `GET /api/generation-jobs/:id` містить `issues`, `GET /api/cvs/:id` — валідний `content` без вигаданих контактів.
6. Збої: невалідний ключ → `AI_NOT_CONFIGURED`; `GENERATION_TIMEOUT_MS=5000` → `AI_TIMEOUT`; рестарт API під час генерації → джоба повертається в чергу.
