> Plan for step 2, approved in Claude Code's plan mode on 2026-10-02 and implemented in [PR #2](https://github.com/maxduma/ai_cv_builder/pull/2). The plan is in Ukrainian. Copied verbatim from the session.

---

# План: редизайн головної частини + основний флоу створення CV

## Context

Перша версія UI (Tailwind; `CvListPage` + `CreateCvForm` з полями Title/Target role, health-пігулка в шапці) будувалась без дизайну і не відповідає очікуванням. Тепер є дизайн-канвас (artifact `3MdEScRphtNH8YfdzCVtYL`: My CVs, Create a CV, Generation, Design system). У цьому кроці:

1. Перебудувати **лише наявну частину** UI під дизайн: шапка, My CVs, створення CV, 404 / помилка роуту.
2. Реалізувати основний флоу з промпту: список CV → створення → target role → PDF і/або текст → старт генерації → відкриття наявного CV. REST-ендпоінти, стан у PostgreSQL, мок-генерація замість Claude.

Решта дизайну — наступні кроки: логін/реєстрація, редактор, прев'ю/PDF, AI-питання, меню картки (rename/duplicate/delete), діалог видалення, тости, меню користувача, скасування генерації.

## Погоджені рішення

- Джерела: **PDF і/або текст** (як у дизайні), потрібне хоча б одне.
- Відкриття готового CV → **лише статус-екран** («Your CV is ready» / прогрес / помилка).
- **Текст із PDF витягується при завантаженні** (`unpdf`): кількість сторінок + перевірка, що PDF читабельний і не скан.
- **CSS дизайну, без Tailwind.**
- Мої рішення (можна заперечити при затвердженні):
  - прибрати з UI `ApiStatus`/`AiNotice` (їх немає в дизайні; `/api/health` лишається);
  - меню користувача («Alex Morgan», Log out) не показуємо до кроку з auth — без фейкових даних; у міні-превʼю CV ім'я — сіра смужка-плейсхолдер, роль — справжня;
  - статуси карток: генерації ще не було → **Draft**, QUEUED/RUNNING → **Generating**, FAILED → **Failed**, SUCCEEDED → **Ready** (чіпи Generating/Failed — за зразком чіпів дизайну);
  - назва CV = target role (перейменування — пізніше), без ролі — «Untitled CV»;
  - тексти UI — англійською, як у дизайні; копірайт дизайну, що обіцяє ще не існуючі фічі, не показуємо (див. 4.6).

## 0. Git і порядок роботи

