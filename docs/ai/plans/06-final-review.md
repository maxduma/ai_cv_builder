> Plan for step 6, approved in Claude Code's plan mode on 2026-10-03 and implemented in [PR #6](https://github.com/maxduma/ai_cv_builder/pull/6). The plan is in Ukrainian. Copied verbatim from the session.

---

# План: фінальний рев'ю take-home — надійність, тести, README

## Контекст

Проєкт здається як завершене take-home. Що просить користувач:
- перевірити весь флоу (реєстрація → … → PDF);
- додати бекенд-тести: auth, ізоляція, створення й оновлення CV, переходи станів генерації, валідація AI-виводу;
- переглянути надійність і мобільну версію;
- доповнити README;
- без нових фіч, зайвої інфраструктури й переписування робочого коду.

**Як зроблено рев'ю (лише читання):**
- 8 рецензентів → 66 знахідок.
- 7 перевіряльників-скептиків → ~45 унікальних, з виправленими фіксами.
- 3 критики перевірили сам план.
- Деталі (файл, рядок, мінімальний фікс, тест) — у scratchpad сесії: `review/verdicts.md` за id `F…` і `review/critique.md`. Нижче лише суть і місця, де план від них відходить.

**Висновок:**
- Критичного немає; ізоляція користувачів на бекенді коректна.
- **Одна висока — F35.** `crypto.randomUUID` недоступний на телефонній адресі з README (`http://<LAN-IP>:5173`, не secure context). Через це в редакторі нічого не додається: ні роль, ні навичка, ні посилання. Підтверджено в браузері.
- **Структурна прогалина — F60.** Prisma-репозиторії не запускає жоден тест; усі ~450 тестів працюють на in-memory копії. Знайдено розбіжності й баг у харнесі.

**Рішення користувача:**
- Postgres-тести на окремій тестовій БД;
- E2E у mock-режимі плюс 1 справжня генерація й 1 відповідь з Claude;
- чернетка розділу про AI-інструменти.

**Git.** `feat/cv-pdf-export` уже змержена:
```
git checkout main && git pull && git checkout -b chore/final-review
```
Порядок комітів, кожен зелений (`pnpm test` перед кожним):
1. харнес (C1) + бекенд A/B;
2. Postgres і маршрутні тести (C2/C3);
3. веб (D);
4. мобільна версія (E);
5. README (F).

Потім PR.

## Пріоритети

- **Tier 1:** D1, B1, B2, D2, D3, D4, A1, A5, B5, C1, C2, C3, F.
- **Tier 2 (дешева коректність):** A2, A4, A6, A7, A8, B3, B4, D5, D7, D8, E.
- Якщо час тисне, Tier 2 переходить у README як відомі обмеження.

---

## Крок 0 — базовий прогін (mock, до змін)

- **Mock-режим.** `ANTHROPIC_API_KEY= docker compose up -d api` → `/api/health` має показати `ai.status = not_configured`. Цей префікс обов'язковий у **кожному** mock-запуску, інакше повертається справжній ключ і запити стають платними. Ключ і `docker compose config` не друкувати.
- **Що пройти** (in-app браузер, тестовий акаунт на localhost):
  - текст і PDF (drop-подія з мінімальним текстовим PDF, зібраним у JS сторінки);
  - один прохід усіх маршрутів на 375px з перевіркою `scrollWidth === innerWidth`.
- **Що робити зі знайденим:**
  - без питань виправляю лише те, що ламає крок запитаного флоу;
  - решту показую користувачеві або заношу в README як обмеження.

---

## A — API: вхідні дані, помилки, завантаження (тести поруч)

- **A1 (F6).** NUL у `targetRole` / `sourceText` → 500.
  - Прибирати `\u0000` у preprocess `clearableText` (`packages/shared/src/cv.ts`).
  - **Не** `isStorableText`: lone surrogates у text-колонках нешкідливі.
  - Тест `it.each` POST/PATCH × поле.
- **A2 (F7/F9).** `error-handler.ts`: нова гілка **після** перевірок `hasType`, перед fallback.
  - Умова: `status` 400–499 і (`expose === true` або `instanceof URIError`) → `VALIDATION_ERROR` «The request could not be read».
  - Тести перевіряють коди: latin1 → 415 `VALIDATION_ERROR`; `%E0%A4%A` → 400; 1.1 MB → 413 `PAYLOAD_TOO_LARGE`.
