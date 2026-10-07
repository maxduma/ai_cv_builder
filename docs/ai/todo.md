# Todo list

There was no separate todo file, and Claude Code's todo tool was not used in any session. Two things did that job:

1. **The roadmap in the README**, written in step 1 and ticked off as the steps were done.
2. **The ordered steps in each plan**, which Claude worked through while implementing that step.

## The roadmap

Copied from the README as it was written in step 1 ([9bda720](https://github.com/maxduma/ai_cv_builder/blob/9bda720/README.md#roadmap)):

> 1. ~~Foundation: monorepo, Docker, database schema, API and web shells~~
> 2. Document upload and text extraction
> 3. AI CV generation: worker, Claude structured output, validation
> 4. CV editor UI
> 5. PDF export
> 6. Authentication

Where each item was ticked off:

| Item                                   | Ticked off in                                                                                                                                                                                                                       | Pull request |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1. Foundation                          | [9bda720](https://github.com/maxduma/ai_cv_builder/blob/9bda720/README.md#roadmap): it was done when the roadmap was written                                                                                                        | #1           |
| 2. Document upload and text extraction | [cfe828b](https://github.com/maxduma/ai_cv_builder/blob/cfe828b/README.md#roadmap)                                                                                                                                                  | #2           |
| 3. AI CV generation                    | the jobs and the worker, with a mock generator, in [cfe828b](https://github.com/maxduma/ai_cv_builder/blob/cfe828b/README.md#roadmap); Claude in [8eb2e3a](https://github.com/maxduma/ai_cv_builder/blob/8eb2e3a/README.md#roadmap) | #2, #3       |
| 4. CV editor UI                        | [a627080](https://github.com/maxduma/ai_cv_builder/blob/a627080/README.md#roadmap), renamed "CV editor and the AI's questions"                                                                                                      | #4           |
| 5. PDF export                          | [5049afa](https://github.com/maxduma/ai_cv_builder/blob/5049afa/README.md#roadmap)                                                                                                                                                  | #5           |
| 6. Authentication                      | [d13d678](https://github.com/maxduma/ai_cv_builder/blob/d13d678/README.md#roadmap), together with the generation                                                                                                                    | #3           |

The roadmap left the README in [4b9e3e9](https://github.com/maxduma/ai_cv_builder/commit/4b9e3e9) (step 6), when the README was rewritten for the final review. From then on, what was left out and what would come next is in the README's "Simplified for the time limit, and what I would do differently" and in [limitations.md](../limitations.md).

## The steps in each plan

| Step | Plan                                                                       | Where its ordered steps are                                                                                                                                                       |
| ---- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | [01-foundation.md](plans/01-foundation.md)                                 | "Implementation order"                                                                                                                                                            |
| 2    | [02-redesign-and-create-flow.md](plans/02-redesign-and-create-flow.md)     | sections 0 to 6: git, shared code, database, API, web, tests, the end-to-end check                                                                                                |
| 3    | [03-auth-and-claude-generation.md](plans/03-auth-and-claude-generation.md) | part A (authentication, A1 to A5), part B (generation with Claude, B1 to B6), then "Verification"                                                                                 |
| 4    | [04-editor-and-ai-questions.md](plans/04-editor-and-ai-questions.md)       | parts A to D (shared code, database, API, web), then the documentation and the verification                                                                                       |
| 5    | [05-pdf-export.md](plans/05-pdf-export.md)                                 | step 0 (a go / no-go spike), parts A to C (shared code, API, web), the documentation and the verification                                                                         |
| 6    | [06-final-review.md](plans/06-final-review.md)                             | two priority tiers, step 0 (a baseline run), parts A to F, what is deliberately not done, the verification                                                                        |
| 7    | [07-final-polish.md](plans/07-final-polish.md)                             | "Steps (in order)", 1 to 9                                                                                                                                                        |
| 8    | none                                                                       | the step had no plan; what it did is in the descriptions of [PR #8](https://github.com/maxduma/ai_cv_builder/pull/8) and [PR #9](https://github.com/maxduma/ai_cv_builder/pull/9) |
