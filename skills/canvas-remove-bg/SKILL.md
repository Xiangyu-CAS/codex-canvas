---
name: canvas-remove-bg
description: "Remove the background from a selected Codex-Canvas image and collect a transparent PNG result back onto the canvas."
---

# Codex-Canvas Remove BG

Use this skill when the user invokes Remove BG from Codex-Canvas or asks to isolate the foreground subject of a selected canvas image.

## Behavior

1. Treat the selected canvas image as the edit target.
2. Preserve only the primary foreground subject, proportions, and visual quality.
3. Remove the background only; do not redesign, restyle, crop, or replace the subject.
4. Do not preserve or recreate readable text, captions, labels, logos, watermarks, UI text, or decorative typography. The cutout should contain the subject only, without text.
5. Use imagegen once to place the foreground subject on a perfectly flat solid `#ff00ff` chroma-key background.
6. The chroma-key background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation.
7. Do not use `#ff00ff` anywhere in the subject.
8. Keep crisp foreground edges, no cast shadow, no contact shadow, no reflection, and enough padding for reliable alpha conversion.
9. Save the generated chroma-key PNG under the Codex-Canvas job output directory.
10. Codex-Canvas will remove the chroma key locally using the imagegen chroma-key helper with soft matte and despill, verify the RGBA alpha PNG, collect it, and place it in a row to the right of the source image.

Do not ask follow-up questions from a background Remove BG job. Make the most reasonable subject isolation from the selected image.
