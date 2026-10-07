---
name: test-env-throttling
description: Background processes from the Claude app can stall ~15 min on this Mac; the hidden browser pane pauses app polling
metadata:
  node_type: memory
  type: project
  originSessionId: 1634cede-2fe4-4505-8c9a-efceb968ab07
  modified: 2026-10-03T11:59:42.131Z
---

On this Mac (M1 Pro), processes the Claude desktop app starts in the background (Bash `run_in_background`, monitors) can stall for ~900 s at a time while the session is idle: a largest-CV render took 896 s at 7.5% CPU, and a watchdog loop in the same tree stalled too. The code is not at fault (25 renders in a row at ~3 s; Docker runs fine). Found 2026-10-03 during the final review (PR #6).

**Why:** this cost a long investigation of a "flaky" React-PDF test (`paginates the largest CV…`) that was really OS throttling.

**How to apply:** run `pnpm test` in the foreground (it takes ~10 s); if a long-running test or render "hangs" for ~15 min with low CPU, suspect throttling before the code. In the in-app browser, a hidden pane makes `document.visibilityState === 'hidden'`, so TanStack Query pauses polling (generation status looks stuck); for testing, override `visibilityState` and dispatch `visibilitychange` with `bubbles: true`.

Browser pane notes (2026-10-03): the in-app browser stays hidden unless the user opens it (`show_pane` can't open it). Hidden, it still works, but screenshots lag one to three seconds behind the page (a menu seems "not open" when it is): `wait` about 3 s before a screenshot, and prefer `find` + `ref` clicks over coordinates when the list can re-sort (My CVs polls while a CV generates). With viewport emulation (375x812) screenshots are 750x1624 and that is the click coordinate frame. To test a failed request, wrap `window.fetch` in `javascript_tool` (reject on a method), then restore `window.__origFetch`. A second Compose project (`docker compose -p cvdev` with `WEB_PORT`/`API_PORT`/`DB_PORT` set and `ANTHROPIC_API_KEY=` empty) gives a free demo-mode stack next to the user's own without touching it; remove it with `down -v` and delete any clone that holds a copy of `.env`.

