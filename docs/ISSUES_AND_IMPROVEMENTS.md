# Potential Issues And Improvements

## Current Issues

- `/canvas` opens the in-app browser at a single local service, now using URLs like `http://127.0.0.1:43217/?project=<id>`. Opening Agent-Canvas from another project registers another canvas page in the same service, and the left project menu switches between registered canvases. Some Codex builds may still expose the same skill as `$canvas` or via natural-language invocation instead of a slash command.
- The personal marketplace entry is installed and enabled locally at `~/.agents/plugins/marketplace.json`, with `~/plugins/agent-canvas` symlinked to this repository. The global Codex CLI had to be repaired by reinstalling `@openai/codex` before `codex plugin add agent-canvas@personal` worked.
- MCP stdio support is implemented with a minimal JSON-RPC handler. `codex mcp list` shows the `agent-canvas` server enabled, but the fresh-thread validation fell back to the CLI because the MCP tool was not exposed by the first tool lookup. The CLI fallback is currently the more reliable `/canvas` path; the MCP server should be replaced with the official MCP SDK if tool exposure remains inconsistent.
- Image auto-collection now has two paths: the local canvas service automatically scans for image files created after each project is registered, and the skill still instructs Codex to import explicit `imagegen` output paths. This only works for images saved under the active project; images kept only as chat attachments or written outside the project still need explicit `add_image` or `collect_recent_images`.
- The Lovart visual match is approximate. A reference screenshot was inspected and the current UI follows the broad shape: light canvas, bottom dock, and selected-image toolbar. Pixel-level spacing, iconography, transitions, and interaction details still need dedicated visual QA.
- Lovart's page was not friendly to Chrome extension DOM automation in this run; reference inspection used a system screenshot after bringing Chrome to the foreground.
- `Quick Edit`, `Remove BG`, and `Edit Text` are implemented as background jobs backed by dedicated Agent-Canvas operation skills. `Edit Elements` remains visible as a reserved product surface for a later implementation.

## Improvement Space

- Add a deterministic plugin install/update script that registers the plugin in the personal marketplace.
- Implement `Edit Elements` with local mask/selection export and an Agent-Canvas operation skill.
- Add a real infinite-canvas engine such as tldraw once the Codex integration contract is stable.
- Add browser-based visual regression checks against a reference screenshot set.
- Replace the current polling auto-collector with a real file watcher or Codex lifecycle hook so image outputs are captured faster and with fewer false positives.
- Add persistent cross-session project registry, asset search, prompt history, and version grouping.
