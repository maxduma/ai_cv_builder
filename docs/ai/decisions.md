# Decisions

Every question Claude asked me in plan mode, with the options it offered and the answer I chose: 20 questions in 7 rounds, in steps 2 to 7. Claude asks when a decision is not its to make alone (scope, a conflict between the design and the requirements, a trade-off); the plan is then written around the answers. Claude marked the option it recommended with "(Recommended)".

The questions, options and answers are copied verbatim from the sessions, which were in Ukrainian. The lines in italics are English translations, added when this folder was assembled.

## Step 2: Redesign and the create-CV flow

Plan: [plans/02-redesign-and-create-flow.md](plans/02-redesign-and-create-flow.md).

### 1. Джерела (Sources), 2026-10-02

> Дизайн дозволяє дати PDF і/або власний текст (пілюля «and / or»), а в промпті написано «choose between». Як робити?

_The design lets you give a PDF and/or your own text (the "and / or" pill), but the prompt says "choose between". Which should it be?_

- **PDF і/або текст (Recommended)**: Як у дизайні: можна дати одне або обидва, потрібне хоча б одне. Генерація бере все, що є.

  _PDF and/or text: as in the design, one or both can be given, and at least one is required. Generation uses whatever there is._

- **Тільки одне на вибір**: Як у промпті: перемикач PDF / текст, у CV зберігається лише одне джерело.

  _Only one of them: as in the prompt, a PDF / text switch, and the CV keeps only one source._

**Answer:** PDF і/або текст (Recommended)

### 2. Відкриття CV (Opening a CV), 2026-10-02

> Редактора ще немає. Що показувати, коли відкриваєш готове CV?

_There is no editor yet. What should opening a finished CV show?_

- **Лише статус-екран (Recommended)**: Екран з дизайну «Your CV is ready» (або прогрес / помилка). Вміст CV побачимо в кроці з редактором.

  _Only the status screen: the design's "Your CV is ready" screen (or progress / an error). The CV's content comes with the editor step._

- **Статус + перегляд вмісту**: Додатково read-only сторінка A4 з мок-результатом за шаблоном CV з дизайну, щоб перевірити, що збереглося.

  _The status plus a view of the content: also a read-only A4 page with the mock result in the design's CV template, to check what was saved._

**Answer:** Лише статус-екран (Recommended)

### 3. Текст PDF (PDF text), 2026-10-02

> Витягувати текст із PDF одразу при завантаженні?

_Extract the text from a PDF as soon as it is uploaded?_

- **Так, при завантаженні (Recommended)**: Перевіряє, що PDF читабельний і не скан, показує кількість сторінок як у дизайні («2 pages · 184 KB»), зберігає текст для кроку з AI. Додає бібліотеку unpdf.

  _Yes, on upload: checks that the PDF is readable and not a scan, shows the page count as in the design ("2 pages · 184 KB") and keeps the text for the AI step. Adds the unpdf library._

- **Ні, лише тип і розмір**: Перевірка типу/розміру й збереження файлу. Без кількості сторінок; витягування тексту — разом з AI.

  _No, only the type and size: check the type and size and store the file. No page count; the text is extracted with the AI step._

**Answer:** Так, при завантаженні (Recommended)

### 4. Стилі (Styles), 2026-10-02

> Зараз UI на Tailwind, а дизайн — це готовий CSS з токенами. Як реалізувати стилі?

_The UI uses Tailwind now, and the design is ready-made CSS with tokens. How should the styles be done?_

- **CSS дизайну, без Tailwind (Recommended)**: Переношу CSS з дизайну (токени + класи компонентів). Найточніше до дизайну, одна система стилів.

  _The design's CSS, no Tailwind: port the design's CSS (tokens and component classes). Closest to the design, one styling system._

- **Залишити Tailwind**: Перекладаю дизайн в утиліти Tailwind і @theme-токени. Більше роботи й менш точно.

  _Keep Tailwind: translate the design into Tailwind utilities and @theme tokens. More work and less exact._

**Answer:** CSS дизайну, без Tailwind (Recommended)

