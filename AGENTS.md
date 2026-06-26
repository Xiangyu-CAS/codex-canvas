# Agent-Canvas Development Notes

## Cross-Platform Requirement

- Agent-Canvas must remain compatible with both macOS and Windows.
- Do not implement core app behavior with OS-specific UI automation such as AppleScript, `osascript`, System Events, Windows UI Automation, coordinate clicking, or simulated keystrokes into the Codex desktop app.
- Prefer browser, plugin, MCP/tool, or other Codex-supported integration surfaces that work consistently across macOS and Windows.

## Frontend UI

- Toolbar, dock, and control icons must come from a mature icon set, not hand-built CSS shapes or one-off custom drawings. Prefer inline Tabler or Lucide SVG paths for consistency, portability, and low runtime overhead.
- Keep icon style, stroke width, corner radius, and visual weight consistent across the same toolbar or dock.
- Only hand-draw an icon when no suitable existing icon exists, and document why it cannot come from the shared icon set.

## Skill Boundary

- Canvas AI operations should be modeled as dedicated skills plus backend job actions. Examples: Quick Edit, Remove BG, Upscale, Edit Elements, Edit Text, Multi-Angles, Move Object, and image generation.
- Each AI operation skill should document the edit intent, required inputs, preservation rules, output requirements, and canvas placement behavior.
- The frontend should send stable action ids such as `quick-edit` or `remove-bg`; it should not embed operation-specific prompts.
- The backend job layer should map action ids to operation prompts/skills, run Codex/ImageGen through cross-platform Codex-supported tooling, and collect outputs back to the canvas.
- Deterministic canvas interactions should remain local app code, not skills. Examples: pan, zoom, drag, select, delete, pencil drawing, text object creation/editing, toolbar visibility, language settings, and viewport framing.
