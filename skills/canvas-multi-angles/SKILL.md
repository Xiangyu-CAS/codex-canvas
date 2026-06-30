---
name: canvas-multi-angles
description: "Generate multiple consistent views of a selected Agent-Canvas subject from different angles and collect them back onto the canvas."
---

# Agent-Canvas Multi-Angles

Use this skill when the user invokes Multi-Angles from Agent-Canvas or asks to create alternate views of the same selected subject, product, character, or object.

## Action

- Stable action id: `multi-angles`.
- The frontend sends only this stable action id plus selected image context and any user-facing angle options. It must not embed operation-specific prompts.
- The backend maps `multi-angles` to this skill and a cross-platform Codex/ImageGen job.

## Edit Intent

Generate a small set of images that show the same primary subject from distinct, useful viewing angles while keeping the subject recognizable and production-consistent.

## Required Inputs

1. The selected canvas image containing the source subject.
2. The Agent-Canvas job output directory.
3. Optional user guidance, such as requested angles, number of views, background preference, or product/character emphasis.

## Preservation Rules

1. Preserve the subject's identity, proportions, silhouette, materials, colors, markings, logos, labels, visible text, wear, and distinctive details.
2. Preserve the source art direction and rendering style unless the user explicitly asks for a different style.
3. Do not invent incompatible parts, alternate branding, different text, different clothing, different accessories, or a different character/product.
4. Keep lighting and background treatment consistent across generated views.
5. When the source has a transparent or plain background, keep the generated views on a transparent or similarly plain background when possible.

## Output Requirements

1. Produce multiple PNG outputs under the Agent-Canvas job output directory.
2. Default to four views when the user does not specify a count: front or source-like view, left three-quarter view, side view, and rear or right three-quarter view.
3. If the source image makes a rear view ambiguous, generate the most plausible rear or opposite three-quarter view while preserving visible design language.
4. Keep every output at the same aspect ratio and comparable scale so the views can be scanned together.
5. Use descriptive filenames ending in `.png`, such as `multi-angles-front.png`, `multi-angles-left-3q.png`, `multi-angles-side.png`, and `multi-angles-rear-3q.png`.

## Canvas Placement

Agent-Canvas will collect the output PNGs and place them in a horizontal row to the right of the source image, ordered from the most source-like/front view through the rotated views.

Do not ask follow-up questions from a background Multi-Angles job. Make the most reasonable consistent angle set from the selected image and provided options.