- **A3 (F10, звужено).** Лише `cvs.repository.ts:129`: `safeParse` + `throw new Error(…, { cause })`, як у `cv-pdf.service.ts`. Дзеркало в in-memory. Тест: зіпсований збережений контент → PUT = 500.
- **A4 (F5).** `Cache-Control: no-store` для `/api`. Middleware в `app.ts` **перед** `express.json()`. Тест.
- **A5 (F12).** `SOURCE_PDF_MAX_TEXT_LENGTH = 100_000` (shared) і `422 PDF_TOO_MUCH_TEXT` до `storage.put`.
  - Рядок у `UPLOAD_ERRORS`.
  - Межу показати в README.
  - `GenerationInputSchema` не чіпати.
  - Тест у `it.each` «reports unusable PDFs».
- **A6 (F17).** У екстракторі викликати `destroy()` і в `finally`, і в колбеку таймауту (`.catch(() => {})`); виправити коментар. **Без** циклу `streamTextContent`.
  - Тест: 2 Flate-сторінки `(A) Tj ×3M`, PDF збирати binary-safe (`latin1`). Основна перевірка — максимальна пауза event loop після таймауту < 500 мс (без фіксу > 1.1 с).
  - Якщо тест флакі, fallback: `vi.mock('unpdf')` і spy на `destroy`.
  - `worker_threads` — лише в README.
- **A7 (F22).** `cleanFileName`: `\p{Cc}` + bidi-символи, обрізання за кодовими точками. Новий `source-documents.service.test.ts`, туди ж тести `hasPdfSignature`.
- **A8 (тести без коду).**
  - multer: неправильне поле, два файли, не-multipart, без boundary, без сесії (файл не збережено);
  - прибирання файлу, коли `replaceForCv` кидає або повертає `null`;
  - знімок генерації не змінюється після DELETE чи заміни PDF.

## B — генерація, відповіді, воркер (тести поруч)

- **B1 (F24).** `scoped(changes, itemId)` у `answer-changes.ts`:
  - `itemId === null` → усі зміни;
  - інакше ті, що називають `itemId`, або одна зміна без id, або нічого.
  - Тести: мікс; дві зміни без id; питання про розділ з двома новими ролями (обидві додаються); те саме для education.
- **B2 (F25).** `cutLists`: перед `slice` відкинути skills > `CV_LIMITS.skill` та невалідні issues; логувати лише кількість. Факти й далі відхиляються. Тест: один запит, решта збережено.
- **B3 (F27, F28, F30, F31):**
  - `withoutEchoes`: email без регістру, телефон за цифрами (`digitsOf`);
  - посилання з порожнім URL або лише схемою прибирається → питання про посилання;
  - `current && end === ''`;
  - місце для питань про прибрані контакти (`slice(0, MAX - cleared.length)`, без `break`).
  - По тесту на кожне.
  - **F26 (headline-гард) прибрано як нову фічу**; у README — у списку «лише промпт + перевірка людиною».
- **B4 (F13).** `validIssues` відкидає issues, які не проходять `isStorableText`. Схему не чіпати. Тест у worker.
- **B5 (F33).** У `onStep` помилка heartbeat → `log.warn` і продовжити; лише `false` означає втрачений lease. Тест: один reject на кроці 2 → COMPLETED, attempts 1.
- **B6 (тести станів, після C1):**
  - свіжий heartbeat не повертається в чергу;
  - `INVALID_INPUT` для generate і answer, генератор не викликається;
  - повтор після FAILED: `failed` у списку й деталях → нова джоба `generating` → `ready`, питання лише від нової;
  - згенероване CV піднімається нагору «My CVs».

## C — харнес і тести на Postgres

- **C1 (першим кодом):**
  - `start-app.ts`: `overrides.repositories ?? memory.repositories` і в resolver сесій, і в app. Зараз підміна репозиторіїв дає 401 на всьому. Повертати `db: memory.db`.
  - `startAppWithTwoAccounts(options)`.
  - in-memory:
    - годинник `Math.max(Date.now(), last + 1)` (F34);
    - `succeed` оновлює `updatedAt`;
    - `saveContent` через `safeParse` (A3).
  - `largestCv()` → `src/test/largest-cv.ts`.
