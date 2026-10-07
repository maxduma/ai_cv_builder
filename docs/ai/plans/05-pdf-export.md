> Plan for step 5, approved in Claude Code's plan mode on 2026-10-03 and implemented in [PR #5](https://github.com/maxduma/ai_cv_builder/pull/5). The plan is in Ukrainian. Copied verbatim from the session.

---

# План: експорт CV у PDF (крок 5 roadmap)

## Контекст

Редактор зберігає CV автоматично і показує live-превʼю A4 (`apps/web/src/ui/CvPage.tsx`). Завантажити CV файлом поки не можна: у README це пункт roadmap «5. PDF export».

**Що потрібно за завданням:**
- формат A4, текст можна виділити;
- читабельний професійний макет з усіма основними розділами;
- PDF містить **збережений** стан CV;
- завантаження з фронтенду;
- PDF генерує бекенд, а не скриншот браузера;
- просто й надійно, один шаблон;
- довгі CV коректно діляться на сторінки.

**Дизайн:** `Preview.dc.html` з варіантами Ready, Error і Mobile. Точки входу описані в `Editor.dc.html`.

**Рішення користувача:** сторінка Preview як у дизайні, лише A4. Посилання в PDF завжди клікабельні, перемикача немає.

**Поза обсягом:**
- перемикачі A4 / US Letter і «Clickable links»;
- номери сторінок: print-CSS дизайну їх ховає;
- інші шаблони;
- з редактора: swatches, Regenerate, AI rewrite.

**Git.** Локальний `main` відстає від `origin/main`, тож гілку беремо з оновленого:
```
git checkout main && git pull && git checkout -b feat/cv-pdf-export
```
Три коміти: (1) shared + API, (2) web, (3) README. Потім PR.

---

## Ключові рішення

**1. Рендерер — `@react-pdf/renderer`, закріплений точно на `4.9.0`.**
- Працює на API. Це чистий JS без браузера: `renderToBuffer`, flex-верстка, автоматичні сторінки, `wrap` і `minPresenceAhead`, `Link`, вбудовані шрифти.
- Текст у PDF справжній, тому його можна виділити і ATS може його прочитати.
- Чому не headless Chromium: це ~300 МБ браузера в dev-образі плюс керування процесом.
- Чому не pdfmake / PDFKit: чіпи й flex-рядки з дизайну там робити важче.
- Чому точний pin: у 4.9 працює класичний рушій сторінок (`experimentalPagination` не вмикаємо), і верстка має змінюватися лише тоді, коли ми самі оновлюємо версію.

**2. Шрифти Geist Regular / Medium / SemiBold / Bold (TTF) лежать у репо.**
- Шлях: `apps/api/src/integrations/pdf/fonts/`, поруч `OFL.txt`.
- Джерело: офіційний npm-тарбол `geist@1.7.2` (`package/dist/fonts/geist-sans/*.ttf`). Кожен файл ~126–129 КБ, разом ~0.5 МБ.
- Покривають латиницю, розширену латиницю і кирилицю (з Ґ).
- Пакет `geist` залежністю не підходить: `exports` ховає шрифти, а сам пакет має peer-залежність від `next`.
- Вага в стилях завжди явна. 650 з дизайну пишемо як **600**, бо react-pdf підбирає вагу як CSS і 650 перетворив би на 700.
- Курсив не реєструється, тож його в шаблоні немає.

**3. Шаблон PDF — порт `cv-page.css`.**
- Утиліта `px = (n) => n * 0.75`: 794 px дизайну = 595.28 pt ширини A4, тож значення читаються як у CSS.
- Відступи 56/64/52 px діють на **кожній** сторінці (padding `Page`).
- `fontSize` і `lineHeight` завжди задаються в одному стилі. Безрозмірний `lineHeight` react-pdf рахує від `fontSize` того самого стилю.
- `Link` за замовчуванням синій і підкреслений; перевизначаємо на колір тексту без підкреслення.
- Крапка буліта: `color-mix(in oklab, #4655EB 70%, #fff)` = `#758DF6` (пораховано скриптом).

