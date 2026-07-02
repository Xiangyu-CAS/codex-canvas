---
name: canvas-edit-text
description: "Recognize visible text in a selected Codex-Canvas image, apply a user-described text edit with imagegen, and collect the result back onto the canvas."
---

# Codex-Canvas Edit Text

Use this skill when the user invokes Edit Text from Codex-Canvas or asks to modify visible text inside a selected canvas image.

## Behavior

1. Treat the selected canvas image as the edit target.
2. Before generating, identify the visible text in the image and write a formatted text inventory to the job output directory path supplied by Codex-Canvas.
3. Use the user's Edit Text instruction as the primary edit instruction.
4. Use imagegen once to create the edited image.
5. Preserve non-text content, aspect ratio, composition, colors, perspective, typography style, and design intent.
6. Only change text requested by the edit instruction. Keep unchanged visible text as-is.
7. If the source image is a transparent layer, render the edited layer on a flat solid #ff00ff chroma-key background so Codex-Canvas can recut the alpha channel after generation.
8. Save the final selected output as a PNG under the job output directory provided by Codex-Canvas.
9. Codex-Canvas will collect the output, remove the chroma-key background when needed, and place it in a row to the right of the source image.

Do not ask follow-up questions from a background Edit Text job. Make the most reasonable text edit from the provided instruction.