- **C2.** Один файл `apps/api/src/db/repositories.postgres.test.ts` під `describe.skipIf(!TEST_DATABASE_URL)`. Конфіг vitest і нові сервіси не потрібні.
  - **Налаштування:**
    - guard: ім'я БД має закінчуватися на `_test`, інакше `throw`;
    - `execFileSync(<apiRoot>/node_modules/.bin/prisma, ['migrate','deploy'])` з `DATABASE_URL`, `CHECKPOINT_DISABLE=1`, `PRISMA_HIDE_UPDATE_MESSAGE=1`; Prisma 7.10 сама створює БД; `beforeAll` з тайм-аутом 60 с;
    - `beforeEach`: `TRUNCATE` п'яти таблиць;
    - `afterAll`: `$disconnect`.
  - **Кейси:**
    1. дві одночасні реєстрації з одним email → `created` + `email_taken`;
    2. чуже CV невидиме для методів, прив'язаних до користувача;
    3. два одночасні `saveContent` → `saved` + `conflict` з контентом переможця;
    4. два одночасні `startJob` → одна джоба;
    5. 3 одночасні `claimNext` на 2 pending → 2 різні id + null; answer-джоби беруться першими; друга відповідь на те саме CV чекає;
    6. fencing старого lease після `recoverStale` і reclaim; `WORKER_LOST` після 3 спроб;
    7. `succeed` атомарний: контент v1 і питання, CV нагорі списку; issue з `\u0000` → rollback усього;
    8. `completeAnswer`:
       - зміна контенту → v+1, ANSWERED;
       - follow-up → OPEN;
       - DISMISSED лишається;
       - старий lease → `lost`;
    9. HTTP-ізоляція. Хелпер `expectIsolated` з C3 запустити з `createRepositories(prisma)`; плюс NUL у `targetRole` ≠ 500.
  - **Скрипт:** `"test:db": "prisma generate && vitest run src/db"`.
  - **Команди:**
    - host: `TEST_DATABASE_URL=postgresql://cvbuilder:cvbuilder@localhost:54320/cvbuilder_test pnpm --filter @cv-builder/api test:db`;
    - docker: `docker compose exec -e TEST_DATABASE_URL=postgresql://cvbuilder:cvbuilder@db:5432/cvbuilder_test api pnpm test:db`.
- **C3 (герметичні):**
  - `src/http/ownership.test.ts`, хелпер `expectIsolated(baseUrl, owner, other)`:
    - кожен ендпоінт з реальною cookie іншого акаунта → 404 (`GET /cvs` → `[]`), `db` без змін, екстрактор і рендерер не викликались;
    - без cookie → 401.
  - `auth.routes.test.ts`:
    - `Secure` при `secureCookies: true`;
    - пароль довший за 1024 → 400;
    - зіпсована cookie → 401;
    - невідомий маршрут без сесії → 401;
    - стара cookie після logout і далі дає 200 (задокументований компроміс stateless).
  - `cvs.routes.test.ts`:
    - 2–3 представницькі рядки понад `CV_LIMITS` → 400 з path;
    - `largestCv` із 3-байтовими символами → 200 (вміщується в 1 MB);
    - `baseVersion` наперед → 409;
    - POST `/cvs` з задовгими role / notes → 400.

## D — веб: флоу й стани

- **D1 (F35).** `apps/web/src/lib/new-id.ts`: `newId()` при **кожному** виклику перевіряє `typeof crypto.randomUUID === 'function'`, інакше v4 з `getRandomValues`. Замінити 6 викликів.
- **D2 (F32/F36).** `CvStatusPage` і `EditCvPage`: помилка фатальна лише без даних (`if (!cv) { if (error) … }`). Без таймера.
- **D3 (F19/F38).** `useCvDraft`:
  - `cancelled` в upload;
  - якщо байти вже відправлено: не abort, чекати `done`, потім DELETE;
  - картка лишається з `removing`, поки DELETE не завершиться; новий drop заблоковано;
  - `choosePdf` при `cancelled` не показує ready чи помилку;
  - якщо DELETE не вдався, повертаємо `ready` (або `null`), щоб ✕ можна було натиснути знову;
  - `generate()` ігнорує `removing` і скасовану чергу.
