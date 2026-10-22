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
7. If the source is a transparent layer, preserve native alpha, fine edges, partial opacity, and all subject colors. Inspect the actual imagegen schema and set `transparent_background: true` only when that boolean argument is exposed. Never guess a `transparent` parameter or paint a checkerboard. If unsupported, report the limitation. Only an explicitly configured `CODEX_CANVAS_TRANSPARENCY_MODE=chroma-key` job may use a uniform #ff00ff background; stop if the key conflicts with the subject instead of recoloring it.
8. Save the final selected output as a PNG under the job output directory provided by Codex-Canvas.
9. Codex-Canvas will collect the output, verify real alpha and preserve native pixels (keying only in explicit compatibility mode), and place it in a row to the right of the source image.

Do not ask follow-up questions from a background Edit Text job. Make the most reasonable text edit from the provided instruction.
