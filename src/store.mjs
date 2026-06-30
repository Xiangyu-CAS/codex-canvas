import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { assetsDirFor, statePathFor } from "./paths.mjs";

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
const stateLocks = new Map();
const versionGroupFields = new Set(["sourceObjectId", "batchId", "layoutMode", "prompt"]);

function canvasIdFrom(options = {}) {
  return typeof options.canvasId === "string" && options.canvasId.trim() ? options.canvasId.trim() : null;
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function clampSearchLimit(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 20;
  return Math.min(100, Math.max(1, Math.round(number)));
}

function matchedObjectFields(object, query) {
  const fields = searchFieldsForObject(object);
  if (!query) return [];
  return fields
    .filter((field) => field.value.includes(query))
    .map((field) => field.name);
}

function searchFieldsForObject(object) {
  const entries = {
    id: object.id,
    type: object.type || "image",
    name: object.name,
    prompt: object.prompt,
    text: object.text,
    batchId: object.batchId,
    sourceObjectId: object.sourceObjectId,
    layerGroupId: object.layerGroupId,
    layerGroupName: object.layerGroupName,
    layerGroupKind: object.layerGroupKind,
    assetPath: object.assetPath,
    sourcePath: object.sourcePath,
    src: object.src
  };
  return Object.entries(entries)
    .filter(([, value]) => typeof value === "string" && value.trim())
    .map(([name, value]) => ({ name, value: value.toLowerCase() }));
}

function summarizeSearchObject(object, matchFields) {
  return {
    id: object.id,
    type: object.type || "image",
    name: object.name || "",
    prompt: object.prompt || "",
    text: object.text || "",
    src: object.src || "",
    assetPath: object.assetPath || null,
    sourcePath: object.sourcePath || null,
    batchId: object.batchId || null,
    sourceObjectId: object.sourceObjectId || null,
    layerGroupId: object.layerGroupId || null,
    layerGroupName: object.layerGroupName || null,
    layerGroupKind: object.layerGroupKind || null,
    x: Number.isFinite(object.x) ? object.x : null,
    y: Number.isFinite(object.y) ? object.y : null,
    width: Number.isFinite(object.width) ? object.width : null,
    height: Number.isFinite(object.height) ? object.height : null,
    createdAt: object.createdAt || null,
    matchFields
  };
}

function summarizeVersionObject(object) {
  return {
    id: object.id,
    type: object.type || "image",
    name: object.name || "",
    prompt: object.prompt || "",
    text: object.text || "",
    src: object.src || "",
    assetPath: object.assetPath || null,
    sourcePath: object.sourcePath || null,
    sourceObjectId: object.sourceObjectId || null,
    batchId: object.batchId || null,
    layoutMode: object.layoutMode || null,
    status: object.status || null,
    action: object.action || null,
    x: Number.isFinite(object.x) ? object.x : null,
    y: Number.isFinite(object.y) ? object.y : null,
    width: Number.isFinite(object.width) ? object.width : null,
    height: Number.isFinite(object.height) ? object.height : null,
    createdAt: object.createdAt || null
  };
}

function normalizeVersionGroupBy(groupBy) {
  const aliases = {
    source: "sourceObjectId",
    sourceObject: "sourceObjectId",
    "source-object": "sourceObjectId",
    "source-object-id": "sourceObjectId",
    batch: "batchId",
    "batch-id": "batchId",
    layout: "layoutMode",
    "layout-mode": "layoutMode"
  };
  const value = typeof groupBy === "string" && groupBy.trim() ? groupBy.trim() : "sourceObjectId";
  const normalized = aliases[value] || value;
  if (versionGroupFields.has(normalized)) return normalized;
  const error = new Error(`Unsupported version group field: ${value}`);
  error.statusCode = 400;
  throw error;
}

function versionGroupValue(object, groupBy) {
  const value = object?.[groupBy];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function versionGroupKey(value, groupBy) {
  return groupBy === "prompt" || groupBy === "layoutMode" ? value.toLowerCase() : value;
}

function newerTimestamp(a, b) {
  const aTime = Date.parse(a || "");
  const bTime = Date.parse(b || "");
  if (!Number.isFinite(aTime)) return b || null;
  if (!Number.isFinite(bTime)) return a || null;
  return aTime >= bTime ? a : b;
}

function groupMatchesQuery(group, normalizedQuery) {
  if (!normalizedQuery) return true;
  if (normalizeSearchText(group.value).includes(normalizedQuery)) return true;
  return group.matchText.some((value) => value.includes(normalizedQuery));
}

export async function ensureProjectStore(projectDir, options = {}) {
  const canvasId = canvasIdFrom(options);
  if (canvasId) await migrateLegacyCanvasIfNeeded(projectDir, canvasId);
  await fs.mkdir(assetsDirFor(projectDir, canvasId), { recursive: true });
  const statePath = statePathFor(projectDir, canvasId);
  await withStateLock(projectDir, options, async () => {
    try {
      await fs.access(statePath);
    } catch {
      await writeStateFile(projectDir, defaultState, options);
    }
  });
}

async function migrateLegacyCanvasIfNeeded(projectDir, canvasId) {
  const targetStatePath = statePathFor(projectDir, canvasId);
  if (await fileExists(targetStatePath)) return;

  const legacyStatePath = statePathFor(projectDir);
  if (!await fileExists(legacyStatePath)) return;

  await fs.mkdir(path.dirname(targetStatePath), { recursive: true });
  const legacyAssetsDir = assetsDirFor(projectDir);
  const targetAssetsDir = assetsDirFor(projectDir, canvasId);
  const legacyState = await readJsonFile(legacyStatePath);

  if (await fileExists(legacyAssetsDir)) {
    await fs.cp(legacyAssetsDir, targetAssetsDir, {
      recursive: true,
      force: false,
      errorOnExist: false
    });
  }
  await writeMigratedLegacyState(targetStatePath, legacyState, legacyAssetsDir, targetAssetsDir);
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeMigratedLegacyState(targetStatePath, legacyState, legacyAssetsDir, targetAssetsDir) {
  const migrated = {
    ...legacyState,
    objects: Array.isArray(legacyState?.objects)
      ? legacyState.objects.map((object) => migrateObjectAssetPath(object, legacyAssetsDir, targetAssetsDir))
      : []
  };
  await fs.writeFile(targetStatePath, `${JSON.stringify(migrated, null, 2)}\n`);
}

function migrateObjectAssetPath(object, legacyAssetsDir, targetAssetsDir) {
  if (!object || typeof object !== "object" || typeof object.assetPath !== "string") return object;
  const relative = path.relative(legacyAssetsDir, object.assetPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return object;
  return {
    ...object,
    assetPath: path.join(targetAssetsDir, relative)
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readState(projectDir, options = {}) {
  const canvasId = canvasIdFrom(options);
  await ensureProjectStore(projectDir, options);
  return readStateFile(projectDir, { canvasId });
}

export async function searchObjects(projectDir, { query = "", limit = 20, type = null, canvasId = null } = {}) {
  const state = await readState(projectDir, { canvasId });
  const normalizedQuery = normalizeSearchText(query);
  const normalizedType = typeof type === "string" && type.trim() ? type.trim().toLowerCase() : null;
  const maxResults = clampSearchLimit(limit);
  const results = [];

  for (const object of state.objects) {
    const objectType = (object.type || "image").toLowerCase();
    if (normalizedType && objectType !== normalizedType) continue;

    const matchFields = matchedObjectFields(object, normalizedQuery);
    if (normalizedQuery && matchFields.length === 0) continue;

    results.push(summarizeSearchObject(object, matchFields));
    if (results.length >= maxResults) break;
  }

  return {
    query: query || "",
    canvasId: canvasId || null,
    total: results.length,
    results
  };
}

export async function promptHistory(projectDir, { query = "", limit = 20, canvasId = null } = {}) {
  const state = await readState(projectDir, { canvasId });
  const normalizedQuery = normalizeSearchText(query);
  const maxResults = clampSearchLimit(limit);
  const seen = new Set();
  const prompts = [];

  for (const object of [...state.objects].reverse()) {
    const prompt = typeof object.prompt === "string" ? object.prompt.trim() : "";
    if (!prompt) continue;
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    if (normalizedQuery && !key.includes(normalizedQuery)) continue;
    seen.add(key);
    prompts.push({
      prompt,
      objectId: object.id,
      objectName: object.name || "",
      objectType: object.type || "image",
      sourceObjectId: object.sourceObjectId || null,
      layoutMode: object.layoutMode || null,
      batchId: object.batchId || null,
      createdAt: object.createdAt || null
    });
    if (prompts.length >= maxResults) break;
  }

  return {
    query: query || "",
    canvasId: canvasId || null,
    total: prompts.length,
    prompts
  };
}

export async function versionGroups(projectDir, { query = "", groupBy = "sourceObjectId", limit = 20, objectLimit = 20, canvasId = null } = {}) {
  const state = await readState(projectDir, { canvasId });
  const normalizedQuery = normalizeSearchText(query);
  const normalizedGroupBy = normalizeVersionGroupBy(groupBy);
  const maxGroups = clampSearchLimit(limit);
  const maxObjects = clampSearchLimit(objectLimit);
  const byKey = new Map();

  for (const object of [...state.objects].reverse()) {
    const value = versionGroupValue(object, normalizedGroupBy);
    if (!value) continue;
    const key = versionGroupKey(value, normalizedGroupBy);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
      existing.latestAt = newerTimestamp(existing.latestAt, object.createdAt);
      existing.matchText.push(...searchFieldsForObject(object).map((field) => field.value));
      if (existing.objects.length < maxObjects) existing.objects.push(summarizeVersionObject(object));
    } else {
      byKey.set(key, {
        id: `${normalizedGroupBy}:${key}`,
        groupBy: normalizedGroupBy,
        key,
        value,
        count: 1,
        latestAt: object.createdAt || null,
        matchText: searchFieldsForObject(object).map((field) => field.value),
        objects: [summarizeVersionObject(object)]
      });
    }
  }

  const groups = [...byKey.values()]
    .filter((group) => groupMatchesQuery(group, normalizedQuery))
    .sort((a, b) => {
      const aTime = Date.parse(a.latestAt || "");
      const bTime = Date.parse(b.latestAt || "");
      if (!Number.isFinite(aTime) && !Number.isFinite(bTime)) return 0;
      if (!Number.isFinite(aTime)) return 1;
      if (!Number.isFinite(bTime)) return -1;
      return bTime - aTime;
    })
    .slice(0, maxGroups)
    .map(({ matchText, ...group }) => group);

  return {
    query: query || "",
    groupBy: normalizedGroupBy,
    canvasId: canvasId || null,
    total: groups.length,
    groups
  };
}

export async function writeState(projectDir, state, options = {}) {
  return withStateLock(projectDir, options, () => writeStateFile(projectDir, state, options));
}

export async function transformState(projectDir, options = {}, transformer) {
  return mutateState(projectDir, options, transformer);
}

async function readStateFile(projectDir, options = {}) {
  const canvasId = canvasIdFrom(options);
  const raw = await fs.readFile(statePathFor(projectDir, canvasId), "utf8");
  return { ...defaultState, ...JSON.parse(raw) };
}

async function writeStateFile(projectDir, state, options = {}) {
  const canvasId = canvasIdFrom(options);
  const statePath = statePathFor(projectDir, canvasId);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const next = {
    ...defaultState,
    ...state,
    updatedAt: new Date().toISOString()
  };
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tempPath, statePath);
  return next;
}

async function mutateState(projectDir, options = {}, mutator) {
  await ensureProjectStore(projectDir, options);
  return withStateLock(projectDir, options, async () => {
    const state = await readStateFile(projectDir, options);
    const result = await mutator(state);
    if (result?.write === false) return result.value;
    const nextState = result?.state || result;
    const written = await writeStateFile(projectDir, nextState, options);
    return Object.hasOwn(result || {}, "value") ? result.value : written;
  });
}

async function withStateLock(projectDir, options = {}, operation) {
  const key = statePathFor(projectDir, canvasIdFrom(options));
  const previous = stateLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => {}).then(() => current);
  stateLocks.set(key, chain);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (stateLocks.get(key) === chain) stateLocks.delete(key);
  }
}

export async function addImage(projectDir, input, options = {}) {
  const asset = await persistImage(projectDir, input, options);
  return mutateState(projectDir, options, (state) => {
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

    return {
      state: {
        ...state,
        objects: [...state.objects, object],
        selection: object.id
      },
      value: object
    };
  });
}

export async function addObject(projectDir, input, options = {}) {
  const type = typeof input.type === "string" ? input.type : "";
  if (!["drawing", "text"].includes(type)) {
    const error = new Error("add_object requires type to be drawing or text");
    error.statusCode = 400;
    throw error;
  }

  const object = normalizeObject(input);
  return mutateState(projectDir, options, (state) => ({
    state: {
      ...state,
      objects: [...state.objects, object],
      selection: object.id
    },
    value: object
  }));
}

export async function addJobPlaceholder(projectDir, input, options = {}) {
  return mutateState(projectDir, options, (state) => {
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

    return {
      state: {
        ...state,
        objects: [...shiftedObjects, object]
      },
      value: object
    };
  });
}

export async function updateSelection(projectDir, selection, options = {}) {
  return mutateState(projectDir, options, (state) => ({
    state: { ...state, selection },
    value: selection
  }));
}

export async function updateViewport(projectDir, viewport, options = {}) {
  return mutateState(projectDir, options, (state) => {
    const nextViewport = {
      x: Number.isFinite(viewport.x) ? viewport.x : state.viewport.x,
      y: Number.isFinite(viewport.y) ? viewport.y : state.viewport.y,
      zoom: Number.isFinite(viewport.zoom) ? viewport.zoom : state.viewport.zoom
    };
    return {
      state: { ...state, viewport: nextViewport },
      value: nextViewport
    };
  });
}

export async function updateProjectMeta(projectDir, patch, options = {}) {
  return mutateState(projectDir, options, (state) => {
    const title = typeof patch.title === "string" && patch.title.trim()
      ? patch.title.trim().slice(0, 120)
      : state.title;
    return {
      state: { ...state, title },
      value: { title }
    };
  });
}

export async function updateObject(projectDir, id, patch, options = {}) {
  return mutateState(projectDir, options, (state) => {
    let updated = null;
    const objects = state.objects.map((object) => {
      if (object.id !== id) return object;
      updated = {
        ...object,
        ...sanitizeObjectPatch(patch),
        id: object.id,
        type: object.type,
        src: object.src,
        assetPath: object.assetPath,
        sourcePath: object.sourcePath,
        createdAt: object.createdAt
      };
      return updated;
    });

    if (!updated) {
      const error = new Error(`Canvas object not found: ${id}`);
      error.statusCode = 404;
      throw error;
    }

    return {
      state: { ...state, objects },
      value: updated
    };
  });
}

function sanitizeObjectPatch(patch = {}) {
  const next = {};
  for (const key of ["x", "y", "width", "height", "fontSize", "strokeWidth", "durationMs"]) {
    if (Number.isFinite(patch[key])) next[key] = key === "width" || key === "height"
      ? Math.max(1, Math.round(patch[key]))
      : Math.round(patch[key]);
  }
  for (const key of [
    "layerGroupIndex",
    "layerGroupOriginalX",
    "layerGroupOriginalY",
    "layerGroupOriginalWidth",
    "layerGroupOriginalHeight",
    "layerGroupRelativeX",
    "layerGroupRelativeY",
    "layerGroupOriginalLayerWidth",
    "layerGroupOriginalLayerHeight"
  ]) {
    if (Number.isFinite(patch[key])) next[key] = Math.round(patch[key]);
  }
  for (const key of ["name", "text", "color", "stroke", "status", "error", "layoutMode", "sourceObjectId", "layerGroupId", "layerGroupName", "layerGroupSourceObjectId", "layerGroupKind"]) {
    if (typeof patch[key] === "string") next[key] = patch[key].slice(0, key === "text" ? 2000 : 300);
  }
  if (typeof patch.layerGroupLocked === "boolean") next.layerGroupLocked = patch.layerGroupLocked;
  if (Array.isArray(patch.points)) {
    next.points = patch.points
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: Math.round(point.x), y: Math.round(point.y) }))
      .slice(0, 4000);
  }
  return next;
}