**4. Один вміст для превʼю і PDF.** Нова чиста функція в shared, `toCvView(content)`, робить усе одне:
- підставляє fallback-и «Your name», «Job title», «Degree». Вони потрапляють і в PDF; це свідомо, бо PDF має збігатися з превʼю, яке користувач бачить до завантаження;
- формує дати «start – end» / «Present» і контактний рядок у порядку дизайну з `href`;
- пропускає порожні значення;
- обробляє пробіли як HTML:
  - однорядкові поля (буліти, назви, контакти, навички) — пробіли й переноси згортаються в один пробіл;
  - summary і details поводяться як `pre-line`: переноси рядків лишаються;
  - керівні символи прибираються.

Її використовують і `CvPage.tsx` (рефакторинг без зміни виводу), і PDF-шаблон.

**5. Сторінки (довгі CV).** Поведінку класичного рушія перевірено в коді `@react-pdf/layout` 5.2:
- `minPresenceAhead` і перенесення блоку працюють лише серед **сусідів в одному батьку**;
- блок `wrap={false}`, вищий за сторінку, просто вилазить за поле.

Звідси такі правила:
- **Пласке дерево:** кожен блок — прямий нащадок `<Page>` (фрагменти дозволені), без обгорток для розділу чи ролі.
- **Шапка** (імʼя, headline, контакти, лінія) не розривається.
- **Experience:**
  - нерозривна «голова» ролі = заголовок розділу (лише в першої ролі) + роль і дати + компанія + перший буліт;
  - кожен наступний буліт — окремий нерозривний блок;
  - отже заголовок ніколи не висить сам, а рядок не розрізається.
- **Education:**
  - нерозривна «голова» = заголовок (у першого запису) + ступінь і дати + заклад;
  - `minPresenceAhead` тримає з нею щонайменше 2 рядки details;
  - сам details — розривний текст, бо `pre-line` може зробити його довшим за сторінку.
- **Summary:** заголовок з `minPresenceAhead` ≈ 2 рядки + відступ, далі розривний текст. Orphans/widows за замовчуванням уже 2.
- **Skills:** заголовок з `minPresenceAhead` ≈ рядок чіпів, далі контейнер чіпів. Кожен чіп нерозривний, тож контейнер ділиться між рядками.
- **Висота нерозривних блоків обмежена** завдяки `CV_LIMITS` і згортанню пробілів. Найбільший ≈ 150 pt при області сторінки 761 pt.
- **Перенос слів вимкнено**, як у браузері.
  - Лише «слова» від ~60 символів (URL) ріжуться на шматки до 30 символів, переважно після `/ . - _ ? & =`, щоб не вилазити за поле.
  - На такому розриві react-pdf ставить дефіс. Це задокументувати.
- Відступ блоку, перенесеного на нову сторінку, лишається (до ~14 pt зверху). Це прийнятно.

**6. Рендер у процесі API, рішення після замірів.**
- Рендер синхронно займає CPU. Generation-worker живе в тому ж процесі, а джоби без heartbeat 30 с вважаються застиглими.
- Крок 0 (spike) заміряє:
  - типовий рендер;
  - максимальне CV за `CV_LIMITS` (~50 сторінок);
  - памʼять за 50 рендерів.
- Максимум ≤ 3 с → лишаємо в процесі й записуємо цифри в README.
- Більше → один `worker_threads`-воркер з тим самим рендерером, черга по одному і тайм-аут.

**7. «Збережений стан».**
- Сервер рендерить `cvs.content` з БД.
- Фронт перед запитом PDF дочікується автозбереження (`flush`).
- Превʼю після `flush` перечитує CV з сервера. Кеш запитів після автозбережень не оновлюється, тому це обовʼязково.
- Якщо частина правок не збереглася (помилка збереження або поле з помилкою, наприклад email), завантаження **не блокується**. Сторінка показує попередження: превʼю і PDF містять останню збережену версію.

**8. Без персональних даних у логах.**
- pino-http логує заголовки відповіді, тому сервер віддає `Content-Disposition: attachment; filename="CV.pdf"`.
- Справжню назву (`Alex_Morgan_CV.pdf`) файлу дає клієнт через `a.download`.

---

## Крок 0 — spike (go / no-go)

1. Додати в `apps/api` залежності:
   - `@react-pdf/renderer@4.9.0` (точно);
   - `react@^19.3.0`, бо скомпільований JSX імпортує `react/jsx-runtime`;
   - dev: `@types/react`.
2. Налаштування:
   - `tsconfig.json`: `"jsx": "react-jsx"`;
   - `eslint.config.js`: API-глоб → `apps/api/**/*.{ts,tsx}`.
