---
name: canvas
description: "Open and use Codex-Canvas, a project-local infinite canvas for Codex image generation. Use when the user says /canvas, asks to open the canvas, or wants generated images collected on a visual board."
---

# Codex-Canvas

Use this skill to open the local Codex-Canvas board and keep generated images collected in the active project.

## Workflow

1. Open the native plugin sidebar with the `codex-canvas.open_canvas` MCP tool. Discover the installed tool if it is deferred, then pass the active workspace's absolute `projectDir` and the current Codex `threadId` whenever available.
   - `open_canvas` defaults to `presentation: "sidebar"`. The tool result opens the MCP App directly beside the chat; no browser tab, localhost URL, HTTP port, or desktop UI automation is needed.
   - The conversation's plugin panel entrypoint can also open the UI. If it has no project binding yet, its button asks the chat to call `open_canvas` with the active workspace and thread.
   - Opening never installs an update. Canvas state and images stay under the workspace's `canvas/` directory, with separate scopes for bound threads.
   - Repeat calls reuse the panel in the same chat. Do not open a browser after a successful sidebar call.
2. Keep the workspace and thread explicit for subsequent imports and operations. Without a thread binding, use the shared project default; never guess another chat's binding.
3. Browser compatibility fallback: only when the host lacks MCP App support, the plugin MCP tool is unavailable, or the user explicitly asks for a browser, run `node <plugin-root>/bin/codex-canvas.mjs open --project <workspace> --thread-id <thread-id>` (omit thread when unavailable), or call `open_canvas` with `presentation: "browser"`.
   - Reuse an existing exact-URL Codex in-app browser tab, or open the returned URL in the in-app browser.
   - If browser control is unavailable, return `[Open Codex-Canvas](<url>)` and report the limitation. Do not launch the OS default browser or use desktop UI automation.
4. When the user asks for image generation or image editing while this skill is active:
   - Use Codex `imagegen` for the image work.
   - Save or identify the generated image file path and keep the current Codex thread id attached to the canvas operation.
   - Immediately add the result to the canvas with `codex-canvas.add_image`, or by running:
     `node <plugin-root>/bin/codex-canvas.mjs import <image-path> --project <workspace> --thread-id <thread-id>`.
   - If the exact output path is unclear, call `codex-canvas.collect_recent_images` with the active workspace, or run:
     `node <plugin-root>/bin/codex-canvas.mjs collect --project <workspace> --thread-id <thread-id> --since-minutes 30 --limit 5`.
   - Default collection scans only `~/.codex/generated_images/<thread-id>`. Without a bound thread it is a safe no-op. Use explicit `roots` / `--from` only for a user-requested manual recovery scan.
   - Session-generated images are placed in a vertical column by generation batch. Multiple images from the same generation batch are aligned in one horizontal row.
   - Canvas-derived images, when collected with a `sourceObjectId`, are placed in a horizontal row to the right of the source image.
5. `Quick Edit`, `Remove BG`, `Expand`, `Edit Text`, and `Edit Elements` are implemented as background Codex-Canvas jobs. They create a canvas placeholder immediately, run Codex/ImageGen through the matching Codex-Canvas operation skill and bundled Codex App CLI, then replace the placeholder with the collected output.
6. `Edit Text` is a two-step interaction: first run text recognition and show the formatted editable text list in the canvas UI; after the user changes one or more fields and clicks Run, call imagegen to produce the edited PNG.
   - Text recognition should try local RapidOCR first when available. If local OCR is unavailable, fails, or returns no text, fall back to Codex vision recognition.
7. `Edit Elements` asks ImageGen for a low-detail instance segmentation map, then Codex-Canvas locally splits the source image into four-channel transparent PNG object/text layers plus a residual background. Codex-Canvas immediately imports the residual background and transparent object/text layers, stacks them to the right of the source image so they reconstruct the original composition, and continues a background-completion pass from the original image plus residual background in the background. When completion finishes, Codex-Canvas replaces the existing background layer asset in place and refreshes that layer. Intermediate segmentation and raw completion images stay internal to the job and are not added to the canvas.
8. Canvas-to-chat requires a bound Codex thread. Each bound thread uses a separate canvas scope under `canvas/threads/<canvasId>/`. The frontend `send-to-chat` action sends a `localImage` turn through Codex app-server `thread/resume` + `turn/start`; MCP/HTTP callers may explicitly use `mention-file` for a Codex `@file`-style `mention` turn. The frontend `@file` toolbar button must not directly send a turn; it prepares/copies an `@<absolute-path>` reference for the user to paste into the Codex chat box. Do not use desktop UI automation or clipboard paste as a fallback.

## Notes

- Canvas data is stored under `<workspace>/canvas/`.
- The default UI is a self-contained MCP App in the plugin sidebar. Its state, images, and actions use the app-only MCP transport; the local web service is a compatibility fallback.
- The first milestone should preserve generated images as project assets, not only as chat attachments.
