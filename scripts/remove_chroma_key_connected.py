#!/usr/bin/env python3
"""Remove only border-connected chroma-key background pixels.

This is intentionally conservative for product cutouts: it changes alpha only
and never rewrites foreground RGB values, so brand colors are preserved.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
from statistics import median
import re
import sys


def die(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_pillow():
    try:
        from PIL import Image
    except ImportError as error:
        die(f"Pillow is required for chroma-key removal: {error}")
    return Image


def parse_color(raw: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", raw.strip())
    if not match:
        die("key color must be a hex RGB value like #ff00ff.")
    value = match.group(1)
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def channel_distance(left: tuple[int, int, int], right: tuple[int, int, int]) -> int:
    return max(abs(left[0] - right[0]), abs(left[1] - right[1]), abs(left[2] - right[2]))


def sample_border_key(image, mode: str) -> tuple[int, int, int]:
    width, height = image.size
    pixels = image.load()
    samples: list[tuple[int, int, int]] = []

    if mode == "corners":
        patch = max(1, min(width, height, 12))
        boxes = [
            (0, 0, patch, patch),
            (width - patch, 0, width, patch),
            (0, height - patch, patch, height),
            (width - patch, height - patch, width, height),
        ]
        for left, top, right, bottom in boxes:
            for y in range(top, bottom):
                for x in range(left, right):
                    samples.append(pixels[x, y][:3])
    else:
        band = max(1, min(width, height, 6))
        step = max(1, min(width, height) // 256)
        for x in range(0, width, step):
            for y in range(band):
                samples.append(pixels[x, y][:3])
                samples.append(pixels[x, height - 1 - y][:3])
        for y in range(0, height, step):
            for x in range(band):
                samples.append(pixels[x, y][:3])
                samples.append(pixels[width - 1 - x, y][:3])

    if not samples:
        die("Could not sample background key color from image border.")
    return (
        int(round(median(sample[0] for sample in samples))),
        int(round(median(sample[1] for sample in samples))),
        int(round(median(sample[2] for sample in samples))),
    )


def remove_connected_key(image, key: tuple[int, int, int], tolerance: int) -> int:
    width, height = image.size
    pixels = image.load()
    queue: deque[tuple[int, int]] = deque()
    visited: set[tuple[int, int]] = set()

    def enqueue_if_key(x: int, y: int) -> None:
        if (x, y) in visited:
            return
        red, green, blue, alpha = pixels[x, y]
        if alpha == 0 or channel_distance((red, green, blue), key) <= tolerance:
            visited.add((x, y))
            queue.append((x, y))

    for x in range(width):
        enqueue_if_key(x, 0)
        enqueue_if_key(x, height - 1)
    for y in range(height):
        enqueue_if_key(0, y)
        enqueue_if_key(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                enqueue_if_key(nx, ny)

    for x, y in visited:
        pixels[x, y] = (0, 0, 0, 0)
    return len(visited)


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove border-connected chroma-key background.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--key-color", default="#ff00ff")
    parser.add_argument("--auto-key", choices=["none", "corners", "border"], default="border")
    parser.add_argument("--tolerance", type=int, default=36)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.out)
    if not input_path.exists():
        die(f"Input image not found: {input_path}")
    if output_path.exists() and not args.force:
        die(f"Output already exists: {output_path}")
    if args.tolerance < 0 or args.tolerance > 255:
        die("--tolerance must be between 0 and 255.")

    Image = load_pillow()
    with Image.open(input_path) as source:
        image = source.convert("RGBA")

    key = sample_border_key(image, args.auto_key) if args.auto_key != "none" else parse_color(args.key_color)
    removed = remove_connected_key(image, key, args.tolerance)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)
    print(f"Wrote {output_path}")
    print(f"Key color: #{key[0]:02x}{key[1]:02x}{key[2]:02x}")
    print(f"Transparent pixels: {removed}/{image.size[0] * image.size[1]}")


if __name__ == "__main__":
    main()