Поточна гілка `feat/project-foundation` уже змерджена (PR #1, `origin/main` = merge-коміт з тим самим кодом), локальний `main` застарів:

```bash
git checkout main && git pull && git checkout -b feat/cv-create-flow
```

Робота йде етапами, після кожного — `typecheck` / `lint` / `test` і перевірка в браузері:

1. **Редизайн наявної частини** (розд. 4.1–4.4): стилі, примітиви, шапка, My CVs з усіма станами, 404 / помилка. Після етапу — скриншоти 1440 / 768 / 390 px поруч з артбордами.
2. **Backend пункту 2** (розд. 1–3): схеми, міграція, ендпоінти, завантаження PDF, генерація з моком, тести.
3. **Флоу пункту 2 в UI** (розд. 4.5–4.7), пункт за пунктом: створення → target role → джерела → старт генерації → відкриття наявного CV.
4. Документація і повна перевірка (розд. 6).

Комміти/PR — коли скажеш.

---

## 1. Shared (`packages/shared/src`)

- `cv.ts`
  - константи: `TARGET_ROLE_MIN = 2`, `TARGET_ROLE_MAX = 120`, `SOURCE_TEXT_MIN = 30`, `SOURCE_TEXT_MAX = 5000`;
  - `CreateCvRequestSchema = z.strictObject({ targetRole?, sourceText? })` — `title`/`jobDescription` прибираються з API (колонка `job_description` лишається в БД);
  - `UpdateCvRequestSchema = z.strictObject({ targetRole?, sourceText? })` — ендпоінт «зберегти текстове джерело» з трьома станами поля: відсутнє → без змін, `''` / `null` → очистити, рядок → записати (наявний хелпер `optionalText` перетворює `''` на «без змін», тож тут він не підходить);
  - `strictObject` → будь-який `userId` у тілі дає 400, власник завжди з `req.user`;
  - `CvStatus = 'draft' | 'generating' | 'failed' | 'ready'` (за останнім job);
  - `CvSummary { id, title, targetRole, status, createdAt, updatedAt }`;
  - `CvDetail extends CvSummary { sourceText, sourceDocument: SourceDocumentDto | null, latestGeneration: GenerationJobDto | null }`.
- `source-document.ts`: `SOURCE_PDF_MAX_BYTES = 10 MiB`, `SOURCE_PDF_MAX_PAGES = 20`, `SourceDocumentDto { id, originalName, sizeBytes, pageCount, createdAt }`.
- `generation-job.ts`: + `GENERATION_STEP_COUNT = 4`, `GenerationJobDto { id, cvId, status, step, errorCode, errorMessage, createdAt, startedAt, finishedAt }`, `GenerationJobIdParamsSchema`.
- `cv-content.ts` (новий): `CvContentSchema` v1 — мінімальна модель документа CV за шаблоном дизайну (`CvPage.dc.html`), з лімітами довжин і кількостей:
  `{ version: 1, contact: { firstName, lastName, headline, email, phone, location, links[{ id, label, url }] }, summary, experience[{ id, title, company, location, start, end, current, bullets[{ id, text }] }], education[{ id, degree, school, location, start, end, details }], skills[{ id, name }] }`.
  Нею валідується мок-результат перед записом у `cvs.content` (правило з README). `extras` / `order` / `hidden` з дизайну — разом із редактором.
- `errors.ts`: + `FILE_TOO_LARGE` (413), `UNSUPPORTED_FILE_TYPE` (415), `PDF_UNREADABLE` (422), `PDF_NO_TEXT` (422), `PDF_TOO_MANY_PAGES` (422), `CV_NOT_READY` (422), `GENERATION_IN_PROGRESS` (409).

## 2. База даних

`schema.prisma`: `Cv.sourceText String? @map("source_text")`, `SourceDocument.pageCount Int? @map("page_count")`, `GenerationJob.progressStep Int @default(0) @map("progress_step")` (0–3 — поточний крок, 4 — готово). Міграція `docker compose exec api pnpm db:migrate --name sources_and_progress` (без БД — `prisma migrate diff`), очікуваний SQL:

```sql
ALTER TABLE "cvs" ADD COLUMN "source_text" TEXT;
ALTER TABLE "generation_jobs" ADD COLUMN "progress_step" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "source_documents" ADD COLUMN "page_count" INTEGER;
```

## 3. API

### 3.1 Ендпоінти (усі за `currentUser`, кожен запит обмежений `req.user.id`; чуже CV → 404)

| Метод і шлях | Що робить |
| --- | --- |
| `GET /api/cvs` | список CV користувача зі `status` |
| `POST /api/cvs` | створити чернетку `{ targetRole?, sourceText? }` → 201 `CvDetail` |
| `GET /api/cvs/:cvId` | деталі: джерела + `latestGeneration` |
| `PATCH /api/cvs/:cvId` | зберегти / очистити `targetRole` і текстове джерело `sourceText` |
| `PUT /api/cvs/:cvId/source-document` | завантажити PDF (multipart, поле `file`), замінює попередній |
| `DELETE /api/cvs/:cvId/source-document` | прибрати PDF (кнопка ✕ у дизайні) |
| `POST /api/cvs/:cvId/generations` | старт генерації → 202 + `Location: /api/generation-jobs/:id`; 409 `GENERATION_IN_PROGRESS` (з `jobId`), якщо вже йде |
| `GET /api/generation-jobs/:jobId` | стан генерації для опитування (як заплановано в README) |

Редагування джерел під час генерації не блокується: job працює зі знімком входу, а UI на цей час форму не показує.

### 3.2 Інтеграції (`apps/api/src/integrations`, як заплановано в README)

- `storage/file-storage.ts` — інтерфейс `put(key, bytes)`, `delete(key)`; `storage/local-file-storage.ts` — диск у `UPLOAD_DIR`. Ключ `${userId}/${cvId}/${uuid}.pdf` — ім'я файлу від клієнта ніколи не потрапляє в шлях.
- `extraction/pdf-text-extractor.ts` — інтерфейс `extract(bytes) → { pageCount, text }`; `extraction/unpdf-pdf-extractor.ts` — реалізація на `unpdf`.

### 3.3 Завантаження PDF (`modules/source-documents`) — порядок перевірок

1. Власник CV перевіряється async-middleware **до** multer — чужий запит не буферизує 10 MB і не доходить до сховища / екстрактора.
2. `multer` 2.x у власній обгортці: memory storage, `defParamCharset: 'utf8'` (інакше «Résumé.pdf» псується), ліміти `fileSize: 10 MiB`, один файл; `fileFilter` відкидає не-PDF MIME → 415. Помилки → `AppError`: `LIMIT_FILE_SIZE` → 413 `FILE_TOO_LARGE`, інші `MulterError` і помилки busboy (битий multipart) → 400 замість 500. Не-multipart запит / немає `req.file` → 400.
3. `%PDF-` у перших 1024 байтах, інакше 415 `UNSUPPORTED_FILE_TYPE`. У БД завжди `mimeType: 'application/pdf'`, а не значення клієнта; `originalName` — без керуючих символів, обрізане до 255.
4. `unpdf` 1.8 (Node ≥ 22, як наш образ): `getDocumentProxy(new Uint8Array(buf), { isEvalSupported: false, verbosity: 0 })` (копія буфера; eval у pdf.js вимкнено для недовірених файлів) → `numPages > 20` → 422 `PDF_TOO_MANY_PAGES` (pdf.js працює в основному потоці — великий файл заблокував би API і heartbeat воркера) → `extractText(pdf, { mergePages: true })` → `pdf.destroy()` у `finally`. Пароль (`PasswordException`) / битий файл → 422 `PDF_UNREADABLE`. З тексту прибираються `\u0000` (Postgres не приймає NUL у TEXT / JSONB). Текст < 30 символів (скан) → 422 `PDF_NO_TEXT`.
5. Запис файлу → транзакція: видалити старі записи `source_documents` цього CV, вставити новий (`pageCount`, `extractedText`) → після коміту видалити старі файли. Якщо БД впала — прибрати щойно записаний файл.

### 3.4 Генерація (`apps/api/src/modules/generation`)

- **Старт**: репозиторний `startJob` в одній транзакції — `SELECT id FROM cvs WHERE id = ${cvId}::uuid AND user_id = ${userId}::uuid FOR UPDATE` (подвійний клік чи друга вкладка не створять два job) → активний job? → читає роль, текст, останній PDF → правило із сервісу будує вхід або кидає 422 `CV_NOT_READY` (з `details`: роль < 2 символів; немає ні PDF з текстом, ні тексту ≥ 30) → вставляє job `QUEUED` зі знімком (`targetRole`, `sourceText`, текст PDF), валідованим Zod-схемою `generation.input.ts`. Повертає `{ kind: 'not_found' | 'busy' | 'created' }`.
- **Воркер** (`generation.worker.ts`), стартує в `server.ts` після HTTP, зупиняється в graceful shutdown; паралельність 1:
  1. `recoverStale` — RUNNING із heartbeat старшим за 30 с → назад у QUEUED, або FAILED (`WORKER_LOST`) після 3 спроб;
  2. `claimNext` — у транзакції `SELECT id FROM generation_jobs WHERE status = 'QUEUED' ORDER BY created_at, id LIMIT 1 FOR UPDATE SKIP LOCKED`, потім типізований update → RUNNING, `attempts + 1`, `started_at`, `heartbeat_at`, `progress_step = 0`;
  3. генератор проходить 4 кроки: `progress_step` + heartbeat на кожному кроці й таймер heartbeat кожні 5 с;
  4. **fencing**: кожен запис воркера — `updateMany where { id, status: RUNNING, attempts: <claimed> }` з перевіркою `count`; 0 → оренду втрачено (job перехопили після stale), обробка зупиняється;
  5. успіх — у транзакції: job SUCCEEDED + `result` + `finished_at`, `cvs.content = result`, `content_version + 1`; невалідний результат або помилка → FAILED з `error_code` і безпечним `error_message`;
  6. при зупинці процесу (tsx watch перезапускає API на кожне збереження) поточний job переривається і повертається в QUEUED (`attempts − 1`), а не висить 30 с і не з'їдає спроби.
- **Мок** (`cv-generator.ts` інтерфейс + `mock-cv-generator.ts`): 4 кроки по `MOCK_GENERATION_STEP_MS` (типово 2500 мс), результат — явно позначений зразок (headline = роль, summary «Sample content — AI generation is not connected yet»), валідований `CvContentSchema`. `MOCK_GENERATION_FAIL_RATE` (0–1, типово 0) — щоб перевірити екран помилки й «Try again». Справжній Claude-генератор пізніше замінить лише цей клас.

### 3.5 Конфіг, wiring, Docker, документація

- `config/env.ts`: `UPLOAD_DIR` (типово `./storage/uploads`), `MOCK_GENERATION_STEP_MS`, `MOCK_GENERATION_FAIL_RATE`; `env.test.ts` (тест дефолтів порівнює весь конфіг — оновити).
- `app.ts` / `http/router.ts`: `AppDeps` отримує готові `repositories` (будуються в `server.ts` через `createRepositories(prisma)`; `prisma` з `AppDeps` прибирається — його використовували лише репозиторії), `fileStorage`, `pdfTextExtractor`; сервіси не імпортують Prisma, транзакції живуть у методах репозиторіїв. Так тести запускають застосунок з in-memory репозиторіями без БД.
- `docker-compose.yml`: том `uploads` → `/data/uploads`, `UPLOAD_DIR=/data/uploads`. Блок `volumes:` у сервісі `api` **замінює** список з якоря `x-node-app` (злиття не глибоке), тож повторюю всі п'ять наявних записів + `uploads`. `.gitignore` + `apps/api/storage/`.
- `.env.example`, `README.md`: статус проєкту, стек (Tailwind → CSS із токенами дизайну), нові змінні, таблиця ендпоінтів, структура (`integrations/`, `modules/{source-documents,generation}`, `ui/`, `styles/`), розділ про генерацію («реалізовано з мок-генератором»), roadmap (пункт 2 зроблено, 3 — частково: воркер є, Claude ще ні).
- Нові залежності API: `multer` 2.4 (+ `@types/multer`), `unpdf` 1.8. Після них — `docker compose up --build -V`.

---

## 4. Web (`apps/web`)

### 4.1 Стилі: перенесення CSS дизайну

- Прибрати `tailwindcss`, `@tailwindcss/vite` (`package.json`, `vite.config.ts`), класи з `<body>`.
- `index.html`: шрифти Geist + Geist Mono (Google Fonts, як у дизайні), `theme-color #F7F7F9`, `<title>CV Builder</title>`; `favicon.svg` — бренд-марка з дизайну.
- `styles/tokens.css` (`:root` токени дизайну дослівно + `--accent: #4655EB`), `styles/base.css` (reset, фон body: canvas + радіальне світіння accent, Geist, `.sr-only`, спільні keyframes, `.cvb-rise/.cvb-fade`, `prefers-reduced-motion`), `styles/components.css` (кнопки, поля, чіпи). Імпортуються в `main.tsx` перед роутером, щоб CSS фіч ішов далі в каскаді.
- CSS фіч — поруч із компонентами: `app/layout.css`, `ui/state-panel.css`, `ui/cv-mini-page.css`, `features/cvs/{dashboard,create,status}.css`, з responsive-правилами дизайну (1023 / 719 / 599 px).
- Main і Create по-різному визначають `.page-main`, `.page-sub`, `.nav-link` → модифікатори `.page-main.is-dashboard / .is-form / .is-gen` і варіант `.nav-link` з Create (`aria-current` через `NavLink end`).
- **Не переносимо** (відкладені фічі / неправдивий копірайт): `.menu*`, `.user-*`, `.avatar`, `.kbd`, `.more-*`, `.rename-input`, `.cv-flash/.cv-pop/.cv-leave`, `.dlg*`, `.toast*`, `.btn-danger`, `.pv-split/.pv-side/.pv-avatar/.pv-main`, `.gen-tip`, view transitions і їхні keyframes. **Додаємо** `.chip-generating` (accent-кільце, що крутиться) і `.chip-failed` (danger-крапка).

### 4.2 UI-примітиви (`src/ui/`)

Кнопки — просто класи дизайну (`btn btn-primary` …), без обгортки. Компоненти: `StatusChip`, `icons.tsx` (inline SVG з дизайну), `StatePanel` (порожній стан / помилка), `FloatingDocArt` (анімована ілюстрація з empty-state і екрана генерації), `CvMiniPage` (міні-сторінка A4: шаблони classic / draft), `useNow(ms)` (поточний час через інтервал — compiler-правила лінтера забороняють `Date.now()` під час рендера).

### 4.3 Шапка і роути

- `AppLayout`: шапка дизайну — бренд «CV Builder» + nav «My CVs», без health-пігулки й меню користувача.
- `router.tsx`: `/` → My CVs; `/cvs/new` → створення; `/cvs/:cvId` → статус-екран; `/cvs/:cvId/edit` → та сама форма з даними чернетки; `*` → 404.
- `NotFoundPage`, `RouteError` — на `StatePanel` у стилі error-state дизайну.
- Видалити `features/health/*` і старі `CvListPage` / `CreateCvForm`.

### 4.4 My CVs (`features/cvs/dashboard`)

Заголовок + лічильник + підзаголовок + «Create new CV» (на телефоні — на всю ширину, 48 px; схована в empty / error, як у дизайні). Стани: скелетони (3 картки) → empty («Create your first CV») → помилка («We couldn't load your CVs» + Try again; `Error <status>`, якщо відомий, без «Contact support» — адреси немає) → сітка 2 / 1 колонка. Картка: міні-превʼю (classic для Ready, draft для решти) + чіп статусу + назва + «Updated 2 hours ago» / «Updated yesterday» / «Updated Sep 28» + «Open» (вся картка клікабельна, як у дизайні). Поки хоч одне CV генерується — список опитується кожні 3 с. Поява карток — підйом зі stagger 80 мс (motion spec); після «Try again» фокус повертається на заголовок.

### 4.5 Створення / редагування (`features/cvs/create`)

Як у `Create.dc.html`: back-link, 3 картки кроків, пігулка «and / or», sticky-панель «Your draft» (живий міні-превʼю, чекліст, «Generate CV», примітка), нижня панель дій < 1024 px.

- **Target role**: поле з іконкою й кнопкою очищення; чіпи «From your CVs» — до 3 унікальних ролей зі списку CV (група ховається, якщо ролей немає).
- **PDF**: dropzone + drag & drop на всю сторінку (слухачі `dragover`/`drop` на `window`, інакше PDF, кинутий на шапку, відкриється браузером і форма пропаде); перевірка на клієнті (PDF, ≤ 10 MB) → завантаження **одразу** через XHR з прогресом (fetch не вміє прогрес відвантаження) → «Reading your CV…» → картка «2 pages · 184 KB» з Replace / ✕.
  - Невдала заміна → повертається картка попереднього файлу з помилкою під нею (на сервері він лишився).
  - ✕ під час завантаження → abort XHR + `DELETE source-document` (сервер міг уже зберегти файл).
  - Помилки під dropzone: не PDF / 415 — «That file isn't a PDF. Export your CV as a PDF and try again.», > 10 MB / 413 — «That file is over 10 MB. Try a smaller PDF.» (обидва з дизайну); нові у тоні дизайну: `PDF_NO_TEXT` — «This PDF has no selectable text — it looks like a scan. Upload a text-based PDF or describe your experience below.», `PDF_UNREADABLE` — «We couldn't read that PDF. It may be damaged or password-protected.», `PDF_TOO_MANY_PAGES` — «That PDF is over 20 pages. Upload just your CV.», мережа — «Upload failed. Check your connection and try again.».
- **Текст**: textarea до 5 000, чіпи-заготовки Role / Achievement / Skills, лічильник (жовтий після 4 500).
- **Чернетка на сервері** створюється ліниво — при першому виборі PDF або натисканні Generate (один раз, навіть при паралельних діях). Покинуті чернетки лишаються в My CVs як Draft / «Untitled CV».
- **Generate CV** ніколи не disabled: без ролі / джерела показує помилки з дизайну й фокусує поле; якщо PDF ще вантажиться — «Starting after upload…» (`aria-busy`) і старт після завершення; інакше `PATCH` (роль + текст, порожній текст очищається) → `POST generations` → відповідь 202 кладеться в кеш деталей CV і job → перехід на `/cvs/:id` з `replace` (без цього статус-екран на застарілому кеші відправив би назад на форму).
- Режим `/cvs/:cvId/edit`: форма заповнюється з `GET /api/cvs/:cvId`; якщо генерація йде або CV готове — редірект на `/cvs/:cvId`.
- Під compiler-правила `eslint-plugin-react-hooks` 7 (у проєкті це помилки): без `setState` в effect-ах і без читання `ref.current` під час рендера. Початкові значення — через `key` + пропси; «старт після завантаження» — всередині `generate()`, що чекає на проміс поточного upload.

### 4.6 Статус-екран CV (`features/cvs/status`, `/cvs/:cvId`)

За `latestGeneration`:
- немає → редірект на `/edit`;
- QUEUED / RUNNING → «Creating your CV for {role}»: анімована ілюстрація, прогрес-бар, «0:38 elapsed · usually about 1 min», 4 кроки (назва першого залежить від джерел), «Go to My CVs». Відсоток = оцінка за часом від `startedAt`, затиснута між позначками кроку `[0, 22, 42, 86, 100]`. Job опитується кожні 1,5 с; можна піти і повернутися — стан на сервері;
- FAILED → «We couldn't finish your CV», замерзлий прогрес із кроком, що впав, «Try again» (новий job) + «Edit details», `Ref. {errorCode}`;
- SUCCEEDED → «Your CV is ready» + картка CV з чіпом **Ready** + «Go to My CVs».

Не беремо з макета те, чого білд не робить: вигадані цифри кроків («Found 4 roles and 18 skills» — деталь лише в активного кроку), підзаголовок повтору «Picking up where it stopped…» (новий job стартує з нуля), підказку про редактор (`.gen-tip`), кнопки «Answer 4 quick questions» / «Open the editor» (разом із тими фічами).

Доступність — як прописано в дизайні: видимі фокус-кільця, `aria-invalid` + `aria-describedby`, `aria-busy`, оголошення кроків / завантаження в `aria-live="polite"`, фокус на заголовок екрана генерації / «Try again» / перше невалідне поле, `prefers-reduced-motion`.

### 4.7 Дані

`lib/api-client.ts`: + `patch`, `delete`, `upload` (XHR, `onProgress`, abort, ті самі `ApiError`). `features/cvs/api.ts`: query keys + `useCvs`, `useCv`, `useCreateCv`, `useUpdateCv`, `useRemoveSourceDocument`, `useStartGeneration`, `useGenerationJob`, `uploadSourceDocument`.

---

## 5. Тести (API, Vitest, у стилі `app.test.ts`)

Застосунок на випадковому порту з in-memory репозиторіями, фейковими сховищем і екстрактором та справжнім multer. Ламаються й переписуються: `app.test.ts` «validates request bodies» (чекав `title`) і `env.test.ts` «applies defaults».

- **Власність**: `userId` у тілі → 400; чуже CV → 404 на GET, PATCH, PUT, DELETE, POST generations і читанні job; для PUT — сховище й екстрактор не викликались.
- **PATCH**: `''` і `null` очищають поле, відсутнє поле не змінюється; ліміти довжин.
- **Завантаження**: не PDF → 415; неправильні магічні байти → 415; > 10 MB → 413; без файлу → 400; помилки екстрактора → 422 з відповідним кодом; валідний → 200 з `pageCount`; заміна прибирає старий файл.
- **Старт генерації**: 422 з `details`, 409 з `jobId`, 202 з `Location`.
- **Воркер** з in-memory репозиторієм: успіх; помилка генератора; невалідний результат; втрачена оренда; `recoverStale`; переривання й повернення в QUEUED при зупинці.
- **Мок**: результат проходить `CvContentSchema`; `failRate = 1` → помилка.
- **Екстрактор**: один тест зі сторінковим PDF, зібраним рядком у тесті.
- Відомий пробіл: SQL-обмеження за користувачем у справжніх запитах тестами не покрите (in-memory репозиторії) — перевіряється рев'ю і e2e. Web — без тестового фреймворку (його зараз немає); перевірка вручну в браузері.

## Ключові файли

- Змінюються: `apps/api/prisma/schema.prisma`, `apps/api/src/{app,server}.ts`, `apps/api/src/http/router.ts`, `apps/api/src/config/env.ts` (+ test), `apps/api/src/modules/cvs/*`, `apps/api/src/app.test.ts`, `packages/shared/src/{cv,generation-job,errors,index}.ts`, `apps/web/{index.html,package.json,vite.config.ts}`, `apps/web/public/favicon.svg`, `apps/web/src/{index.css,main.tsx}`, `apps/web/src/app/*`, `apps/web/src/pages/NotFoundPage.tsx`, `apps/web/src/lib/api-client.ts`, `apps/web/src/features/cvs/api.ts`, `docker-compose.yml`, `.env.example`, `.gitignore`, `README.md`.
- Нові: міграція `apps/api/prisma/migrations/<ts>_sources_and_progress/`, `apps/api/src/integrations/{storage,extraction}/*`, `apps/api/src/modules/{source-documents,generation}/*`, `packages/shared/src/{cv-content,source-document}.ts`, `apps/web/src/styles/*`, `apps/web/src/ui/*`, `apps/web/src/features/cvs/{dashboard,create,status}/*`.
- Видаляються: `apps/web/src/features/health/*`, `apps/web/src/features/cvs/{CvListPage,CreateCvForm}.tsx`.
- Джерело дизайну: файли артефакту `project/Main.dc.html`, `project/Create.dc.html`, `project/CreateStates.dc.html`, `project/DesignSystem.dc.html`, `project/StateLibrary.dc.html` (читаються через Artifact `read`).

## 6. Перевірка end-to-end

1. `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format:check`.
2. `docker compose up --build -V` → міграція застосовується при старті API.
3. Тестові файли: текстовий PDF (`cupsfilter notes.txt > cv.pdf`), PDF > 20 сторінок (`cupsfilter` довгого тексту), «скан» (`sips -s format pdf photo.png --out scan.pdf`), файл > 10 MB, не-PDF, за можливості — PDF з паролем.
4. У вбудованому браузері на `http://localhost:5173` (ширини артбордів: 1440, 768, 390): порожній стан → «Create CV» → Generate без нічого (обидві помилки, фокус на ролі) → роль → PDF (прогрес → «2 pages · …») і/або текст → Generate → прогрес → «Go to My CVs» (картка Generating → Ready) → «Open» → «Your CV is ready». Стан у БД — через `psql`, файли — у томі `/data/uploads`.
5. Помилки файлів із п. 3; «Starting after upload…» — з тротлінгом мережі; `MOCK_GENERATION_FAIL_RATE=1` → «We couldn't finish your CV» → повернути 0 → «Try again» / «Edit details».
6. Надійність: перезавантаження сторінки під час генерації; `docker compose restart api` посеред job — продовжується одразу; `docker compose kill -s KILL api` — підхоплюється приблизно через 30 с.
7. Порівняння з артбордами (My CVs, Empty, Loading, Error, Create, Create mobile, Generating, Generation failed) на тих самих ширинах; телефон у локальній мережі; `prefers-reduced-motion`.