export async function markStaleJobPlaceholders(projectDir, { activePlaceholderIds = [], timeoutMs = 2 * 60_000, canvasId = null } = {}) {
  const options = { canvasId };
  return mutateState(projectDir, options, (state) => {
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

    if (!changed) return { write: false, value: state };
    return { ...state, objects };
  });
}

export async function deleteObject(projectDir, id, options = {}) {
  return mutateState(projectDir, options, (state) => {
    const objects = state.objects.filter((object) => object.id !== id);
    if (objects.length === state.objects.length) {
      const error = new Error(`Canvas object not found: ${id}`);
      error.statusCode = 404;
      throw error;
    }

    const selection = state.selection === id ? null : state.selection;
    return {
      state: { ...state, objects, selection },
      value: { id, deleted: true }
    };
  });
}

export async function deleteObjects(projectDir, ids, options = {}) {
  const idSet = new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === "string" && id.trim()) : []);
  if (idSet.size === 0) {
    const error = new Error("delete_objects requires at least one object id.");
    error.statusCode = 400;
    throw error;
  }

  return mutateState(projectDir, options, (state) => {
    const objects = state.objects.filter((object) => !idSet.has(object.id));
    const deletedIds = state.objects.filter((object) => idSet.has(object.id)).map((object) => object.id);
    if (deletedIds.length === 0) {
      const error = new Error("Canvas objects not found.");
      error.statusCode = 404;
      throw error;
    }

    const selection = state.selection && idSet.has(state.selection) ? null : state.selection;
    return {
      state: { ...state, objects, selection },
      value: { ids: deletedIds, deleted: true }
    };
  });
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

