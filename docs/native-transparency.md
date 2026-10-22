# Native transparent foregrounds

Remove BG and edits of transparent layers (Quick Edit / Edit Text) default to native PNG alpha. The job instructs Codex to inspect its actual imagegen tool schema and use `transparent_background: true` when that boolean argument exists. It does not pass a guessed `transparent` flag to the CLI or assume every Codex release exposes the same image tool.

The running plugin's operation skill is referenced by absolute path so an older installed copy cannot silently restore obsolete chroma-key instructions. The CLI resolver supports both Codex.app and the CLI bundled in ChatGPT.app on macOS; the configured CLI override remains first.

On collection, decoded PNG pixels must include both transparency and a visible foreground. Native RGBA files are copied byte-for-byte, including semi-transparent edges and magenta subject colors. Other valid PNG alpha forms are normalized to RGBA without changing decoded pixels. Opaque images (including painted checkerboards), malformed PNGs, and empty outputs fail instead of being presented as successful cutouts. This validates alpha presence, not artistic segmentation quality; inspect generated edges against contrasting backgrounds.

Image import and single-image PNG download retain the asset bytes. The canvas composites transparency over its display background; that background is not baked into downloads. PSD exports retain per-layer RGBA values (resampling still applies if the layer display size differs from its pixel dimensions).

## Explicit legacy compatibility

For a tool that cannot produce native transparency, restart the canvas server with `CODEX_CANVAS_TRANSPARENCY_MODE=chroma-key` (set the environment variable using the syntax of your shell). The mode is captured at job creation and applies to Remove BG / transparent-layer edits only. Native is the default for all other values. Already-running jobs do not silently change modes.

Compatibility jobs request a uniform #ff00ff backdrop. The foreground must be suitable for that color key; if magenta colors or translucent material conflict with it, the agent must stop and report that native alpha is needed, never recolor the subject. Opaque fallback outputs require at least 95% of the border to match the requested magenta key within 12 RGB channel values. The helper uses that fixed key, not an inferred scene color; its result must have both transparency and a visible foreground. Existing soft-matte/despill behavior is confined to this explicitly chosen legacy path. Native alpha always bypasses the helper, even in legacy mode.

This setting does not change Edit Elements instance segmentation maps: their magenta background is a semantic mask label, not an output foreground matte.

## Verification

`npm run smoke` covers native pixels, partial alpha and magenta preservation for all three actions, explicit fallback, opaque/checkerboard/empty rejection, import/download byte identity and PSD layer pixel identity. Python/Pillow are only needed for the legacy/helper cases, not native validation.

Local real-generation evidence should record the tool call, raw output, alpha histogram, source/asset/download hashes, PSD pixel comparison and contrasting-background previews. A successful prompt or mocked CLI is not proof of image generation capability.
