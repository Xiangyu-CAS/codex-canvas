#!/usr/bin/env python3
"""Split a source image into transparent element layers from a color segmentation map."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from typing import Any


def die(message: str, code: int = 1) -> None:
    print(f"Error: {message}", file=sys.stderr)
    raise SystemExit(code)


def dependency_hint(package: str) -> str:
    return (
        "Activate the repo-selected environment first, then install it with "
        f"`uv pip install {package}`. If this repo uses a local virtualenv, start with "
        "`source .venv/bin/activate`; otherwise use this repo's configured shared fallback "
        "environment."
    )


def load_dependencies():
    try:
        import numpy as np
        from PIL import Image, ImageFilter
    except ImportError as error:
        die(f"Pillow and NumPy are required for element splitting. {dependency_hint('pillow numpy')} {error}")
    return np, Image, ImageFilter


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="Original source image path.")
    parser.add_argument("--segmentation", required=True, help="Generated color segmentation map path.")
    parser.add_argument("--out-dir", required=True, help="Directory for extracted RGBA PNG layers.")
    parser.add_argument("--max-layers", type=int, default=24, help="Maximum number of element layers to export.")
    parser.add_argument("--palette-size", type=int, default=32, help="Color count used to normalize generated maps.")
    parser.add_argument("--min-area-ratio", type=float, default=0.00035, help="Minimum region area as a ratio of image area.")
    parser.add_argument("--min-area-px", type=int, default=48, help="Absolute minimum region area in pixels.")
    parser.add_argument("--pad", type=int, default=2, help="Transparent padding around cropped layer bounds.")
    parser.add_argument("--edge-feather", type=float, default=0, help="Mask edge feather radius in pixels.")
    parser.add_argument("--boundary-trim", type=int, default=2, help="Trim likely background contamination from this many pixels inside object boundaries.")
    parser.add_argument("--boundary-trim-margin", type=float, default=16, help="Minimum RGB-distance advantage for outside color before trimming boundary pixels.")
    parser.add_argument("--boundary-flood", type=int, default=0, help="Flood-fill likely outside-color contamination this many pixels inward from object boundaries.")
    parser.add_argument("--boundary-flood-color-distance", type=float, default=30, help="Maximum local RGB distance to nearby outside pixels for boundary flood trimming.")
    parser.add_argument("--mask-grow", type=int, default=2, help="Grow foreground masks by this many pixels before extracting layers.")
    parser.add_argument("--mask-grow-color-distance", type=float, default=86, help="Maximum local RGB distance for accepting grown edge pixels; 0 disables color gating.")
    parser.add_argument("--color-merge-distance", type=float, default=48, help="Global RGB distance for merging generated near-colors into one mask color.")
    parser.add_argument("--component-merge-gap-ratio", type=float, default=0.035, help="Auto gap threshold, as a ratio of max image dimension, for merging nearby disconnected same-color components.")
    parser.add_argument("--component-merge-gap-px", type=int, default=0, help="Override pixel gap threshold for merging nearby disconnected same-color components; 0 means auto.")
    parser.add_argument("--split-color-components", action="store_true", help="Split every disconnected component of the same mask color into separate layers.")
    parser.add_argument("--merge-contained", action="store_true", help="Opt in to semantic cleanup that merges nested regions into parent object layers.")
    parser.add_argument("--fill-object-holes", action="store_true", help="Opt in to filling enclosed holes in dense object masks.")
    parser.add_argument("--no-merge-contained", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--no-residual-layer", action="store_true", help="Do not export uncovered source pixels as a residual/background layer.")
    parser.add_argument("--write-reconstruction", action="store_true", help="Write reconstruction and comparison images for verification.")
    parser.add_argument("--force", action="store_true", help="Delete existing PNG layers in out-dir before writing.")
    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    source = Path(args.source)
    segmentation = Path(args.segmentation)
    if not source.exists():
        die(f"Source image not found: {source}")
    if not segmentation.exists():
        die(f"Segmentation image not found: {segmentation}")
    if args.max_layers < 1 or args.max_layers > 128:
        die("--max-layers must be between 1 and 128.")
    if args.palette_size < 2 or args.palette_size > 256:
        die("--palette-size must be between 2 and 256.")
    if args.min_area_ratio < 0 or args.min_area_ratio > 0.2:
        die("--min-area-ratio must be between 0 and 0.2.")
    if args.min_area_px < 1:
        die("--min-area-px must be positive.")
    if args.pad < 0 or args.pad > 128:
        die("--pad must be between 0 and 128.")
    if args.edge_feather < 0 or args.edge_feather > 8:
        die("--edge-feather must be between 0 and 8.")
    if args.boundary_trim < 0 or args.boundary_trim > 16:
        die("--boundary-trim must be between 0 and 16.")
    if args.boundary_trim_margin < 0 or args.boundary_trim_margin > 128:
        die("--boundary-trim-margin must be between 0 and 128.")
    if args.boundary_flood < 0 or args.boundary_flood > 32:
        die("--boundary-flood must be between 0 and 32.")
    if args.boundary_flood_color_distance < 0 or args.boundary_flood_color_distance > 255:
        die("--boundary-flood-color-distance must be between 0 and 255.")
    if args.mask_grow < 0 or args.mask_grow > 64:
        die("--mask-grow must be between 0 and 64.")
    if args.mask_grow_color_distance < 0 or args.mask_grow_color_distance > 255:
        die("--mask-grow-color-distance must be between 0 and 255.")
    if args.color_merge_distance < 0 or args.color_merge_distance > 160:
        die("--color-merge-distance must be between 0 and 160.")
    if args.component_merge_gap_ratio < 0 or args.component_merge_gap_ratio > 0.25:
        die("--component-merge-gap-ratio must be between 0 and 0.25.")
    if args.component_merge_gap_px < 0 or args.component_merge_gap_px > 512:
        die("--component-merge-gap-px must be between 0 and 512.")


def normalize_segmentation(segmentation, size, palette_size):
    _, Image, ImageFilter = load_dependencies()
    resampling = getattr(Image, "Resampling", Image)
    image = segmentation.convert("RGB")
    if image.size != size:
        image = image.resize(size, resampling.NEAREST)
    image = image.filter(ImageFilter.MedianFilter(3))
    quantized = image.quantize(colors=palette_size, method=Image.Quantize.MEDIANCUT)
    return quantized.convert("RGB")


def color_key(color: tuple[int, int, int]) -> str:
    return f"#{color[0]:02x}{color[1]:02x}{color[2]:02x}"


def color_distance(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return sum((a[index] - b[index]) ** 2 for index in range(3)) ** 0.5


def should_ignore_color(color: tuple[int, int, int], area: int, total_area: int) -> bool:
    red, green, blue = color
    spread = max(color) - min(color)
    luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    if area < max(8, int(total_area * 0.00005)):
        return True
    if spread <= 6 and (max(color) <= 10 or min(color) >= 251):
        return True
    if luminance < 28:
        return True
    return red == 255 and green == 0 and blue == 255


def region_bounds(mask):
    np, _, _ = load_dependencies()
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def expand_bbox(bbox: tuple[int, int, int, int], width: int, height: int, pad: int) -> tuple[int, int, int, int]:
    return (
        max(0, bbox[0] - pad),
        max(0, bbox[1] - pad),
        min(width, bbox[2] + pad),
        min(height, bbox[3] + pad),
    )


def bbox_area(bbox: tuple[int, int, int, int]) -> int:
    return max(0, bbox[2] - bbox[0]) * max(0, bbox[3] - bbox[1])


def bbox_contains(parent: tuple[int, int, int, int], child: tuple[int, int, int, int], margin: int = 0) -> bool:
    return (
        child[0] >= parent[0] - margin
        and child[1] >= parent[1] - margin
        and child[2] <= parent[2] + margin
        and child[3] <= parent[3] + margin
    )


def bbox_center(bbox: tuple[int, int, int, int]) -> tuple[float, float]:
    return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)


def point_in_bbox(point: tuple[float, float], bbox: tuple[int, int, int, int]) -> bool:
    return bbox[0] <= point[0] <= bbox[2] and bbox[1] <= point[1] <= bbox[3]


def bbox_gap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> int:
    horizontal = max(0, max(a[0], b[0]) - min(a[2], b[2]))
    vertical = max(0, max(a[1], b[1]) - min(a[3], b[3]))
    return max(horizontal, vertical)


def is_thin_artifact(area: int, bbox: tuple[int, int, int, int], total_area: int) -> bool:
    width = max(1, bbox[2] - bbox[0])
    height = max(1, bbox[3] - bbox[1])
    shortest = min(width, height)
    longest = max(width, height)
    fill_ratio = area / max(1, width * height)
    small_area = area < max(768, int(total_area * 0.004))
    return small_area and (shortest <= 3 or (longest / shortest >= 18 and fill_ratio < 0.05))


def is_thin_component_cluster(components: list[dict[str, Any]], total_area: int) -> bool:
    if not components:
        return False
    area = sum(int(component.get("area", 0)) for component in components)
    if area >= max(768, int(total_area * 0.004)):
        return False
    return all(
        is_thin_artifact(int(component.get("area", 0)), tuple(component.get("bbox", (0, 0, 0, 0))), total_area)
        for component in components
    )


def merge_region_pair(target: dict[str, Any], source: dict[str, Any]) -> None:
    target["mask"] = target["mask"] | source["mask"]
    target["area"] = int(target["mask"].sum())
    target["bbox"] = region_bounds(target["mask"])
    target.setdefault("mergedColors", []).append(color_key(source["color"]))
    target.setdefault("mergedAreas", []).append(source["area"])
    target.setdefault("components", []).extend(source.get("components", []))


def group_similar_colors(colors, counts, total_area: int, min_area: int, merge_distance: float) -> list[dict[str, Any]]:
    """Cluster generated near-colors before extracting masks.

    Imagegen often returns slight gradients or antialias-like variants even when the
    requested output is flat. The segmentation contract is visual-color based, so
    these variants should be grouped globally before connected-component analysis.
    """

    color_items = []
    for color_array, area in zip(colors, counts):
        color = tuple(int(value) for value in color_array)
        area = int(area)
        if should_ignore_color(color, area, total_area):
            continue
        color_items.append({
            "color": color,
            "array": color_array,
            "area": area,
        })

    groups: list[dict[str, Any]] = []
    for item in sorted(color_items, key=lambda entry: entry["area"], reverse=True):
        best_index = None
        best_distance = None
        for index, group in enumerate(groups):
            distance = color_distance(item["color"], group["color"])
            if distance > merge_distance:
                continue
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best_index = index

        if best_index is not None:
            group = groups[best_index]
            group["arrays"].append(item["array"])
            group["area"] += item["area"]
            group["mergedColors"].append(color_key(item["color"]))
            continue

        if item["area"] < min_area:
            continue
        groups.append({
            "color": item["color"],
            "arrays": [item["array"]],
            "area": item["area"],
            "mergedColors": [],
        })

    return groups


def merge_similar_adjacent_regions(regions: list[dict[str, Any]], total_area: int) -> list[dict[str, Any]]:
    """Merge adjacent near-colors caused by non-flat generated mask gradients."""

    if len(regions) < 2:
        return regions

    changed = True
    while changed:
        changed = False
        removed: set[int] = set()
        for i, first in enumerate(regions):
            if i in removed:
                continue
            for j in range(i + 1, len(regions)):
                if j in removed:
                    continue
                second = regions[j]
                if color_distance(first["color"], second["color"]) > 48:
                    continue
                if bbox_gap(first["bbox"], second["bbox"]) > 3:
                    continue
                union_bbox = (
                    min(first["bbox"][0], second["bbox"][0]),
                    min(first["bbox"][1], second["bbox"][1]),
                    max(first["bbox"][2], second["bbox"][2]),
                    max(first["bbox"][3], second["bbox"][3]),
                )
                if bbox_area(union_bbox) > total_area * 0.58:
                    continue
                merge_region_pair(first, second)
                removed.add(j)
                changed = True
            if changed:
                break
        if removed:
            regions = [region for index, region in enumerate(regions) if index not in removed and region["bbox"]]

    return regions


def merge_tiny_similar_color_artifacts(regions: list[dict[str, Any]], total_area: int) -> list[dict[str, Any]]:
    """Merge tiny mask color leftovers into the larger region they visually match."""

    if len(regions) < 2:
        return regions

    tiny_area = max(64, int(total_area * 0.0012))
    removed: set[int] = set()
    for child_index, child in sorted(enumerate(regions), key=lambda item: item[1]["area"]):
        if child_index in removed or child["area"] > tiny_area:
            continue

        candidates = []
        for parent_index, parent in enumerate(regions):
            if parent_index == child_index or parent_index in removed:
                continue
            if parent["area"] <= child["area"] * 8:
                continue
            distance = color_distance(child["color"], parent["color"])
            if distance > 28:
                continue
            candidates.append((distance, -parent["area"], parent_index))

        if not candidates:
            continue
        _, _, parent_index = min(candidates)
        merge_region_pair(regions[parent_index], child)
        removed.add(child_index)

    return [region for index, region in enumerate(regions) if index not in removed and region["bbox"]]


def merge_contained_regions(regions: list[dict[str, Any]], total_area: int) -> list[dict[str, Any]]:
    """Merge likely internal detail regions back into their object-level parent.

    Image models sometimes mark printed graphics, highlights, product UI, or surface
    details as separate colors. For Edit Elements, those details usually belong to the
    containing object layer. This pass is intentionally conservative around full-page
    backgrounds so standalone text does not disappear into the backdrop.
    """

    if len(regions) < 2:
        return regions

    removed: set[int] = set()
    for child_index, child in sorted(enumerate(regions), key=lambda item: item[1]["area"]):
        if child_index in removed:
            continue
        child_bbox = child["bbox"]
        child_center = bbox_center(child_bbox)
        child_bbox_area = bbox_area(child_bbox)
        candidates = []

        for parent_index, parent in enumerate(regions):
            if parent_index == child_index or parent_index in removed:
                continue
            if parent["area"] <= child["area"]:
                continue

            parent_bbox = parent["bbox"]
            parent_bbox_area = bbox_area(parent_bbox)
            if parent_bbox_area <= 0:
                continue
            if parent_bbox_area > total_area * 0.52:
                continue
            if child["area"] > parent["area"] * 0.48:
                continue
            if child_bbox_area > parent_bbox_area * 0.72:
                continue
            if not (bbox_contains(parent_bbox, child_bbox, margin=3) or point_in_bbox(child_center, parent_bbox)):
                continue
            if not parent_surrounds_child(parent["mask"], child_bbox, band=12):
                continue

            candidates.append((parent_bbox_area, parent["area"], parent_index))

        if not candidates:
            continue

        _, _, parent_index = min(candidates)
        parent = regions[parent_index]
        merge_region_pair(parent, child)
        removed.add(child_index)

    return [region for index, region in enumerate(regions) if index not in removed and region["bbox"]]


def mask_overlap_ratio_inside(child_mask, parent_bbox: tuple[int, int, int, int]) -> float:
    left, top, right, bottom = parent_bbox
    child_area = int(child_mask.sum())
    if child_area == 0:
        return 0.0
    inside = int(child_mask[top:bottom, left:right].sum())
    return inside / child_area


def mask_has_pixels(mask, left: int, top: int, right: int, bottom: int) -> bool:
    height, width = mask.shape
    left = max(0, min(width, left))
    right = max(0, min(width, right))
    top = max(0, min(height, top))
    bottom = max(0, min(height, bottom))
    if right <= left or bottom <= top:
        return False
    return bool(mask[top:bottom, left:right].any())


def parent_surrounds_child(parent_mask, child_bbox: tuple[int, int, int, int], band: int = 16) -> bool:
    left, top, right, bottom = child_bbox
    checks = [
        mask_has_pixels(parent_mask, left, top - band, right, top),
        mask_has_pixels(parent_mask, left, bottom, right, bottom + band),
        mask_has_pixels(parent_mask, left - band, top, left, bottom),
        mask_has_pixels(parent_mask, right, top, right + band, bottom),
    ]
    return sum(1 for item in checks if item) >= 3


def merge_internal_detail_regions(regions: list[dict[str, Any]], total_area: int) -> list[dict[str, Any]]:
    """Merge fine-grained generated-mask details into their object-level parent.

    This is deliberately content-agnostic. It catches model outputs that split a
    product's printed graphics, highlights, holes, fruit artwork, or texture patches
    into separate colors even though those regions sit inside a larger object area.
    """

    if len(regions) < 2:
        return regions

    removed: set[int] = set()
    for child_index, child in sorted(enumerate(regions), key=lambda item: item[1]["area"]):
        if child_index in removed:
            continue
        if child["area"] > total_area * 0.09:
            continue

        child_bbox = child["bbox"]
        child_bbox_area = bbox_area(child_bbox)
        candidates = []
        for parent_index, parent in enumerate(regions):
            if parent_index == child_index or parent_index in removed:
                continue
            if parent["area"] <= child["area"] * 1.8:
                continue
            parent_bbox = parent["bbox"]
            parent_bbox_area = bbox_area(parent_bbox)
            if parent_bbox_area <= 0 or parent_bbox_area > total_area * 0.62:
                continue
            if child_bbox_area > parent_bbox_area * 0.55:
                continue

            overlap = mask_overlap_ratio_inside(child["mask"], parent_bbox)
            if overlap < 0.82:
                continue
            if not parent_surrounds_child(parent["mask"], child_bbox):
                continue
            candidates.append((parent_bbox_area, parent["area"], parent_index))

        if not candidates:
            continue
        _, _, parent_index = min(candidates)
        merge_region_pair(regions[parent_index], child)
        removed.add(child_index)

    return [region for index, region in enumerate(regions) if index not in removed and region["bbox"]]


def connected_mask_components(mask, min_component_area):
    np, _, _ = load_dependencies()
    height, width = mask.shape
    visited = np.zeros(mask.shape, dtype=bool)
    components: list[dict[str, Any]] = []

    for start_y, start_x in zip(*np.nonzero(mask & ~visited)):
        if visited[start_y, start_x]:
            continue
        stack = [(int(start_x), int(start_y))]
        visited[start_y, start_x] = True
        pixels: list[tuple[int, int]] = []
        while stack:
            x, y = stack.pop()
            pixels.append((x, y))
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if nx < 0 or ny < 0 or nx >= width or ny >= height:
                    continue
                if visited[ny, nx] or not mask[ny, nx]:
                    continue
                visited[ny, nx] = True
                stack.append((nx, ny))

        area = len(pixels)
        if area < min_component_area:
            continue
        xs = [pixel[0] for pixel in pixels]
        ys = [pixel[1] for pixel in pixels]
        component_mask = np.zeros(mask.shape, dtype=bool)
        for x, y in pixels:
            component_mask[y, x] = True
        components.append({
            "area": area,
            "bbox": [min(xs), min(ys), max(xs) + 1, max(ys) + 1],
            "mask": component_mask,
        })

    return components


def cluster_components_by_gap(components: list[dict[str, Any]], max_gap: int) -> list[dict[str, Any]]:
    """Group nearby disconnected same-color components without merging far objects.

    Imagegen can accidentally reuse one flat color for multiple independent
    objects. Treating every same-color component as one layer makes those objects
    inseparable, but splitting every component breaks text glyphs and multi-piece
    objects. This clusters by spatial proximity only.
    """

    np, _, _ = load_dependencies()
    if not components:
        return []
    if len(components) == 1:
        component = components[0]
        return [{
            "area": int(component["area"]),
            "bbox": tuple(component["bbox"]),
            "mask": component["mask"],
            "components": [{
                "area": int(component["area"]),
                "bbox": list(component["bbox"]),
            }],
        }]

    parent = list(range(len(components)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(first: int, second: int) -> None:
        first_root = find(first)
        second_root = find(second)
        if first_root != second_root:
            parent[second_root] = first_root

    for first_index, first in enumerate(components):
        first_bbox = tuple(first["bbox"])
        for second_index in range(first_index + 1, len(components)):
            second = components[second_index]
            if bbox_gap(first_bbox, tuple(second["bbox"])) <= max_gap:
                union(first_index, second_index)

    groups: dict[int, list[dict[str, Any]]] = {}
    for index, component in enumerate(components):
        groups.setdefault(find(index), []).append(component)

    clustered = []
    for group_components in groups.values():
        if len(group_components) == 1:
            component = group_components[0]
            clustered.append({
                "area": int(component["area"]),
                "bbox": tuple(component["bbox"]),
                "mask": component["mask"],
                "components": [{
                    "area": int(component["area"]),
                    "bbox": list(component["bbox"]),
                }],
            })
            continue

        combined_mask = np.zeros(group_components[0]["mask"].shape, dtype=bool)
        clean_components = []
        for component in group_components:
            combined_mask |= component["mask"]
            clean_components.append({
                "area": int(component["area"]),
                "bbox": list(component["bbox"]),
            })
        clustered.append({
            "area": int(combined_mask.sum()),
            "bbox": region_bounds(combined_mask),
            "mask": combined_mask,
            "components": clean_components,
        })

    return [cluster for cluster in clustered if cluster["bbox"]]


def fill_object_holes(mask):
    np, _, _ = load_dependencies()
    height, width = mask.shape
    visited = np.zeros(mask.shape, dtype=bool)
    outside = np.zeros(mask.shape, dtype=bool)
    stack: list[tuple[int, int]] = []

    for x in range(width):
        if not mask[0, x]:
            stack.append((x, 0))
            visited[0, x] = True
        if not mask[height - 1, x] and not visited[height - 1, x]:
            stack.append((x, height - 1))
            visited[height - 1, x] = True
    for y in range(height):
        if not mask[y, 0] and not visited[y, 0]:
            stack.append((0, y))
            visited[y, 0] = True
        if not mask[y, width - 1] and not visited[y, width - 1]:
            stack.append((width - 1, y))
            visited[y, width - 1] = True

    while stack:
        x, y = stack.pop()
        outside[y, x] = True
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if nx < 0 or ny < 0 or nx >= width or ny >= height:
                continue
            if visited[ny, nx] or mask[ny, nx]:
                continue
            visited[ny, nx] = True
            stack.append((nx, ny))

    return mask | (~mask & ~outside)


def maybe_fill_dense_object_holes(region: dict[str, Any], total_area: int) -> None:
    bbox = region["bbox"]
    area = int(region["area"])
    box_area = max(1, bbox_area(bbox))
    fill_ratio = area / box_area
    if fill_ratio < 0.34:
        return
    if box_area > total_area * 0.45:
        return
    filled = fill_object_holes(region["mask"])
    filled_area = int(filled.sum())
    added = filled_area - area
    if added <= 0:
        return
    if added > max(total_area * 0.08, area * 0.55):
        return
    region["mask"] = filled
    region["area"] = filled_area
    region["bbox"] = region_bounds(filled)
    region.setdefault("filledHolePixels", 0)
    region["filledHolePixels"] += added


def grow_mask(mask, radius: int):
    """Dilate a binary mask to recover pixels lost by underfilled segmentation edges."""

    np, Image, ImageFilter = load_dependencies()
    if radius <= 0:
        return mask
    alpha = Image.fromarray(mask.astype("uint8") * 255)
    grown = alpha.filter(ImageFilter.MaxFilter(radius * 2 + 1))
    return np.array(grown) > 0


def nearest_color_distance(source_rgb, reference_mask, candidates, radius: int):
    np, _, _ = load_dependencies()
    best = np.full(reference_mask.shape, np.inf, dtype=np.float32)
    source = source_rgb.astype(np.int32)
    height, width = reference_mask.shape
    directions = (
        (-1, 0), (1, 0), (0, -1), (0, 1),
        (-1, -1), (1, -1), (-1, 1), (1, 1),
    )
    for step in range(1, max(1, radius) + 1):
        for unit_dx, unit_dy in directions:
            dx = unit_dx * step
            dy = unit_dy * step
            neighbor = np.zeros(reference_mask.shape, dtype=bool)
            neighbor_rgb = np.zeros(source.shape, dtype=np.int32)

            if dx >= 0:
                dst_x = slice(dx, width)
                src_x = slice(0, width - dx)
            else:
                dst_x = slice(0, width + dx)
                src_x = slice(-dx, width)
            if dy >= 0:
                dst_y = slice(dy, height)
                src_y = slice(0, height - dy)
            else:
                dst_y = slice(0, height + dy)
                src_y = slice(-dy, height)

            neighbor[dst_y, dst_x] = reference_mask[src_y, src_x]
            if not neighbor.any():
                continue
            neighbor_rgb[dst_y, dst_x] = source[src_y, src_x]
            active = candidates & neighbor
            if not active.any():
                continue
            diff = source - neighbor_rgb
            distance = np.sqrt(np.sum(diff * diff, axis=2))
            best[active] = np.minimum(best[active], distance[active])

    return best


def color_continuity_mask(source_rgb, anchor_mask, candidates, max_distance: float, radius: int):
    if max_distance <= 0:
        return candidates
    best = nearest_color_distance(source_rgb, anchor_mask, candidates, radius)
    return candidates & (best <= max_distance)


def trim_boundary_contamination(regions: list[dict[str, Any]], source_rgba, radius: int, margin: float) -> None:
    """Remove boundary pixels that match nearby outside colors better than object interior.

    This targets common segmentation-map halo: the generated mask slightly includes
    background or adjacent-object pixels along an object's edge. The test is local and
    content-agnostic, so it does not depend on object names or poster-specific colors.
    """

    np, _, _ = load_dependencies()
    if radius <= 0 or not regions:
        return

    source_rgb_full = np.array(source_rgba.convert("RGB"))
    source_alpha_full = np.array(source_rgba.getchannel("A")) > 0
    full_width, full_height = source_rgba.size
    for region in regions:
        bbox = region["bbox"]
        if not bbox:
            continue
        left, top, right, bottom = expand_bbox(tuple(bbox), full_width, full_height, radius + 4)
        mask = region["mask"][top:bottom, left:right]
        area = int(mask.sum())
        if area <= 0:
            continue
        source_rgb = source_rgb_full[top:bottom, left:right]
        source_alpha = source_alpha_full[top:bottom, left:right]

        boundary = mask & grow_mask(~mask, radius)
        if not boundary.any():
            continue
        core = mask & ~grow_mask(~mask, radius + 2)
        if int(core.sum()) < max(32, int(area * 0.08)):
            continue
        outside = grow_mask(mask, radius + 2) & ~mask & source_alpha
        if not outside.any():
            continue

        outside_distance = nearest_color_distance(source_rgb, outside, boundary, radius + 2)
        inside_distance = nearest_color_distance(source_rgb, core, boundary, radius + 2)
        trim = boundary & np.isfinite(outside_distance) & np.isfinite(inside_distance)
        trim &= (outside_distance + margin < inside_distance)
        trim &= outside_distance <= max(10.0, margin * 2.5)
        trim_pixels = int(trim.sum())
        if trim_pixels <= 0:
            continue
        if trim_pixels > max(int(area * 0.12), 4096):
            continue

        clean_crop = mask & ~trim
        clean_area = int(clean_crop.sum())
        if clean_area < max(16, int(area * 0.82)):
            continue
        clean = region["mask"].copy()
        clean[top:bottom, left:right] = clean_crop
        new_bbox = region_bounds(clean)
        if not new_bbox:
            continue
        region["mask"] = clean
        region["area"] = clean_area
        region["bbox"] = new_bbox
        region["boundaryTrimPixels"] = trim_pixels


def should_flood_trim_region(region: dict[str, Any], total_area: int) -> bool:
    bbox = region["bbox"]
    width = max(1, bbox[2] - bbox[0])
    height = max(1, bbox[3] - bbox[1])
    shortest = min(width, height)
    longest = max(width, height)
    box_area = max(1, width * height)
    fill_ratio = int(region["area"]) / box_area
    aspect = longest / shortest

    if box_area < max(2048, int(total_area * 0.004)):
        return False
    if fill_ratio < 0.24:
        return False
    if fill_ratio < 0.78 and aspect >= 2.35:
        return False
    if fill_ratio < 0.90 and aspect >= 4.0:
        return False
    if fill_ratio < 0.44 and aspect >= 2.6:
        return False
    if shortest < 64 and aspect >= 2.0:
        return False
    return True


def flood_trim_boundary_contamination(regions: list[dict[str, Any]], source_rgba, radius: int, color_distance_threshold: float, total_area: int) -> None:
    """Flood inward from object edges through pixels that look like nearby outside.

    This catches wider halo bands than pointwise boundary trimming while stopping at
    local color discontinuities. It is intentionally limited to an inner boundary band
    so true object interiors and printed details are not reconsidered globally.
    """

    np, _, _ = load_dependencies()
    if radius <= 0 or color_distance_threshold <= 0 or not regions:
        return

    source_rgb_full = np.array(source_rgba.convert("RGB"))
    source_alpha_full = np.array(source_rgba.getchannel("A")) > 0
    full_width, full_height = source_rgba.size
    for region in regions:
        if not should_flood_trim_region(region, total_area):
            region["boundaryFloodSkipped"] = True
            continue
        bbox = region["bbox"]
        if not bbox:
            continue
        left, top, right, bottom = expand_bbox(tuple(bbox), full_width, full_height, radius + 4)
        mask = region["mask"][top:bottom, left:right]
        area = int(mask.sum())
        if area <= 0:
            continue
        source_rgb = source_rgb_full[top:bottom, left:right]
        source_alpha = source_alpha_full[top:bottom, left:right]
        band = mask & grow_mask(~mask, radius)
        if not band.any():
            continue
        outside = grow_mask(mask, 1) & ~mask & source_alpha
        if not outside.any():
            continue

        outside_distance = nearest_color_distance(source_rgb, outside, band, max(1, radius))
        traversable = band & np.isfinite(outside_distance) & (outside_distance <= color_distance_threshold)
        if not traversable.any():
            continue

        trim = traversable & grow_mask(outside, 1)
        previous_count = -1
        for _ in range(radius):
            count = int(trim.sum())
            if count == previous_count:
                break
            previous_count = count
            trim = traversable & grow_mask(trim, 1)

        trim_pixels = int(trim.sum())
        if trim_pixels <= 0:
            continue
        if trim_pixels > max(int(area * 0.16), 8192):
            continue
        clean_crop = mask & ~trim
        clean_area = int(clean_crop.sum())
        if clean_area < max(16, int(area * 0.78)):
            continue
        clean = region["mask"].copy()
        clean[top:bottom, left:right] = clean_crop
        new_bbox = region_bounds(clean)
        if not new_bbox:
            continue
        region["mask"] = clean
        region["area"] = clean_area
        region["bbox"] = new_bbox
        region["boundaryFloodTrimPixels"] = trim_pixels


def grow_foreground_region_masks(regions: list[dict[str, Any]], radius: int, source_rgba, color_distance_threshold: float) -> None:
    """Add a small safety band to foreground masks without case-specific logic.

    Generated segmentation maps are often slightly inside the real object boundary.
    Growing only foreground masks moves those edge pixels back into editable layers
    instead of leaving them stranded in the residual background. Original mask pixels
    keep priority. The grown safety band is allowed to overlap when two objects both
    reach the same previously-unassigned edge pixel; those pixels come from the same
    source image, so stacked reconstruction remains stable while dragged-out elements
    keep less-eroded edges.
    """

    np, _, _ = load_dependencies()
    if radius <= 0 or not regions:
        return

    source_rgb = np.array(source_rgba.convert("RGB"))
    original_masks = [region["mask"].copy() for region in regions]
    original_union = np.zeros(original_masks[0].shape, dtype=bool)
    for mask in original_masks:
        original_union |= mask

    proposals = []
    rejected = []
    for mask in original_masks:
        candidates = grow_mask(mask, radius) & ~original_union
        boundary = mask & grow_mask(~mask, 1)
        accepted = color_continuity_mask(source_rgb, boundary, candidates, color_distance_threshold, radius)
        proposals.append(accepted)
        rejected.append(int(candidates.sum()) - int(accepted.sum()))

    proposal_count = np.zeros(original_masks[0].shape, dtype="uint16")
    for proposal in proposals:
        proposal_count += proposal.astype("uint16")

    shared = proposal_count > 1
    shared_pixels = int(shared.sum())
    for region, original_mask, proposal, rejected_pixels in zip(regions, original_masks, proposals, rejected):
        clean = original_mask | proposal
        grown_pixels = int(proposal.sum())
        if grown_pixels <= 0:
            continue
        region["mask"] = clean
        region["area"] = int(clean.sum())
        region["bbox"] = region_bounds(clean)
        region["maskGrowPixels"] = int(grown_pixels)
        region["maskGrowSharedPixels"] = int((proposal & shared).sum())
        region["maskGrowConflictPixels"] = int(shared_pixels)
        region["maskGrowRejectedPixels"] = int(rejected_pixels)


def safe_layer_name(index: int, color: tuple[int, int, int] | None) -> str:
    if color is None:
        return f"element-{index:02d}-background.png"
    return f"element-{index:02d}-{color[0]:02x}{color[1]:02x}{color[2]:02x}.png"


def write_layer(source_rgba, mask, bbox, output_path: Path, pad: int, edge_feather: float) -> dict[str, Any]:
    np, Image, ImageFilter = load_dependencies()
    width, height = source_rgba.size
    left, top, right, bottom = bbox
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(width, right + pad)
    bottom = min(height, bottom + pad)

    crop = source_rgba.crop((left, top, right, bottom))
    alpha_array = (mask[top:bottom, left:right].astype("uint8") * 255)
    alpha = Image.fromarray(alpha_array)
    if edge_feather > 0:
        alpha = alpha.filter(ImageFilter.GaussianBlur(radius=edge_feather))

    source_alpha = crop.getchannel("A")
    alpha_np = np.array(alpha, dtype=np.uint16)
    source_alpha_np = np.array(source_alpha, dtype=np.uint16)
    combined_alpha = ((alpha_np * source_alpha_np) // 255).astype("uint8")
    crop.putalpha(Image.fromarray(combined_alpha))
    crop.save(output_path)
    nonzero = int((combined_alpha > 0).sum())
    return {
        "path": str(output_path),
        "bbox": [left, top, right, bottom],
        "width": right - left,
        "height": bottom - top,
        "visiblePixels": nonzero,
    }


def image_difference_metrics(source_rgba, reconstruction):
    np, _, _ = load_dependencies()
    source = np.array(source_rgba.convert("RGBA"), dtype=np.int16)
    rebuilt = np.array(reconstruction.convert("RGBA"), dtype=np.int16)
    alpha = rebuilt[:, :, 3]
    covered = alpha > 0
    coverage_ratio = float(covered.sum()) / float(alpha.size)

    white = np.full(source.shape, 255, dtype=np.int16)
    white[:, :, 3] = 255
    source_alpha = source[:, :, 3:4] / 255.0
    rebuilt_alpha = rebuilt[:, :, 3:4] / 255.0
    source_flat = (source[:, :, :3] * source_alpha + 255 * (1 - source_alpha)).astype(np.int16)
    rebuilt_flat = (rebuilt[:, :, :3] * rebuilt_alpha + 255 * (1 - rebuilt_alpha)).astype(np.int16)
    absolute = np.abs(source_flat - rebuilt_flat)

    if covered.any():
        covered_mean = float(np.abs(source[:, :, :3][covered] - rebuilt[:, :, :3][covered]).mean())
    else:
        covered_mean = 255.0

    return {
        "coverageRatio": round(coverage_ratio, 6),
        "meanAbsRgbAllOnWhite": round(float(absolute.mean()), 4),
        "meanAbsRgbCovered": round(covered_mean, 4),
        "maxAbsRgbAllOnWhite": int(absolute.max()),
    }


def write_reconstruction_outputs(source_rgba, manifest: dict[str, Any], out_dir: Path) -> dict[str, Any]:
    np, Image, _ = load_dependencies()
    reconstruction = Image.new("RGBA", source_rgba.size, (0, 0, 0, 0))
    for layer in manifest["layers"]:
        layer_image = Image.open(layer["path"]).convert("RGBA")
        left, top, _, _ = layer["bbox"]
        reconstruction.alpha_composite(layer_image, (left, top))

    reconstruction_path = out_dir / "reconstruction.png"
    comparison_path = out_dir / "reconstruction-comparison.png"
    difference_path = out_dir / "reconstruction-diff.png"
    reconstruction.save(reconstruction_path)

    source_flat = Image.new("RGBA", source_rgba.size, (255, 255, 255, 255))
    source_flat.alpha_composite(source_rgba)
    rebuilt_flat = Image.new("RGBA", source_rgba.size, (255, 255, 255, 255))
    rebuilt_flat.alpha_composite(reconstruction)

    source_np = np.array(source_flat.convert("RGB"), dtype=np.int16)
    rebuilt_np = np.array(rebuilt_flat.convert("RGB"), dtype=np.int16)
    diff = np.abs(source_np - rebuilt_np).astype("uint8")
    boosted = np.clip(diff.astype(np.int16) * 4, 0, 255).astype("uint8")
    Image.fromarray(boosted).save(difference_path)

    width, height = source_rgba.size
    comparison = Image.new("RGB", (width * 3, height), (255, 255, 255))
    comparison.paste(source_flat.convert("RGB"), (0, 0))
    comparison.paste(rebuilt_flat.convert("RGB"), (width, 0))
    comparison.paste(Image.open(difference_path).convert("RGB"), (width * 2, 0))
    comparison.save(comparison_path)

    metrics = image_difference_metrics(source_rgba, reconstruction)
    return {
        **metrics,
        "reconstructionPath": str(reconstruction_path),
        "comparisonPath": str(comparison_path),
        "differencePath": str(difference_path),
    }


def split_elements(args: argparse.Namespace) -> dict[str, Any]:
    np, Image, _ = load_dependencies()
    source_path = Path(args.source)
    segmentation_path = Path(args.segmentation)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.force:
        for item in out_dir.glob("*.png"):
            item.unlink()

    source_rgba = Image.open(source_path).convert("RGBA")
    segmentation = Image.open(segmentation_path)
    normalized = normalize_segmentation(segmentation, source_rgba.size, args.palette_size)
    normalized_array = np.array(normalized.convert("RGB"))
    height, width = normalized_array.shape[:2]
    total_area = width * height
    min_area = max(args.min_area_px, int(total_area * args.min_area_ratio))
    min_component_area = max(6, min(args.min_area_px, min_area // 8))
    component_merge_gap_px = args.component_merge_gap_px
    if component_merge_gap_px <= 0:
        component_merge_gap_px = max(12, min(96, int(round(max(width, height) * args.component_merge_gap_ratio))))

    flat = normalized_array.reshape(-1, 3)
    colors, counts = np.unique(flat, axis=0, return_counts=True)
    color_groups = group_similar_colors(colors, counts, total_area, min_area, args.color_merge_distance)
    regions = []
    for group in color_groups:
        color = group["color"]
        color_mask = np.zeros((height, width), dtype=bool)
        for color_array in group["arrays"]:
            color_mask |= np.all(normalized_array == color_array, axis=2)
        components = connected_mask_components(color_mask, min_component_area)
        if not args.split_color_components:
            for cluster in cluster_components_by_gap(components, component_merge_gap_px):
                clean_area = int(cluster["area"])
                if clean_area < min_area:
                    continue
                if is_thin_artifact(clean_area, tuple(cluster["bbox"]), total_area):
                    continue
                if is_thin_component_cluster(cluster.get("components", []), total_area):
                    continue
                regions.append({
                    "color": color,
                    "area": clean_area,
                    "bbox": cluster["bbox"],
                    "mask": cluster["mask"],
                    "mergedColors": group["mergedColors"],
                    "components": cluster["components"],
                })
            continue

        for component in components:
            clean_area = int(component["area"])
            if clean_area < min_area:
                continue
            bbox = tuple(component["bbox"])
            if is_thin_artifact(clean_area, bbox, total_area):
                continue
            regions.append({
                "color": color,
                "area": clean_area,
                "bbox": bbox,
                "mask": component["mask"],
                "mergedColors": group["mergedColors"],
                "components": [{
                    "area": clean_area,
                    "bbox": list(bbox),
                }],
            })

    if args.merge_contained and not args.no_merge_contained:
        regions = merge_contained_regions(regions, total_area)
        regions = merge_internal_detail_regions(regions, total_area)
        regions = merge_contained_regions(regions, total_area)

    if args.fill_object_holes:
        for region in regions:
            maybe_fill_dense_object_holes(region, total_area)

    trim_boundary_contamination(regions, source_rgba, args.boundary_trim, args.boundary_trim_margin)
    flood_trim_boundary_contamination(regions, source_rgba, args.boundary_flood, args.boundary_flood_color_distance, total_area)
    regions.sort(key=lambda item: (-item["area"], item["bbox"][1], item["bbox"][0]))
    selected = regions[:args.max_layers]
    grow_foreground_region_masks(selected, args.mask_grow, source_rgba, args.mask_grow_color_distance)
    layers = []
    for index, region in enumerate(selected, 1):
        output_path = out_dir / safe_layer_name(index, region["color"])
        layer = write_layer(source_rgba, region["mask"], region["bbox"], output_path, args.pad, args.edge_feather)
        layers.append({
            **layer,
            "index": index,
            "segmentationColor": color_key(region["color"]),
            "mergedColors": region.get("mergedColors", []),
            "mergedAreas": region.get("mergedAreas", []),
            "filledHolePixels": region.get("filledHolePixels", 0),
            "boundaryTrimPixels": region.get("boundaryTrimPixels", 0),
            "boundaryFloodTrimPixels": region.get("boundaryFloodTrimPixels", 0),
            "boundaryFloodSkipped": region.get("boundaryFloodSkipped", False),
            "maskGrowPixels": region.get("maskGrowPixels", 0),
            "maskGrowSharedPixels": region.get("maskGrowSharedPixels", 0),
            "maskGrowConflictPixels": region.get("maskGrowConflictPixels", 0),
            "maskGrowRejectedPixels": region.get("maskGrowRejectedPixels", 0),
            "areaPixels": region["area"],
            "components": region["components"][:64],
        })

    background_area = 0
    if not args.no_residual_layer:
        source_alpha = np.array(source_rgba.getchannel("A")) > 0
        covered = np.zeros(source_alpha.shape, dtype=bool)
        for region in selected:
            covered |= region["mask"]
        background_mask = source_alpha & ~covered
        background_area = int(background_mask.sum())
        background_bbox = region_bounds(background_mask)
        if background_bbox and background_area >= min_area:
            index = len(layers) + 1
            output_path = out_dir / safe_layer_name(index, None)
            layer = write_layer(source_rgba, background_mask, background_bbox, output_path, args.pad, args.edge_feather)
            layers.append({
                **layer,
                "index": index,
                "kind": "background",
                "segmentationColor": None,
                "mergedColors": [],
                "mergedAreas": [],
                "areaPixels": background_area,
                "components": [{
                    "area": background_area,
                    "bbox": list(background_bbox),
                }],
            })

    manifest = {
        "source": str(source_path),
        "segmentation": str(segmentation_path),
        "sourceSize": {"width": width, "height": height},
        "paletteSize": args.palette_size,
        "colorMergeDistance": args.color_merge_distance,
        "componentMergeGapPixels": component_merge_gap_px,
        "boundaryTrimPixels": args.boundary_trim,
        "boundaryTrimMargin": args.boundary_trim_margin,
        "boundaryFloodPixels": args.boundary_flood,
        "boundaryFloodColorDistance": args.boundary_flood_color_distance,
        "maskGrowPixels": args.mask_grow,
        "maskGrowColorDistance": args.mask_grow_color_distance,
        "minAreaPixels": min_area,
        "mode": "edge-safe-trim-overlap-mask",
        "mergeContained": bool(args.merge_contained and not args.no_merge_contained),
        "fillObjectHoles": bool(args.fill_object_holes),
        "backgroundLayer": not args.no_residual_layer,
        "backgroundAreaPixels": background_area,
        "exportedLayers": len(layers),
        "candidateRegions": len(regions),
        "layers": layers,
    }

    if args.write_reconstruction:
        manifest["reconstruction"] = write_reconstruction_outputs(source_rgba, manifest, out_dir)

    (out_dir / "elements-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> None:
    args = parse_args()
    validate_args(args)
    manifest = split_elements(args)
    if manifest["exportedLayers"] == 0:
        die("No element layers were extracted. Try a clearer segmentation map or a lower min-area threshold.")
    print(json.dumps({
        "exportedLayers": manifest["exportedLayers"],
        "candidateRegions": manifest["candidateRegions"],
        "outDir": str(Path(args.out_dir)),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
