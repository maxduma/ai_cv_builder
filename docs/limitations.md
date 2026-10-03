# Limitations

What was left out of the 10-hour assignment, or kept simple, and what the web app does not do yet. The [README](../README.md#simplified-for-the-time-limit-and-what-i-would-do-differently) has the short version and the order I would fix things in.

## Left out or simplified

- **Product scope:** a CV can't be regenerated (that would replace the person's edits); one CV template, A4 only; uploads are PDF only (no DOCX, no OCR for scanned PDFs); the UI is in English; the PDF fonts cover Latin and Cyrillic only. Deleting a CV is permanent, as its dialog says: there is no trash.
- **Accounts:** the development setup signs sessions with a public secret (it is in the repository) unless `JWT_SECRET` is set, and publishes the web port on all interfaces so a phone can reach it: on a shared network, someone who knows a user's id could forge that user's session. Ids are random UUIDs and sign-up is open anyway, and production refuses to start without a private secret. No email verification or password reset; sessions can't be revoked (logging out only removes the cookie, and a token that leaked stays valid for up to 7 days); no login rate limiting yet. Limiting by client IP needs `trust proxy` set for whatever proxy runs in front of the API, or every client shares one IP. Meanwhile each guess costs a full scrypt hash, which also holds one of Node's four threadpool threads for a few hundred milliseconds, so a flood of logins would slow other requests too.
- **Infrastructure:** development-only Docker (the source is bind-mounted for hot reload; no production images, deployment or HTTPS); uploaded PDFs on a local volume; the job worker, PDF text extraction and PDF rendering all run in the API process. A crafted PDF (one compressed page with millions of text operators) can keep the API busy for seconds: the 15 s parse deadline stops pdf.js only when it yields. Moving extraction and rendering to `worker_threads` is the next step.
- **Testing:** the web app's pages and layout have no unit or browser end-to-end tests (the editor's autosave and merge, the saved create form, the My CVs cache updates and the card menu's keys do); they were checked by hand (see [development.md](development.md#tests-in-detail)). The repositories are tested on PostgreSQL in a suite that `pnpm test` skips unless `TEST_DATABASE_URL` is set; CI runs it.
- **Data:** the extracted text of a removed PDF stays in the snapshots of the jobs that used it (kept for auditing); deleting the CV removes those jobs too.

## Known limitations of the UI

- The create form sends the role and description to the server when Generate is pressed (the draft itself, with its PDF, is saved at once). Until then they are kept in the tab: a reload brings them back and closing the tab asks first, but leaving by a link discards them.
- Phones held sideways get the tablet layout. On short screens the header and the editor's bars scroll away instead of staying pinned, but the editor's bottom bar stays and some controls there are smaller than 44 px.
- Moving between pages doesn't move keyboard focus to the new page's heading (pages that load work, such as the generation status, do move it).
- Logging in as another account in another tab isn't noticed by an open tab until it is reloaded.
- A renamed CV moves to the top of My CVs only on the next refresh of the list (the card first keeps its place, so it doesn't jump away under the cursor).
- Reading a PDF: text comes out in the PDF's content order, so a two-column or sidebar CV may interleave; the address behind a link's text is not extracted (a "LinkedIn" link becomes a question). A CV in Ukrainian or Russian gets English section headings and "Present" in the PDF, and the AI's questions are in English.
