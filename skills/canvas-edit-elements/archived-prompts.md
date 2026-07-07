# Archived Edit Elements Prompts

These prompts are retained for comparison and debugging only. They are not used by the runtime Edit Elements flow.

## Complex Object-Level Prompt

```text
Task: create a hard-edged low-detail design-layer segmentation map for generic element separation.
Use quality=low if the imagegen surface exposes a quality setting; otherwise make the prompt explicitly low-detail and mask-like.
Call imagegen exactly once. Treat this as an image edit/reference task, not a new unrelated design.
The output must match the source image aspect ratio and approximate the source's element boundaries.
Default layer classes are: independently editable objects, logical text groups, and one single background.
Default to object-level granularity, not part-level granularity.
A complete object must stay one solid color region even if it contains internal texture, print, labels, fruit graphics, UI details, reflections, highlights, droplets, holes, or small attached details.
Only split things that a designer would reasonably move or edit independently on a canvas.
Render each independently editable object or logical text group as a hard-edged flat solid high-contrast color region.
Render the entire background as one flat solid #000000 region. Do not split background panels, brush strokes, gradients, wall/table/floor fills, texture, shadows, or background decorative marks into separate regions.
Use different non-black colors for product objects, badge/card objects, headline groups, logo groups, and foreground props.
Prefer this fixed high-contrast palette for foreground layers, using each color at most once before choosing additional distinct saturated colors: #ff0066, #66ff00, #00ffff, #0066ff, #9933ff, #ff6600, #996633, #ffcc00, #00aa66, #cc33ff.
Never reuse the same or a similar non-black color for unrelated objects or text groups.
No labels, no legends, no readable words, no icons, no gradients, no shadows, no textures, no source artwork, and no antialias-like pictorial detail in the segmentation map.
Represent text areas as one filled text-group silhouette or simple filled block per logical text group. Do not recreate individual readable characters unless the letters themselves are the object boundary needed for editing.
Do not leave important source regions uncolored unless they are empty margin.
```
