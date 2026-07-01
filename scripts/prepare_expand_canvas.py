#!/usr/bin/env python3
"""Create a padded outpaint input canvas for Codex-Canvas Expand."""

from __future__ import annotations

import argparse
import math
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Source image path.")
    parser.add_argument("--out", required=True, help="Output padded PNG path.")
    parser.add_argument("--ratio", default="original", help="Target ratio: original, 1:1, 4:3, 16:9, etc.")
    parser.add_argument("--scale", default="1", help="Expansion scale multiplier.")
    parser.add_argument("--source-left-ratio", type=float, help="Source left position as a ratio of target width.")
    parser.add_argument("--source-top-ratio", type=float, help="Source top position as a ratio of target height.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    return parser.parse_args()


def die(message: str) -> None:
    raise SystemExit(message)


def parse_ratio(value: str, source_width: int, source_height: int) -> float:
    normalized = str(value or "original").strip().lower()
    if normalized in {"", "original", "original ratio"}:
      return source_width / max(1, source_height)
    if ":" in normalized:
        left, right = normalized.split(":", 1)
        try:
            width = float(left)
            height = float(right)
        except ValueError:
            die(f"Invalid ratio: {value}")
        if width <= 0 or height <= 0:
            die(f"Invalid ratio: {value}")
        return width / height
    try:
        ratio = float(normalized)
    except ValueError:
        die(f"Invalid ratio: {value}")
    if ratio <= 0:
        die(f"Invalid ratio: {value}")
    return ratio


def parse_scale(value: str) -> float:
    normalized = str(value or "1").strip().lower().removesuffix("x")
    try:
        scale = float(normalized)
    except ValueError:
        die(f"Invalid scale: {value}")
    if scale < 1 or scale > 4:
        die(f"Invalid scale: {value}")
    return scale


def target_size(source_width: int, source_height: int, ratio: float, scale: float) -> tuple[int, int]:
    width = float(source_width)
    height = float(source_height)
    current = width / max(1.0, height)

    if current < ratio:
        width = height * ratio
    elif current > ratio:
        height = width / ratio

    width *= scale
    height *= scale
    target_width = max(source_width, int(math.ceil(width)))
    target_height = max(source_height, int(math.ceil(height)))

    return target_width, target_height


def main() -> None:
    args = parse_args()
    source_path = Path(args.source)
    output_path = Path(args.out)
    if not source_path.exists():
        die(f"Source image not found: {source_path}")
    if output_path.exists() and not args.force:
        die(f"Output already exists: {output_path}")

    try:
        from PIL import Image, ImageFilter
    except ImportError as error:
        die(f"Pillow is required for Expand preparation: {error}")

    source = Image.open(source_path).convert("RGBA")
    ratio = parse_ratio(args.ratio, source.width, source.height)
    scale = parse_scale(args.scale)
    width, height = target_size(source.width, source.height, ratio, scale)
    left = placement_from_ratio(args.source_left_ratio, width, source.width)
    top = placement_from_ratio(args.source_top_ratio, height, source.height)

    # A blurred, low-contrast underlay gives ImageGen a soft continuation hint
    # while the exact source image remains pasted unmodified in the center.
    underlay = source.copy()
    underlay.thumbnail((width, height), Image.Resampling.LANCZOS)
    blur = Image.new("RGBA", (width, height), (246, 246, 246, 255))
    underlay_x = (width - underlay.width) // 2
    underlay_y = (height - underlay.height) // 2
    blur.alpha_composite(underlay, (underlay_x, underlay_y))
    blur = blur.filter(ImageFilter.GaussianBlur(radius=max(10, int(min(width, height) * 0.035))))
    muted = Image.blend(Image.new("RGBA", (width, height), (246, 246, 246, 255)), blur, 0.28)
    muted.putalpha(255)
    muted.alpha_composite(source, (left, top))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    muted.save(output_path)


def placement_from_ratio(value: float | None, target_size: int, source_size: int) -> int:
    if value is None:
        return (target_size - source_size) // 2
    raw = int(round(value * target_size))
    return max(0, min(target_size - source_size, raw))


if __name__ == "__main__":
    main()
