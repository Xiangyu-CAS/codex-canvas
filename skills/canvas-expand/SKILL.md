---
name: canvas-expand
description: "Outpaint a selected Agent-Canvas image beyond its current frame and collect the expanded image back onto the canvas."
---

# Agent-Canvas Expand

Use this skill when the user invokes Expand from Agent-Canvas or asks to extend a selected canvas image beyond its current edges.

## Behavior

1. Treat the selected canvas image as the source image to outpaint.
2. Use the user's Expand text as the primary expansion instruction.
3. Preserve the source subject identity, visible text, composition anchor, perspective, lighting, colors, and design intent.
4. Extend the scene or design outside the current frame. Do not crop, zoom in, replace the main subject, or redesign unrelated content.
5. Keep the original image content visually coherent with the newly generated surrounding area.
6. Use a wider or taller canvas only when the instruction implies that direction; otherwise create a balanced expansion with extra context around all sides.
7. Save the final expanded image as a PNG under the Agent-Canvas job output directory.
8. Agent-Canvas will collect the output and place it in a row to the right of the source image.

Do not ask follow-up questions from a background Expand job. Make the most reasonable outpainted expansion from the provided instruction.
