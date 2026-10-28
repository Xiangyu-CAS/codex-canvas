import fs from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { addImage, isSupportedImageBuffer, readState, repairTruncatedImageAsset } from "./store.mjs";
import { assetsDirFor } from "./paths.mjs";

const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"]);
const boardPadding = 120;
const verticalGap = 56;
const horizontalGap = 64;
const editGap = 72;
const batchWindowMs = 12_000;
const defaultCollectLimit = 20;
const maxCollectLimit = 100;
const generatedImagesRootEnv = "CODEX_CANVAS_GENERATED_IMAGES_ROOT";

export async function collectRecentImages(projectDir, options = {}) {
  const storeOptions = { canvasId: options.canvasId || null };
  const roots = normalizeRoots(projectDir, options.roots, {
    threadId: options.threadId,
    generatedImagesRoot: options.generatedImagesRoot
  });
  const sinceMs = Number.isFinite(options.sinceMs) ? options.sinceMs : Date.now() - 2 * 60 * 60 * 1000;
  const limit = normalizeCollectLimit(options.limit);
  const excludePaths = new Set((options.excludePaths || []).map((item) => path.resolve(item)));
  const retryPaths = new Set((options.pendingPaths || []).map((item) => path.resolve(item)));
  const pendingPaths = new Set();
  const state = await readState(projectDir, { ...storeOptions, readOnly: true });
  const repaired = options.repairTruncated && !options.roots?.length
    ? await repairTruncatedCollectedImages(projectDir, state.objects, roots[0], storeOptions)
    : 0;
  const knownSources = new Set(
    state.objects
      .map((object) => object.sourcePath)
      .filter(Boolean)
      .map((sourcePath) => path.resolve(sourcePath))
  );
  const knownHashes = await knownImageHashes(state.objects);

  const candidates = [];
  for (const root of roots) {
    await walkImages(root, {
      candidates,
      knownHashes,
      knownSources,
      excludePaths,
      retryPaths,
      pendingPaths,
      projectDir,
      sinceMs
    });
  }

  candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
  // Keep candidates beyond this pass's limit eligible after the watermark moves.
  for (const candidate of candidates.slice(0, -limit)) pendingPaths.add(candidate.path);
  const imported = [];
  const planned = planImageLayout({
    candidates: candidates.slice(-limit),
    state,
    options
  });
  for (const candidate of planned) {
    // Persist the same bytes that were checked. The producer may still be
    // replacing or writing the source while a collection pass is running.
    let imageBuffer;
    try { imageBuffer = await fs.readFile(candidate.path); } catch { continue; }
    if (!isSupportedImageBuffer(imageBuffer) || !isCompletePng(imageBuffer)) {
      pendingPaths.add(candidate.path);
      continue;
    }
    const object = await addImage(projectDir, {
      path: candidate.path,
      name: path.basename(candidate.path),
      prompt: options.prompt || "Collected recent image",
      imagegenPrompt: options.imagegenPrompt || "",
      x: candidate.x,
      y: candidate.y,
      batchId: candidate.batchId,
      layoutMode: candidate.layoutMode,
      sourceObjectId: options.sourceObjectId || null
    }, { ...storeOptions, imageBuffer });
    imported.push(object);
  }

  return { scannedRoots: roots, imported, repaired, skippedKnown: knownSources.size, pendingPaths: [...pendingPaths] };
}

