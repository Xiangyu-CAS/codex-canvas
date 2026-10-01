# Codex-Canvas

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

Codex-Canvas is an infinite canvas plugin for Codex. It requires no API setup and uses Codex's built-in GPT-image-2 workflow to edit images on a local canvas. It opens directly inside Codex, collects generated images into the current project, and lets you organize, annotate, edit, compare, and reuse visual assets.

It brings a Lovart-like workflow to Codex: chat on one side, canvas on the other, with powerful image editing tools designed around the same creative loop.

<p align="center">
  <img src="assets/readme/overview.webp" alt="Open Codex Canvas" width="760">
</p>

## Installation

Copy this prompt into Codex:

```text
Please install Codex-Canvas according to https://github.com/Xiangyu-CAS/codex-canvas.git and its INSTALL.md.
After installation, tell the user to start a new Codex task and type `@Codex-Canvas open the codex canvas`.
```

See the full installation guide in [`INSTALL.md`](INSTALL.md).

Stable versions ship through GitHub Releases. **Settings → Version** only installs a `vX.Y.Z` release after its assets are complete and its manifest matches the tag, never unreleased commits from `main`. The old server exits after an update; reopen the canvas and start a new Codex task.

After installation, start a new Codex task and open the canvas:

```text
@Codex-Canvas open the codex canvas
```

## Roadmap

- [x] GPT-image-2 powered image editing
- [ ] Editable PPT generation and export
- [ ] draw.io flowchart generation and editing

## Highlights

### 1. Open a canvas and collect generated images automatically

Type `@Codex-Canvas open the codex canvas` in your current Codex conversation, and Codex-Canvas opens a local project canvas in the in-app browser. Keep chatting on the left while managing visual assets on the right. Once bound, Codex-Canvas collects only that thread's outputs from `~/.codex/generated_images/<thread-id>`; it does not scan other projects, other threads, or the whole project directory. Results are persisted into that thread's canvas.

<p align="center">
  <img src="assets/readme/auto-collect.webp" alt="Auto collect generated images" width="640">
</p>

### 2. Quick Edit: mark what you want changed

Quick Edit now defaults to an arrow-note tool: drag from a note position outside the image to the region you want changed, then type the instruction inline. Brush masks, colors, standalone text, and an optional overall prompt remain available. The source and annotations stay in place while the running placeholder and final revision remain on the canvas to the right.

<p align="center">
  <img src="assets/readme/quick-edit-comparison.webp" alt="Quick Edit comparison" width="700">
</p>

### 3. Edit Elements: separate layers and rearrange them

Edit Elements separates an image into movable layers such as background, text, products, people, and price tags. You can rearrange those layers on the canvas, while Codex-Canvas can continue completing the background that was hidden behind foreground objects. Downloading any layer from an Edit Elements group exports the whole group as a PSD, with each canvas layer mapped to a Photoshop layer for further editing in tools like Photoshop or Photopea.

<p align="center">
  <img src="assets/readme/edit-elements-comparison.webp" alt="Edit Elements comparison" width="700">
</p>

### 4. Edit Text: recognize and rewrite text in images

Edit Text recognizes text in the image and lists it as editable fields. You can revise individual lines while asking the model to preserve the original typography, layout relationships, and visual tone.

<p align="center">
  <img src="assets/readme/edit-text-comparison.webp" alt="Edit Text comparison" width="700">
</p>

### 5. Remove BG: remove backgrounds in one step

For posters, portraits, product shots, and other assets, Codex-Canvas can create a transparent-background result directly on the canvas. The result stays in the same project canvas, ready for composition, layout, or reuse in Codex.

<p align="center">
  <img src="assets/readme/remove-bg-result.webp" alt="Remove BG result" width="560">
</p>

### 6. Expand: outpaint to a new aspect ratio

Expand provides a visual expansion frame and common aspect-ratio presets such as 1:1, 3:4, 16:9, and 9:16. Choose the target canvas first, then let the model complete the surrounding image content.

<p align="center">
  <img src="assets/readme/expand-comparison.webp" alt="Expand comparison" width="700">
</p>

## Features

- Opens a local infinite canvas in Codex's in-app browser.
- Automatically collects Codex/ImageGen outputs into the bound thread canvas without leaking outputs from other projects or conversations.
- Supports uploading, importing, arranging, selecting, dragging, deleting, and downloading canvas images.
- Supports explicitly linked arrow notes, brush annotations, and temporary text labels, including notes outside the image.
- Supports Quick Edit without an overall prompt, sending a clean source, annotation board, and structured annotation details to the model.
- Supports background removal.
- Supports Expand/outpaint with an adjustable expansion preview frame.
- Supports Edit Text; local OCR is used first when available, with Codex vision fallback when needed.
- Supports Edit Elements, separating images into foreground object/text layers and a background layer.
- Supports background completion for Edit Elements and replaces the background layer in place.
- Supports downloading Edit Elements layer groups as PSD files, with each canvas layer mapped to a Photoshop layer.
- Supports prompt history and generated-version groups.
- Keeps separate canvases for different Codex conversations to avoid mixing contexts.
- Supports copying a selected image as an `@file` reference and pasting it back into Codex chat.

