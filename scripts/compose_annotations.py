#!/usr/bin/env python3
"""Compose Codex-Canvas Quick Edit annotations onto a temporary PNG input."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Source image path.")
    parser.add_argument("--annotations", required=True, help="Annotation JSON path.")
    parser.add_argument("--out", required=True, help="Output annotated PNG path.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    return parser.parse_args()


def die(message: str) -> None:
    raise SystemExit(message)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def parse_color(value: str, alpha: int = 255) -> tuple[int, int, int, int]:
    text = str(value or "").strip()
    if text.startswith("#") and len(text) in (4, 7):
        if len(text) == 4:
            red = int(text[1] * 2, 16)
            green = int(text[2] * 2, 16)
            blue = int(text[3] * 2, 16)
        else:
            red = int(text[1:3], 16)
            green = int(text[3:5], 16)
            blue = int(text[5:7], 16)
        return red, green, blue, alpha
    return 32, 33, 36, alpha


def load_font(size: int, text: str = ""):
    from PIL import ImageFont

    font_candidates = [
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "C:/Windows/Fonts/msyh.ttc",
        "C:/Windows/Fonts/simhei.ttf",
        "C:/Windows/Fonts/simsun.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/arphic/uming.ttc",
        "DejaVuSans.ttf",
        "Arial.ttf",
        "LiberationSans-Regular.ttf",
    ]

    for name in font_candidates:
        try:
            font = ImageFont.truetype(name, size)
            if font_supports_text(font, text):
                return font
        except Exception:
            pass
    return ImageFont.load_default()


def font_supports_text(font, text: str) -> bool:
    if not text:
        return True
    try:
        missing = font.getmask("\u25a1").getbbox()
        for char in text:
            if char.isspace():
                continue
            if font.getmask(char).getbbox() != missing:
                return True
    except Exception:
        return True
    return False


def scale_point(point: dict, scale_x: float, scale_y: float) -> tuple[float, float]:
    return float(point.get("x", 0)) * scale_x, float(point.get("y", 0)) * scale_y


def draw_drawing(draw, item: dict, scale_x: float, scale_y: float) -> None:
    points = [scale_point(point, scale_x, scale_y) for point in item.get("points", []) if isinstance(point, dict)]
    if len(points) < 2:
        return

    color = parse_color(item.get("stroke"), 245)
    stroke_width = max(1, round(float(item.get("strokeWidth", 4)) * (scale_x + scale_y) / 2))
    draw.line(points, fill=color, width=stroke_width, joint="curve")

    radius = max(1, stroke_width / 2)
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def draw_text(draw, item: dict, scale_x: float, scale_y: float, image_size: tuple[int, int]) -> None:
    text = str(item.get("text") or "").strip()
    if not text:
        return

    image_width, image_height = image_size
    x = clamp(float(item.get("x", 0)) * scale_x, 0, image_width)
    y = clamp(float(item.get("y", 0)) * scale_y, 0, image_height)
    width = max(1, float(item.get("width", 1)) * scale_x)
    height = max(1, float(item.get("height", 1)) * scale_y)
    font_size = max(8, round(float(item.get("fontSize", 28)) * scale_y))
    color = parse_color(item.get("color"), 245)
    font = load_font(font_size, text)

    padding = max(4, round(font_size * 0.2))
    rect = (x, y, min(image_width, x + width), min(image_height, y + height))
    draw.rounded_rectangle(rect, radius=max(2, padding // 2), fill=(255, 255, 255, 210), outline=color, width=max(1, font_size // 12))
    draw.multiline_text((x + padding, y + padding), text, fill=color, font=font, spacing=max(1, font_size // 8))


def main() -> None:
    args = parse_args()
    source_path = Path(args.source)
    annotations_path = Path(args.annotations)
    output_path = Path(args.out)

    if not source_path.exists():
        die(f"Source image not found: {source_path}")
    if not annotations_path.exists():
        die(f"Annotation JSON not found: {annotations_path}")
    if output_path.exists() and not args.force:
        die(f"Output already exists: {output_path}")

    try:
        from PIL import Image, ImageDraw
    except ImportError as error:
        die(f"Pillow is required for Quick Edit annotation composition: {error}")

    payload = json.loads(annotations_path.read_text(encoding="utf-8"))
    items = payload.get("items") if isinstance(payload, dict) else []
    if not isinstance(items, list):
        items = []

    image = Image.open(source_path).convert("RGBA")
    source_size = payload.get("sourceSize") if isinstance(payload, dict) else {}
    basis_width = float(source_size.get("width") or image.width)
    basis_height = float(source_size.get("height") or image.height)
    scale_x = image.width / max(1.0, basis_width)
    scale_y = image.height / max(1.0, basis_height)

    overlay = Image.new("RGBA", image.size, (255, 255, 255, 0))
    draw = ImageDraw.Draw(overlay)
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "drawing":
            draw_drawing(draw, item, scale_x, scale_y)
        elif item.get("type") == "text":
            draw_text(draw, item, scale_x, scale_y, image.size)

    image.alpha_composite(overlay)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)


if __name__ == "__main__":
    main()
