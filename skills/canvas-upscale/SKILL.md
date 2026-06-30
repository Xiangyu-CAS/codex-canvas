---
name: canvas-upscale
description: "Upscale and enhance a selected Agent-Canvas image while preserving its content, then collect the result back onto the canvas."
---

# Agent-Canvas Upscale

Use this skill when the user invokes Upscale from Agent-Canvas or asks to increase the resolution, sharpness, or production quality of a selected canvas image.

## Action

- Stable action id: `upscale`.
- The frontend sends only this stable action id plus selected image context and any user-facing enhancement options. It must not embed operation-specific prompts.
- The backend maps `upscale` to this skill and a cross-platform Codex/ImageGen job.

## Edit Intent

Create a higher-resolution, cleaner version of the selected image. Improve clarity, edge definition, texture fidelity, and compression artifacts without redesigning the image.

## Required Inputs

1. The selected canvas image to upscale.
2. The Agent-Canvas job output directory.
3. Optional user guidance, such as desired scale, target use, or quality emphasis.

## Preservation Rules

1. Preserve the source image's aspect ratio, framing, composition, subject identity, pose, visible text, layout, colors, lighting, and design intent.
2. Do not crop, extend, restyle, replace subjects, add new objects, remove objects, or change readable text.
3. Keep logos, UI details, product markings, faces, hands, typography, and line art faithful to the source.
4. Reduce noise and artifacts only when doing so does not erase intentional texture or fine detail.

## Output Requirements

1. Use the highest practical image quality available from the generation surface.
2. Prefer a larger pixel dimension than the source when the image generation surface supports it. If the surface cannot guarantee a larger pixel size, produce the cleanest enhanced PNG at the supported size and preserve the source aspect ratio exactly.
3. Save one final PNG under the Agent-Canvas job output directory.
4. Use a descriptive filename ending in `.png`, such as `upscale-result.png`.

## Canvas Placement

Agent-Canvas will collect the output PNG and place it in the generated-result row to the right of the source image.

Do not ask follow-up questions from a background Upscale job. Make the most reasonable quality-preserving upscale from the selected image and provided options.