// Only restore a proven prefix of its original generated PNG, within this
// thread's own output directory. Do not replace other damaged or edited assets.
async function repairTruncatedCollectedImages(projectDir, objects, threadRoot, storeOptions) {
  if (!threadRoot) return 0;
  let realRoot, realAssets;
  try {
    if (!(await fs.lstat(threadRoot)).isDirectory()) return 0;
    realRoot = await fs.realpath(threadRoot);
    realAssets = await fs.realpath(assetsDirFor(projectDir, storeOptions.canvasId));
  } catch { return 0; }
  let repaired = 0;
  for (const object of objects) {
    if ((object.type || "image") !== "image" || !object.layoutMode?.startsWith("session-") || !object.sourcePath || !object.assetPath) continue;
    const source = path.resolve(object.sourcePath);
    if (!isInsideDirectory(threadRoot, source)) continue;
    try {
      if (!(await fs.lstat(object.assetPath)).isFile() || path.dirname(await fs.realpath(object.assetPath)) !== realAssets) continue;
      const asset = await fs.readFile(object.assetPath);
      if (!hasPngSignature(asset) || isCompletePng(asset)) continue;
      if (!(await fs.lstat(source)).isFile()) continue;
      if (!isInsideDirectory(realRoot, await fs.realpath(source))) continue;
      const full = await fs.readFile(source);
      if (!isSupportedImageBuffer(full) || !hasPngSignature(full) || !isCompletePng(full)) continue;
      if (asset.length >= full.length || !full.subarray(0, asset.length).equals(asset)) continue;
      if (await repairTruncatedImageAsset(projectDir, object, asset, full, storeOptions)) repaired++;
    } catch {
      // A missing, changing, or inaccessible file can be retried on the next pass.
    }
  }
  return repaired;
}

function isInsideDirectory(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function normalizeCollectLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return defaultCollectLimit;
  return Math.min(maxCollectLimit, Math.max(1, Math.round(number)));
}

function planImageLayout({ candidates, state, options }) {
  if (candidates.length === 0) return [];

  if (options.sourceObjectId) {
    return planCanvasDerivedRow(candidates, state, options.sourceObjectId);
  }

  const batches = groupSessionBatches(candidates);
  let nextY = nextSessionY(state);
  const planned = [];

  for (const batch of batches) {
    const batchId = `session_${Math.round(batch[0].mtimeMs)}`;
    if (batch.length > 1) {
      const row = planRow(batch, {
        x: boardPadding,
        y: nextY,
        batchId,
        layoutMode: "session-row"
      });
      planned.push(...row);
      nextY += maxHeight(row) + verticalGap;
      continue;
    }

    const candidate = batch[0];
    planned.push({
      ...candidate,
      x: boardPadding,
      y: nextY,
      batchId,
      layoutMode: "session-column"
    });
    nextY += displayHeight(candidate) + verticalGap;
  }

  return planned;
}

function planCanvasDerivedRow(candidates, state, sourceObjectId) {
  const source = state.objects.find((object) => object.id === sourceObjectId);
  const startX = source ? source.x + source.width + editGap : rightmostX(state) + horizontalGap;
  const startY = source ? source.y : boardPadding;
  return planRow(candidates, {
    x: startX,
    y: startY,
    batchId: `canvas_${sourceObjectId}_${Date.now()}`,
    layoutMode: "canvas-row"
  });
}

function planRow(candidates, { x, y, batchId, layoutMode }) {
  let cursorX = x;
  return candidates.map((candidate) => {
    const planned = {
      ...candidate,
      x: cursorX,
      y,
      batchId,
      layoutMode
    };
    cursorX += displayWidth(candidate) + horizontalGap;
    return planned;
  });
}

function groupSessionBatches(candidates) {
  const groups = [];
  for (const candidate of candidates) {
    const last = groups.at(-1);
    const sameDirectory = last && path.dirname(last[0].path) === path.dirname(candidate.path);
    const closeInTime = last && Math.abs(candidate.mtimeMs - last.at(-1).mtimeMs) <= batchWindowMs;
    if (sameDirectory && closeInTime) {
      last.push(candidate);
    } else {
      groups.push([candidate]);
    }
  }
  return groups;
}

function nextSessionY(state) {
  const sessionObjects = state.objects.filter((object) => object.layoutMode?.startsWith("session"));
  const base = sessionObjects.length > 0 ? bottommostY({ objects: sessionObjects }) + verticalGap : boardPadding;
  return Math.max(boardPadding, base);
}

function rightmostX(state) {
  return state.objects.reduce((right, object) => Math.max(right, object.x + object.width), boardPadding);
}

function bottommostY(state) {
  return state.objects.reduce((bottom, object) => Math.max(bottom, object.y + object.height), boardPadding);
}

function maxHeight(candidates) {
  return candidates.reduce((height, candidate) => Math.max(height, displayHeight(candidate)), 0);
}