## Step 3: Authentication and generation with Claude

Plan: [plans/03-auth-and-claude-generation.md](plans/03-auth-and-claude-generation.md).

### 5. Сесія (Session), 2026-10-02

> Де зберігати JWT-сесію на фронтенді?

_Where should the front end keep the JWT session?_

- **httpOnly cookie (Recommended)**: JWT у httpOnly + SameSite=Lax cookie (Secure у production). JS не бачить токен (захист від XSS), фронт дізнається про сесію через GET /api/auth/me. Працює з поточним Vite-проксі та XHR-завантаженням PDF без змін.

  _httpOnly cookie: the JWT in an httpOnly, SameSite=Lax cookie (Secure in production). JavaScript can't see the token (protection from XSS); the front end learns about the session from GET /api/auth/me. Works with the current Vite proxy and the XHR PDF upload unchanged._

- **localStorage + Bearer**: Токен у localStorage, заголовок Authorization у fetch і XHR. Простіше для сторонніх API-клієнтів, але токен доступний будь-якому скрипту на сторінці (XSS).

  _localStorage + Bearer: the token in localStorage and an Authorization header in fetch and XHR. Simpler for third-party API clients, but any script on the page can read the token (XSS)._

**Answer:** httpOnly cookie (Recommended)

### 6. Статуси (Statuses), 2026-10-02

> Статуси генерації зараз QUEUED/RUNNING/SUCCEEDED/FAILED. Перейменувати під промпт (pending/processing/completed/failed)?

_The generation statuses are QUEUED/RUNNING/SUCCEEDED/FAILED now. Rename them to match the prompt (pending/processing/completed/failed)?_

- **Перейменувати (Recommended)**: Міграція ALTER TYPE … RENAME VALUE (дані зберігаються) → PENDING/PROCESSING/COMPLETED/FAILED у БД, shared-типах, API і вебі. 1:1 з вимогами.

  _Rename: an ALTER TYPE … RENAME VALUE migration (the data is kept) → PENDING/PROCESSING/COMPLETED/FAILED in the database, the shared types, the API and the web app. One to one with the requirements._

- **Залишити як є**: Семантика та сама, без міграції; у README лише опишу відповідність.

  _Keep them: the meaning is the same and there is no migration; the README would only describe the mapping._

**Answer:** Перейменувати (Recommended)

### 7. Прогалини (Gaps), 2026-10-02

> AI знаходитиме відсутню/неоднозначну інформацію. У дизайні це екран «Answer 4 quick questions» (Clarify) — окремий наступний крок. Що робимо зараз?

_The AI will find missing or ambiguous information. In the design that is the "Answer 4 quick questions" screen (Clarify), a separate later step. What do we do now?_

- **Лише API (Recommended)**: Зберігаю список питань (section, target, question, why — під формат Clarify) у job і віддаю в GET /api/generation-jobs/:id. UI Clarify — пізніше, окремим кроком.

  _Only the API: keep the list of questions (section, target, question, why, in the shape Clarify needs) in the job and return it from GET /api/generation-jobs/:id. The Clarify UI comes later, as its own step._

- **Ще й короткий список у UI**: Додаю на екран «Your CV is ready» простий блок з питаннями. Виходить за межі поточного done-view; повноцінний Clarify все одно пізніше.

  _Also a short list in the UI: add a simple block with the questions to the "Your CV is ready" screen. Goes beyond the current done view; the full Clarify screen comes later anyway._

**Answer:** Лише API (Recommended)

### 8. Demo-дані (Demo data), 2026-10-02

> У локальній БД є demo-користувач (без пароля) з тестовими CV. Що з ним робити при додаванні пароля?

_The local database has a demo user (no password) with test CVs. What should happen to it when passwords are added?_

- **Видалити в міграції (Recommended)**: password_hash стає NOT NULL; demo-користувач і його CV/джоби видаляються каскадом (лише локальні тестові дані; завантажені PDF лишаться сиротами у volume).

  _Delete it in the migration: password_hash becomes NOT NULL; the demo user and its CVs and jobs are deleted by the cascade (local test data only; uploaded PDFs stay behind in the volume as orphans)._

