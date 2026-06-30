---
name: canvas-edit-elements
description: "Generate an instance segmentation map for a selected Agent-Canvas image, split the source into transparent element layers, and collect the layers back onto the canvas."
---

# Agent-Canvas Edit Elements

Use this skill when the user invokes Edit Elements from Agent-Canvas or asks to separate a selected canvas image into editable visual elements.

## Behavior

1. Treat the selected canvas image as the source image to separate.
2. Use imagegen once to create a low-detail instance segmentation map of the source image. Use `quality=low` when the imagegen surface exposes a quality setting; otherwise keep the prompt explicitly low-detail and mask-like.
3. The segmentation map must preserve the exact source aspect ratio and approximate object boundaries.
4. Segment into three default layer classes: objects, text groups, and one background layer.
5. Segment at object-level granularity by default. A complete object should remain one region even when it contains texture, print, reflections, droplets, app UI, fruit graphics, or other internal details.
6. Represent each independently editable object or logical text group as a hard-edged, flat, solid, high-contrast color region.
7. Treat the whole background as one background class. Do not split background panels, brush strokes, gradients, shadows, textures, floor/table/wall fills, or decorative background marks into separate layers unless they are clearly foreground objects.
8. In the segmentation map, render all background pixels as one flat solid black region (`#000000`) and never use black for objects or text groups.
9. Use a different non-black color for each movable object or logical text group, such as a product object, badge/card, headline group, logo group, or foreground prop. Prefer a fixed high-contrast palette and never reuse the same or similar color for unrelated objects. Do not include labels, legends, shadows, gradients, textures, antialias-like detail, readable text, or visible source artwork in the segmentation map.
10. Text areas should become one filled text-group silhouette or simple filled block per logical text group. Do not recreate readable characters in the segmentation map unless the letters themselves are the object boundary needed for editing.
11. Save only the generated segmentation map as a PNG under the Agent-Canvas job output directory.
12. Agent-Canvas will locally normalize near-colors in the segmentation map, then extract each non-black color group directly from the source into a four-channel transparent PNG layer. It should not semantically regroup objects beyond the mask colors, but it will split same-color disconnected regions into separate layers when their components are spatially far apart.
13. All remaining pixels first become a transparent residual background layer. Agent-Canvas then sends the original image plus that residual background layer through a background-completion imagegen pass to create a full-frame background with removed objects filled in.
14. Only the final completed background layer and transparent object/text layers should be collected back onto the canvas. The intermediate segmentation map and background-completion raw output are internal job artifacts and should not appear as canvas objects.
15. Collected layers are stacked at their original relative positions, with the completed background as the bottom layer, so the group reconstructs the source composition when layered.

Do not ask follow-up questions from a background Edit Elements job. Make the most reasonable general-purpose element separation from the selected image.
