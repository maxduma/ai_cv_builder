---
name: minimal-config
description: "User wants .env and .env.example minimal (secrets only, no comment walls); tunables live as constants above the code"
metadata:
  node_type: memory
  type: feedback
  originSessionId: b74eba42-3581-44b3-be23-572ee3602677
  modified: 2026-10-03T15:40:18.515Z
---

Keep configuration files small: `.env` / `.env.example` hold only what is secret or machine-specific (here just `ANTHROPIC_API_KEY=`), with no explanatory comments. Anything tunable (model, deadlines, mock pace, log level) is a constant above the component that uses it, with the explanation as a comment there. The user said the old `.env.example` had "too much" and too many comments and asked to "hardcode" the rest.

**Why:** a reviewer opening the repo should see a one-line env file; extra optional variables read as noise (2026-10-03, final polish of the take-home).

**How to apply:** don't add new env variables for tunables; put a named constant next to the code and document it in `docs/development.md` ("Configuration"). Never print `.env` values: to edit the user's real `.env`, keep the key line with `grep '^ANTHROPIC_API_KEY=' .env > .env.tmp && mv .env.tmp .env` and inspect only variable names (`cut -d= -f1`). See [[take-home-submission-state]].
