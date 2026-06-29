---
name: canvas
description: "Open and use Agent-Canvas, a project-local infinite canvas for Codex image generation. Use when the user says /canvas, asks to open the canvas, or wants generated images collected on a visual board."
---

# Agent-Canvas

Use this skill to open the local Agent-Canvas board and keep generated images collected in the active project.

## Workflow

1. Start or reuse the local canvas server for the active project:
   - Prefer the `agent-canvas.open_canvas` MCP tool when available.
   - Pass the active workspace path as `projectDir`.
   - If the MCP tool is not available, run `node <plugin-root>/bin/agent-canvas.mjs open --project <workspace>`.
2. Open the returned URL in the Codex in-app browser when Browser is available.
3. When the user asks for image generation or image editing while this skill is active:
   - Use Codex `imagegen` for the image work.
   - Save or identify the generated image file path. Prefer saving generated images under the active workspace so Agent-Canvas auto-collection can find them.
   - Immediately add the result to the canvas with `agent-canvas.add_image`, or by running:
     `node <plugin-root>/bin/agent-canvas.mjs import <image-path> --project <workspace>`.
   - If the exact output path is unclear, call `agent-canvas.collect_recent_images` with the active workspace, or run:
     `node <plugin-root>/bin/agent-canvas.mjs collect --project <workspace> --since-minutes 30 --limit 5`.
   - The collector scans both the active workspace and Codex's default generated image directory at `~/.codex/generated_images`.
   - Session-generated images are placed in a vertical column by generation batch. Multiple images from the same generation batch are aligned in one horizontal row.
   - Canvas-derived images, when collected with a `sourceObjectId`, are placed in a horizontal row to the right of the source image.
4. `Quick Edit`, `Remove BG`, and `Edit Text` are implemented as background Agent-Canvas jobs. They create a canvas placeholder immediately, run Codex/ImageGen through the matching Agent-Canvas operation skill and bundled Codex App CLI, then replace the placeholder with the collected output.
5. `Edit Text` is a two-step interaction: first run text recognition and show the formatted editable text list in the canvas UI; after the user changes one or more fields and clicks Run, call imagegen to produce the edited PNG.
   - Text recognition should try local RapidOCR first when available. If local OCR is unavailable, fails, or returns no text, fall back to Codex vision recognition.
6. If the user asks for `Edit Elements`, explain briefly that the control exists but the underlying image operation is intentionally reserved for a later implementation.

## Notes

- Canvas data is stored under `<workspace>/canvas/`.
- The visible canvas runs as a local web service and is intended to be opened in Codex `in-app browser`.
- The first milestone should preserve generated images as project assets, not only as chat attachments.
