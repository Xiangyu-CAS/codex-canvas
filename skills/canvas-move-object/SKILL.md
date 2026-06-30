---
name: canvas-move-object
description: "Move a specified object within a selected Agent-Canvas image, repair the revealed background, and collect the edited result back onto the canvas."
---

# Agent-Canvas Move Object

Use this skill when the user invokes Move Object from Agent-Canvas or asks to reposition an object inside a selected canvas image.

## Action

- Stable action id: `move-object`.
- The frontend sends only this stable action id plus selected image context and user-facing move parameters. It must not embed operation-specific prompts.
- The backend maps `move-object` to this skill and a cross-platform Codex/ImageGen job.

## Edit Intent

Reposition the requested object in the selected image, preserve the rest of the composition, and plausibly fill the object's original location.

## Required Inputs

1. The selected canvas image to edit.
2. The Agent-Canvas job output directory.
3. A move instruction or structured move parameters identifying the object and target placement, such as direction, destination region, offset, or desired alignment.
4. Optional constraints, such as whether to keep scale, rotation, shadow, or depth relationship unchanged.

## Preservation Rules

1. Move only the requested object. Preserve all unrelated subjects, background details, visible text, layout, colors, lighting, perspective, and design intent.
2. Preserve the moved object's identity, proportions, scale, orientation, texture, markings, labels, and visible text unless the user explicitly requests a change.
3. Repair the object's original location with plausible background completion that matches the surrounding scene.
4. Update contact shadows, reflections, occlusion, and depth cues at the new location so the moved object belongs in the image.
5. Do not crop, outpaint, redesign, remove unrelated elements, or add new objects.
6. If the requested target would place the object partly outside the frame, keep it fully visible unless the user explicitly asks for partial cropping.

## Output Requirements

1. Save one final edited PNG under the Agent-Canvas job output directory.
2. Preserve the source image aspect ratio and canvas dimensions when possible.
3. Use a descriptive filename ending in `.png`, such as `move-object-result.png`.

## Canvas Placement

Agent-Canvas will collect the output PNG and place it in the generated-result row to the right of the source image.

Do not ask follow-up questions from a background Move Object job. Make the most reasonable object move from the selected image and provided move parameters.
