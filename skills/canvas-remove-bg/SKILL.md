---
name: canvas-remove-bg
description: "Remove the background from a selected Codex-Canvas image and collect a transparent PNG result back onto the canvas."
---

# Codex-Canvas Remove BG

Use this skill when the user invokes Remove BG from Codex-Canvas or asks to isolate the foreground subject of a selected canvas image.

## Behavior

1. Treat the selected canvas image as the edit target.
2. Preserve the foreground subject, proportions, visible text, and visual quality.
3. Remove the background only; do not redesign, restyle, crop, or replace the subject.
4. Use imagegen once to place the foreground subject on a perfectly flat solid `#ff00ff` chroma-key background.
5. The chroma-key background must be one uniform color with no shadows, gradients, texture, reflections, floor plane, or lighting variation.
6. Do not use `#ff00ff` anywhere in the subject.
7. Keep crisp foreground edges and enough padding for reliable alpha conversion.
8. Save the generated chroma-key PNG under the Codex-Canvas job output directory.
9. Codex-Canvas will remove the chroma key locally, verify the RGBA alpha PNG, collect it, and place it in a row to the right of the source image.

Do not ask follow-up questions from a background Remove BG job. Make the most reasonable subject isolation from the selected image.