- **Залишити**: password_hash nullable; demo-рядки залишаються в БД, але увійти в них неможливо.

  _Keep it: password_hash stays nullable; the demo rows stay in the database, but nobody can log in to them._

**Answer:** Видалити в міграції (Recommended)

## Step 4: The editor and the AI's questions

Plan: [plans/04-editor-and-ai-questions.md](plans/04-editor-and-ai-questions.md).

### 9. Відповіді (Answers), 2026-10-02

> Коли відповідь на питання AI має оновлювати CV?

_When should an answer to one of the AI's questions update the CV?_

- **Одразу після кожної (Recommended)**: Кожна відповідь запускає фонове оновлення лише свого розділу. Поки людина відповідає на наступні питання, CV уже оновлюється. Кнопка «Update my CV» у кінці просто відкриває редактор.

  _Right after each one: each answer starts a background update of its own section only. While the person answers the next questions, the CV is already being updated. The "Update my CV" button at the end just opens the editor._

- **Разом, кнопкою «Update my CV»**: Як у дизайні: відповіді спершу зберігаються, а в CV потрапляють однією дією наприкінці.

  _All together, with the "Update my CV" button: as in the design, the answers are saved first and reach the CV in one action at the end._

**Answer:** Одразу після кожної (Recommended)

### 10. Формат (Format), 2026-10-02

> Як людина відповідає на питання AI?

_How does the person answer the AI's questions?_

- **Вільний текст (Recommended)**: Одне текстове поле під питанням. AI ставить відкриті питання й не пропонує готових варіантів відповіді (вони можуть бути вигаданими).

  _Free text: one text field under the question. The AI asks open questions and offers no ready-made answers (they could be invented)._

- **Варіанти від AI + текст**: Як у дизайні: AI пропонує 2–4 варіанти-чіпи і поле для власної відповіді. Схема відповіді AI і промпт стають складнішими.

  _Options from the AI plus text: as in the design, the AI offers 2–4 option chips and a field for your own answer. The AI's response schema and the prompt get more complex._

**Answer:** Вільний текст (Recommended)

### 11. Обсяг (Scope), 2026-10-02 (several answers allowed)

> Що з дизайну редактора додати вже зараз, окрім полів і автозбереження?

_What from the editor's design should be added now, besides the fields and autosave?_

- **Live A4 preview (Recommended)**: Права колонка з живим переглядом CV на A4 і рядком «Fits on one page». Без «Full preview» і завантаження PDF.

  _Live A4 preview: a right-hand column with a live view of the CV on A4 and the "Fits on one page" line. Without "Full preview" and the PDF download._

- **Undo після видалення (Recommended)**: Тост «Deleted …» з кнопкою Undo на 6 с, як у дизайні. Так роль, освіту, пункт чи навичку не можна втратити одним випадковим кліком.

  _Undo after deleting: a "Deleted …" toast with an Undo button for 6 s, as in the design, so a role, an education entry, a bullet or a skill can't be lost to one stray click._

- **Поле Work setup**: Поле «Work setup» у контактах (напр. «Open to remote roles»), як у дизайні. AI заповнює його, лише якщо це є в джерелах.

  _The Work setup field: a "Work setup" field in the contact details (for example "Open to remote roles"), as in the design. The AI fills it only if the sources say so._

- **Move up / Move down**: Пункти в меню ⋯ ролі чи освіти, щоб змінити порядок (без drag-and-drop).

  _Move up / Move down: items in the ⋯ menu of a role or an education entry to change their order (no drag and drop)._

**Answer:** Live A4 preview (Recommended); Undo після видалення (Recommended); Поле Work setup; Move up / Move down

### 12. Збереження (Saving), 2026-10-03

> У завданні сказано «edit any field manually and save changes», а в дизайні немає кнопки Save: зміни зберігаються автоматично («Saving… → Saved»). Як зберігати ручні правки?

