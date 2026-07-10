import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { assetsDirFor, dataDirFor, legacyCanvasDataDirFor, statePathFor } from "./paths.mjs";

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
const maxObjectCoordinate = 1_000_000;
const maxObjectDimension = 6000;
const minFontSize = 6;
const maxFontSize = 160;
const minStrokeWidth = 1;
const maxStrokeWidth = 80;
const maxDurationMs = 24 * 60 * 60 * 1000;
const minViewportZoom = 0.12;
const maxViewportZoom = 2.2;
const derivedGap = 72;
const stateLocks = new Map();
const legacyMigrationLocks = new Map();
const versionGroupFields = new Set(["sourceObjectId", "batchId", "layoutMode", "prompt"]);
const legacyThreadMigrationMarkerName = ".legacy-thread-migration.json";
const crossProcessLockTimeoutMs = 15_000;
const staleCrossProcessLockMs = 5 * 60_000;
const crossProcessLockRetryMs = 12;

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
    imagegenPrompt: object.imagegenPrompt,
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
    imagegenPrompt: object.imagegenPrompt || "",
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
    imagegenPrompt: object.imagegenPrompt || "",
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
  return withLegacyMigrationLock(projectDir, () => (
    withStateLock(projectDir, {}, async () => {
      const targetStatePath = statePathFor(projectDir, canvasId);
      if (await fileExists(targetStatePath)) {
        await ensureLegacyThreadMigrationMarker(projectDir, {
          canvasId,
          migrated: false,
          reason: "existing-thread-canvas"
        });
        return;
      }

      const legacyCanvasDir = legacyCanvasDataDirFor(projectDir, canvasId);
      const legacyCanvasStatePath = path.join(legacyCanvasDir, "codex-canvas.json");
      if (legacyCanvasStatePath !== targetStatePath && await fileExists(legacyCanvasStatePath)) {
        await withStateLock(projectDir, { canvasId }, async () => {
          await fs.mkdir(path.dirname(targetStatePath), { recursive: true });
          await fs.cp(legacyCanvasDir, path.dirname(targetStatePath), {
            recursive: true,
            force: false,
            errorOnExist: false
          });
          await ensureLegacyThreadMigrationMarker(projectDir, {
            canvasId,
            migrated: true,
            reason: "legacy-thread-storage"
          });
        });
        return;
      }

      if (await fileExists(legacyThreadMigrationMarkerPath(projectDir))) return;

      const existingThreadState = await findExistingThreadState(projectDir);
      if (existingThreadState) {
        await writeLegacyThreadMigrationMarker(projectDir, {
          canvasId: null,
          migrated: false,
          reason: "existing-thread-canvas",
          existingThreadState
        });
        return;
      }

      const legacyStatePath = statePathFor(projectDir);
      if (!await fileExists(legacyStatePath)) {
        await writeLegacyThreadMigrationMarker(projectDir, {
          canvasId,
          migrated: false,
          reason: "no-legacy-canvas"
        });
        return;
      }

      await withStateLock(projectDir, { canvasId }, async () => {
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
        await writeLegacyThreadMigrationMarker(projectDir, {
          canvasId,
          migrated: true,
          reason: "legacy-default-canvas"
        });
      });
    })
  ));
}

function legacyThreadMigrationMarkerPath(projectDir) {
  return path.join(dataDirFor(projectDir), legacyThreadMigrationMarkerName);
}

async function ensureLegacyThreadMigrationMarker(projectDir, payload) {
  if (await fileExists(legacyThreadMigrationMarkerPath(projectDir))) return;
  await writeLegacyThreadMigrationMarker(projectDir, payload);
}

async function writeLegacyThreadMigrationMarker(projectDir, payload) {
  const markerPath = legacyThreadMigrationMarkerPath(projectDir);
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  const marker = {
    version: 1,
    ...payload,
    claimsDefault: payload.claimsDefault === true
      || (payload.migrated === true && payload.reason === "legacy-default-canvas"),
    createdAt: new Date().toISOString()
  };
  const tempPath = `${markerPath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(marker, null, 2)}\n`);
  await fs.rename(tempPath, markerPath);
}