async function persistImage(projectDir, input, options = {}) {
  const assetsDir = assetsDirFor(projectDir, canvasIdFrom(options));
  await fs.mkdir(assetsDir, { recursive: true });

  if (input.path) {
    const sourcePath = path.resolve(input.path);
    const stat = await statImageSource(sourcePath);
    if (!stat.isFile()) {
      const error = new Error("Image path must point to a file.");
      error.statusCode = 400;
      throw error;
    }
    const ext = normalizeExt(path.extname(sourcePath)) || ".png";
    const name = safeAssetName(input.name || path.basename(sourcePath, ext), ext);
    const assetPath = path.join(assetsDir, name);
    await copyImageSource(sourcePath, assetPath);
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

async function statImageSource(sourcePath) {
  try {
    return await fs.stat(sourcePath);
  } catch (error) {
    throw classifyImageSourceError(error);
  }
}

async function copyImageSource(sourcePath, assetPath) {
  try {
    await fs.copyFile(sourcePath, assetPath);
  } catch (error) {
    throw classifyImageSourceError(error);
  }
}

function classifyImageSourceError(error) {
  if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
    const clientError = new Error("Image path does not exist.");
    clientError.statusCode = 404;
    return clientError;
  }
  if (error?.code === "EACCES" || error?.code === "EPERM") {
    const clientError = new Error("Image path is not readable.");
    clientError.statusCode = 403;
    return clientError;
  }
  return error;
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
