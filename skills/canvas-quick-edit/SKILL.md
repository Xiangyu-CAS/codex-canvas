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
7. If the source image is a transparent layer, render the edited layer on a flat solid #ff00ff chroma-key background so Codex-Canvas can recut the alpha channel after generation.
8. Generate exactly one revised clean bitmap. Save the final selected output as a PNG under the job output directory provided by Codex-Canvas.
9. Codex-Canvas will collect the output, remove the chroma-key background when needed, and replace the running placeholder to the right of the source image. It will preserve the original image and its annotation objects.

Do not ask follow-up questions from a background Quick Edit job. Make the most reasonable edit from the provided instruction.
