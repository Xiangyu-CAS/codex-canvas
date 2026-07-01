---
name: canvas-edit-elements
description: "Generate an instance segmentation map for a selected Codex-Canvas image, split the source into transparent element layers, and collect the layers back onto the canvas."
---

# Codex-Canvas Edit Elements

Use this skill when the user invokes Edit Elements from Codex-Canvas or asks to separate a selected canvas image into editable visual elements.

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
11. Save only the generated segmentation map as a PNG under the Codex-Canvas job output directory.
12. Codex-Canvas will locally normalize near-colors in the segmentation map, split same-color disconnected regions when their components are spatially far apart, then extract each non-black object/text group from the source into a four-channel transparent PNG layer. Before extraction, Codex-Canvas trims a narrow boundary band when source pixels match the nearby outside region better than the object interior, which reduces generic segmentation halos without object-specific rules. For block-like or solid regions, it may also flood inward from the outside through connected pixels that still look like nearby outside color, stopping before object interiors; thin text/brush-like regions are shape-gated out of this stronger cleanup. Codex-Canvas then applies a small foreground mask safety band so slightly underfilled segmentation edges remain with the editable object instead of being stranded in the residual background. The safety band is constrained by local source-image color continuity from the original mask boundary, and pixels not claimed by the original segmentation may be shared by adjacent objects so dragged-out elements keep complete edges without case-specific object rules.
13. All remaining pixels first become a transparent residual background layer. Codex-Canvas imports that residual background immediately with the transparent object/text layers, then sends the original image plus that residual background layer through a background-completion imagegen pass to create a full-frame background with removed objects filled in.
14. The segmentation map and background-completion raw output are internal job artifacts and should not appear as canvas objects. The only canvas background object is the imported residual background layer; when completion finishes, Codex-Canvas replaces that same layer asset in place.
15. Collected layers are stacked at their original relative positions, with the background as the bottom layer, so the group reconstructs the source composition when layered before and after background completion.
16. Collected layers keep shared `layerGroupId` metadata for reset, layer-order controls, and PSD export, but they should start unlocked so the user can immediately drag individual elements. The canvas may offer a separate Group control when the user wants to move all associated layers as one unit.
17. When a user downloads any member of an Edit Elements layer group, Codex-Canvas should export the whole associated layer set as a PSD with one Photoshop layer per canvas image layer.

Do not ask follow-up questions from a background Edit Elements job. Make the most reasonable general-purpose element separation from the selected image.