_The task says "edit any field manually and save changes", but the design has no Save button: changes are saved automatically ("Saving… → Saved"). How should manual edits be saved?_

- **Автозбереження, як у дизайні (Recommended)**: Зберігається приблизно через 0,7 с після останньої правки. У барі видно «Saving…» / «Saved», а помилку збереження з кнопкою «Try again». Незбережене не губиться при переході, відповіді AI вливаються без втрат.

  _Autosave, as in the design: it saves about 0.7 s after the last edit. The bar shows "Saving…" / "Saved", and a failed save with a "Try again" button. Unsaved edits are not lost when you move to another page, and the AI's answers are merged in without losing anything._

- **Кнопка Save**: У барі «Unsaved changes» і кнопка Save; без неї нічого не зберігається. Під час закриття вкладки з'являється попередження. Простіше, але легше втратити правки.

  _A Save button: the bar shows "Unsaved changes" and a Save button, and nothing is saved without it. Closing the tab shows a warning. Simpler, but edits are easier to lose._

**Answer:** Автозбереження, як у дизайні (Recommended)

## Step 5: PDF export

Plan: [plans/05-pdf-export.md](plans/05-pdf-export.md).

### 13. Обсяг UI (UI scope), 2026-10-03

> Яку частину дизайну «Preview & PDF» будувати на цьому кроці? (PDF генеруватиме бекенд у будь-якому разі.)

_Which part of the "Preview & PDF" design should this step build? (The back end generates the PDF either way.)_

- **Сторінка Preview, тільки A4 (Recommended)**: Кнопка «Preview & download» і посилання «Full preview» в редакторі відкривають /cvs/:id/preview. На сторінці: A4-прев’ю з зумом і картка «Download PDF» з назвою файлу, станами preparing / ready / failed та мобільною панеллю. Перемикача A4 / US Letter немає, бо в завданні лише A4. Посилання в PDF завжди клікабельні, тож перемикача «Clickable links» теж немає.

  _The Preview page, A4 only: the editor's "Preview & download" button and "Full preview" link open /cvs/:id/preview. On the page: an A4 preview with zoom and a "Download PDF" card with the file name, the preparing / ready / failed states and a bar for phones. No A4 / US Letter switch, because the task asks only for A4. Links in the PDF are always clickable, so there is no "Clickable links" switch either._

- **Лише кнопка завантаження**: Без сторінки прев’ю: кнопка «Download PDF» у панелі редактора одразу завантажує PDF збереженого CV. Змін найменше, але це відходить від сценарію з дизайну.

  _Only a download button: no preview page; a "Download PDF" button in the editor's bar downloads the PDF of the saved CV at once. The fewest changes, but it departs from the flow in the design._

- **Увесь дизайн**: Усе з артбордів «Preview & PDF», зокрема перемикачі A4 / US Letter і «Clickable links». Це виходить за межі завдання, де вказано тільки A4.

  _The whole design: everything on the "Preview & PDF" artboards, including the A4 / US Letter and "Clickable links" switches. That goes beyond the task, which names only A4._

**Answer:** Сторінка Preview, тільки A4 (Recommended)

## Step 6: Final review

Plan: [plans/06-final-review.md](plans/06-final-review.md).

### 14. DB-тести (Database tests), 2026-10-03

> Зараз усі тести бекенду ганяють роути на in-memory репозиторіях. Справжні SQL-запити не перевіряє жоден тест: claim джобів через FOR UPDATE SKIP LOCKED, fencing за attempts, фільтри user_id, блокування версії контенту. Додати для них інтеграційні тести на Postgres?

_All back-end tests run the routes on in-memory repositories now. No test checks the real SQL: claiming jobs with FOR UPDATE SKIP LOCKED, fencing by attempts, the user_id filters, locking the content version. Add integration tests on Postgres for them?_

- **Так, окрема тестова БД (Recommended)**: База cvbuilder_test у вже наявному Postgres з docker compose; міграції через prisma migrate deploy. Нових сервісів не додаємо. Без TEST_DATABASE_URL ці тести пропускаються, і pnpm test працює як зараз.

  _Yes, a separate test database: a cvbuilder_test database in the Postgres that docker compose already runs, with migrations applied by prisma migrate deploy. No new services. Without TEST_DATABASE_URL these tests are skipped and pnpm test works as it does now._