## Usage Notes

Codex-Canvas stores canvas data in the current project's `canvas/` directory. Generated assets, job logs, and intermediate files stay local to the project.

MCP startup and tool discovery do not create this directory. `status` (including `npm run validate`), search, prompt history, and version queries read existing state without creating files or claiming a legacy canvas for a thread. An absent scope reports an empty canvas unless eligible legacy data can be previewed; copying assets and claiming that legacy canvas still happen only when the canvas is explicitly opened or written. Collection with no new images also leaves an unused project untouched.

`open` / `open_canvas` and `start` explicitly initialize a canvas and write its runtime file, even with `--no-auto-collect`. Importing images and other mutations also create storage. The HTTP server restores previously registered canvases, but skips scopes whose stored state has been removed. A running auto-collector stops when its stored canvas disappears. Close/stop the server before moving or deleting data: the canvas UI and in-flight writes can still create it again.

`Send to chat` is currently a prototype path through the Codex app-server. It can submit at the protocol layer, but it may not always appear in the currently visible Codex desktop chat UI. The more reliable workflow is to use `Copy @file`, then paste that reference into the current Codex chat box.

## Uninstall (keep your assets)

There is no npm uninstall hook: removing a package alone does not stop a detached server or remove the Codex plugin registration.

1. Wait for image/text jobs to finish. For foreground `start`, press Ctrl+C in its terminal. For a server launched by `open`, closing the browser tab is **not** enough: inspect `canvas/.codex-canvas-runtime.json` for its URL and PID, verify the live process command points to this plugin's `bin/codex-canvas.mjs start` and the expected project, then stop that specific process using Activity Monitor on macOS or Task Manager on Windows (or your OS process tools). Do not terminate a PID solely from an old runtime file; PIDs can be reused. Repeat for any other Canvas server instances. A server may serve multiple projects, so stopping it stops collection for all of them.
2. Remove/disable **codex-canvas@personal** in Codex's plugin management. For CLI installations, run `codex plugin --help` and use the removal subcommand supported by your installed version, then verify with `codex plugin list --json`. End old Codex tasks and restart Codex so already-loaded MCP processes/skills are no longer available. If you manually added a `codex-canvas` MCP entry, remove only that entry from the configuration where you added it.
3. To remove the personal marketplace listing, back up `~/.agents/plugins/marketplace.json` and remove only the plugin object whose `name` is `codex-canvas`; keep every other entry. Remove `~/plugins/codex-canvas` only after verifying it is the installer's symlink/junction, deleting the link itself without following its target. If it is a real directory, leave it in place for manual review. With `CODEX_CANVAS_PERSONAL_HOME`, use that installation's home instead. If installed through Red SkillHub, also remove its separate `codex-canvas` bootstrap skill using that manager so it cannot reinstall the plugin.
4. After all servers are stopped, optionally remove the plugin-specific `~/.agents/codex-canvas/projects.json` registry (or your `CODEX_CANVAS_PROJECT_REGISTRY_PATH` override) and each project's `canvas/.codex-canvas-runtime.json`. These are registration/runtime metadata, not images. Keeping them is harmless once the plugin is uninstalled. Do not remove the shared `.agents` or `.codex` directories.
5. Keep or back up each project's **entire `canvas/` folder**: it contains user images, thread canvases, state, job outputs and intermediate files. Delete it only after reviewing and backing up what you need. Optionally archive/remove the plugin's verified source checkout and leftover plugin-specific cache after inspecting them for local changes; never recursively delete through `~/plugins/codex-canvas`. Leave shared Python dependencies and `~/.codex/generated_images/` alone, since other workflows may use them.

## Development

Common local commands:

```bash
npm install
npm test
node ./bin/codex-canvas.mjs open --project .
```

Related docs:

- [`INSTALL.md`](INSTALL.md): installation guide and optional local dependencies.
- [`docs/RELEASING.md`](docs/RELEASING.md): versioning, Release PR, tag, and artifact workflow.
- [`docs/CANVAS_TO_CHAT.md`](docs/CANVAS_TO_CHAT.md): current canvas-to-chat validation results and limitations.

## Credits

Thanks to [Cowart](https://github.com/zhongerxin/Cowart) for the canvas concept.
