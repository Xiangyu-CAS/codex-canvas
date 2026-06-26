---
name: canvas-quick-edit
description: "Run a user-described Quick Edit on a selected Agent-Canvas image and collect the result back onto the canvas."
---

# Agent-Canvas Quick Edit

Use this skill when the user invokes Quick Edit from Agent-Canvas or asks to perform an open-ended edit on a selected canvas image.

## Behavior

1. Treat the selected canvas image as the edit target.
2. Use the user's Quick Edit text as the primary edit instruction.
3. Preserve the source image's aspect ratio, subject identity, layout, visible text, and design intent unless the user explicitly asks to change them.
4. Save the final selected output as a PNG under the job output directory provided by Agent-Canvas.
5. Agent-Canvas will collect the output and place it in a row to the right of the source image.

Do not ask follow-up questions from a background Quick Edit job. Make the most reasonable edit from the provided instruction.
