#!/usr/bin/env python3
"""Render a clean Quick Edit annotation board around a source image."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Source image path.")
    parser.add_argument("--annotations", required=True, help="Annotation JSON path.")
    parser.add_argument("--out", required=True, help="Output annotation-board PNG path.")
    parser.add_argument("--max-dimension", type=int, default=2048, help="Maximum output width or height.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing output file.")
    return parser.parse_args()


def die(message: str) -> None:
    raise SystemExit(message)


def clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def finite(value, fallback: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return fallback
    return number if math.isfinite(number) else fallback


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
        return any(char.isspace() or font.getmask(char).getbbox() != missing for char in text)
    except Exception:
        return True


def wrap_text(text: str, max_chars: int = 28) -> list[str]:
    lines: list[str] = []
    for paragraph in str(text or "").splitlines() or [""]:
        paragraph = paragraph.strip()
        if not paragraph:
            if lines:
                lines.append("")
            continue
        words = paragraph.split()
        if len(words) > 1:
            current = ""
            for word in words:
                candidate = f"{current} {word}".strip()
                if current and len(candidate) > max_chars:
                    lines.append(current)
                    current = word
                else:
                    current = candidate
            if current:
                lines.append(current)
        else:
            lines.extend(paragraph[index:index + max_chars] for index in range(0, len(paragraph), max_chars))
    return lines or [""]


def point_from(value, fallback=(0.0, 0.0)) -> tuple[float, float]:
    if not isinstance(value, dict):
        return fallback
    return finite(value.get("x"), fallback[0]), finite(value.get("y"), fallback[1])


def item_bounds(item: dict) -> tuple[float, float, float, float] | None:
    item_type = item.get("type")
    if item_type == "drawing":
        points = [point_from(point) for point in item.get("points", []) if isinstance(point, dict)]
        if not points:
            return None
        stroke = max(1.0, finite(item.get("strokeWidth"), 4.0))
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        return min(xs) - stroke, min(ys) - stroke, max(xs) + stroke, max(ys) + stroke
    if item_type == "text":
        x = finite(item.get("x"))
        y = finite(item.get("y"))
        width = max(1.0, finite(item.get("width"), 1.0))
        height = max(1.0, finite(item.get("height"), 1.0))
        return x, y, x + width, y + height
    if item_type == "annotation":
        label_point = point_from(item.get("labelPoint"))
        start_point = point_from(item.get("startPoint"), label_point)
        target_point = point_from(item.get("targetPoint"))
        font_size = max(12.0, finite(item.get("fontSize"), 18.0))
        label = str(item.get("label") or "").strip()
        lines = wrap_text(label) if label else []
        label_width = max(72.0, min(420.0, max((len(line) for line in lines), default=0) * font_size * 0.65 + 24.0))
        label_height = max(32.0, len(lines) * font_size * 1.35 + 16.0) if lines else 0.0
        left = min(label_point[0] - label_width / 2, start_point[0], target_point[0])
        top = min(label_point[1] - label_height - 12.0, start_point[1], target_point[1])
        right = max(label_point[0] + label_width / 2, start_point[0], target_point[0])
        bottom = max(label_point[1], start_point[1], target_point[1])
        return left, top, right, bottom
    return None


def scene_bounds(items: list[dict], source_width: float, source_height: float) -> tuple[float, float, float, float]:
    left, top, right, bottom = 0.0, 0.0, source_width, source_height
    for item in items:
        bounds = item_bounds(item)
        if not bounds:
            continue
        left = min(left, bounds[0])
        top = min(top, bounds[1])
        right = max(right, bounds[2])
        bottom = max(bottom, bounds[3])
    padding = clamp(max(source_width, source_height) * 0.035, 24.0, 96.0)
    return left - padding, top - padding, right + padding, bottom + padding


def scene_transform(bounds, scale: float):
    left, top, _, _ = bounds

    def transform(point: tuple[float, float]) -> tuple[float, float]:
        return (point[0] - left) * scale, (point[1] - top) * scale

    return transform


def draw_drawing(draw, item: dict, transform, scale: float) -> None:
    points = [transform(point_from(point)) for point in item.get("points", []) if isinstance(point, dict)]
    if len(points) < 2:
        return
    color = parse_color(item.get("stroke"), 245)
    stroke_width = max(1, round(finite(item.get("strokeWidth"), 4.0) * scale))
    draw.line(points, fill=color, width=stroke_width, joint="curve")
    radius = max(1, stroke_width / 2)
    for x, y in points:
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def draw_text_note(draw, item: dict, transform, scale: float) -> None:
    text = str(item.get("text") or "").strip()
    if not text:
        return
    x, y = transform((finite(item.get("x")), finite(item.get("y"))))
    width = max(1, round(finite(item.get("width"), 180.0) * scale))
    height = max(1, round(finite(item.get("height"), 48.0) * scale))
    font_size = max(10, round(finite(item.get("fontSize"), 18.0) * scale))
    color = parse_color(item.get("color"), 255)
    font = load_font(font_size, text)
    padding = max(5, round(font_size * 0.28))
    rect = (round(x), round(y), round(x + width), round(y + height))
    draw.rounded_rectangle(rect, radius=max(4, padding), fill=(255, 255, 255, 238), outline=color, width=max(1, round(2 * scale)))
    draw.multiline_text((x + padding, y + padding), "\n".join(wrap_text(text, 32)), fill=color, font=font, spacing=max(2, font_size // 5))


def cubic_points(start, control1, control2, end, steps: int = 40):
    for index in range(steps + 1):
        t = index / steps
        inverse = 1.0 - t
        yield (
            inverse ** 3 * start[0]
            + 3 * inverse * inverse * t * control1[0]
            + 3 * inverse * t * t * control2[0]
            + t ** 3 * end[0],
            inverse ** 3 * start[1]
            + 3 * inverse * inverse * t * control1[1]
            + 3 * inverse * t * t * control2[1]
            + t ** 3 * end[1],
        )


def draw_arrow_note(draw, item: dict, transform, scale: float) -> None:
    label_point = point_from(item.get("labelPoint"))
    start = transform(point_from(item.get("startPoint"), label_point))
    end = transform(point_from(item.get("targetPoint")))
    label_anchor = transform(label_point)
    color = parse_color(item.get("color"), 255)
    stroke_width = max(2, round(min(3.25, finite(item.get("strokeWidth"), 3.0)) * scale))
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = max(1.0, math.hypot(dx, dy))
    bend = min(42.0 * scale, max(8.0 * scale, length * 0.08))
    direction = -1.0 if abs(dx) >= abs(dy) and dx >= 0 else 1.0
    normal_x = -(dy / length) * bend * direction
    normal_y = (dx / length) * bend * direction
    control1 = (
        start[0] + dx * 0.3 + normal_x,
        start[1] + dy * 0.3 + normal_y,
    )
    control2 = (
        end[0] - dx * 0.2 + normal_x * 0.48,
        end[1] - dy * 0.2 + normal_y * 0.48,
    )
    curve = list(cubic_points(start, control1, control2, end))
    draw.line(curve, fill=color, width=stroke_width, joint="curve")

    tangent_x = end[0] - control2[0]
    tangent_y = end[1] - control2[1]
    tangent_length = max(1.0, math.hypot(tangent_x, tangent_y))
    unit_x, unit_y = tangent_x / tangent_length, tangent_y / tangent_length
    head_length = max(8.0 * scale, stroke_width * 2.4)
    head_width = head_length * 0.5
    base_x = end[0] - unit_x * head_length
    base_y = end[1] - unit_y * head_length
    perpendicular_x, perpendicular_y = -unit_y, unit_x
    upper = (base_x + perpendicular_x * head_width, base_y + perpendicular_y * head_width)
    lower = (base_x - perpendicular_x * head_width, base_y - perpendicular_y * head_width)
    draw.line([upper, end, lower], fill=color, width=max(2, round(stroke_width * 0.78)), joint="curve")

    label = str(item.get("label") or "").strip()
    if not label:
        return
    font_size = max(11, round(finite(item.get("fontSize"), 18.0) * scale))
    font = load_font(font_size, label)
    lines = wrap_text(label, 28)
    line_spacing = max(2, font_size // 5)
    text = "\n".join(lines)
    text_box = draw.multiline_textbbox((0, 0), text, font=font, spacing=line_spacing)
    padding_x = max(8, round(font_size * 0.48))
    padding_y = max(6, round(font_size * 0.35))
    width = text_box[2] - text_box[0] + padding_x * 2
    height = text_box[3] - text_box[1] + padding_y * 2
    left = label_anchor[0] - width / 2
    top = label_anchor[1] - height - max(8, round(8 * scale))
    rect = (round(left), round(top), round(left + width), round(top + height))
    draw.rounded_rectangle(rect, radius=max(6, round(8 * scale)), fill=(255, 255, 255, 244), outline=color, width=max(1, round(2 * scale)))
    draw.multiline_text((left + padding_x, top + padding_y - text_box[1]), text, fill=color, font=font, spacing=line_spacing)


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
    items = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    source = Image.open(source_path).convert("RGBA")
    source_size = payload.get("sourceSize") if isinstance(payload, dict) else {}
    source_width = max(1.0, finite(source_size.get("width"), source.width))
    source_height = max(1.0, finite(source_size.get("height"), source.height))
    bounds = scene_bounds(items, source_width, source_height)
    scene_width = max(1.0, bounds[2] - bounds[0])
    scene_height = max(1.0, bounds[3] - bounds[1])
    max_dimension = max(256, int(args.max_dimension))
    scale = min(1.0, max_dimension / max(scene_width, scene_height))
    output_size = (max(1, round(scene_width * scale)), max(1, round(scene_height * scale)))
    board = Image.new("RGBA", output_size, (247, 248, 250, 255))
    transform = scene_transform(bounds, scale)

    source_output_size = (max(1, round(source_width * scale)), max(1, round(source_height * scale)))
    source_for_board = source.resize(source_output_size, Image.Resampling.LANCZOS)
    source_left, source_top = transform((0.0, 0.0))
    board.alpha_composite(source_for_board, (round(source_left), round(source_top)))
    draw = ImageDraw.Draw(board)
    for item in items:
        if item.get("type") == "drawing":
            draw_drawing(draw, item, transform, scale)
        elif item.get("type") == "text":
            draw_text_note(draw, item, transform, scale)
        elif item.get("type") == "annotation":
            draw_arrow_note(draw, item, transform, scale)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    board.save(output_path)


if __name__ == "__main__":
    main()
