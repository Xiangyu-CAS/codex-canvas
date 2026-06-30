#!/usr/bin/env python3
"""Verify Edit Elements layer manifests by recomposing exported PNG layers."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys


def die(message: str, code: int = 1) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(code)


def load_dependencies():
    try:
        import numpy as np
        from PIL import Image
    except ImportError as error:
        die(f"Pillow and NumPy are required for layer verification: {error}")
    return np, Image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True, help="Path to elements-manifest.json.")
    parser.add_argument("--max-diff", type=int, default=0, help="Maximum allowed RGB reconstruction difference on white.")
    parser.add_argument("--min-coverage", type=float, default=1.0, help="Minimum recomposed alpha coverage ratio.")
    parser.add_argument("--require-completed-background", action="store_true", help="Require and validate a completed full-frame background layer.")
    parser.add_argument("--write-final-composite", help="Optional path to write the recomposed background-plus-object PNG.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    return parser.parse_args()


def load_manifest(path: Path) -> dict:
    if not path.exists():
        die(f"Manifest not found: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        die(f"Manifest is not valid JSON: {error}")


def flatten_on_white(image):
    _, Image = load_dependencies()
    flat = Image.new("RGBA", image.size, (255, 255, 255, 255))
    flat.alpha_composite(image.convert("RGBA"))
    return flat.convert("RGB")


def verify_manifest(manifest_path: Path, max_diff: int, min_coverage: float, require_completed_background: bool, final_composite_path: Path | None) -> dict:
    np, Image = load_dependencies()
    manifest = load_manifest(manifest_path)
    source_path = Path(manifest.get("source") or "")
    if not source_path.exists():
        die(f"Source image not found: {source_path}")

    source = Image.open(source_path).convert("RGBA")
    source_width, source_height = source.size
    layers = manifest.get("layers")
    if not isinstance(layers, list) or not layers:
        die("Manifest has no layers.")

    background_layers = [layer for layer in layers if layer.get("kind") == "background"]
    if len(background_layers) != 1:
        die(f"Expected exactly one background layer, found {len(background_layers)}.")

    reconstruction = Image.new("RGBA", source.size, (0, 0, 0, 0))
    foreground_layers = []
    layer_summaries = []
    completed_background_opaque_ratio = None
    for layer in layers:
        layer_path = Path(layer.get("path") or "")
        if not layer_path.exists():
            die(f"Layer image not found: {layer_path}")
        bbox = layer.get("bbox")
        if not isinstance(bbox, list) or len(bbox) != 4:
            die(f"Layer has invalid bbox: {layer_path}")
        left, top, right, bottom = [int(value) for value in bbox]
        if left < 0 or top < 0 or right > source_width or bottom > source_height or right <= left or bottom <= top:
            die(f"Layer bbox is outside source bounds: {layer_path} {bbox}")
        layer_image = Image.open(layer_path).convert("RGBA")
        if layer_image.size != (right - left, bottom - top):
            die(f"Layer image size does not match bbox: {layer_path}")
        alpha = np.array(layer_image.getchannel("A"))
        visible = int((alpha > 0).sum())
        if visible <= 0:
            die(f"Layer has no visible pixels: {layer_path}")
        if layer.get("kind") == "background" and require_completed_background:
            if not manifest.get("backgroundCompleted"):
                die("Manifest does not mark the background as completed.")
            if [left, top, right, bottom] != [0, 0, source_width, source_height]:
                die("Completed background layer must be full-frame.")
            source_alpha = np.array(source.getchannel("A"))
            source_visible = source_alpha > 0
            if source_visible.any():
                completed_background_opaque_ratio = float((alpha[source_visible] > 0).sum()) / float(source_visible.sum())
                if completed_background_opaque_ratio < 0.999:
                    die(f"Completed background alpha coverage {completed_background_opaque_ratio:.6f} is too low.")
        reconstruction.alpha_composite(layer_image, (left, top))
        if layer.get("kind") != "background":
            foreground_layers.append(layer)
        layer_summaries.append({
            "index": layer.get("index"),
            "kind": layer.get("kind", "object"),
            "visiblePixels": visible,
            "bbox": [left, top, right, bottom],
            "boundaryTrimPixels": int(layer.get("boundaryTrimPixels") or 0),
            "boundaryFloodTrimPixels": int(layer.get("boundaryFloodTrimPixels") or 0),
            "maskGrowPixels": int(layer.get("maskGrowPixels") or 0),
        })

    rebuilt_alpha = np.array(reconstruction.getchannel("A"))
    source_alpha = np.array(source.getchannel("A"))
    source_visible = source_alpha > 0
    if source_visible.any():
        coverage = float(((rebuilt_alpha > 0) & source_visible).sum()) / float(source_visible.sum())
    else:
        coverage = 1.0
    source_flat = np.array(flatten_on_white(source), dtype=np.int16)
    rebuilt_flat = np.array(flatten_on_white(reconstruction), dtype=np.int16)
    absolute = np.abs(source_flat - rebuilt_flat)
    max_abs = int(absolute.max())
    mean_abs = float(absolute.mean())
    if coverage < min_coverage:
        die(f"Coverage {coverage:.6f} is below required {min_coverage:.6f}.")
    if not require_completed_background and max_abs > max_diff:
        die(f"Max reconstruction diff {max_abs} exceeds allowed {max_diff}.")
    if final_composite_path:
        final_composite_path.parent.mkdir(parents=True, exist_ok=True)
        reconstruction.save(final_composite_path)

    return {
        "manifest": str(manifest_path),
        "source": str(source_path),
        "sourceSize": {"width": source_width, "height": source_height},
        "layers": len(layers),
        "foregroundLayers": len(foreground_layers),
        "backgroundLayers": len(background_layers),
        "coverageRatio": round(coverage, 6),
        "meanAbsRgbAllOnWhite": round(mean_abs, 4),
        "maxAbsRgbAllOnWhite": max_abs,
        "backgroundCompleted": bool(manifest.get("backgroundCompleted")),
        "completedBackgroundOpaqueRatio": None if completed_background_opaque_ratio is None else round(completed_background_opaque_ratio, 6),
        "finalCompositePath": None if final_composite_path is None else str(final_composite_path),
        "layerSummaries": layer_summaries,
    }


def main() -> None:
    args = parse_args()
    result = verify_manifest(
        Path(args.manifest),
        args.max_diff,
        args.min_coverage,
        args.require_completed_background,
        Path(args.write_final_composite) if args.write_final_composite else None,
    )
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(
            f"ok layers={result['layers']} foreground={result['foregroundLayers']} "
            f"coverage={result['coverageRatio']} maxDiff={result['maxAbsRgbAllOnWhite']}"
        )


if __name__ == "__main__":
    main()