async function findExistingThreadState(projectDir) {
  const threadsDir = path.join(dataDirFor(projectDir), "threads");
  let entries;
  try {
    entries = await fs.readdir(threadsDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(threadsDir, entry.name, "codex-canvas.json");
    if (await fileExists(candidate)) return path.relative(dataDirFor(projectDir), candidate);
  }
  return null;
}

async function withLegacyMigrationLock(projectDir, operation) {
  const key = legacyThreadMigrationMarkerPath(projectDir);
  const previous = legacyMigrationLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  const chain = previous.catch(() => {}).then(() => current);
  legacyMigrationLocks.set(key, chain);
  await previous.catch(() => {});
  try {
    return await withCrossProcessLock(`${key}.lock`, operation);
  } finally {
    release();
    if (legacyMigrationLocks.get(key) === chain) legacyMigrationLocks.delete(key);
  }
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
    const summaryPrompt = typeof object.prompt === "string" ? object.prompt.trim() : "";
    const imagegenPrompt = typeof object.imagegenPrompt === "string" ? object.imagegenPrompt.trim() : "";
    const prompt = imagegenPrompt || summaryPrompt;
    if (!prompt) continue;
    const searchable = [prompt, summaryPrompt, object.name || ""].join("\n").toLowerCase();
    const key = prompt.toLowerCase();
    if (seen.has(key)) continue;
    if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;
    seen.add(key);
    prompts.push({
      prompt,
      summaryPrompt,
      imagegenPrompt,
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
  return withStateLock(projectDir, options, async () => {
    await assertLegacyDefaultCanvasWritable(projectDir, options);
    return writeStateFile(projectDir, state, options);
  });
}

export async function transformState(projectDir, options = {}, transformer) {
  return mutateState(projectDir, options, transformer);
}

async function readStateFile(projectDir, options = {}) {
  const canvasId = canvasIdFrom(options);
  const raw = await fs.readFile(statePathFor(projectDir, canvasId), "utf8");
  return normalizeState(JSON.parse(raw), { projectDir, canvasId });
}

async function writeStateFile(projectDir, state, options = {}) {
  const canvasId = canvasIdFrom(options);
  const statePath = statePathFor(projectDir, canvasId);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const next = normalizeState({ ...state, updatedAt: new Date().toISOString() }, { projectDir, canvasId });
  const tempPath = `${statePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`);
  await fs.rename(tempPath, statePath);
  return next;
}

function normalizeState(state = {}, context = {}) {
  const objects = Array.isArray(state.objects)
    ? state.objects
      .map((object) => normalizePersistedObject(object, context))
      .filter(Boolean)
    : [];
  const selection = typeof state.selection === "string" && objects.some((object) => object.id === state.selection)
    ? state.selection
    : null;
  return {
    ...defaultState,
    ...state,
    viewport: normalizeViewport(state.viewport),
    objects,
    selection
  };
}

function normalizeViewport(viewport = {}) {
  const source = viewport && typeof viewport === "object" ? viewport : {};
  return {
    x: Number.isFinite(source.x) ? source.x : defaultState.viewport.x,
    y: Number.isFinite(source.y) ? source.y : defaultState.viewport.y,
    zoom: Number.isFinite(source.zoom) ? clampViewportZoom(source.zoom) : defaultState.viewport.zoom
  };
}

async function mutateState(projectDir, options = {}, mutator) {
  await ensureProjectStore(projectDir, options);
  return withStateLock(projectDir, options, async () => {
    const state = await readStateFile(projectDir, options);
    const result = await mutator(state);
    if (result?.write === false) return result.value;
    await assertLegacyDefaultCanvasWritable(projectDir, options);
    const nextState = result?.state || result;
    const written = await writeStateFile(projectDir, nextState, options);
    return Object.hasOwn(result || {}, "value") ? result.value : written;
  });
}

async function assertLegacyDefaultCanvasWritable(projectDir, options = {}) {
  if (canvasIdFrom(options)) return;
  if (!await legacyDefaultCanvasClaimed(projectDir)) return;
  const error = new Error("The legacy default canvas is read-only after it has been claimed by a thread.");
  error.statusCode = 409;
  throw error;
}

async function legacyDefaultCanvasClaimed(projectDir) {
  try {
    const marker = await readJsonFile(legacyThreadMigrationMarkerPath(projectDir));
    return marker?.claimsDefault === true
      || (marker?.claimsDefault === undefined
        && marker?.migrated === true
        && marker?.reason === "legacy-default-canvas");
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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
    return await withCrossProcessLock(`${key}.lock`, operation);
  } finally {
    release();
    if (stateLocks.get(key) === chain) stateLocks.delete(key);
  }
}

async function withCrossProcessLock(lockPath, operation) {
  const lock = await acquireCrossProcessLock(lockPath);
  try {
    return await operation();
  } finally {
    await releaseCrossProcessLock(lockPath, lock);
  }
}

async function acquireCrossProcessLock(lockPath) {
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const startedAt = Date.now();
  const token = `${process.pid}-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
  for (;;) {
    let handle;
    try {
      handle = await fs.open(lockPath, "wx");
      await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      return { handle, token };
    } catch (error) {
      if (handle) {
        await handle.close().catch(() => {});
        await fs.unlink(lockPath).catch(() => {});
      }
      if (error?.code !== "EEXIST") throw error;
      await removeAbandonedCrossProcessLock(lockPath);
      if (Date.now() - startedAt >= crossProcessLockTimeoutMs) {
        const timeoutError = new Error(`Timed out waiting for canvas state lock: ${lockPath}`);
        timeoutError.statusCode = 503;
        throw timeoutError;
      }
      const jitter = Math.floor(Math.random() * crossProcessLockRetryMs);
      await new Promise((resolve) => setTimeout(resolve, crossProcessLockRetryMs + jitter));
    }
  }
}

async function removeAbandonedCrossProcessLock(lockPath) {
  let stat;
  let owner = null;
  try {
    [stat, owner] = await Promise.all([
      fs.stat(lockPath),
      fs.readFile(lockPath, "utf8").then((raw) => JSON.parse(raw)).catch(() => null)
    ]);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const stale = Date.now() - stat.mtimeMs >= staleCrossProcessLockMs;
  const abandoned = Number.isInteger(owner?.pid) && !processIsAlive(owner.pid);
  if (!stale && !abandoned) return;
  await fs.unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

function processIsAlive(pid) {
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function releaseCrossProcessLock(lockPath, lock) {
  await lock.handle.close().catch(() => {});
  let owner;
  try {
    owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return;
    return;
  }
  if (owner?.token !== lock.token) return;
  await fs.unlink(lockPath).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
}

export async function addImage(projectDir, input, options = {}) {
  if (shouldDedupeImage(input)) {
    const existing = await findExistingImageForInput(projectDir, input, options);
    if (existing) return selectExistingImage(projectDir, existing.id, options);
  }

  const asset = await persistImage(projectDir, input, options);
  return mutateState(projectDir, options, async (state) => {
    const duplicate = shouldDedupeImage(input) ? await findDuplicateImageObject(state, asset) : null;
    if (duplicate) {
      await removeDuplicateAsset(asset, duplicate);
      return {
        state: {
          ...state,
          selection: duplicate.id
        },
        value: duplicate
      };
    }

    const count = state.objects.length;
    const displaySize = imageDisplaySize(asset, input);
    const object = {
      id: `img_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      type: "image",
      name: sanitizeString(input.name, asset.name || "Image"),
      src: asset.src,
      assetPath: asset.assetPath,
      sourcePath: asset.sourcePath || null,
      prompt: sanitizeString(input.prompt, "", 4000),
      imagegenPrompt: sanitizeString(input.imagegenPrompt, "", 20000),
      sourceObjectId: typeof input.sourceObjectId === "string" ? input.sourceObjectId.slice(0, 300) : null,
      batchId: typeof input.batchId === "string" ? input.batchId.slice(0, 300) : null,
      layoutMode: sanitizeString(input.layoutMode, "manual", 80),
      x: Number.isFinite(input.x) ? sanitizeCoordinate(input.x) : 120 + (count % 5) * 56,
      y: Number.isFinite(input.y) ? sanitizeCoordinate(input.y) : 120 + (count % 7) * 44,
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

function shouldDedupeImage(input = {}) {
  if (input.allowDuplicate === true || input.dedupe === false) return false;
  return input.dedupe === true || Boolean(input.path);
}

async function selectExistingImage(projectDir, id, options = {}) {
  return mutateState(projectDir, options, (state) => {
    const object = state.objects.find((item) => item.id === id);
    if (!object) return { state, value: null };
    return {
      state: {
        ...state,
        selection: object.id
      },
      value: object
    };
  });
}

async function findExistingImageForInput(projectDir, input, options = {}) {
  const fingerprint = await imageInputFingerprint(input);
  if (!fingerprint) return null;
  const state = await readState(projectDir, options);
  return findDuplicateImageObject(state, fingerprint);
}

async function imageInputFingerprint(input = {}) {
  if (input.path) {
    const sourcePath = path.resolve(input.path);
    let buffer;
    try {
      buffer = await fs.readFile(sourcePath);
    } catch {
      return { sourcePath };
    }
    return {
      sourcePath,
      contentHash: imageContentHash(buffer)
    };
  }

  if (input.dataUrl) {
    const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(input.dataUrl);
    if (!match) return null;
    const buffer = decodeBase64ImagePayload(match[2]);
    return {
      contentHash: imageContentHash(buffer)
    };
  }

  return null;
}

async function findDuplicateImageObject(state, fingerprint) {
  const sourcePath = typeof fingerprint.sourcePath === "string" ? path.resolve(fingerprint.sourcePath) : null;
  for (const object of state.objects) {
    if ((object.type || "image") !== "image") continue;
    if (sourcePath && path.resolve(object.sourcePath || "") === sourcePath) return object;
    if (sourcePath && path.resolve(object.assetPath || "") === sourcePath) return object;
  }

  if (!fingerprint.contentHash) return null;
  for (const object of state.objects) {
    if ((object.type || "image") !== "image" || !object.assetPath) continue;
    try {
      const buffer = await fs.readFile(object.assetPath);
      if (imageContentHash(buffer) === fingerprint.contentHash) return object;
    } catch {
      // Missing local assets should not prevent importing a new image.
    }
  }
  return null;
}

async function removeDuplicateAsset(asset, duplicate) {
  if (!asset.assetPath || asset.assetPath === duplicate.assetPath) return;
  try {
    await fs.rm(asset.assetPath, { force: true });
  } catch {
    // A failed cleanup should not turn a successful dedupe into an import failure.
  }
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

    const width = sanitizeDimension(Number.isFinite(input.width) ? input.width : source.width);
    const height = sanitizeDimension(Number.isFinite(input.height) ? input.height : source.height);
    const position = adjacentDerivedPosition(source);
    const shift = width + derivedGap;
    const object = {
      id: input.id || `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`,
      type: "job",
      name: sanitizeString(input.name, "Working"),
      action: sanitizeString(input.action, "image-job", 80),
      status: sanitizeString(input.status, "running", 80),
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
  return mutateState(projectDir, options, (state) => {
    const selectedId = typeof selection === "string" && state.objects.some((object) => object.id === selection)
      ? selection
      : null;
    return {
      state: { ...state, selection: selectedId },
      value: selectedId
    };
  });
}

export async function updateViewport(projectDir, viewport, options = {}) {
  return mutateState(projectDir, options, (state) => {
    const nextViewport = {
      x: Number.isFinite(viewport.x) ? viewport.x : state.viewport.x,
      y: Number.isFinite(viewport.y) ? viewport.y : state.viewport.y,
      zoom: Number.isFinite(viewport.zoom) ? clampViewportZoom(viewport.zoom) : state.viewport.zoom
    };
    return {
      state: { ...state, viewport: nextViewport },
      value: nextViewport
    };
  });
}

function clampViewportZoom(zoom) {
  return Math.min(maxViewportZoom, Math.max(minViewportZoom, zoom));
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeCoordinate(value, fallback = 0) {
  return Math.round(clampNumber(value, -maxObjectCoordinate, maxObjectCoordinate, fallback));
}

function sanitizeDimension(value, fallback = 1) {
  return Math.round(clampNumber(value, 1, maxObjectDimension, fallback));
}

function sanitizeFontSize(value, fallback = 28) {
  return Math.round(clampNumber(value, minFontSize, maxFontSize, fallback));
}

function sanitizeStrokeWidth(value, fallback = 4) {
  return Math.round(clampNumber(value, minStrokeWidth, maxStrokeWidth, fallback));
}

function sanitizeDurationMs(value, fallback = 0) {
  return Math.round(clampNumber(value, 0, maxDurationMs, fallback));
}

function sanitizeString(value, fallback = "", limit = 300, trim = true) {
  if (typeof value !== "string") return fallback;
  const normalized = trim ? value.trim() : value;
  return (normalized || fallback).slice(0, limit);
}

function normalizePersistedObject(object, context = {}) {
  if (!object || typeof object !== "object") return null;
  const id = sanitizeString(object.id, "", 200);
  if (!id) return null;
  const type = sanitizeString(object.type, "image", 40);
  const normalized = {
    ...object,
    id,
    type,
    name: sanitizeString(object.name, type === "text" ? "Text" : type === "drawing" ? "Drawing" : "Image"),
    prompt: sanitizeString(object.prompt, "", 4000),
    imagegenPrompt: sanitizeString(object.imagegenPrompt, "", 20000),
    x: sanitizeCoordinate(object.x),
    y: sanitizeCoordinate(object.y),
    width: sanitizeDimension(object.width, type === "text" ? 220 : 1),
    height: sanitizeDimension(object.height, type === "text" ? 80 : 1)
  };
  if (typeof object.createdAt !== "string") normalized.createdAt = new Date().toISOString();
  if (Number.isFinite(object.durationMs)) normalized.durationMs = sanitizeDurationMs(object.durationMs);
  if (type === "text") {
    normalized.text = sanitizeString(object.text, "Text", 2000, false);
    normalized.fontSize = sanitizeFontSize(object.fontSize);
    normalized.color = sanitizeString(object.color, "#202124", 80);
  }
  if (type === "drawing") {
    normalized.points = sanitizePoints(object.points);
    normalized.stroke = sanitizeString(object.stroke, "#202124", 80);
    normalized.strokeWidth = sanitizeStrokeWidth(object.strokeWidth);
  }
  if (object.crop && typeof object.crop === "object") {
    const crop = sanitizeCrop(object.crop);
    if (crop) normalized.crop = crop;
    else delete normalized.crop;
  }
  sanitizePersistedAssetFields(normalized, object, context);
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
    if (Number.isFinite(object[key])) normalized[key] = key.endsWith("Width") || key.endsWith("Height")
      ? sanitizeDimension(object[key])
      : sanitizeCoordinate(object[key]);
  }
  return normalized;
}

function sanitizePersistedAssetFields(normalized, original, { projectDir, canvasId } = {}) {
  if (!projectDir) return;
  const objectType = normalized.type || "image";
  if (objectType !== "image" && objectType !== "job") return;

  const safeAssetPath = safePersistedAssetPath(original.assetPath, projectDir, canvasId);
  if (safeAssetPath) {
    normalized.assetPath = safeAssetPath;
    if (typeof original.sourcePath === "string" && original.sourcePath.trim()) {
      normalized.sourcePath = path.resolve(original.sourcePath);
    } else {
      normalized.sourcePath = null;
    }
    normalized.src = sanitizePersistedImageSrc(original.src, safeAssetPath);
    return;
  }

  normalized.assetPath = null;
  normalized.sourcePath = null;
  normalized.src = sanitizePersistedImageSrc(original.src, null);
}

function safePersistedAssetPath(assetPath, projectDir, canvasId) {
  if (typeof assetPath !== "string" || !assetPath.trim()) return null;
  const resolved = path.resolve(assetPath);
  const assetsDir = assetsDirFor(projectDir, canvasId);
  return isInsidePath(assetsDir, resolved) ? resolved : null;
}

function sanitizePersistedImageSrc(src, safeAssetPath) {
  if (typeof src !== "string" || !src.trim()) return safeAssetPath ? `/assets/${encodeURIComponent(path.basename(safeAssetPath))}` : "";
  const trimmed = src.trim();
  if (safeAssetPath && isAssetSrc(trimmed)) return trimmed.slice(0, 2000);
  if (/^https?:\/\//i.test(trimmed)) return trimmed.slice(0, 2000);
  return safeAssetPath ? `/assets/${encodeURIComponent(path.basename(safeAssetPath))}` : "";
}

function isAssetSrc(src) {
  try {
    const url = new URL(src, "http://codex-canvas.local");
    return url.origin === "http://codex-canvas.local" && url.pathname.startsWith("/assets/");
  } catch {
    return false;
  }
}

function isInsidePath(parentPath, childPath) {
  const parent = comparablePath(parentPath);
  const child = comparablePath(childPath);
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function comparablePath(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
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

export async function reorderLayerGroupLayer(projectDir, groupId, objectId, direction, options = {}) {
  if (!groupId || !objectId || !["up", "down"].includes(direction)) {
    const error = new Error("Layer reorder requires a layer group id, object id, and direction.");
    error.statusCode = 400;
    throw error;
  }

  return mutateState(projectDir, options, (state) => {
    const firstGroupIndex = state.objects.findIndex((object) => object.layerGroupId === groupId);
    const groupObjects = state.objects
      .filter((object) => object.layerGroupId === groupId)
      .sort((a, b) => (a.layerGroupIndex || 0) - (b.layerGroupIndex || 0));
    const currentIndex = groupObjects.findIndex((object) => object.id === objectId);
    if (firstGroupIndex < 0 || currentIndex < 0 || groupObjects.length < 2) {
      const error = new Error("Layer group member not found.");
      error.statusCode = 404;
      throw error;
    }

    const targetIndex = layerGroupReorderTargetIndex(groupObjects, currentIndex, direction);
    if (targetIndex < 0) {
      return {
        state,
        value: {
          objects: groupObjects,
          changed: false
        }
      };
    }

    const reordered = [...groupObjects];
    const [selected] = reordered.splice(currentIndex, 1);
    reordered.splice(targetIndex, 0, selected);
    const reindexed = reordered.map((object, index) => ({
      ...object,
      layerGroupIndex: index
    }));
    const reindexedById = new Map(reindexed.map((object) => [object.id, object]));
    const otherObjects = state.objects.filter((object) => object.layerGroupId !== groupId);
    const insertIndex = Math.min(firstGroupIndex, otherObjects.length);
    const objects = [
      ...otherObjects.slice(0, insertIndex),
      ...reindexed,
      ...otherObjects.slice(insertIndex)
    ];

    return {
      state: {
        ...state,
        objects,
        selection: objectId
      },
      value: {
        objects: reindexed,
        object: reindexedById.get(objectId),
        changed: true
      }
    };
  });
}

export async function setLayerGroupOrder(projectDir, groupId, objectIds, options = {}) {
  const normalizedIds = Array.isArray(objectIds)
    ? objectIds.map((id) => typeof id === "string" ? id.trim() : "").filter(Boolean)
    : [];
  if (!groupId || !normalizedIds.length || normalizedIds.length !== objectIds?.length) {
    const error = new Error("Layer order requires a layer group id and an ordered list of object ids.");
    error.statusCode = 400;
    throw error;
  }
  if (new Set(normalizedIds).size !== normalizedIds.length) {
    const error = new Error("Layer order requires unique object ids.");
    error.statusCode = 400;
    throw error;
  }

  return mutateState(projectDir, options, (state) => {
    const firstGroupIndex = state.objects.findIndex((object) => object.layerGroupId === groupId);
    const groupObjects = state.objects.filter((object) => object.layerGroupId === groupId);
    const groupIds = new Set(groupObjects.map((object) => object.id));
    const exactMembership = groupObjects.length === normalizedIds.length
      && normalizedIds.every((id) => groupIds.has(id));
    if (firstGroupIndex < 0 || !exactMembership) {
      const error = new Error("Layer group membership changed outside this history session.");
      error.statusCode = 409;
      throw error;
    }

    const byId = new Map(groupObjects.map((object) => [object.id, object]));
    const ordered = normalizedIds.map((id, index) => ({
      ...byId.get(id),
      layerGroupIndex: index
    }));
    const otherObjects = state.objects.filter((object) => object.layerGroupId !== groupId);
    const insertIndex = Math.min(firstGroupIndex, otherObjects.length);
    const objects = [
      ...otherObjects.slice(0, insertIndex),
      ...ordered,
      ...otherObjects.slice(insertIndex)
    ];
    const existingIds = new Set(state.objects.map((object) => object.id));
    const selection = typeof options.selection === "string" && existingIds.has(options.selection)
      ? options.selection
      : state.selection;

    return {
      state: { ...state, objects, selection },
      value: {
        objects: ordered,
        changed: groupObjects.some((object, index) => object.id !== normalizedIds[index]),
        selection
      }
    };
  });
}

function layerGroupReorderTargetIndex(groupObjects, currentIndex, direction) {
  const selected = groupObjects[currentIndex];
  if (!selected) return -1;
  if (direction === "up") {
    for (let index = currentIndex + 1; index < groupObjects.length; index += 1) {
      if (objectsOverlap(selected, groupObjects[index])) return index;
    }
    return -1;
  }

  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    if (objectsOverlap(selected, groupObjects[index])) return index;
  }
  return -1;
}

function objectsOverlap(left, right) {
  const leftBounds = objectBounds(left);
  const rightBounds = objectBounds(right);
  if (!leftBounds || !rightBounds) return false;
  return leftBounds.left < rightBounds.right
    && leftBounds.right > rightBounds.left
    && leftBounds.top < rightBounds.bottom
    && leftBounds.bottom > rightBounds.top;
}

function objectBounds(object) {
  if (!object || !Number.isFinite(object.x) || !Number.isFinite(object.y)) return null;
  const width = Number.isFinite(object.width) ? object.width : 0;
  const height = Number.isFinite(object.height) ? object.height : 0;
  if (width <= 0 || height <= 0) return null;
  return {
    left: object.x,
    top: object.y,
    right: object.x + width,
    bottom: object.y + height
  };
}

export async function updateObject(projectDir, id, patch, options = {}) {
  return mutateState(projectDir, options, (state) => {
    let updated = null;
    const objects = state.objects.map((object) => {
      if (object.id !== id) return object;
      updated = objectWithPatch(object, patch);
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

export async function updateObjects(projectDir, updates, options = {}) {
  if (!Array.isArray(updates) || updates.length === 0) {
    const error = new Error("update_objects requires at least one object update.");
    error.statusCode = 400;
    throw error;
  }
  const invalidUpdate = updates.find((update) => (
    typeof update?.id !== "string"
    || !update.id.trim()
    || !update.patch
    || typeof update.patch !== "object"
    || Array.isArray(update.patch)
  ));
  if (invalidUpdate) {
    const error = new Error("update_objects requires every update to include an object id and patch object.");
    error.statusCode = 400;
    throw error;
  }
  const normalizedUpdates = updates.map((update) => ({
    id: update.id.trim(),
    patch: update.patch
  }));
  if (new Set(normalizedUpdates.map((update) => update.id)).size !== normalizedUpdates.length) {
    const error = new Error("update_objects requires unique object ids.");
    error.statusCode = 400;
    throw error;
  }

  return mutateState(projectDir, options, (state) => {
    const existingIds = new Set(state.objects.map((object) => object.id));
    const missing = normalizedUpdates.find((update) => !existingIds.has(update.id));
    if (missing) {
      const error = new Error(`Canvas object not found: ${missing.id}`);
      error.statusCode = 404;
      throw error;
    }

    const patches = new Map(normalizedUpdates.map((update) => [update.id, update.patch]));
    const updatedById = new Map();
    const objects = state.objects.map((object) => {
      if (!patches.has(object.id)) return object;
      const updated = objectWithPatch(object, patches.get(object.id));
      updatedById.set(object.id, updated);
      return updated;
    });
    const selection = Object.hasOwn(options, "selection")
      ? (typeof options.selection === "string" && existingIds.has(options.selection) ? options.selection : null)
      : state.selection;
    return {
      state: { ...state, objects, selection },
      value: {
        objects: normalizedUpdates.map((update) => updatedById.get(update.id)),
        selection
      }
    };
  });
}

function objectWithPatch(object, patch) {
  return {
    ...object,
    ...sanitizeObjectPatch(patch),
    id: object.id,
    type: object.type,
    src: object.src,
    assetPath: object.assetPath,
    sourcePath: object.sourcePath,
    createdAt: object.createdAt
  };
}

function sanitizeObjectPatch(patch = {}) {
  const next = {};
  for (const key of ["x", "y"]) {
    if (Number.isFinite(patch[key])) next[key] = sanitizeCoordinate(patch[key]);
  }
  for (const key of ["width", "height"]) {
    if (Number.isFinite(patch[key])) next[key] = sanitizeDimension(patch[key]);
  }
  if (Number.isFinite(patch.fontSize)) next.fontSize = sanitizeFontSize(patch.fontSize);
  if (Number.isFinite(patch.strokeWidth)) next.strokeWidth = sanitizeStrokeWidth(patch.strokeWidth);
  if (Number.isFinite(patch.durationMs)) next.durationMs = sanitizeDurationMs(patch.durationMs);
  for (const key of ["layerGroupIndex", "layerGroupOriginalX", "layerGroupOriginalY", "layerGroupRelativeX", "layerGroupRelativeY"]) {
    if (Number.isFinite(patch[key])) next[key] = sanitizeCoordinate(patch[key]);
  }
  if (Number.isFinite(patch.assetVersion)) next.assetVersion = Math.max(0, Math.round(patch.assetVersion));
  for (const key of [
    "layerGroupOriginalWidth",
    "layerGroupOriginalHeight",
    "layerGroupOriginalLayerWidth",
    "layerGroupOriginalLayerHeight"
  ]) {
    if (Number.isFinite(patch[key])) next[key] = sanitizeDimension(patch[key]);
  }
  for (const key of ["name", "text", "color", "stroke", "status", "error", "layoutMode", "sourceObjectId", "layerGroupId", "layerGroupName", "layerGroupSourceObjectId", "layerGroupKind", "layerGroupBackgroundStatus", "prompt", "imagegenPrompt"]) {
    if (typeof patch[key] === "string") {
      const limit = key === "text" ? 2000 : key === "prompt" ? 4000 : key === "imagegenPrompt" ? 20000 : 300;
      next[key] = patch[key].slice(0, limit);
    }
  }
  if (typeof patch.layerGroupLocked === "boolean") next.layerGroupLocked = patch.layerGroupLocked;
  if (patch.crop && typeof patch.crop === "object") {
    const crop = sanitizeCrop(patch.crop);
    if (crop) next.crop = crop;
  }
  if (Array.isArray(patch.points)) {
    next.points = sanitizePoints(patch.points);
  }
  return next;
}

function sanitizePoints(points) {
  return Array.isArray(points)
    ? points
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => ({ x: sanitizeCoordinate(point.x), y: sanitizeCoordinate(point.y) }))
      .slice(0, 4000)
    : [];
}

function sanitizeCrop(crop) {
  const x = Number(crop.x);
  const y = Number(crop.y);
  const width = Number(crop.width);
  const height = Number(crop.height);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  const left = Math.max(0, Math.min(0.98, x));
  const top = Math.max(0, Math.min(0.98, y));
  const right = Math.max(left + 0.01, Math.min(1, left + Math.max(0.01, width)));
  const bottom = Math.max(top + 0.01, Math.min(1, top + Math.max(0.01, height)));
  return {
    x: Number(left.toFixed(4)),
    y: Number(top.toFixed(4)),
    width: Number((right - left).toFixed(4)),
    height: Number((bottom - top).toFixed(4))
  };
}

export async function markStaleJobPlaceholders(projectDir, { activePlaceholderIds = [], timeoutMs = 2 * 60_000, backgroundTimeoutMs = 6 * 60_000, canvasId = null } = {}) {
  const options = { canvasId };
  if (!canvasId && await legacyDefaultCanvasClaimed(projectDir)) {
    return readState(projectDir, options);
  }
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
    const objectsWithBackgroundStatus = objects.map((object) => {
      if (object.layerGroupKind !== "background" || object.layerGroupBackgroundStatus !== "filling") return object;
      const createdAt = Date.parse(object.createdAt || "");
      if (!Number.isFinite(createdAt) || now - createdAt < backgroundTimeoutMs) return object;
      changed = true;
      return {
        ...object,
        layerGroupBackgroundStatus: "failed"
      };
    });

    if (!changed) return { write: false, value: state };
    return { ...state, objects: objectsWithBackgroundStatus };
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
  const idSet = new Set(Array.isArray(ids)
    ? ids
      .filter((id) => typeof id === "string" && id.trim())
      .map((id) => id.trim())
    : []);
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

export async function restoreObjects(projectDir, entries, options = {}) {
  const restoreEntries = Array.isArray(entries)
    ? entries
      .map((entry) => {
        const object = entry && typeof entry === "object" && entry.object && typeof entry.object === "object"
          ? entry.object
          : entry;
        const index = Number.isInteger(entry?.index) ? entry.index : null;
        return { object, index };
      })
      .filter((entry) => entry.object && typeof entry.object === "object")
    : [];
  if (restoreEntries.length === 0) {
    const error = new Error("restore_objects requires at least one object.");
    error.statusCode = 400;
    throw error;
  }

  return mutateState(projectDir, options, (state) => {
    const existingIds = new Set(state.objects.map((object) => object.id));
    const restored = [];
    const seenIds = new Set();
    for (const entry of restoreEntries) {
      const object = normalizePersistedObject(entry.object, {
        projectDir,
        canvasId: canvasIdFrom(options)
      });
      if (!object) continue;
      if (existingIds.has(object.id) || seenIds.has(object.id)) {
        const error = new Error(`Canvas object already exists: ${object.id}`);
        error.statusCode = 409;
        throw error;
      }
      seenIds.add(object.id);
      restored.push({ object, index: entry.index });
    }
    if (restored.length === 0) {
      const error = new Error("restore_objects did not include any valid canvas objects.");
      error.statusCode = 400;
      throw error;
    }

    const objects = [...state.objects];
    for (const entry of restored) {
      const index = Number.isInteger(entry.index)
        ? Math.min(Math.max(entry.index, 0), objects.length)
        : objects.length;
      objects.splice(index, 0, entry.object);
    }
    const requestedSelection = typeof options.selection === "string" && restored.some((entry) => entry.object.id === options.selection)
      ? options.selection
      : state.selection;

    return {
      state: { ...state, objects, selection: requestedSelection },
      value: {
        objects: restored.map((entry) => entry.object),
        selection: requestedSelection
      }
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
    name: sanitizeString(input.name, type === "text" ? "Text" : "Drawing"),
    x: Number.isFinite(input.x) ? sanitizeCoordinate(input.x) : 120,
    y: Number.isFinite(input.y) ? sanitizeCoordinate(input.y) : 120,
    width: Number.isFinite(input.width) ? sanitizeDimension(input.width, 220) : 220,
    height: Number.isFinite(input.height) ? sanitizeDimension(input.height, 80) : 80,
    createdAt: new Date().toISOString()
  };

  if (type === "text") {
    return {
      ...base,
      text: sanitizeString(input.text, "Text", 2000, false),
      fontSize: Number.isFinite(input.fontSize) ? sanitizeFontSize(input.fontSize) : 28,
      color: sanitizeString(input.color, "#202124", 80)
    };
  }

  return {
    ...base,
    points: sanitizePoints(input.points),
    stroke: sanitizeString(input.stroke, "#202124", 80),
    strokeWidth: Number.isFinite(input.strokeWidth) ? sanitizeStrokeWidth(input.strokeWidth) : 4
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
    await assertSupportedImageFile(sourcePath);
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
    const buffer = decodeBase64ImagePayload(match[2]);
    if (!isSupportedImageBuffer(buffer)) {
      const error = new Error("dataUrl must contain supported image data");
      error.statusCode = 400;
      throw error;
    }
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

async function assertSupportedImageFile(sourcePath) {
  try {
    if (isSupportedImageBuffer(await fs.readFile(sourcePath))) return;
  } catch (error) {
    throw classifyImageSourceError(error);
  }
  const error = new Error("Image path must point to a supported image file.");
  error.statusCode = 400;
  throw error;
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

function decodeBase64ImagePayload(payload) {
  const compact = String(payload || "").replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 !== 0) {
    const error = new Error("dataUrl must contain valid base64 image data");
    error.statusCode = 400;
    throw error;
  }
  const buffer = Buffer.from(compact, "base64");
  if (buffer.length === 0) {
    const error = new Error("dataUrl must contain valid base64 image data");
    error.statusCode = 400;
    throw error;
  }
  return buffer;
}

function imageContentHash(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function imageDisplaySize(asset, input) {
  if (Number.isFinite(input.width) && Number.isFinite(input.height)) {
    return {
      width: sanitizeDimension(input.width, defaultImageSize.width),
      height: sanitizeDimension(input.height, defaultImageSize.height)
    };
  }

  if (!Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width <= 0 || asset.height <= 0) {
    return defaultImageSize;
  }

  const scale = Math.min(1, maxImageDisplaySize / Math.max(asset.width, asset.height));
  return {
    width: sanitizeDimension(asset.width * scale, defaultImageSize.width),
    height: sanitizeDimension(asset.height * scale, defaultImageSize.height)
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

export function isSupportedImageBuffer(buffer) {
  if (hasAvifSignature(buffer)) return true;
  const dimensions = readPngDimensions(buffer)
    || readJpegDimensions(buffer)
    || readGifDimensions(buffer)
    || readWebpDimensions(buffer);
  return Number.isFinite(dimensions?.width)
    && dimensions.width > 0
    && Number.isFinite(dimensions?.height)
    && dimensions.height > 0;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24 || !hasPngSignature(buffer)) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    hasAlpha: buffer[25] === 4 || buffer[25] === 6
  };
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || !hasJpegSignature(buffer)) return null;
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
  if (buffer.length < 10 || !hasGifSignature(buffer)) return null;
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8)
  };
}

function readWebpDimensions(buffer) {
  if (buffer.length < 30 || !hasWebpSignature(buffer)) {
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

function hasPngSignature(buffer) {
  return buffer.length >= 8
    && buffer[0] === 0x89
    && buffer.toString("ascii", 1, 4) === "PNG"
    && buffer[4] === 0x0d
    && buffer[5] === 0x0a
    && buffer[6] === 0x1a
    && buffer[7] === 0x0a;
}

function hasJpegSignature(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

function hasGifSignature(buffer) {
  if (buffer.length < 6) return false;
  const signature = buffer.toString("ascii", 0, 6);
  return signature === "GIF87a" || signature === "GIF89a";
}

function hasWebpSignature(buffer) {
  return buffer.length >= 12
    && buffer.toString("ascii", 0, 4) === "RIFF"
    && buffer.toString("ascii", 8, 12) === "WEBP";
}

function hasAvifSignature(buffer) {
  if (buffer.length < 12 || buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const brands = [buffer.toString("ascii", 8, 12)];
  for (let offset = 16; offset + 4 <= Math.min(buffer.length, 64); offset += 4) {
    brands.push(buffer.toString("ascii", offset, offset + 4));
  }
  return brands.some((brand) => brand === "avif" || brand === "avis");
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
