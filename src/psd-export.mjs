import fs from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { writePsdBuffer } from "ag-psd";
import { readState } from "./store.mjs";

export async function exportLayerGroupPsd(projectDir, groupId, options = {}) {
  const state = await readState(projectDir, options);
  const members = state.objects
    .filter((object) => object.layerGroupId === groupId && (object.type || "image") === "image")
    .sort((a, b) => (a.layerGroupIndex || 0) - (b.layerGroupIndex || 0));

  if (members.length === 0) {
    const error = new Error("Layer group not found or has no image layers.");
    error.statusCode = 404;
    throw error;
  }

  const bounds = boundsForObjects(members);
  const children = [];
  for (const member of members) {
    const assetPath = member.assetPath || member.sourcePath;
    if (!assetPath) continue;
    const png = await readPng(assetPath, member);
    const left = Math.round(member.x - bounds.x);
    const top = Math.round(member.y - bounds.y);
    children.push({
      name: layerName(member),
      left,
      top,
      right: left + png.width,
      bottom: top + png.height,
      opacity: 1,
      imageData: {
        data: png.data,
        width: png.width,
        height: png.height
      }
    });
  }

  if (children.length === 0) {
    const error = new Error("Layer group has no readable PNG layers.");
    error.statusCode = 400;
    throw error;
  }

  const buffer = writePsdBuffer({
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
    children
  }, {
    noBackground: true,
    invalidateTextLayers: true
  });

  return {
    buffer,
    filename: `${safeDownloadName(members[0]?.layerGroupName || "agent-canvas-layers")}.psd`,
    layerCount: children.length
  };
}

async function readPng(filePath, member) {
  let png;
  try {
    png = PNG.sync.read(await fs.readFile(filePath));
  } catch (error) {
    const exported = new Error(`PSD export only supports PNG image layers. Failed to read ${path.basename(filePath)}.`);
    exported.statusCode = 400;
    exported.cause = error;
    throw exported;
  }
  const expectedWidth = Math.max(1, Math.round(member.width));
  const expectedHeight = Math.max(1, Math.round(member.height));
  if (png.width === expectedWidth && png.height === expectedHeight) return png;
  return resizePngNearest(png, expectedWidth, expectedHeight);
}

function resizePngNearest(png, width, height) {
  const next = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(png.height - 1, Math.floor(y * png.height / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(png.width - 1, Math.floor(x * png.width / width));
      const sourceIndex = (sourceY * png.width + sourceX) * 4;
      const targetIndex = (y * width + x) * 4;
      next[targetIndex] = png.data[sourceIndex];
      next[targetIndex + 1] = png.data[sourceIndex + 1];
      next[targetIndex + 2] = png.data[sourceIndex + 2];
      next[targetIndex + 3] = png.data[sourceIndex + 3];
    }
  }
  return { data: next, width, height };
}

function boundsForObjects(objects) {
  const left = Math.min(...objects.map((object) => object.x));
  const top = Math.min(...objects.map((object) => object.y));
  const right = Math.max(...objects.map((object) => object.x + object.width));
  const bottom = Math.max(...objects.map((object) => object.y + object.height));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
}

function layerName(member) {
  const kind = member.layerGroupKind || "layer";
  const index = Number.isFinite(member.layerGroupIndex) ? member.layerGroupIndex : 0;
  return `${String(index).padStart(2, "0")} ${member.name || kind}`;
}

function safeDownloadName(name) {
  const cleaned = String(name || "agent-canvas-layers")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || "agent-canvas-layers";
}
