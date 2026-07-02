---
name: canvas
description: "Open and use Codex-Canvas, a project-local infinite canvas for Codex image generation. Use when the user says /canvas, asks to open the canvas, or wants generated images collected on a visual board."
---

# Codex-Canvas

Use this skill to open the local Codex-Canvas board and keep generated images collected in the active project.

## Workflow

1. Start or reuse the local canvas server for the active project:
   - Use the CLI opener as the default path: `node <plugin-root>/bin/codex-canvas.mjs open --project <workspace>`.
   - Pass the current Codex thread id with `--thread-id <thread-id>` whenever it is available; Codex-Canvas uses this explicit binding for canvas-to-chat image sends and to keep one canvas per Codex thread.
   - Leave `autoUpdate` enabled unless the user explicitly asks to skip updates; active opens run Codex-Canvas's best-effort fast-forward updater before returning the canvas URL.
   - `codex-canvas open` will also read `CODEX_THREAD_ID` or `CODEX_CANVAS_CODEX_THREAD_ID` from the environment. If neither an explicit thread id nor an environment thread id is available, the canvas is the shared project default, not a per-thread canvas.
   - If the `codex-canvas.open_canvas` MCP tool is already exposed in the thread, it is also acceptable to use it with `projectDir` and `threadId`, but do not probe for it or announce anything about MCP availability. Treat CLI opening as the normal supported behavior.
2. Fast open behavior:
   - Prefer reusing the existing runtime URL in `<workspace>/canvas/.codex-canvas-runtime.json` when it responds.
   - Prefer `codex-canvas open --project <workspace>` over `codex-canvas start`; `open` already reuses the saved runtime or starts a detached server only when needed.
   - If the Codex in-app browser already has a tab on that exact Codex-Canvas URL, reuse it and make it visible. Do not open a duplicate tab or reload the page unless the user asks.
   - Do not repeat Browser plugin bootstrap/path discovery when a browser tab is already connected and usable in this turn; reuse the existing tab binding.
3. Open the returned URL directly in the Codex in-app browser.
   - Use the Browser plugin / in-app browser control surface for this step. The intended result is that the canvas appears inside Codex, next to the chat.
   - Do not open the URL with the operating system default browser. Do not use `open`, `xdg-open`, `start`, PowerShell `Start-Process`, AppleScript, clipboard paste, coordinate clicking, or any desktop UI automation as a fallback.
   - Do not rely on the user clicking a printed URL; that commonly opens Chrome or the system default browser instead of Codex's in-app browser.
   - If the Browser plugin / in-app browser control surface is unavailable in the current Codex surface, return the URL and state that Codex-Canvas is running but the in-app browser could not be opened from this surface. Do not launch an external browser.
4. When the user asks for image generation or image editing while this skill is active:
   - Use Codex `imagegen` for the image work.
   - Save or identify the generated image file path. Prefer saving generated images under the active workspace so Codex-Canvas auto-collection can find them.
   - Immediately add the result to the canvas with `codex-canvas.add_image`, or by running:
     `node <plugin-root>/bin/codex-canvas.mjs import <image-path> --project <workspace>`.
   - If the exact output path is unclear, call `codex-canvas.collect_recent_images` with the active workspace, or run:
     `node <plugin-root>/bin/codex-canvas.mjs collect --project <workspace> --since-minutes 30 --limit 5`.
   - The collector scans both the active workspace and Codex's default generated image directory at `~/.codex/generated_images`.
   - Session-generated images are placed in a vertical column by generation batch. Multiple images from the same generation batch are aligned in one horizontal row.
   - Canvas-derived images, when collected with a `sourceObjectId`, are placed in a horizontal row to the right of the source image.
5. `Quick Edit`, `Remove BG`, `Expand`, `Edit Text`, and `Edit Elements` are implemented as background Codex-Canvas jobs. They create a canvas placeholder immediately, run Codex/ImageGen through the matching Codex-Canvas operation skill and bundled Codex App CLI, then replace the placeholder with the collected output.
6. `Edit Text` is a two-step interaction: first run text recognition and show the formatted editable text list in the canvas UI; after the user changes one or more fields and clicks Run, call imagegen to produce the edited PNG.
   - Text recognition should try local RapidOCR first when available. If local OCR is unavailable, fails, or returns no text, fall back to Codex vision recognition.
7. `Edit Elements` asks ImageGen for a low-detail instance segmentation map, then Codex-Canvas locally splits the source image into four-channel transparent PNG object/text layers plus a residual background. Codex-Canvas immediately imports the residual background and transparent object/text layers, stacks them to the right of the source image so they reconstruct the original composition, and continues a background-completion pass from the original image plus residual background in the background. When completion finishes, Codex-Canvas replaces the existing background layer asset in place and refreshes that layer. Intermediate segmentation and raw completion images stay internal to the job and are not added to the canvas.
8. Canvas-to-chat requires a bound Codex thread. Each bound thread uses a separate canvas scope under `canvas/threads/<canvasId>/`. The frontend `send-to-chat` action sends a `localImage` turn through Codex app-server `thread/resume` + `turn/start`; MCP/HTTP callers may explicitly use `mention-file` for a Codex `@file`-style `mention` turn. The frontend `@file` toolbar button must not directly send a turn; it prepares/copies an `@<absolute-path>` reference for the user to paste into the Codex chat box. Do not use desktop UI automation or clipboard paste as a fallback.

## Notes

- Canvas data is stored under `<workspace>/canvas/`.
- The visible canvas runs as a local web service and is intended to be opened in Codex `in-app browser`.
- The first milestone should preserve generated images as project assets, not only as chat attachments.