- **D4 (F21/F37).**
  - `replaceState` на `/cvs/<id>/edit` після створення чернетки (лише якщо `mounted`);
  - прибрати `setQueryData` зі старою відповіддю (там немає PDF);
  - виправити docblock.
- **D5 (F2/F39, F40, F44).**
  - `flushEditorSessions()` і `retryFailedEditorSessions()` в `editor-session.ts`.
  - `useLogout`: `mutationFn` спершу flush; якщо `hasUnsavedEdits()` і користувач не підтвердив → повертає `'cancelled'`; `onSuccess` тоді нічого не робить.
  - `AppLayout`: `visibilitychange`→hidden → flush; `online` → retry.
- **D7 (F42).** `errorMessage` і `refetchIfStale` у `features/cvs/api.ts`; використати в обох catch `QuestionsPanel`.
- **D8 (F15).** `request()`: якщо тіло 2xx-відповіді не читається → `networkError()`.

## E — мобільна версія (лише CSS і атрибути; прибирають бічний скрол, iOS-зум і сховані помилки)

- **F45.** `font-size: 16px` для полів у `@media (max-width: 599px), (hover: none)` у `components.css`, `sections.css`, `editor.css`.
- **F47.** `.s-chip` з ellipsis і `title`; `.ok-chip` — `min-height` замість `height`.
- **F48.** `repeat(n, minmax(0, 32px))`.
- **F49.** Лише CSS: ellipsis для мітки статусу в `.ed-mbar`. Текст «Preview & download» лишається, бо так у дизайні.
- **F50.** `.file-meta` з ellipsis.
- **F52.** `padding-bottom` через `:has(.submit-error)` на ≤599px.
- **F57.** `.um-name { overflow-wrap: anywhere }`.

## F — README

- **Виправити:**
  - DOCX (L142);
  - «will live in file storage» (L210);
  - CSRF (L184);
  - «every query» (L141 / L188);
  - MOCK_* стосується й відповідей (L30, L70–71);
  - `job_description`;
  - 2-хвилинний дедлайн відповіді;
  - повтор при обриві стріму;
  - `422 CV_NOT_READY`;
  - формулювання контакт-гарду (F29);
  - scrypt і threadpool у рядку про rate limiting (F4);
  - межа тексту PDF;
  - `pnpm format` → `format:check`;
  - статус.
- **Розділи** (без дублювання, з посиланнями один на одного):
  - **How to run:** Quick start, mock-режим, телефон.
  - **Testing:**
    - `pnpm test` (число з vitest);
    - Docker-only: `docker compose exec -w /app api pnpm test`;
    - `test:db` з обома командами і що він покриває;
    - веб-тестів немає; рядок про ручну перевірку (320/375, iOS-зум, офлайн-збереження).
  - **Architecture:** без змін, плюс шар тестів.
  - **Decisions and trade-offs:** лишаються; чисті спрощення переносяться в новий розділ.
  - **Preventing invented facts:**
    - шари: промпт із джерелами як даними; суворі схеми; детермінований контакт-гард; прогалини стають питаннями; відповіді обмежені розділом і записом, без видалень, максимум один follow-up; людина редагує останньою;
    - межі: роботодавці, посади, headline, дати й цифри — лише промпт + перевірка людиною; прихований текст PDF іде в Claude як дані.
  - **Simplified for the 10-hour limit** + підсписок **Known limitations**:
    - парсинг і рендер PDF у процесі API (наступний крок — `worker_threads`);
    - landscape отримує планшетну верстку;
    - зміна акаунта в іншій вкладці не відстежується;
    - фокус при навігації не переходить;
    - форма створення зберігає дані лише при Generate;
    - CSRF лише на SameSite;
    - тощо.
  - **How AI coding tools were used** (чернетка):
    - Claude Design → CSS;
    - Claude Code покроково: plan mode → затвердження автором → реалізація → перевірки й браузер;
    - фінальне мультиагентне рев'ю;
    - роль автора; `Co-Authored-By`; Claude усередині продукту — окремо.
  - Закреслений **Roadmap** → короткий **Next steps**.

