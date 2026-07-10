#!/usr/bin/env python3
"""Remove a border-connected chroma-key background with an optional soft matte.

The connected mask preserves isolated foreground colors that resemble the key.
Soft-matte and despill options make generated cutout edges usable without
depending on a helper outside the plugin package.
"""

from __future__ import annotations

import argparse
from collections import deque
from pathlib import Path
from statistics import median
import re
import sys
from typing import Tuple


Color = Tuple[int, int, int]
KEY_DOMINANCE_THRESHOLD = 16.0
ALPHA_NOISE_FLOOR = 8


def die(message: str) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(1)


def load_pillow():
    try:
        from PIL import Image
    except ImportError as error:
        die(f"Pillow is required for chroma-key removal: {error}")
    return Image


def parse_color(raw: str) -> Color:
    match = re.fullmatch(r"#?([0-9a-fA-F]{6})", raw.strip())
    if not match:
        die("key color must be a hex RGB value like #ff00ff.")
    value = match.group(1)
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def channel_distance(left: Color, right: Color) -> int:
    return max(abs(left[0] - right[0]), abs(left[1] - right[1]), abs(left[2] - right[2]))


def clamp_channel(value: float) -> int:
    return max(0, min(255, int(round(value))))


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def soft_alpha(distance: int, transparent_threshold: float, opaque_threshold: float) -> int:
    if distance <= transparent_threshold:
        return 0
    if distance >= opaque_threshold:
        return 255
    ratio = (float(distance) - transparent_threshold) / (opaque_threshold - transparent_threshold)
    return clamp_channel(255.0 * smoothstep(ratio))


def spill_channels(key: Color) -> list[int]:
    key_max = max(key)
    if key_max < 128:
        return []
    return [index for index, value in enumerate(key) if value >= key_max - 16 and value >= 128]


def key_channel_dominance(rgb: Color, key: Color) -> float:
    spill = spill_channels(key)
    if not spill:
        return 0.0
    channels = [float(value) for value in rgb]
    non_spill = [index for index in range(3) if index not in spill]
    key_strength = min(channels[index] for index in spill) if len(spill) > 1 else channels[spill[0]]
    non_key_strength = max((channels[index] for index in non_spill), default=0.0)
    return key_strength - non_key_strength


def dominance_alpha(rgb: Color, key: Color) -> int:
    dominance = key_channel_dominance(rgb, key)
    if dominance <= 0:
        return 255
    non_spill = [index for index in range(3) if index not in spill_channels(key)]
    non_key_strength = max((float(rgb[index]) for index in non_spill), default=0.0)
    denominator = max(1.0, float(max(key)) - non_key_strength)
    return clamp_channel((1.0 - min(1.0, dominance / denominator)) * 255.0)


def looks_key_colored(rgb: Color, key: Color, distance: int) -> bool:
    return distance <= 32 or key_channel_dominance(rgb, key) >= KEY_DOMINANCE_THRESHOLD


def cleanup_spill(rgb: Color, key: Color, alpha: int) -> Color:
    if alpha >= 252:
        return rgb
    spill = spill_channels(key)
    if not spill:
        return rgb
    channels = [float(value) for value in rgb]
    non_spill = [index for index in range(3) if index not in spill]
    if non_spill:
        cap = max(0.0, max(channels[index] for index in non_spill) - 1.0)
        for index in spill:
            channels[index] = min(channels[index], cap)
    return tuple(clamp_channel(value) for value in channels)


def sample_border_key(image, mode: str) -> Color:
    width, height = image.size
    pixels = image.load()
    samples: list[Color] = []

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


def remove_connected_key(
    image,
    key: Color,
    tolerance: int,
    *,
    soft_matte: bool,
    transparent_threshold: float,
    opaque_threshold: float,
    despill: bool,
) -> int:
    width, height = image.size
    pixels = image.load()
    queue: deque[tuple[int, int]] = deque()
    visited: set[tuple[int, int]] = set()

    def enqueue_if_key(x: int, y: int) -> None:
        if (x, y) in visited:
            return
        red, green, blue, alpha = pixels[x, y]
        rgb = (red, green, blue)
        distance = channel_distance(rgb, key)
        max_distance = opaque_threshold if soft_matte else tolerance
        if alpha == 0 or (
            distance <= max_distance
            and (not soft_matte or looks_key_colored(rgb, key, distance))
        ):
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

    transparent = 0
    for x, y in visited:
        red, green, blue, input_alpha = pixels[x, y]
        rgb = (red, green, blue)
        distance = channel_distance(rgb, key)
        output_alpha = (
            min(
                soft_alpha(distance, transparent_threshold, opaque_threshold),
                dominance_alpha(rgb, key),
            )
            if soft_matte
            else 0
        )
        output_alpha = clamp_channel(output_alpha * (input_alpha / 255.0))
        if 0 < output_alpha <= ALPHA_NOISE_FLOOR:
            output_alpha = 0
        if output_alpha == 0:
            pixels[x, y] = (0, 0, 0, 0)
            transparent += 1
            continue
        if despill:
            red, green, blue = cleanup_spill(rgb, key, output_alpha)
        pixels[x, y] = (red, green, blue, output_alpha)
    return transparent


def contract_alpha(image, pixels: int, ImageFilter):
    if pixels == 0:
        return
    alpha = image.getchannel("A")
    for _ in range(pixels):
        alpha = alpha.filter(ImageFilter.MinFilter(3))
    image.putalpha(alpha)


def count_transparent(image) -> int:
    return sum(1 for pixel in image.getdata() if pixel[3] == 0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove border-connected chroma-key background.")
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--key-color", default="#ff00ff")
    parser.add_argument("--auto-key", choices=["none", "corners", "border"], default="border")
    parser.add_argument("--tolerance", type=int, default=36)
    parser.add_argument("--soft-matte", action="store_true")
    parser.add_argument("--transparent-threshold", type=float, default=12.0)
    parser.add_argument("--opaque-threshold", type=float, default=96.0)
    parser.add_argument("--despill", action="store_true")
    parser.add_argument("--edge-contract", type=int, default=0)
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
    if args.transparent_threshold < 0 or args.transparent_threshold > 255:
        die("--transparent-threshold must be between 0 and 255.")
    if args.opaque_threshold < 0 or args.opaque_threshold > 255:
        die("--opaque-threshold must be between 0 and 255.")
    if args.soft_matte and args.transparent_threshold >= args.opaque_threshold:
        die("--transparent-threshold must be lower than --opaque-threshold.")
    if args.edge_contract < 0 or args.edge_contract > 16:
        die("--edge-contract must be between 0 and 16.")

    Image = load_pillow()
    from PIL import ImageFilter
    with Image.open(input_path) as source:
        image = source.convert("RGBA")

    key = sample_border_key(image, args.auto_key) if args.auto_key != "none" else parse_color(args.key_color)
    remove_connected_key(
        image,
        key,
        args.tolerance,
        soft_matte=args.soft_matte,
        transparent_threshold=args.transparent_threshold,
        opaque_threshold=args.opaque_threshold,
        despill=args.despill,
    )
    contract_alpha(image, args.edge_contract, ImageFilter)
    transparent = count_transparent(image)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)
    print(f"Wrote {output_path}")
    print(f"Key color: #{key[0]:02x}{key[1]:02x}{key[2]:02x}")
    print(f"Transparent pixels: {transparent}/{image.size[0] * image.size[1]}")


if __name__ == "__main__":
    main()
