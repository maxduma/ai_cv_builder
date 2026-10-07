---
name: design-source-of-truth
description: "The UI must match the user's claude.ai Design canvas artifact (CV Builder product design); read artboards from it before building UI"
metadata:
  node_type: memory
  type: reference
  originSessionId: 9df1d837-187c-4762-aed5-fc039866c1b7
  modified: 2026-10-02T16:31:52.899Z
---

UI source of truth: Design canvas artifact https://claude.ai/artifact/3MdEScRphtNH8YfdzCVtYL ("AI CV Builder · Product design"). Content lives in its files `project/*.dc.html` (read with the Artifact tool `read` + `path`, never WebFetch); index in `project/canvas.json`.

Key artboards: `Main.dc.html` (My CVs dashboard, all list states), `Create.dc.html` (Create a CV + generating/failed/done views), `CreateStates.dc.html`, `DesignSystem.dc.html` (tokens: Geist/Geist Mono, accent #4655EB, canvas #F7F7F9), `StateLibrary.dc.html` (empty/loading/error rules), `Motion.dc.html`, `Login`/`SignUp`, `Editor`, `Preview`, `Clarify`, `CvPage` (CV document model).

The first UI was built without the design and the user rejected its look; port the design's CSS faithfully (plain CSS + tokens, no Tailwind — decided 2026-10-02). See [[scope-discipline]] for what to leave out.