3. Додати шрифти.
4. Відрендерити зразок під `tsx` і під vitest, прогнати `tsc`.
   - Обидва (esbuild / Vite 8) беруть `jsx` з tsconfig.
   - Перевірити сумісність React 19.3 з `@react-pdf/reconciler`. Запасний варіант: `react@~19.2` лише в `apps/api`.
5. Заміри з рішення 6.

---

## Частина A — shared (`packages/shared`)

**`src/cv-view.ts`** (+ експорт в `index.ts`):
- `toCvView(content): CvView` — модель із рішення 4. Id елементів зберігаються.
- `cvDates(start, end, current)`.
- `linkHref(url)` — лише регулярні вирази, бо в shared немає типу `URL` (`lib: ES2023`, `types: []`):
  - `http(s)://…` як є;
  - голий домен на кшталт `linkedin.com/in/x` → `https://…`;
  - інакше `null` (`javascript:`, `ftp:`, «Portfolio», текст із пробілами).
- Email отримує `mailto:` лише якщо проходить `isValidEmail`. Телефон, локація і work setup лишаються без посилань.
- `defaultPdfFileName(content)` → `Alex_Morgan_CV`; без імені → `CV`.
- `cleanPdfFileName(value)` (правило дизайну): прибрати `\/:*?"<>|` і керівні символи та введене `.pdf`, обрізати пробіли, максимум 80.

**`src/errors.ts`:** код `PDF_RENDER_FAILED`.

**`src/cv-view.test.ts`:**
- fallback-и, пропуск порожніх, правила пробілів і `pre-line`, дати;
- `linkHref`, включно з відхиленими значеннями;
- імена файлів: кирилиця лишається, `.pdf` прибирається, межа 80.

---

## Частина B — API (`apps/api`)

**B1. `src/integrations/pdf/`** (README уже резервує місце: «`integrations/pdf` (CV rendering) is planned»):
- `cv-pdf-renderer.ts`: `interface RenderedPdf { data: Uint8Array; pageCount: number }` і `interface CvPdfRenderer { render(content: CvContent): Promise<RenderedPdf> }`.
- `cv-pdf-document.tsx`: `<CvPdfDocument view={CvView} />` — A4, пласке дерево (рішення 3 і 5). Метадані: `title` «{name} — CV», `author`, `subject` (headline), `creator` / `producer` «CV Builder».
- `react-pdf-cv-renderer.tsx`: `createReactPdfCvRenderer()`.
  - Шрифти й callback переносу реєструються **один раз** (прапорець модуля). Шлях через `fileURLToPath(new URL('./fonts/…', import.meta.url))`: рядок `file://` react-pdf прийняв би за URL для `fetch`.
  - Рендер через `renderToBuffer`.
  - `countPdfPages(bytes)` через `unpdf` `getDocumentProxy(new Uint8Array(buf)).numPages`, потім `destroy()`. Копія потрібна, бо pdf.js не приймає Node `Buffer` і може забрати байти собі.
- `fonts/`: 4 TTF + `OFL.txt`.

**B2. Ендпоінт (окремий модуль `src/modules/cv-pdf/`, модуль `cvs` не змінюється):**
- `lib/errors.ts`: `AppError(status, code, message, details?, options?: ErrorOptions)` → `super(message, options)`. Серіалізатор pino (`pino-std-serializers` 7.1) уже дописує в лог «caused by» зі стеком.
- `cv-pdf.service.ts`: `createCvPdfService({ cvs, renderer }).render(userId, cvId)`:
  - CV береться через наявний `cvs.findForUser`. Невідомий або чужий → 404.
  - `contentVersion === 0` → `409 CV_NOT_GENERATED` «This CV has no content to export yet».
  - `CvContentSchema.safeParse` не пройшов → звичайна помилка 500. `.parse` дав би ZodError, тобто 400.
  - Падіння рендерера → `AppError(500, 'PDF_RENDER_FAILED', …, undefined, { cause })`.
- `cv-pdf.routes.ts`: `GET /:cvId/pdf`, змонтований у `http/router.ts` на `/cvs`.
  - Спершу рендер, лише потім заголовки, тож помилки лишаються JSON.
  - Заголовки: `res.attachment('CV.pdf')`, `Cache-Control: private, no-store`, `X-Page-Count`.
  - Тіло: `send(Buffer.from(data.buffer, data.byteOffset, data.byteLength))`.
