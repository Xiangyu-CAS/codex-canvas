---
name: canvas-edit-elements
description: "Generate an instance segmentation map for a selected Codex-Canvas image, split the source into transparent element layers, and collect the layers back onto the canvas."
---

# Codex-Canvas Edit Elements

Use this skill when the user invokes Edit Elements from Codex-Canvas or asks to separate a selected canvas image into editable visual elements.

## Behavior

1. Treat the selected canvas image as the source image to separate.
2. Use imagegen once to create a low-detail instance segmentation map of the source image, not a finished artwork. Use `quality=low` when the imagegen surface exposes a quality setting.
3. The segmentation map must preserve the exact source aspect ratio.
4. Use this exact visual prompt without adding object examples, category examples, palette examples, or case-specific rules: `对这张图进行实例分割，背景用纯洋红色 #ff00ff 表示。每个前景实例使用不同的纯色表示。完整物体作为一个实例，不要拆分物体内部部件。文字按视觉文本块作为独立实例保留。输出平涂分割图，不要渐变、阴影、纹理、图例或说明文字。`
5. Only leave regions uncolored when they are true background or empty margin.
6. Save only the generated segmentation map as a PNG under the Codex-Canvas job output directory.
7. Codex-Canvas will locally normalize near-colors in the segmentation map, treat magenta as a chroma-key background, split same-color disconnected regions when their components are spatially far apart, and merge only spatially related same-color components such as adjacent object pieces or coherent text rows. Sparse same-color fragments that span a large part of the canvas are downgraded into smaller spatial groups instead of becoming one huge layer, and many small same-color decorative fragments can be merged into a single decoration layer. Codex-Canvas also merges contained or visibly attached multi-color parts back into the larger object-level layer, so product interiors and attached details do not become separate layers just because the segmentation map used multiple colors.
8. Codex-Canvas then extracts each non-background object/text group from the source into a four-channel transparent PNG layer. Before extraction, Codex-Canvas trims a narrow boundary band when source pixels match the nearby outside region better than the object interior, which reduces generic segmentation halos without object-specific rules. For block-like or solid regions, it may also flood inward from the outside through connected pixels that still look like nearby outside color, stopping before object interiors; thin text/brush-like regions are shape-gated out of this stronger cleanup. Codex-Canvas then applies a small foreground mask safety band so slightly underfilled segmentation edges remain with the editable object instead of being stranded in the residual background. The safety band is constrained by local source-image color continuity from the original mask boundary, and pixels not claimed by the original segmentation may be shared by adjacent objects so dragged-out elements keep complete edges without case-specific object rules.
9. All remaining pixels first become a transparent residual background layer. Codex-Canvas imports that residual background immediately with the transparent object/text layers, then sends the original image plus that residual background layer through a background-completion imagegen pass to create a full-frame background with removed objects filled in.
10. The segmentation map and background-completion raw output are internal job artifacts and should not appear as canvas objects. The only canvas background object is the imported residual background layer; when completion finishes, Codex-Canvas replaces that same layer asset in place.
11. Collected layers are stacked at their original relative positions, with the background as the bottom layer, so the group reconstructs the source composition when layered before and after background completion.
12. Collected layers keep shared `layerGroupId` metadata for reset, layer-order controls, and PSD export, but they should start unlocked so the user can immediately drag individual elements. The canvas may offer a separate Group control when the user wants to move all associated layers as one unit.
13. When a user downloads any member of an Edit Elements layer group, Codex-Canvas should export the whole associated layer set as a PSD with one Photoshop layer per canvas image layer.

Do not ask follow-up questions from a background Edit Elements job. Make the most reasonable general-purpose element separation from the selected image.
