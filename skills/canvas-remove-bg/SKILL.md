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
5. Default to native transparent PNG generation. Inspect the actual built-in imagegen schema: if it exposes `transparent_background` (boolean), set `transparent_background: true`. Never guess a `transparent` or `background` tool argument.
6. Preserve all subject colors (including magenta), fine edges, and partial opacity. Do not draw a checkerboard, white background, or colored matte.
7. Save/copy the generated PNG under the job output directory. Codex-Canvas validates decoded alpha pixels, rejects opaque or empty results, and preserves native RGBA PNGs byte-for-byte.
8. If native transparency is unavailable, report the limitation. Do not switch to a paid API or silently key an opaque output.
9. Only when the job explicitly selects compatibility mode (`CODEX_CANVAS_TRANSPARENCY_MODE=chroma-key` on the canvas server), generate on a uniform `#ff00ff` background with generous padding and no shadows or gradients. If magenta subject colors or translucent material conflict with this key, stop instead of recoloring the subject. Codex-Canvas verifies the border before conversion; valid native alpha always bypasses keying even in this mode.
10. The verified transparent result replaces the placeholder in a row to the right of the source image.

Do not ask follow-up questions from a background Remove BG job. Make the most reasonable subject isolation from the selected image.
