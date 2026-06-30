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
   - Pass the current Codex thread id as `threadId` whenever it is available; Agent-Canvas uses this explicit binding for canvas-to-chat image sends and to keep one canvas per Codex thread.
   - When falling back to the CLI, `agent-canvas open` will also read `CODEX_THREAD_ID` or `AGENT_CANVAS_CODEX_THREAD_ID` from the environment. If neither is available, the canvas is the shared project default, not a per-thread canvas.
   - If the MCP tool is not available, run `node <plugin-root>/bin/agent-canvas.mjs open --project <workspace>`.
2. Fast open behavior:
   - Prefer reusing the existing runtime URL in `<workspace>/canvas/.agent-canvas-runtime.json` when it responds.
   - Prefer `agent-canvas open --project <workspace>` over `agent-canvas start`; `open` already reuses the saved runtime or starts a detached server only when needed.
   - If the Codex in-app browser already has a tab on that exact Agent-Canvas URL, reuse it and make it visible. Do not open a duplicate tab or reload the page unless the user asks.
   - Do not repeat Browser plugin bootstrap/path discovery when a browser tab is already connected and usable in this turn; reuse the existing tab binding.
3. Open the returned URL in the Codex in-app browser when Browser is available.
4. When the user asks for image generation or image editing while this skill is active:
   - Use Codex `imagegen` for the image work.
   - Save or identify the generated image file path. Prefer saving generated images under the active workspace so Agent-Canvas auto-collection can find them.
   - Immediately add the result to the canvas with `agent-canvas.add_image`, or by running:
     `node <plugin-root>/bin/agent-canvas.mjs import <image-path> --project <workspace>`.
   - If the exact output path is unclear, call `agent-canvas.collect_recent_images` with the active workspace, or run:
     `node <plugin-root>/bin/agent-canvas.mjs collect --project <workspace> --since-minutes 30 --limit 5`.
   - The collector scans both the active workspace and Codex's default generated image directory at `~/.codex/generated_images`.
   - Session-generated images are placed in a vertical column by generation batch. Multiple images from the same generation batch are aligned in one horizontal row.
   - Canvas-derived images, when collected with a `sourceObjectId`, are placed in a horizontal row to the right of the source image.
5. `Quick Edit`, `Remove BG`, `Expand`, `Edit Text`, `Edit Elements`, `Upscale`, `Multi-Angles`, and `Move Object` are implemented as background Agent-Canvas jobs. They create a canvas placeholder immediately, run Codex/ImageGen through the matching Agent-Canvas operation skill and bundled Codex App CLI, then replace the placeholder with the collected output.
6. `Edit Text` is a two-step interaction: first run text recognition and show the formatted editable text list in the canvas UI; after the user changes one or more fields and clicks Run, call imagegen to produce the edited PNG.
   - Text recognition should try local RapidOCR first when available. If local OCR is unavailable, fails, or returns no text, fall back to Codex vision recognition.
7. `Edit Elements` asks ImageGen for a low-detail instance segmentation map, then Agent-Canvas locally splits the source image into four-channel transparent PNG object/text layers plus a residual background. Agent-Canvas then runs a background-completion pass from the original image plus residual background, imports only the completed background and transparent object/text layers, and stacks them to the right of the source image so they reconstruct the original composition. Intermediate segmentation and raw completion images stay internal to the job and are not added to the canvas.
8. Canvas-to-chat requires a bound Codex thread. Each bound thread uses a separate canvas scope under `canvas/threads/<canvasId>/`. The frontend sends a stable `send-to-chat` action to the backend; the backend refuses to send unless the project runtime has `chatThreadId`, then sends the selected local image to that thread with Codex app-server `thread/resume` + `turn/start` and a `localImage` input. Do not use desktop UI automation or clipboard paste as a fallback.

## Notes

- Canvas data is stored under `<workspace>/canvas/`.
- The visible canvas runs as a local web service and is intended to be opened in Codex `in-app browser`.
- The first milestone should preserve generated images as project assets, not only as chat attachments.