## Свідомо НЕ робимо

- Головне (F26 і D6 мають причину в дужках):
  - headline-гард (F26: нова фіча);
  - кеш після save (D6: косметика);
  - тест-раннер для вебу;
  - `worker_threads`;
  - rate limiting і семафор scrypt (F4);
  - CSRF-middleware (F3).
- Мобільні дрібниці та фокус: F43, F46, F51, F53, F54, F55, F56, F58.
- Інше:
  - F1 (зміна акаунта в іншій вкладці);
  - F16;
  - F29 (код);
  - B7 і тест `stop()`: дублюють наявні тести.

## Перевірка

1. **Статичні перевірки.** `pnpm lint && pnpm typecheck && pnpm test && pnpm format:check`, плюс `test:db` з host і з Docker. Двічі поспіль, щоб перевірити ідемпотентність. Окремо запустити з `cvbuilder` в URL: guard має кинути помилку, кількість рядків у dev-БД не змінюється.
2. **E2E (mock, 1280px)**, кожен запуск з `ANTHROPIC_API_KEY=` і перевіркою health:
   1. **Реєстрація й вхід:** реєстрація → logout → login; невірний пароль; зайнятий email.
   2. **Створення:**
      - текст; PDF через drop;
      - reload після вибору PDF → `/cvs/:id/edit` з PDF;
      - скасування під час «Reading your CV…» через MutationObserver на crafted PDF ~1 с. За `read_network_requests` DELETE має піти після PUT; після reload PDF немає;
      - не-PDF → 415.
   3. **Довга генерація** (`MOCK_GENERATION_STEP_MS=15000`):
      - reload сторінки статусу; My CVs показує «generating»;
      - `docker compose restart api` → ready, у psql attempts 1;
      - на другому CV `docker compose kill api` + `up` → приблизно через 30 с attempts 2 → ready.
   4. **Збій:** `MOCK_GENERATION_FAIL_RATE=1` → failed на новому CV → перезапуск без змінної → «Try again» → ready.
   5. **Питання:** відповісти, пропустити, follow-up; reload під час «Updating…»; у `QuestionsPanel` редактора відповісти й dismiss.
   6. **Редактор:**
      - помітна правка в summary → reload → збережено;
      - `docker compose stop api` → «Couldn't save» → `start` → `dispatchEvent(new Event('online'))` → «saved» без кліку;
      - logout з незбереженим (stub `window.confirm`: false, потім true).
   7. **Стани помилок (D2):** на `/edit` з введеним текстом і на сторінці статусу `stop api` → зміна фокусу → сторінка й текст лишаються → `start` → відновлення.
   8. **Preview:** in-page `fetch('/api/cvs/<id>/pdf')` → `%PDF-` і `X-Page-Count`; превʼю показує правку з кроку 6. Без кліку Download, бо це завантаження файлу.
   9. **Логи:** `docker compose logs api` — error-рядки лише від навмисних збоїв.
3. **Мобільна версія.**
   - D1: на localhost виконати `delete Crypto.prototype.randomUUID`, потім додати роль, буліт, навичку, освіту, посилання → працює й переживає reload. Справжню перевірку на телефоні лишаю користувачеві: вхід на LAN-IP мені недоступний.
   - На 320 і 375px: `scrollWidth === innerWidth` на auth, My CVs, create, status, clarify, editor, preview і ready-sheet, кожен у своєму стані:
     - роль на 44+ символів як підказка;
     - помилка Generate;
     - збій збереження;
     - картка PDF;
     - ім'я на 35 символів;
     - 10 питань: додаткові рядки `cv_questions` через psql.
   - На 740×360: `font-size` полів = 16px.
4. **Справжній Claude** (`docker compose up -d api` → `configured`). PDF + нотатки: остання посада ≠ target role, є ім'я й email, немає телефону й посилань. Перевірити:
   - контакти не вигадані;
   - питання є;
   - 1 відповідь застосовується;
   - PDF.
5. Повернути API у звичайний стан. Перелічити тестові дані в локальній БД; нічого не видаляти без дозволу.
6. Коміти й PR з атрибуцією за system reminder.
