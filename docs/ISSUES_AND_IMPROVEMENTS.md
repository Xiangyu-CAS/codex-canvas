# Potential Issues And Improvements

## Current Issues

- `/canvas` was verified in a fresh Codex app thread after installing `agent-canvas@personal`: the skill opened the in-app browser at `http://127.0.0.1:43217/` and loaded the `Agent-Canvas` page. Some Codex builds may still expose the same skill as `$canvas` or via natural-language invocation instead of a slash command.
- The personal marketplace entry is installed and enabled locally at `~/.agents/plugins/marketplace.json`, with `~/plugins/agent-canvas` symlinked to this repository. The global Codex CLI had to be repaired by reinstalling `@openai/codex` before `codex plugin add agent-canvas@personal` worked.
- MCP stdio support is implemented with a minimal JSON-RPC handler. `codex mcp list` shows the `agent-canvas` server enabled, but the fresh-thread validation fell back to the CLI because the MCP tool was not exposed by the first tool lookup. The CLI fallback is currently the more reliable `/canvas` path; the MCP server should be replaced with the official MCP SDK if tool exposure remains inconsistent.
- Image auto-collection now has two paths: the local canvas service automatically scans for image files created after the server starts, and the skill still instructs Codex to import explicit `imagegen` output paths. This only works for images saved under the active project; images kept only as chat attachments or written outside the project still need explicit `add_image` or `collect_recent_images`.
- The Lovart visual match is approximate. A reference screenshot was inspected and the current UI follows the broad shape: light canvas, right chat panel, bottom dock, and selected-image toolbar. Pixel-level spacing, iconography, transitions, and interaction details still need dedicated visual QA.
- Lovart's page was not friendly to Chrome extension DOM automation in this run; reference inspection used a system screenshot after bringing Chrome to the foreground.
- The image edit tools are placeholders. `remove BG`, `Edit Elements`, `Edit Text`, and `expand/crop` only show the intended product surface.

## Improvement Space

- Add a deterministic plugin install/update script that registers the plugin in the personal marketplace.
- Replace placeholder editing controls with real image operations backed by ImageGen and local mask/selection export.
- Add a real infinite-canvas engine such as tldraw once the Codex integration contract is stable.
- Add browser-based visual regression checks against a reference screenshot set.
- Replace the current polling auto-collector with a real file watcher or Codex lifecycle hook so image outputs are captured faster and with fewer false positives.
- Add multi-page canvas support, asset search, prompt history, and version grouping.
