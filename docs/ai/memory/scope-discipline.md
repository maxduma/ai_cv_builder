---
name: scope-discipline
description: "User wants features built strictly to the prompt's listed scope, step by step; unlisted design parts wait for later prompts"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 9df1d837-187c-4762-aed5-fc039866c1b7
  modified: 2026-10-02T16:31:47.817Z
---

Build only what the current prompt explicitly lists; the user adds the rest in later, separate steps ("Не будуй зайвого… потім добудуємо інше", "будемо робити все крок за кроком").

**Why:** the user is building the AI CV builder incrementally and reviews each step; extra screens or features (even ones present in the design) are unwanted until asked for.

**How to apply:** when the design ([[design-source-of-truth]]) shows more than the prompt asks for (menus, delete dialogs, editor, auth screens), leave those out and say so; when a choice changes scope, ask first. Don't render non-functional placeholders for deferred features.