- **Ні, лише in-memory**: Тести на ізоляцію, переходи станів і валідацію AI-виводу додаю тільки через наявний харнес (startApp + in-memory). Розбіжності з реальним SQL лишаються неперевіреними.

  _No, in-memory only: the tests for isolation, state transitions and the validation of AI output go only through the existing harness (startApp + in-memory). Differences from the real SQL stay untested._

**Answer:** Так, окрема тестова БД (Recommended)

### 15. E2E-флоу (End-to-end flow), 2026-10-03

> Як проганяти повний флоу (реєстрація → … → завантаження PDF) у браузері під час перевірки?

_How should the full flow (sign-up → … → PDF download) be run in the browser during the review?_

- **Mock + 1 справжня генерація (Recommended)**: Весь флоу кілька разів у mock-режимі (тимчасово без API-ключа), плюс один прогін зі справжнім Claude: одна генерація й одна відповідь на питання. Це платно, але небагато.

  _Mock plus one real generation: the whole flow several times in mock mode (temporarily without an API key), plus one run with the real Claude: one generation and one answer to a question. It costs money, but not much._

- **Тільки mock**: Без платних викликів. Реальну інтеграцію з Claude покривають лише наявні юніт-тести з фейковим клієнтом.

  _Mock only: no paid calls. The real Claude integration is covered only by the existing unit tests with a fake client._

- **Тільки справжній Claude**: Усі прогони через реальний API: точніше, але дорожче й повільніше (генерація ~1 хв).

  _The real Claude only: every run through the real API. More accurate, but costlier and slower (a generation takes about a minute)._

**Answer:** Mock + 1 справжня генерація (Recommended)

### 16. AI-розділ (The AI section), 2026-10-03

> README має пояснювати, як використовувались AI-інструменти. Звідки взяти зміст цього розділу?

_The README has to explain how AI tools were used. Where should the content of that section come from?_

- **Чернетка з відомого (Recommended)**: Напишу з того, що видно в проєкті й цій роботі: дизайн у Claude Design (артефакт), реалізація в Claude Code покроково з plan mode, ти затверджував плани й рішення, перевірка тестами й у браузері. Потім ти поправиш.

  _A draft from what is known: written from what the project and this work show: the design in Claude Design (an artifact), the implementation in Claude Code step by step with plan mode, you approving the plans and decisions, checks with tests and in the browser. You correct it afterwards._

- **Дам свої нотатки**: Залишу в розділі місце, а ти надішлеш, що саме туди написати.

  _I'll give my notes: leave room in the section, and you send what to write there._

**Answer:** Чернетка з відомого (Recommended)

## Step 7: Audit against the assignment and final polish

Plan: [plans/07-final-polish.md](plans/07-final-polish.md).

### 17. Порядок (Order), 2026-10-03

> Як виправити порядок досвіду (вимога «most relevant experience comes first»)?

_How should the order of experience be fixed (the requirement "most relevant experience comes first")?_

- **За релевантністю (Recommended)**: Змінити prompt.ts:24 і схему на «by relevance, most recent first among equals», виправити коментарі й README:264. Відповідає завданню буквально; потім один прогін із реальним ключем.

  _By relevance: change prompt.ts:24 and the schema to "by relevance, most recent first among equals", fix the comments and README:264. Matches the task literally; then one run with a real key._

- **Лишити хронологію**: Прибрати «in which order» з prompt.ts:12, виправити коментарі й README, додати рядок про свідомий вибір. Дешевше, але слабша відповідь на фразу завдання.

  _Keep it chronological: remove "in which order" from prompt.ts:12, fix the comments and the README, add a line about the deliberate choice. Cheaper, but a weaker answer to the task's wording._

**Answer:** За релевантністю (Recommended)

### 18. README (README), 2026-10-03