- Підключення:
  - `AppDeps.cvPdfRenderer` в `app.ts`;
  - `server.ts` → справжній рендерер;
  - `test/start-app.ts` → `createFakePdfRenderer(result | Error)` за замовчуванням: записує виклики і не тягне react-pdf у кожен тест.

**B3. Тести:**
- `integrations/pdf/react-pdf-cv-renderer.test.ts` (справжній рендерер; `unpdf`: `extractText`, `extractTextItems` з x/y/width, `extractLinks`, `getMeta`):
  - сторінка A4 595.28×841.89; `pageCount` = `numPages`;
  - шрифти вбудовані: `/FontFile2`, Geist;
  - весь текст розділів є і в правильному порядку, заголовки великими літерами, порожніх розділів немає;
  - посилання: `mailto` лише для валідного email, `https://` для голого домену;
  - метадані на місці; кирилиця «Ґ ї є» повертається без втрат.
- **Максимальне CV** (`CV_LIMITS`, details і summary з купою переносів рядків, URL на 300 символів):
  - понад 1 сторінку, кожен буліт рівно один раз;
  - жодна сторінка не закінчується заголовком;
  - жоден текст не виходить за праве або нижнє поле;
  - час рендера в межах бюджету зі spike (тест із піднятим тайм-аутом).
- `modules/cv-pdf/cv-pdf.routes.test.ts`:
  - 200: `application/pdf`, `attachment; filename="CV.pdf"`, `no-store`, `X-Page-Count`, тіло з `%PDF-` (справжній рендерер);
  - рендерер отримує контент, збережений перед тим через `PUT …/content` (фейк);
  - 409 для чернетки; 404 для чужого CV; 400 для поганого id; 401 зі справжніми сесіями;
  - `500 PDF_RENDER_FAILED`, коли фейк кидає помилку; лог містить «caused by».

---

## Частина C — Web (`apps/web/src`)

**C1. Дані:**
- `lib/api-client.ts`: `api.download(path, { signal })` → `{ blob, headers }`. Перевикористовує приватні `toApiError`, `reportIfSessionEnded` і `networkError`; обрив тіла теж network error.
- `features/cvs/api.ts`: `cvsApi.downloadPdf(cvId, signal)` → `{ blob, pageCount }`.
- `lib/save-file.ts`: `saveFile(blob, name)` — object URL і `<a download>`, URL звільняється через ~60 с.
- `features/editor/editor-session.ts`: `findEditorSession(cvId)` — лише пошук, без створення.
- `ui/CvPage.tsx` рендерить з `toCvView`; вивід ідентичний.

**C2. Guard.**
- Охоронну логіку з `CvEditorPage` винести в `features/cvs/ReadyCvGate.tsx` (render-prop):
  - `useCv` + `useQuestionUpdates`;
  - стани: loading; 404 → `NotFoundPage`; помилка → панель з Retry;
  - редиректи: draft → `/edit`, не ready → `/cvs/:id`;
  - нечитабельний вміст → панель.
- Її використовують редактор і превʼю. Поведінка редактора не змінюється.

**C3. Маршрут `cvs/:cvId/preview` → `features/preview/CvPreviewPage.tsx`, `preview.css` з префіксом `fp-`.** Класи `pv-*` уже зайняті в `cv-preview.css` і `cv-mini-page.css`.
- **Синхронізація.** Під час mount: `findEditorSession(cvId)?.flush()`, потім `refetch()`. Якщо сесія `failed` або має поля з помилками → `.alert.is-warn` «Some edits aren’t in this PDF» / «They aren’t saved yet, so the preview and the PDF show your last saved version.» + посилання «Back to editor».
  - `.alert.is-warn` портується в `components.css` з State library дизайну.
  - Стан сесії читається через `useSyncExternalStore`.
- **`PreviewBar`** (sticky):
  - back-link «Editor», `h1` з назвою CV, meta «A4 · N page(s)»;
  - чіп «PDF ready»;
  - зум «− / 100% / + / Fit»: рівні .5–1.5; Fit = min(1, ширина / 794) через ResizeObserver; live-оголошення.
