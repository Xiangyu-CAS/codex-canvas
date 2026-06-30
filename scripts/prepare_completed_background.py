#!/usr/bin/env python3
"""Normalize a generated completed background for Agent-Canvas element layers."""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Original source image path.")
    parser.add_argument("--completed", required=True, help="Generated completed background image path.")
    parser.add_argument("--out", required=True, help="Output RGBA PNG path.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    return parser.parse_args()


def die(message: str) -> None:
    raise SystemExit(message)


def main() -> None:
    args = parse_args()
    source_path = Path(args.source)
    completed_path = Path(args.completed)
    output_path = Path(args.out)

    if not source_path.exists():
        die(f"Source image not found: {source_path}")
    if not completed_path.exists():
        die(f"Completed background image not found: {completed_path}")
    if output_path.exists() and not args.force:
        die(f"Output already exists: {output_path}")

    try:
        from PIL import Image, ImageOps
    except ImportError as error:
        die(f"Pillow is required for completed background preparation: {error}")

    source = Image.open(source_path).convert("RGBA")
    completed = Image.open(completed_path).convert("RGBA")

    if completed.size != source.size:
        completed = ImageOps.fit(completed, source.size, method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

    # ImageGen should return a full-frame background. If it still contains
    # transparent pixels, flatten those pixels against white rather than leaking
    # old foreground content from the source image back into the background.
    flattened = Image.new("RGBA", source.size, (255, 255, 255, 255))
    flattened.alpha_composite(completed)
    flattened.putalpha(source.getchannel("A"))

    output_path.parent.mkdir(parents=True, exist_ok=True)
    flattened.save(output_path)


if __name__ == "__main__":
    main()
