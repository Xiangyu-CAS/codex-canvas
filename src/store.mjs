import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { assetsDirFor, dataDirFor, statePathFor } from "./paths.mjs";

const defaultState = {
  version: 1,
  title: "Untitled",
  viewport: { x: 0, y: 0, zoom: 0.72 },
  objects: [],
  selection: null,
  updatedAt: null
};

const defaultImageSize = { width: 360, height: 360 };
const maxImageDisplaySize = 420;
const derivedGap = 72;

export async function ensureProjectStore(projectDir) {
  await fs.mkdir(assetsDirFor(projectDir), { recursive: true });
  const statePath = statePathFor(projectDir);
  try {
    await fs.access(statePath);
  } catch {
    await writeState(projectDir, defaultState);
  }
}

export async function readState(projectDir) {
  await ensureProjectStore(projectDir);
  const raw = await fs.readFile(statePathFor(projectDir), "utf8");
  return { ...defaultState, ...JSON.parse(raw) };
}

export async function writeState(projectDir, state) {
  await fs.mkdir(dataDirFor(projectDir), { recursive: true });
  const next = {
    ...defaultState,
    ...state,
    updatedAt: new Date().toISOString()
  };
  await fs.writeFile(statePathFor(projectDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export async function addImage(projectDir, input) {
  await ensureProjectStore(projectDir);

  const asset = await persistImage(projectDir, input);
  const state = await readState(projectDir);
  const count = state.objects.length;
  const displaySize = imageDisplaySize(asset, input);
  const object = {
    id: `img_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    type: "image",
    name: input.name || asset.name,
    src: asset.src,
    assetPath: asset.assetPath,
    sourcePath: asset.sourcePath || null,
    prompt: input.prompt || "",
    sourceObjectId: input.sourceObjectId || null,
    batchId: input.batchId || null,
    layoutMode: input.layoutMode || "manual",
    x: Number.isFinite(input.x) ? input.x : 120 + (count % 5) * 56,
    y: Number.isFinite(input.y) ? input.y : 120 + (count % 7) * 44,
    width: displaySize.width,
    height: displaySize.height,
    naturalWidth: asset.width || null,
    naturalHeight: asset.height || null,
    hasAlpha: Boolean(asset.hasAlpha),
    createdAt: new Date().toISOString()
  };

  const next = {
    ...state,
    objects: [...state.objects, object],
    selection: object.id
  };
  await writeState(projectDir, next);
  return object;
}

export async function addObject(projectDir, input) {
  await ensureProjectStore(projectDir);
  const state = await readState(projectDir);
  const type = typeof input.type === "string" ? input.type : "";
  if (!["drawing", "text"].includes(type)) {
    const error = new Error("add_object requires type to be drawing or text");
    error.statusCode = 400;
    throw error;
  }

  const object = normalizeObject(input);
  const next = {
    ...state,
    objects: [...state.objects, object],
    selection: object.id
  };
  await writeState(projectDir, next);
  return object;
}

export async function addJobPlaceholder(projectDir, input) {
  await ensureProjectStore(projectDir);
  const state = await readState(projectDir);
  const source = state.objects.find((object) => object.id === input.sourceObjectId);
  if (!source) {
    const error = new Error(`Source canvas object not found: ${input.sourceObjectId || "(missing)"}`);
    error.statusCode = 404;
    throw error;
  }

  const width = Number.isFinite(input.width) ? input.width : source.width;
  const height = Number.isFinite(input.height) ? input.height : source.height;
  const position = adjacentDerivedPosition(source);
  const shift = width + derivedGap;
  const object = {
    id: input.id || `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    type: "job",
    name: input.name || "Working",
    action: input.action || "image-job",
    status: input.status || "running",
    sourceObjectId: source.id,
    layoutMode: "canvas-row",
    src: source.src || null,
    assetPath: source.assetPath || null,
    x: position.x,
    y: position.y,
    width,
    height,
    naturalWidth: source.naturalWidth || null,
    naturalHeight: source.naturalHeight || null,
    createdAt: new Date().toISOString()
  };

  const shiftedObjects = state.objects.map((item) => {
    if (item.sourceObjectId !== source.id) return item;
    if (item.x < position.x) return item;
    return { ...item, x: item.x + shift };
  });

  await writeState(projectDir, {
    ...state,
    objects: [...shiftedObjects, object]
  });
  return object;
}

export async function updateSelection(projectDir, selection) {
  const state = await readState(projectDir);
  await writeState(projectDir, { ...state, selection });
  return selection;
}

export async function updateViewport(projectDir, viewport) {
  const state = await readState(projectDir);
  const nextViewport = {
    x: Number.isFinite(viewport.x) ? viewport.x : state.viewport.x,
    y: Number.isFinite(viewport.y) ? viewport.y : state.viewport.y,
    zoom: Number.isFinite(viewport.zoom) ? viewport.zoom : state.viewport.zoom
  };
  await writeState(projectDir, { ...state, viewport: nextViewport });
  return nextViewport;
}

export async function updateProjectMeta(projectDir, patch) {
  const state = await readState(projectDir);
  const title = typeof patch.title === "string" && patch.title.trim()
    ? patch.title.trim().slice(0, 120)
    : state.title;
  const next = await writeState(projectDir, { ...state, title });
  return { title: next.title };
}

export async function updateObject(projectDir, id, patch) {
  const state = await readState(projectDir);
  let updated = null;
  const objects = state.objects.map((object) => {
    if (object.id !== id) return object;
    updated = { ...object, ...patch, id: object.id, type: object.type };
    return updated;
  });

  if (!updated) {
    const error = new Error(`Canvas object not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }

  await writeState(projectDir, { ...state, objects });
  return updated;
}

export async function markStaleJobPlaceholders(projectDir, { activePlaceholderIds = [], timeoutMs = 2 * 60_000 } = {}) {
  const state = await readState(projectDir);
  const active = new Set(activePlaceholderIds);
  const now = Date.now();
  let changed = false;
  const objects = state.objects.map((object) => {
    if (object.type !== "job") return object;
    if (object.status === "failed") {
      if (object.error) return object;
      changed = true;
      return { ...object, error: "The image job failed before reporting an error." };
    }
    if (active.has(object.id)) return object;
    const createdAt = Date.parse(object.createdAt || "");
    if (!Number.isFinite(createdAt) || now - createdAt < timeoutMs) return object;
    changed = true;
    return {
      ...object,
      status: "failed",
      error: object.error || "The image job timed out or was interrupted."
    };
  });

  if (!changed) return state;
  return writeState(projectDir, { ...state, objects });
}

export async function deleteObject(projectDir, id) {
  const state = await readState(projectDir);
  const objects = state.objects.filter((object) => object.id !== id);
  if (objects.length === state.objects.length) {
    const error = new Error(`Canvas object not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }

  const selection = state.selection === id ? null : state.selection;
  await writeState(projectDir, { ...state, objects, selection });
  return { id, deleted: true };
}

function adjacentDerivedPosition(source) {
  return {
    x: source.x + source.width + derivedGap,
    y: source.y
  };
}

function normalizeObject(input) {
  const type = input.type;
  const base = {
    id: `${type}_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
    type,
    name: input.name || (type === "text" ? "Text" : "Drawing"),
    x: Number.isFinite(input.x) ? input.x : 120,
    y: Number.isFinite(input.y) ? input.y : 120,
    width: Number.isFinite(input.width) ? Math.max(1, Math.round(input.width)) : 220,
    height: Number.isFinite(input.height) ? Math.max(1, Math.round(input.height)) : 80,
    createdAt: new Date().toISOString()
  };

  if (type === "text") {
    return {
      ...base,
      text: typeof input.text === "string" ? input.text.slice(0, 2000) : "Text",
      fontSize: Number.isFinite(input.fontSize) ? input.fontSize : 28,
      color: typeof input.color === "string" ? input.color : "#202124"
    };
  }

  return {
    ...base,
    points: Array.isArray(input.points)
      ? input.points
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
        .slice(0, 4000)
      : [],
    stroke: typeof input.stroke === "string" ? input.stroke : "#202124",
    strokeWidth: Number.isFinite(input.strokeWidth) ? input.strokeWidth : 4
  };
}

async function persistImage(projectDir, input) {
  const assetsDir = assetsDirFor(projectDir);
  await fs.mkdir(assetsDir, { recursive: true });

  if (input.path) {
    const sourcePath = path.resolve(input.path);
    const ext = normalizeExt(path.extname(sourcePath)) || ".png";
    const name = safeAssetName(input.name || path.basename(sourcePath, ext), ext);
    const assetPath = path.join(assetsDir, name);
    await fs.copyFile(sourcePath, assetPath);
    const dimensions = await readImageDimensions(assetPath);
    return {
      name,
      assetPath,
      sourcePath,
      ...dimensions,
      src: `/assets/${encodeURIComponent(name)}`
    };
  }

  if (input.dataUrl) {
    const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(input.dataUrl);
    if (!match) {
      const error = new Error("dataUrl must be a base64 image data URL");
      error.statusCode = 400;
      throw error;
    }
    const ext = normalizeExt(`.${match[1]}`) || ".png";
    const name = safeAssetName(input.name || "image", ext);
    const assetPath = path.join(assetsDir, name);
    const buffer = Buffer.from(match[2], "base64");
    await fs.writeFile(assetPath, buffer);
    const dimensions = readImageDimensionsFromBuffer(buffer);
    return {
      name,
      assetPath,
      ...dimensions,
      src: `/assets/${encodeURIComponent(name)}`
    };
  }

  if (input.url) {
    return {
      name: input.name || input.url.split("/").pop() || "remote-image",
      assetPath: null,
      src: input.url
    };
  }

  const error = new Error("add_image requires one of: path, dataUrl, or url");
  error.statusCode = 400;
  throw error;
}

function imageDisplaySize(asset, input) {
  if (Number.isFinite(input.width) && Number.isFinite(input.height)) {
    return { width: input.width, height: input.height };
  }

  if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
    return defaultImageSize;
  }

  const scale = Math.min(1, maxImageDisplaySize / Math.max(asset.width, asset.height));
  return {
    width: Math.max(1, Math.round(asset.width * scale)),
    height: Math.max(1, Math.round(asset.height * scale))
  };
}

async function readImageDimensions(filePath) {
  try {
    return readImageDimensionsFromBuffer(await fs.readFile(filePath));
  } catch {
    return {};
  }
}

function readImageDimensionsFromBuffer(buffer) {
  return readPngDimensions(buffer)
    || readJpegDimensions(buffer)
    || readGifDimensions(buffer)
    || readWebpDimensions(buffer)
    || {};
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    hasAlpha: buffer[25] === 4 || buffer[25] === 6
  };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xc3) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + length;
  }
  return null;
}

function readGifDimensions(buffer) {
  if (buffer.length < 10 || buffer.toString("ascii", 0, 3) !== "GIF") return null;
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8)
  };
}

function readWebpDimensions(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }

  const format = buffer.toString("ascii", 12, 16);
  if (format === "VP8 " && buffer.length >= 30) {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff
    };
  }
  if (format === "VP8L" && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1
    };
  }
  if (format === "VP8X" && buffer.length >= 30) {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3)
    };
  }
  return null;
}

function normalizeExt(ext) {
  const lower = ext.toLowerCase();
  if (lower === ".jpeg") return ".jpg";
  if ([".png", ".jpg", ".webp", ".gif", ".avif"].includes(lower)) return lower;
  return ".png";
}

function safeAssetName(baseName, ext) {
  const cleanBase = String(baseName)
    .replace(/\.[a-zA-Z0-9]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
  return `${Date.now()}-${crypto.randomBytes(3).toString("hex")}-${cleanBase}${ext}`;
}