function displayWidth(candidate) {
  return Number.isFinite(candidate.width) ? candidate.width : 360;
}

function displayHeight(candidate) {
  return Number.isFinite(candidate.height) ? candidate.height : 360;
}

function normalizeRoots(projectDir, roots, options = {}) {
  if (!roots || roots.length === 0) {
    const threadRoot = generatedImagesDirForThread(options.threadId, options.generatedImagesRoot);
    return threadRoot ? [threadRoot] : [];
  }
  return roots.map((root) => path.resolve(projectDir, root));
}

export function defaultGeneratedImagesRoot() {
  return path.resolve(
    process.env[generatedImagesRootEnv]
    || path.join(os.homedir(), ".codex", "generated_images")
  );
}

export function generatedImagesDirForThread(threadId, generatedImagesRoot = defaultGeneratedImagesRoot()) {
  const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
  if (!normalizedThreadId || normalizedThreadId === "." || normalizedThreadId === ".." || /[\\/\0]/.test(normalizedThreadId)) {
    return null;
  }
  return path.join(path.resolve(generatedImagesRoot), normalizedThreadId);
}

async function walkImages(currentPath, context) {
  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const childPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectory(childPath, context.projectDir)) continue;
      await walkImages(childPath, context);
      continue;
    }

    if (!entry.isFile()) continue;
    if (!imageExtensions.has(path.extname(entry.name).toLowerCase())) continue;

    const absolutePath = path.resolve(childPath);
    if (context.excludePaths?.has(absolutePath)) continue;
    if (context.knownSources.has(absolutePath)) continue;

    let stat;
    try {
      stat = await fs.stat(absolutePath);
    } catch {
      continue;
    }
    if (stat.mtimeMs < context.sinceMs && !context.retryPaths.has(absolutePath)) continue;

    let buffer;
    try { buffer = await fs.readFile(absolutePath); } catch { continue; }
    if (!isSupportedImageBuffer(buffer) || !isCompletePng(buffer)) {
      context.pendingPaths.add(absolutePath);
      continue;
    }
    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    if (context.knownHashes.has(hash)) continue;
    context.knownHashes.add(hash);

    context.candidates.push({
      path: absolutePath,
      mtimeMs: stat.mtimeMs,
      ...displaySizeFromDimensions(readImageDimensionsFromBuffer(buffer))
    });
  }
}

// A PNG's dimensions appear near the beginning, well before the image is fully
// written. Wait for the complete chunk stream before collecting it.
function isCompletePng(buffer) {
  if (!hasPngSignature(buffer)) return true;
  let offset = 8;
  let hasImageData = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) return false;
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (offset === 8 && (type !== "IHDR" || length !== 13)) return false;
    if (type === "IDAT") hasImageData = true;
    if (type === "IEND") return length === 0 && hasImageData;
    offset = end;
  }
  return false;
}

function hasPngSignature(buffer) {
  return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

async function knownImageHashes(objects) {
  const hashes = new Set();
  for (const object of objects) {
    if (!object.assetPath) continue;
    try {
      if (!(await fs.lstat(object.assetPath)).isFile()) continue;
      const buffer = await fs.readFile(object.assetPath);
      hashes.add(crypto.createHash("sha256").update(buffer).digest("hex"));
    } catch {
      // Missing local assets should not block collection of new images.
    }
  }
  return hashes;
}

function displaySizeFromDimensions(dimensions) {
  if (!dimensions.width || !dimensions.height) return {};
  const scale = Math.min(1, 420 / Math.max(dimensions.width, dimensions.height));
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale))
  };
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
    height: buffer.readUInt32BE(20)
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

function shouldSkipDirectory(directoryPath, projectDir) {
  const basename = path.basename(directoryPath);
  if (basename.startsWith(".")) return true;
  if (["node_modules", "dist", "build", "coverage"].includes(basename)) return true;
  if (basename === "reference-screenshots" && path.basename(path.dirname(directoryPath)) === "scripts") return true;
  const relative = path.relative(projectDir, directoryPath);
  return relative === "canvas" || relative.startsWith(`canvas${path.sep}`);
}
