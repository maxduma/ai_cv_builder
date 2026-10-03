# API

The REST API (Express). Everything the web app does goes through it; there is no other interface.

## Endpoints

Apart from `/api/health` and signing up, logging in and logging out, every route acts on behalf of the logged-in user and answers 401 without a session (an unknown path too). Another user's CV or job answers 404.

| Method and path                                     | Purpose                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/auth/signup`                             | Create an account `{ name, email, password }` and log in; `409` if taken                                                                         |
| `POST /api/auth/login`                              | Log in `{ email, password }`: sets the session cookie, or `401`                                                                                  |
| `POST /api/auth/logout`                             | Log out: clears the session cookie (`204`)                                                                                                       |
| `GET /api/auth/me`                                  | The logged-in user, or `401` without a valid session                                                                                             |
| `GET /api/cvs`                                      | The user's CVs with their status (`draft`, `generating`, `failed`, `ready`)                                                                      |
| `POST /api/cvs`                                     | Create a draft `{ targetRole?, sourceText? }`                                                                                                    |
| `GET /api/cvs/:cvId`                                | A CV with its sources, latest generation, `content` (`null` until generated), `contentVersion` and the AI's `questions`                          |
| `PATCH /api/cvs/:cvId`                              | Rename the CV `{ title }` (one line, 1–120 characters), and/or save the target role and the free-text source (`""`/`null` clears those two)      |
| `DELETE /api/cvs/:cvId`                             | Delete the CV with its generations, questions and uploaded PDF → `204`; a generation running meanwhile is dropped                                |
| `PUT /api/cvs/:cvId/source-document`                | Upload the source PDF (multipart field `file`); replaces the previous one                                                                        |
| `DELETE /api/cvs/:cvId/source-document`             | Remove the source PDF                                                                                                                            |
| `PUT /api/cvs/:cvId/content`                        | Save edited content `{ baseVersion, content }` → `{ contentVersion }`; `409 CONTENT_CONFLICT` with the newer content when `baseVersion` is stale |
| `GET /api/cvs/:cvId/pdf`                            | The CV as saved now, as an A4 PDF to download (`X-Page-Count` gives its pages); `409 CV_NOT_GENERATED` before it has content                     |
| `POST /api/cvs/:cvId/generations`                   | Start generation → `202` + `Location`; `422 CV_NOT_READY` without a role or sources; `409` while one is running, or once the CV has content      |
| `POST /api/cvs/:cvId/questions/:questionId/answers` | Answer a question `{ answer }` → `202` + `Location` of the job that applies it                                                                   |
| `PATCH /api/cvs/:cvId/questions/:questionId`        | Skip or dismiss a question `{ status: "skipped" \| "dismissed" }`                                                                                |
| `GET /api/generation-jobs/:jobId`                   | A job's status (a generation, or an answer being applied), current step and `issues`, for polling                                                |

Uploads are checked before anything is stored: CV ownership (before the body is read), size (10 MB), type (declared type and the `%PDF-` signature), page count (20), readable text, and at most 100,000 characters of text (`PDF_TOO_MUCH_TEXT`: all of it is stored and sent to Claude). Files are stored under keys the API generates; the client's file name is cleaned and only displayed.

## Errors

Errors are handled in one place. Every error response has the shape `{ error: { code, message, details?, requestId } }`, and the request id is also returned in the `X-Request-Id` header. The handler maps errors as follows:

- Zod validation errors → `400 VALIDATION_ERROR`
- malformed JSON → `400 INVALID_JSON`; a body over 1 MB → `413 PAYLOAD_TOO_LARGE`
- other requests Express can't read (an unsupported charset or encoding, an aborted body, a malformed %-escape) → their own 4xx status, as `VALIDATION_ERROR`
- `AppError` subclasses → their own status
- anything else → a logged `500 INTERNAL_ERROR` that doesn't leak internals (stored data that no longer fits its schema is one of these: a fault on our side, not the request's)

API responses are sent with `Cache-Control: no-store`, so CV data doesn't stay in the browser's HTTP cache.

## Authentication and ownership

Users sign up with a name, an email and a password. Emails are stored trimmed and lowercased, so they are unique regardless of case. Passwords are hashed with scrypt from `node:crypto` (OWASP parameters, a random salt per password, the parameters stored with each hash). Login errors don't reveal whether an email has an account: an unknown email gets the same `401` as a wrong password and costs the same hash check.

Signing up or logging in sets the session cookie `cvb_session`: `HttpOnly` (page scripts can't read it), `SameSite=Lax`, `Path=/api`, and `Secure` in production. It holds a JWT signed with `JWT_SECRET` (HS256 only), which expires after 7 days. The `currentUser` middleware verifies it and loads the user on every route except health, sign-up, login and logout. Services take the owner only from that session; no endpoint accepts a user id from the client, and request bodies are strict objects (an unknown key such as `userId` is a 400).

Cross-site request forgery is prevented by `SameSite=Lax`: browsers don't send the cookie on cross-site POSTs. HTML forms can only send GET and POST, so the PUT, PATCH and DELETE routes (the multipart upload included) can't be forged by a form at all, and a cross-origin `fetch` with them, or with a JSON body, needs a CORS preflight the API never answers. The POSTs that need no body (starting a generation, logging out) rely on `SameSite` alone, which trusts same-site origins (other ports on localhost, sibling subdomains).

Ownership is enforced at two levels:

- **Queries:** every query made for a request filters by `user_id` (or locks the CV's row by `id` and `user_id`). Another user's CV returns 404, so its existence is not revealed.
- **Database:** `generation_jobs`, `source_documents` and `cv_questions` reference `(cv_id, user_id)` → `cvs(id, user_id)`, and an answer job references `(question_id, cv_id)` → `cv_questions(id, cv_id)`. A job, document or question therefore cannot exist for a user who doesn't own its CV, and a job can't apply an answer to another CV. The worker, which acts by job id, relies on this.

## Job error codes

A failed job stores a code and a message. The CV's page shows the message, which says what happened and what to try, and the code as "Ref. CODE" (see `modules/generation/generation.failures.ts`).

| Code                  | Meaning                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `INVALID_INPUT`       | The job's saved input couldn't be read                                     |
| `INVALID_OUTPUT`      | The generator's result failed the worker's final check (a backstop)        |
| `INTERNAL_ERROR`      | An unexpected error                                                        |
| `WORKER_LOST`         | Its worker stopped responding, and the job had used all 3 attempts         |
| `AI_TIMEOUT`          | The job's deadline passed, or the connection to Anthropic timed out        |
| `AI_RATE_LIMITED`     | Anthropic's rate limit was hit                                             |
| `AI_UNAVAILABLE`      | Anthropic was unreachable, overloaded or failing                           |
| `AI_NOT_CONFIGURED`   | The API key, its account (billing, permissions) or the model name is wrong |
| `AI_REQUEST_REJECTED` | Anthropic rejected the request, e.g. as too large                          |
| `AI_REFUSED`          | Claude declined to write the CV                                            |
| `AI_OUTPUT_TRUNCATED` | The answer hit the output limit before it was complete                     |
| `AI_INVALID_JSON`     | The answer wasn't valid JSON, twice                                        |
| `AI_SCHEMA_MISMATCH`  | The answer didn't match the CV schema, twice                               |
| `AI_INVALID_UPDATE`   | An answer's changes, merged into the CV, broke its rules; nothing changed  |
