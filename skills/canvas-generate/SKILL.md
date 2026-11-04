---
name: canvas-generate
description: Generate one Codex-Canvas image from ordered reference images and a user prompt using the reference-generate action. Use for node composition and continued visual iteration.
---

# Reference generation

The attached images are ordered visual references, not annotation boards. Interpret “reference 1”, “reference 2”, and so on in attachment order. Combine their subjects, style, or composition according to the user prompt; preserve referenced identities and requested details. Do not reproduce canvas controls or connector lines.

Use the available imagegen tool with all supplied references. Produce exactly one image at the requested aspect ratio; “original” means the first reference's ratio. Do not substitute a different ratio silently when the generator cannot support it. Report the limitation if necessary.

Save the final bitmap as a PNG in the job output directory. Preserve the source files. The canvas backend collects the result to the right of the source nodes and records its references. Multiple requested results are separate jobs, so do not create extra variants in one job. Do not ask follow-up questions in this background job.
