# Potential Issues And Improvements

## Current Issues

- `/canvas` opens the in-app browser at a single local service, now using URLs like `http://127.0.0.1:43217/?project=<id>`. Opening Agent-Canvas from another project registers another canvas page in the same service, and the left project menu switches between registered canvases. Some Codex builds may still expose the same skill as `$canvas` or via natural-language invocation instead of a slash command.
- Personal marketplace registration is now deterministic through `npm run install:personal`, which updates `~/.agents/plugins/marketplace.json` and points `~/plugins/agent-canvas` at this repository.
- MCP stdio support is implemented with a minimal JSON-RPC handler. Smoke coverage now exercises `initialize`, `tools/list`, and an actual `canvas_status` tool call, including the rule that thread-scoped canvases require explicit `threadId` and do not infer the last runtime binding. Replacing the hand-rolled handler with the official MCP SDK is still a maintainability improvement, but it is no longer a known blocker for tool discovery.
- Image auto-collection now has two paths: the local canvas service automatically scans for image files created after each project is registered, and the skill still instructs Codex to import explicit `imagegen` output paths. The service scans both the active project and Codex's `~/.codex/generated_images` directory, advances a per-project watermark after successful scans, and skips known files by path/hash. Images kept only as chat attachments or written to unrelated custom directories still need explicit `add_image` or `collect_recent_images`.
- The Lovart visual match is approximate. A reference screenshot was inspected and the current UI follows the broad shape: light canvas, bottom dock, and selected-image toolbar. Pixel-level spacing, iconography, transitions, and interaction details still need dedicated visual QA.
- Lovart's page was not friendly to Chrome extension DOM automation in this run; reference inspection used a system screenshot after bringing Chrome to the foreground.
- `Quick Edit`, `Remove BG`, `Edit Text`, and `Edit Elements` are implemented as background jobs backed by dedicated Agent-Canvas operation skills. `Edit Elements` now has deterministic smoke coverage for segmentation artifacts, completed background normalization, layer stack/group metadata, and missing-segmentation failures; broader visual QA is still useful because generated mask quality can vary.

## Improvement Space

- Expand `Edit Elements` with browser-level visual regression tests using saved fixture images, building on the deterministic segmentation, background, layer stacking, and grouped-layer contract coverage in smoke tests.
- Add a real infinite-canvas engine such as tldraw once the Codex integration contract is stable.
- Add browser-based visual regression checks against a reference screenshot set.
- Replace the current polling auto-collector with a real file watcher or Codex lifecycle hook so image outputs are captured faster and with fewer false positives.
- Add persistent cross-session project registry, asset search, prompt history, and version grouping.
