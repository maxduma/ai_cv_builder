# AI artifacts

The plans, decisions, todo list and rules behind this project, and how it was built with AI tools. The reviewers asked for them after the submission, so this folder was assembled then (2026-10-07) by Claude Code, from its local files: the session transcripts, the saved plans, its memory and my hooks. The artifacts are copied verbatim, except where marked `[omitted: …]`.

## What was asked for, and where it is

| Asked for | Where                                                                                    | What it is                                                                                                                                                                                                                                                        |
| --------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plans     | [plans/](plans/)                                                                         | The 7 plans Claude wrote in plan mode, one per step (the last step had none). I approved each one as proposed; in steps 2 to 7, my answers to Claude's questions shaped them first. Five are in Ukrainian, the language of the sessions.                          |
| Specs     | the Context section of each plan, and [decisions.md](decisions.md)                       | Each step started from a prompt with the requirements for that step; the Context section of its plan restates them. The 20 questions Claude asked before planning, with the options and my answers, are in decisions.md. The prompts themselves are not included. |
| Todo list | [todo.md](todo.md)                                                                       | There was no todo file and no todo tool: the README's roadmap, ticked off commit by commit, and the ordered steps in each plan.                                                                                                                                   |
| Skills    | [Skills, rules and hooks](#skills-rules-and-hooks), [memory/](memory/), [hooks/](hooks/) | No custom skills, slash commands, agents or CLAUDE.md. Claude used the built-in `claude-api` skill, kept the project's rules in its memory, and ran with two hooks of mine.                                                                                       |

## How the work went

The project was built in 8 steps in Claude Code (the desktop app). A step went like this:

1. A prompt with the requirements for the step and how far it should go, with the link to the design from step 2 on.
2. Plan mode: Claude read the code, itself or with exploring agents; asked about the decisions it should not make alone ([decisions.md](decisions.md)); in some steps had agents check and critique its draft; and proposed a plan.
3. I approved the plan ([plans/](plans/)).
4. Claude implemented it (in steps 3 and 4 partly with agents working in parallel on separate files), ran lint, the type checks and the tests, and walked through the flow in the app's built-in browser, at desktop and phone sizes.
5. Agents reviewed the work: the change in steps 3, 4 and 8, the whole project in steps 6 and 7. In the review workflows, a skeptical verifier tried to refute each finding. The confirmed findings were fixed.
6. Claude opened the pull request; I reviewed and merged it.

Claude wrote the code, the tests, the documentation, the commit messages and the pull request descriptions. Apart from the merges, the only commits without its `Co-Authored-By` trailer are two one-line ones of mine: `65f7cc4` ("first commit") and `fe001bd` ("fix model").

| Step                                                                                  | Merged     | Model      | Plan                                         | Questions                                                                  | Workflows (agents) | Single agents    | Pull request                                                                                                 |
| ------------------------------------------------------------------------------------- | ---------- | ---------- | -------------------------------------------- | -------------------------------------------------------------------------- | ------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------ |
| 1. Foundation: monorepo, API and web shells, database schema, Docker Compose          | 2026-10-02 | Opus 5.5   | [01](plans/01-foundation.md)                 |                                                                            |                    | Plan             | [#1](https://github.com/maxduma/ai_cv_builder/pull/1)                                                        |
| 2. My CVs rebuilt on the design; the create-CV flow with a mock generator             | 2026-10-02 | Opus 5.5   | [02](plans/02-redesign-and-create-flow.md)   | [1–4](decisions.md#step-2-redesign-and-the-create-cv-flow)                 |                    | Explore ×2, Plan | [#2](https://github.com/maxduma/ai_cv_builder/pull/2)                                                        |
| 3. Authentication; CV generation with Claude                                          | 2026-10-02 | Opus 5.5   | [03](plans/03-auth-and-claude-generation.md) | [5–8](decisions.md#step-3-authentication-and-generation-with-claude)       | 1–5 (26)           |                  | [#3](https://github.com/maxduma/ai_cv_builder/pull/3)                                                        |
| 4. The CV editor and the AI's questions                                               | 2026-10-03 | Opus 5.5   | [04](plans/04-editor-and-ai-questions.md)    | [9–12](decisions.md#step-4-the-editor-and-the-ais-questions)               | 6–10 (24)          |                  | [#4](https://github.com/maxduma/ai_cv_builder/pull/4)                                                        |
| 5. PDF export                                                                         | 2026-10-03 | Opus 5.5   | [05](plans/05-pdf-export.md)                 | [13](decisions.md#step-5-pdf-export)                                       |                    | Explore ×2, Plan | [#5](https://github.com/maxduma/ai_cv_builder/pull/5)                                                        |
| 6. Final review: reliability fixes, tests on PostgreSQL, README                       | 2026-10-03 | Opus 5.5   | [06](plans/06-final-review.md)               | [14–16](decisions.md#step-6-final-review)                                  | 11–13 (18)         |                  | [#6](https://github.com/maxduma/ai_cv_builder/pull/6)                                                        |
| 7. Audit against the assignment; final polish                                         | 2026-10-03 | Sonnet 5.5 | [07](plans/07-final-polish.md)               | [17–20](decisions.md#step-7-audit-against-the-assignment-and-final-polish) | 14 (47)            |                  | [#7](https://github.com/maxduma/ai_cv_builder/pull/7)                                                        |
| 8. Rename and delete CVs, a one-line `.env`, a short README; then fixes from a review | 2026-10-03 | Sonnet 5.5 |                                              |                                                                            |                    | general-purpose  | [#8](https://github.com/maxduma/ai_cv_builder/pull/8), [#9](https://github.com/maxduma/ai_cv_builder/pull/9) |

The model is the one that did the step's work; a few turns ran on the other one. For example, the turn that committed step 2 ran on Sonnet 5.5, which is why that commit's `Co-Authored-By` trailer names Sonnet.

## Workflows

Claude Code's Workflow tool runs a script that starts many agents and collects what they return. 14 workflows ran, with 115 agents in all. Their scripts are prompts for those agents and are not included; this is what each one did.

| #   | Step | What it did                                                                                                                                                  | Agents | Model      | Result                                                                                                                                 |
| --- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 3    | Read the API, the generation pipeline, the web app and the auth design before planning                                                                       | 4      | Opus 5.5   | 4 reports for the plan                                                                                                                 |
| 2   | 3    | Checked the draft plan against the code, then critiqued it: requirements, security, use of the Anthropic SDK                                                 | 2      | Opus 5.5   | a check and a critique of the plan                                                                                                     |
| 3   | 3    | Implemented authentication: the API and the web UI in parallel, on separate files                                                                            | 2      | Opus 5.5   | the code and its tests                                                                                                                 |
| 4   | 3    | Reviewed the authentication change from 4 angles; a verifier checked each finding                                                                            | 16     | Opus 5.5   | 12 findings: 10 confirmed (1 medium, 9 low), 2 rejected                                                                                |
| 5   | 3    | Implemented generation with Claude: the Claude integration and the job pipeline in parallel                                                                  | 2      | Opus 5.5   | the code and its tests                                                                                                                 |
| 6   | 4    | Mapped the editor and Clarify designs and the current code before planning                                                                                   | 5      | Opus 5.5   | 5 reports for the plan                                                                                                                 |
| 7   | 4    | Critiqued the editor plan from 4 angles before implementation                                                                                                | 4      | Opus 5.5   | a critique from each angle                                                                                                             |
| 8   | 4    | Wrote the new API tests: saving content, the questions, the answer jobs                                                                                      | 4      | Opus 5.5   | the test files                                                                                                                         |
| 9   | 4    | Built the editor's sections, the live A4 preview and the Clarify page, on separate files                                                                     | 3      | Opus 5.5   | the code                                                                                                                               |
| 10  | 4    | Reviewed the editor change from 4 angles, each followed by a verifier                                                                                        | 8      | Opus 5.5   | 20 findings, all confirmed (7 medium, 13 low)                                                                                          |
| 11  | 6    | Reviewed the whole project by area for reliability, correctness and code quality                                                                             | 8      | Opus 5.5   | 66 findings and 54 gaps in the tests                                                                                                   |
| 12  | 6    | Verified the 66 findings by area, trying to refute each one                                                                                                  | 7      | Opus 5.5   | 53 verdicts: 29 confirmed, 24 partly; 42 to fix, 7 to document, 4 to skip                                                              |
| 13  | 6    | Three critics checked the review plan for completeness, feasibility and scope                                                                                | 3      | Opus 5.5   | 41 issues raised against the plan                                                                                                      |
| 14  | 7    | Audited the project against the assignment, requirement by requirement: 14 auditors by area, duplicates merged, 2 skeptics for each medium or higher finding | 47     | Sonnet 5.5 | 260 requirement checks; 98 findings, 59 after merging; 16 verified (8 confirmed, 8 partly), 43 minor ones left unverified; no blockers |

Besides the workflows, 8 single agents ran in plan mode or in review (their prompts are not included either):

| Step | Agent           | What for                                                         |
| ---- | --------------- | ---------------------------------------------------------------- |
| 1    | Plan            | Critique the foundation plan before it was proposed              |
| 2    | Explore ×2      | Read the web app, and the API with the shared package            |
| 2    | Plan            | Design the implementation plan                                   |
| 5    | Explore ×2      | Read the API and the web editor before the PDF export            |
| 5    | Plan            | Design the PDF export                                            |
| 8    | general-purpose | Review PR #8 independently, read-only; its findings became PR #9 |

## Skills, rules and hooks

- **Skills.** No custom skills, slash commands, agents or CLAUDE.md were written for this project. The built-in `claude-api` skill, Anthropic's reference for its SDK, models and structured output, was loaded twice in the sessions (steps 1 and 3) and 7 times by agents.
- **Rules.** Claude Code keeps notes between sessions and loads them into each new one. For this project they were its working rules, kept verbatim in [memory/](memory/):
  - [scope-discipline](memory/scope-discipline.md): build only what the current step asks for;
  - [design-source-of-truth](memory/design-source-of-truth.md): the design canvas is the source of truth for the UI;
  - [user-language](memory/user-language.md): answer in Ukrainian, keep the app's UI in English;
  - [minimal-config](memory/minimal-config.md): `.env` holds only the API key, everything else is a constant in the code;
  - [test-env-throttling](memory/test-env-throttling.md): how this machine slows down background runs, so tests run in the foreground.

  A sixth note, about the state of the submission itself, is left out.

- **Hooks.** Two hooks from my own Claude Code setup, written before this project, were active. [branch-status.sh](hooks/branch-status.sh) reminds Claude, before each prompt, when the current branch's pull request is already merged; [check-merged-pr.sh](hooks/check-merged-pr.sh) blocks a `git commit` on such a branch. The reminder fired in steps 2 to 8; the blocker never had to. They are wired in `~/.claude/settings.json`:

  ```json
  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "Bash",
          "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/check-merged-pr.sh" }]
        }
      ],
      "UserPromptSubmit": [
        { "hooks": [{ "type": "command", "command": "$HOME/.claude/hooks/branch-status.sh" }] }
      ]
    }
  }
  ```

- **Other tools.** Plan mode; the Explore, Plan and general-purpose agents; the Workflow tool; the desktop app's built-in browser, to walk through the app; the Artifact tool, to read the design canvas; and the app's "Create PR" with Auto-fix, which watches the pull request's CI.

## Design

The screens were designed first, on Claude's design canvas at claude.ai: [AI CV Builder · Product design](https://claude.ai/artifact/3MdEScRphtNH8YfdzCVtYL). It has desktop and mobile artboards for every screen with its states (My CVs, Create a CV and generating, sign-in and sign-up, the editor, Clarify for the AI's questions, Preview & PDF, the CV page), plus the design system, a library of empty, loading and error states, and motion. Claude Code read the artboards with its Artifact tool and ported their CSS.

## What was edited

- Each plan starts with a one-line note (step, date, pull request) above a rule; below the rule is the plan as it was approved.
- In plan 7, one sentence of personal notes for the interview is replaced with `[omitted: …]`.
- [memory/](memory/) has five of the six notes, unchanged, metadata included.
- In [decisions.md](decisions.md), the questions, options and answers are verbatim; the headings, the layout and the English translations were added.

## Not included

- The conversation transcripts (75 MB of local JSON for the 5 sessions, 176 MB with the agents' own: system prompts, tool output, screenshots, local environment details), and the prompts in them: the prompt for each step and the prompts Claude wrote for its agents.
- The text of the assignment, which is the company's document.
- The text of the built-in skills, which is Anthropic's.

The prompts the app itself sends to Claude belong to the product, not to the tools that built it: [prompt.ts](../../apps/api/src/modules/generation/claude/prompt.ts) and [answer-prompt.ts](../../apps/api/src/modules/generation/claude/answer-prompt.ts).