- **Desk:** аркуш `<CvPage content={cv.content}/>` з CSS `zoom`, підпис «Page 1 of 1 · A4 · 210 × 297 mm» (для N сторінок — «N pages · A4 · …»).
- **`DownloadCard`:**
  - поле File name із суфіксом `.pdf`; порожнє → «Add a file name to download your CV.» і фокус;
  - checks:
    - «Fits on one A4 page» або «Clean page breaks across N A4 pages»;
    - «Selectable text, so applicant tracking systems can read it»;
    - «Email and profile links are clickable»;
    - «Fonts embedded — looks the same on every device»;
  - кнопка «Download PDF» → «Preparing PDF…» з `.gbar` (модифікатор 6px) і кроками дизайну на таймерах;
  - примітка «{file}.pdf».
- **Download:**
  - `await flush()` (повторює невдале збереження), потім запит;
  - `AbortController` скасовує запит, якщо сторінку покинули;
  - успіх → `saveFile` → ready, фокус на заголовок, live-повідомлення «Your PDF is ready. {file} is downloading.»;
  - помилка → `.alert` «We couldn’t create your PDF» + текст дизайну + «Ref. {code}». Для `NETWORK_ERROR` — текст про зʼєднання. Кнопка «Try again».
- **`ReadyCard`:**
  - рядок файлу: `PdfFileIcon`, імʼя, «N page(s) · A4 · {formatFileSize}» зі справжнього `X-Page-Count`;
  - checks;
  - «Download again»: той самий blob, 2.2 с показує «Downloaded again»;
  - «Back to editor»;
  - «Go to My CVs» · «Change settings» (повертає idle і фокус на кнопку);
  - ×; Escape.
- **Кількість сторінок:** до першого PDF — `estimatePages`; після — справжня.
- **≤1023px (як у дизайні):**
  - одна колонка;
  - фіксований `fp-mbar` з імʼям, meta і кнопкою (плюс рядок помилки). Дублікат кнопки ховається через `display: none`;
  - ready-картка стає bottom sheet з backdrop: `role="dialog"` і `aria-modal`, пастка Tab, Escape, повернення фокусу.
- **≤599px:** розміри з дизайну, цілі дотику 44px.
- **Іконки:** нові `DownloadIcon`, `MinusIcon`, `ExternalArrowIcon`. `PdfFileIcon` уже є і збігається з дизайном.

**C4. Точки входу в редакторі (з дизайну), усі в тій самій вкладці.** У новій вкладці немає сесії редактора, і правки, що чекають автозбереження, не встигли б зберегтися.
- `EditorBar`: `Link.btn.btn-primary.ed-cta` «Preview & download →» після статусу збереження; ховається на ≤1023px.
- `CvPreview`: «Full preview ↗» (`.pv-full`, `margin-left: auto`).
- `.ed-mbar`: «Preview & download →», 46px на ≤599px.

---

## Документація (README)

- **Статус** і стек: React-PDF, точний pin.
- **Структура:** `integrations/pdf`, `modules/cv-pdf`, `features/preview`.
- **REST-таблиця:** `GET /api/cvs/:cvId/pdf`.
- **Розділ «PDF export»:**
  - правила сторінок;
  - шрифти й ліцензія;
  - збережений стан і flush;
  - заміри часу;
  - обмеження:
    - emoji, CJK, арабська тощо не друкуються (немає fallback-шрифту);
    - дефіс на розриві дуже довгих URL.
- **Decisions:** React-PDF замість Chromium.
- **Roadmap:** пункт 5 закрито.

---

## Перевірка

1. `pnpm lint && pnpm typecheck && pnpm test`.
2. `docker compose up -d --build -V` (нові залежності), API healthy.
3. curl із сесійною cookie:
   - `GET /api/cvs/:id/pdf` → A4, текст витягується;
   - чужий CV → 404;
   - draft → 409.
4. In-app браузер (mock-режим):
   1. Редактор → «Preview & download»: зум і Fit; поле імені (порожнє → помилка); Download → ready; «Download again»; «Change settings».
   2. Надрукувати правку й одразу відкрити превʼю: PDF містить правку.
   3. Невалідний email у редакторі: у превʼю видно попередження, PDF зі старим email.
   4. Зупинити API: помилка з «Ref.», потім «Try again».
   5. Довгий CV через `PUT …/content`: кілька сторінок, заголовки не висять, рядки не розрізані, нічого не вилазить за поля.
   6. Ширина 375px: m-bar, bottom sheet, Escape, фокус.
5. Відкрити PDF у Preview / Chrome: текст виділяється й копіюється, посилання клікабельні.