> Наскільки сильно переробляти README (завдання просить «short»)?

_How much should the README be reworked (the task asks for "short")?_

- **Легка правка (Recommended)**: Скоротити Status до 2–3 рядків, винести п'ять обов'язкових тем у Contents, переназвати й підняти «what I would do differently», додати поради про ключ і відмови Claude, виправити неточності, переписати розділ про AI від першої особи.

  _A light edit: cut Status to 2–3 lines, put the five required topics in Contents, rename "what I would do differently" and move it up, add tips about the key and Claude's refusals, fix inaccuracies, rewrite the AI section in the first person._

- **Короткий README + docs/**: Основний README близько 150 рядків із п'ятьма темами, а REST-таблиця, коди помилок, PDF і модель даних переїжджають у docs/. Сильніше відповідає «short», але займає 1–2 години і ризикує зламати якорі.

  _A short README + docs/: a main README of about 150 lines with the five topics, while the REST table, the error codes, the PDF and the data model move to docs/. A better match for "short", but it takes 1–2 hours and risks breaking anchors._

- **Лише фактичні виправлення**: Не чіпати структуру, виправити тільки неточності й формулювання про JWT_SECRET.

  _Factual fixes only: leave the structure, fix only the inaccuracies and the wording about JWT_SECRET._

**Answer:** Короткий README + docs/

### 19. Обсяг (Scope), 2026-10-03 (several answers allowed)

> Яку необов'язкову роботу додати? Усе нижче малоризикове; кожну групу можна обрати окремо.

_Which optional work should be added? Everything below is low-risk; each group can be picked on its own._

- **Швидкі фікси коду**: Ліміт нотаток 20 000, стабільне закриття сервера в тестах, правка 3 текстів в UI, видалити колонку job_description міграцією, нейтральні запитання в prompt, очищення headline, що дорівнює target role.

  _Quick code fixes: a 20,000 limit for notes, a reliable server shutdown in tests, 3 UI copy fixes, dropping the job_description column with a migration, neutral questions in the prompt, clearing a headline that equals the target role._

- **Мобільний CSS**: 100dvh на сторінках входу, touch-цілі 44 px, overflow-wrap у превʼю CV, запасний варіант для field-sizing, кілька однорядкових правок.

  _Mobile CSS: 100dvh on the sign-in pages, 44 px touch targets, overflow-wrap in the CV preview, a fallback for field-sizing, a few one-line fixes._

- **Тести й CI**: Один наскрізний тест (реєстрація → генерація → відповідь → правка → PDF), тест editor-session у веб-частині, GitHub Actions із lint, typecheck і test.

  _Tests and CI: one end-to-end test (sign-up → generation → answer → edit → PDF), an editor-session test in the web app, GitHub Actions with lint, typecheck and test._

- **PDF: розслідування**: Відтворити втрату текстового шару після «ü». Якщо виправлення мале, додати його з регресійним тестом, інакше записати в README.

  _PDF: investigation: reproduce the text layer getting lost after "ü". If the fix is small, add it with a regression test; otherwise note it in the README._

**Answer:** Швидкі фікси коду; Мобільний CSS; Тести й CI; PDF: розслідування

### 20. Форма (The form), 2026-10-03

> Що робити з втратою введеного у формі створення CV при перезавантаженні до натискання Generate?

_What to do about the create-CV form losing what was typed when the page is reloaded before Generate is pressed?_

- **Лишити як є (Recommended)**: Обидва скептики оцінили як низьку важливість: генерація переживає перезавантаження, обмеження вже чесно записане в README.

  _Leave it: both skeptics rated it low: the generation survives a reload, and the limitation is already stated honestly in the README._

- **beforeunload + sessionStorage**: Попередження при виході та відновлення role/text після перезавантаження, приблизно 30 хвилин. Закриває буквальне читання «reloading must not lose work».

  _beforeunload + sessionStorage: a warning on leaving, and the role and text restored after a reload, about 30 minutes of work. Covers the literal reading of "reloading must not lose work"._

**Answer:** beforeunload + sessionStorage
