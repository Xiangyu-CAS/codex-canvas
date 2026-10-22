---
name: canvas-quick-edit
description: "Run a user-described Quick Edit on a selected Codex-Canvas image and collect the result back onto the canvas."
---

# Codex-Canvas Quick Edit

Use this skill when the user invokes Quick Edit from Codex-Canvas or asks to perform an open-ended edit on a selected canvas image.

## Behavior

1. Treat the selected canvas image as the edit target.
2. Quick Edit may provide one clean source image or two images. When two are attached, image 1 is the clean source and image 2 is an annotation board containing temporary arrows, masks, and edit notes around the source.
3. Always use the clean source as the visual base. Use the annotation board only to locate regions and interpret the edit intent; do not preserve its surrounding board background or annotation UI.
4. Use the user's optional Quick Edit text together with every arrow label, pencil mask, text note, color, and source-pixel location listed in the prompt. Arrow labels are explicit instructions for their arrow targets.
5. Apply the requested edit according to the annotations, then remove all temporary arrows, strokes, boxes, label bubbles, and note text from the final image.
6. Preserve the source image's aspect ratio, subject identity, layout, unmentioned visible text, and design intent unless an instruction explicitly asks to change them.
7. If the source is a transparent layer, preserve native alpha, fine edges, partial opacity, and all subject colors. Inspect the actual imagegen schema and set `transparent_background: true` only when that boolean argument is exposed. Never guess a `transparent` parameter or paint a checkerboard. If unsupported, report the limitation. Only an explicitly configured `CODEX_CANVAS_TRANSPARENCY_MODE=chroma-key` job may use a uniform #ff00ff background; stop if the key conflicts with the subject instead of recoloring it.
8. Generate exactly one revised clean bitmap. Save the final selected output as a PNG under the job output directory provided by Codex-Canvas.
9. Codex-Canvas will collect the output, verify real alpha and preserve native pixels (keying only in explicit compatibility mode), and replace the running placeholder to the right of the source image. It will preserve the original image and its annotation objects.

Do not ask follow-up questions from a background Quick Edit job. Make the most reasonable edit from the provided instruction.
