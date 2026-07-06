---
name: codex-canvas
description: "Open and operate Codex-Canvas as either a standalone Agent Skill or a Codex plugin. Use when the user says /canvas, asks to open a local infinite canvas, collect generated images on a board, send canvas images back to Codex chat, or run Codex-Canvas image operations such as Quick Edit, Remove BG, Expand, Edit Text, and Edit Elements."
---

# Codex-Canvas

Use this root skill as the entry point for Codex-Canvas when the project is installed as a standalone skill. When the same project is installed as a Codex plugin, preserve the plugin flow in `.codex-plugin/plugin.json` and the dedicated operation skills under `skills/`.

## Locate the Runtime

1. Treat the skill directory or plugin directory as `<codex-canvas-root>`.
2. Confirm `<codex-canvas-root>/bin/codex-canvas.mjs` exists before running CLI actions.
3. Run commands with Node.js 18.18 or newer.
4. Keep all canvas data inside the active workspace under `canvas/`.

## Open the Canvas

1. Start or reuse the project-local canvas with:
   `node <codex-canvas-root>/bin/codex-canvas.mjs open --project <workspace>`
2. Pass `--thread-id <thread-id>` whenever the current Codex thread id is available. Codex-Canvas also reads `CODEX_THREAD_ID` and `CODEX_CANVAS_CODEX_THREAD_ID`.
3. Prefer `open` over `start`; `open` reuses a healthy saved runtime and starts a detached server only when needed.
4. Open the returned URL in the Codex in-app browser when the browser control surface is available.
5. If the in-app browser is unavailable, return a Markdown link to the running canvas URL. Do not launch the OS default browser.

## Image Collection

1. For generated or edited images, save outputs under the active workspace when possible.
2. Import a known image with:
   `node <codex-canvas-root>/bin/codex-canvas.mjs import <image-path> --project <workspace>`
3. If the output path is unclear, collect recent images with:
   `node <codex-canvas-root>/bin/codex-canvas.mjs collect --project <workspace> --since-minutes 30 --limit 5`
4. Keep generated-image batches grouped by Codex-Canvas placement rules: same batch in a row, canvas-derived outputs to the right of the source image.

## AI Operation Boundary

Use stable Codex-Canvas action ids and backend jobs for AI image operations. Do not move operation-specific prompts into frontend code.

- `quick-edit`: use `skills/canvas-quick-edit/SKILL.md`.
- `remove-bg`: use `skills/canvas-remove-bg/SKILL.md`.
- `expand`: use `skills/canvas-expand/SKILL.md`.
- `edit-text`: use `skills/canvas-edit-text/SKILL.md`.
- `edit-elements`: use `skills/canvas-edit-elements/SKILL.md`.

Load the matching operation skill only when that action is requested. Deterministic canvas interactions such as pan, zoom, drag, select, delete, pencil drawing, text object editing, toolbar state, and viewport framing stay in local app code.

## Platform Rules

- Keep behavior cross-platform across macOS and Windows.
- Do not use AppleScript, `osascript`, System Events, Windows UI Automation, coordinate clicking, simulated keystrokes, clipboard paste, or OS-specific browser launching for core behavior.
- Prefer Codex-supported browser, plugin, MCP, CLI, and backend job surfaces.
- Use existing mature icon assets and the app's established icon style for toolbar, dock, and control UI changes.

## Plugin Compatibility

Do not require `.codex-plugin/plugin.json` to point at this root skill. The plugin installation path should continue to expose the existing `skills/` directory and MCP server configuration. This root `SKILL.md` exists so the repository can also be installed or uploaded as a standalone skill without disrupting plugin installs.
