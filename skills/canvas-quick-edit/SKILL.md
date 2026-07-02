---
name: canvas-quick-edit
description: "Run a user-described Quick Edit on a selected Codex-Canvas image and collect the result back onto the canvas."
---

# Codex-Canvas Quick Edit

Use this skill when the user invokes Quick Edit from Codex-Canvas or asks to perform an open-ended edit on a selected canvas image.

## Behavior

1. Treat the selected canvas image as the edit target.
2. Use the user's Quick Edit text as the primary edit instruction.
3. If the attached image contains temporary pencil or text annotations from Codex-Canvas, treat those marks as edit guidance and region references.
4. Apply the requested edit according to the annotations, then remove all temporary annotation strokes, boxes, and label text from the final image.
5. Preserve the source image's aspect ratio, subject identity, layout, visible text, and design intent unless the user explicitly asks to change them.
6. If the source image is a transparent layer, render the edited layer on a flat solid #ff00ff chroma-key background so Codex-Canvas can recut the alpha channel after generation.
7. Save the final selected output as a PNG under the job output directory provided by Codex-Canvas.
8. Codex-Canvas will collect the output, remove the chroma-key background when needed, and place it in a row to the right of the source image.

Do not ask follow-up questions from a background Quick Edit job. Make the most reasonable edit from the provided instruction.
