import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizePort } from "../src/cli.mjs";
import { sendImageToBoundChat } from "../src/codex-chat.mjs";
import { collectRecentImages } from "../src/collector.mjs";
import { createImageJob, getIgnoredGeneratedImagePaths, getImageJob, markTextRecognitionCancelledForTest, placeImportedElementLayersForTest, prepareImageForCollectionForTest } from "../src/jobs.mjs";
import { checkImageProcessingDepsAvailable } from "../src/ocr-setup.mjs";
import { assetsDirFor, jobsDirFor, legacyCanvasDataDirFor, statePathFor } from "../src/paths.mjs";
import { exportLayerGroupPsd } from "../src/psd-export.mjs";
import { canvasIdForThread } from "../src/runtime.mjs";
import { createServer as createAgentCanvasServer } from "../src/server.mjs";
import { addImage, addObject, deleteObjects, markStaleJobPlaceholders, promptHistory, readState, reorderLayerGroupLayer, restoreObjects, searchObjects, setLayerGroupOrder, transformState, updateObject, updateObjects, updateSelection, updateViewport, versionGroups } from "../src/store.mjs";
import { appUpdateStatus } from "../src/updater.mjs";

const execFileAsync = promisify(execFile);

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const stableFrontendImageActions = ["quick-edit", "remove-bg", "expand", "edit-text", "edit-elements"];
const directImageJobActions = ["quick-edit", "remove-bg", "expand", "edit-elements"];
let smokeProjectRegistryPath = null;

async function main() {
  const results = [];
  for (const [name, test] of [
    ["store concurrency", testStoreConcurrency],
    ["cross process store locking", testCrossProcessStoreLocking],
    ["delete undo restore", testDeleteUndoRestore],
    ["batch object update atomicity", testBatchObjectUpdateAtomicity],
    ["object patch sanitization", testObjectPatchSanitization],
    ["object input sanitization", testObjectInputSanitization],
    ["layer group overlap reorder", testLayerGroupOverlapReorder],
    ["stale background fill cleanup", testStaleBackgroundFillCleanup],
    ["path image dedupe", testPathImageDedupe],
    ["connected chroma key", testConnectedChromaKey],
    ["selection sanitization", testSelectionSanitization],
    ["viewport sanitization", testViewportSanitization],
    ["canvas id path isolation", testCanvasIdPathIsolation],
    ["http object patch sanitization", testHttpObjectPatchSanitization],
    ["http image input boundaries", testHttpImageInputBoundaries],
    ["canvas object search", testCanvasObjectSearch],
    ["canvas prompt history", testCanvasPromptHistory],
    ["canvas version groups", testCanvasVersionGroups],
    ["collector numeric boundaries", testCollectorNumericBoundaries],
    ["thread scoped collector defaults", testThreadScopedCollectorDefaults],
    ["cli numeric boundaries", testCliNumericBoundaries],
    ["port numeric boundaries", testPortNumericBoundaries],
    ["http query numeric boundaries", testHttpQueryNumericBoundaries],
    ["http json boundaries", testHttpJsonBoundaries],
    ["http file response boundaries", testHttpFileResponseBoundaries],
    ["http project registration boundaries", testHttpProjectRegistrationBoundaries],
    ["frontend action contract", testFrontendActionContract],
    ["canvas history queue", testCanvasHistoryQueue],
    ["http canvas mutation scope", testHttpCanvasMutationScope],
    ["image job error contract", testImageJobErrorContract],
    ["thread migration asset paths", testThreadMigrationAssetPaths],
    ["persistent project registry", testPersistentProjectRegistry],
    ["persistent project registry restored auto collector", testPersistentProjectRegistryRestoredAutoCollector],
    ["mcp canvas status", testMcpCanvasStatus],
    ["mcp numeric boundaries", testMcpNumericBoundaries],
    ["thread scoped auto collector", testAutoCollectorWatermark],
    ["package optional dependency scripts", testPackageOptionalDependencyScripts],
    ["plugin package manifest", testPluginPackageManifest],
    ["personal plugin installer", testPersonalPluginInstaller],
    ["dev plugin cache linker", testDevPluginCacheLinker],
    ["app update strategy", testAppUpdateStrategy],
    ["cli collect help", testCliCollectHelp],
    ["cli argument parsing and errors", testCliArgumentParsingAndErrors],
    ["cli codex thread environment", testCliCodexThreadEnvironment],
    ["doctor optional deps without python", testDoctorOptionalDepsWithoutPython],
    ["chat binding alias", testChatBindingAlias],
    ["chat websocket fallback", testChatWebSocketFallback],
    ["chat turn action contract", testChatTurnActionContract],
    ["edit text cancellation cleanup", testEditTextCancellationCleanup],
    ["quick edit annotations", testQuickEditAnnotations],
    ["alpha recut edit outputs", testAlphaRecutEditOutputs],
    ["edit elements scripts", testEditElementsScripts]
  ]) {
    await test();
    results.push(name);
  }
  console.log(JSON.stringify({ ok: true, tests: results }, null, 2));
}

async function createServer(options = {}) {
  return createAgentCanvasServer({
    persistentRegistryPath: await persistentRegistryPathForSmoke(),
    ...options
  });
}

async function persistentRegistryPathForSmoke() {
  if (!smokeProjectRegistryPath) {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-smoke-"));
    smokeProjectRegistryPath = path.join(tmp, "projects.json");
  }
  return smokeProjectRegistryPath;
}

async function testObjectPatchSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-patch-"));
  const image = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "safe.png",
    x: 10,
    y: 20
  });
  const updated = await updateObject(projectDir, image.id, {
    x: "not-a-number",
    y: 42,
    width: -10,
    crop: { x: 0.9, y: -2, width: 0.8, height: 0 },
    src: "https://example.invalid/evil.png",
    assetPath: "/tmp/evil.png",
    sourcePath: "/tmp/source.png",
    type: "text",
    createdAt: "1900-01-01T00:00:00.000Z"
  });
  assertEqual(updated.x, 10, "updateObject should ignore non-numeric coordinates");
  assertEqual(updated.y, 42, "updateObject should keep valid numeric coordinates");
  assertEqual(updated.width, 1, "updateObject should clamp dimensions");
  assertEqual(updated.crop.x, 0.9, "updateObject should keep sanitized crop x");
  assertEqual(updated.crop.y, 0, "updateObject should clamp crop y");
  assertEqual(updated.crop.width, 0.1, "updateObject should clamp crop width to the image edge");
  assertEqual(updated.crop.height, 0.01, "updateObject should clamp crop height to a minimum");
  assertEqual(updated.src, image.src, "updateObject should not allow src mutation");
  assertEqual(updated.assetPath, image.assetPath, "updateObject should not allow assetPath mutation");
  assertEqual(updated.sourcePath, image.sourcePath || null, "updateObject should not allow sourcePath mutation");
  assertEqual(updated.type, "image", "updateObject should not allow type mutation");
  assertEqual(updated.createdAt, image.createdAt, "updateObject should not allow createdAt mutation");
}

async function testObjectInputSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-object-input-"));
  const image = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "oversized-image.png",
    x: Number.MAX_VALUE,
    y: -Number.MAX_VALUE,
    width: 999999,
    height: -2
  });
  assertEqual(image.x, 1000000, "addImage should cap oversized image x coordinates");
  assertEqual(image.y, -1000000, "addImage should cap oversized image y coordinates");
  assertEqual(image.width, 6000, "addImage should cap explicit image display width");
  assertEqual(image.height, 1, "addImage should clamp explicit image display height to a visible minimum");

  const text = await addObject(projectDir, {
    type: "text",
    name: "Review Text",
    text: "Needs bounds",
    x: Number.MAX_VALUE,
    y: -Number.MAX_VALUE,
    width: 999999,
    height: 0,
    fontSize: -20
  });
  assertEqual(text.x, 1000000, "addObject should cap oversized text x coordinates");
  assertEqual(text.y, -1000000, "addObject should cap oversized text y coordinates");
  assertEqual(text.width, 6000, "addObject should cap oversized text width");
  assertEqual(text.height, 1, "addObject should clamp text height to a visible minimum");
  assertEqual(text.fontSize, 6, "addObject should clamp text font size to a visible minimum");

  const patched = await updateObject(projectDir, text.id, {
    width: 999999,
    height: -12,
    fontSize: 999,
    durationMs: -5
  });
  assertEqual(patched.width, 6000, "updateObject should cap oversized object width");
  assertEqual(patched.height, 1, "updateObject should clamp patched object height to a visible minimum");
  assertEqual(patched.fontSize, 160, "updateObject should cap oversized font size");
  assertEqual(patched.durationMs, 0, "updateObject should clamp negative job durations");

  const drawing = await addObject(projectDir, {
    type: "drawing",
    strokeWidth: 0,
    points: [
      { x: Number.MAX_VALUE, y: -Number.MAX_VALUE },
      { x: "bad", y: 12 }
    ]
  });
  assertEqual(drawing.strokeWidth, 1, "addObject should clamp drawing stroke width to a visible minimum");
  assertEqual(drawing.points.length, 1, "addObject should drop malformed drawing points");
  assertEqual(drawing.points[0].x, 1000000, "addObject should cap drawing point x coordinates");
  assertEqual(drawing.points[0].y, -1000000, "addObject should cap drawing point y coordinates");

  const corruptProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-object-state-"));
  const corruptAssetsDir = assetsDirFor(corruptProjectDir);
  const safePersistedAssetPath = path.join(corruptAssetsDir, "safe-persisted.png");
  const safePersistedSourcePath = path.join(os.tmpdir(), "safe-persisted-source.png");
  await fs.mkdir(corruptAssetsDir, { recursive: true });
  await fs.writeFile(safePersistedAssetPath, Buffer.from(pngOne, "base64"));
  await fs.mkdir(path.dirname(statePathFor(corruptProjectDir)), { recursive: true });
  await fs.writeFile(statePathFor(corruptProjectDir), `${JSON.stringify({
    version: 1,
    title: "Corrupt Objects",
    viewport: { x: 0, y: 0, zoom: 0.72 },
    objects: [
      { id: "", type: "text", text: "drop me", width: 10, height: 10 },
      { id: "legacy-text", type: "text", text: "legacy", x: 1e12, y: -1e12, width: -10, height: 999999, fontSize: 999 },
      { id: "legacy-drawing", type: "drawing", strokeWidth: -4, points: [{ x: 1e12, y: 2 }, { x: null, y: 2 }] },
      { id: "unsafe-image", type: "image", src: "file:///private/secret.png", assetPath: "/private/secret.png", sourcePath: "/private/source.png", width: 10, height: 10 },
      { id: "safe-image", type: "image", src: "/assets/safe-persisted.png", assetPath: safePersistedAssetPath, sourcePath: safePersistedSourcePath, width: 10, height: 10 },
      { id: "remote-image", type: "image", src: "https://example.invalid/remote.png", assetPath: "/private/remote.png", sourcePath: "/private/remote-source.png", width: 10, height: 10 }
    ],
    selection: "legacy-text"
  }, null, 2)}\n`);
  const corruptState = await readState(corruptProjectDir);
  assertEqual(corruptState.objects.length, 5, "readState should drop persisted objects without stable ids");
  const legacyText = corruptState.objects.find((object) => object.id === "legacy-text");
  assertEqual(legacyText.x, 1000000, "readState should cap persisted object coordinates");
  assertEqual(legacyText.width, 1, "readState should clamp persisted object dimensions to a visible minimum");
  assertEqual(legacyText.height, 6000, "readState should cap persisted object dimensions");
  assertEqual(legacyText.fontSize, 160, "readState should cap persisted text font size");
  const legacyDrawing = corruptState.objects.find((object) => object.id === "legacy-drawing");
  assertEqual(legacyDrawing.strokeWidth, 1, "readState should clamp persisted drawing stroke width");
  assertEqual(legacyDrawing.points.length, 1, "readState should drop malformed persisted drawing points");
  const unsafeImage = corruptState.objects.find((object) => object.id === "unsafe-image");
  assertEqual(unsafeImage.assetPath, null, "readState should drop persisted image asset paths outside the canvas assets directory");
  assertEqual(unsafeImage.sourcePath, null, "readState should drop source paths when the persisted local asset is unsafe");
  assertEqual(unsafeImage.src, "", "readState should drop local file image URLs from persisted state");
  const safeImage = corruptState.objects.find((object) => object.id === "safe-image");
  assertEqual(safeImage.assetPath, path.resolve(safePersistedAssetPath), "readState should preserve canvas-local persisted image assets");
  assertEqual(safeImage.sourcePath, path.resolve(safePersistedSourcePath), "readState should preserve source paths only when the local asset is trusted");
  assertEqual(safeImage.src, "/assets/safe-persisted.png", "readState should preserve asset URLs for trusted local assets");
  const remoteImage = corruptState.objects.find((object) => object.id === "remote-image");
  assertEqual(remoteImage.assetPath, null, "readState should not trust local asset paths on remote images");
  assertEqual(remoteImage.sourcePath, null, "readState should not keep source paths for remote-only images");
  assertEqual(remoteImage.src, "https://example.invalid/remote.png", "readState should preserve remote image URLs");
  assertEqual(corruptState.selection, "legacy-text", "readState should preserve selections that still point at sanitized objects");
}

async function testLayerGroupOverlapReorder() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-layer-overlap-"));
  const groupId = "layer_group_overlap";
  const bottom = await addObject(projectDir, { type: "text", text: "bottom", x: 0, y: 0, width: 100, height: 100 });
  const unrelated = await addObject(projectDir, { type: "text", text: "unrelated", x: 240, y: 0, width: 80, height: 80 });
  const selected = await addObject(projectDir, { type: "text", text: "selected", x: 20, y: 20, width: 100, height: 100 });
  const top = await addObject(projectDir, { type: "text", text: "top", x: 30, y: 30, width: 100, height: 100 });
  for (const [index, object] of [bottom, unrelated, selected, top].entries()) {
    await updateObject(projectDir, object.id, {
      layerGroupId: groupId,
      layerGroupName: "Overlap Group",
      layerGroupIndex: index,
      layerGroupLocked: false
    });
  }

  await reorderLayerGroupLayer(projectDir, groupId, selected.id, "down");
  const movedDown = (await readState(projectDir)).objects.filter((object) => object.layerGroupId === groupId);
  assertEqual(
    movedDown.map((object) => object.id).join(","),
    [selected.id, bottom.id, unrelated.id, top.id].join(","),
    "Layer down should move below the nearest overlapping lower layer and skip unrelated non-overlapping layers"
  );

  for (const [index, object] of [bottom, unrelated, selected, top].entries()) {
    await updateObject(projectDir, object.id, { layerGroupIndex: index });
  }
  await reorderLayerGroupLayer(projectDir, groupId, selected.id, "up");
  const movedUp = (await readState(projectDir)).objects.filter((object) => object.layerGroupId === groupId);
  assertEqual(
    movedUp.map((object) => object.id).join(","),
    [bottom.id, unrelated.id, top.id, selected.id].join(","),
    "Layer up should move above the nearest overlapping upper layer and leave unrelated layer order intact"
  );

  const result = await reorderLayerGroupLayer(projectDir, groupId, unrelated.id, "up");
  assertEqual(result.changed, false, "Layer reorder should no-op when no overlapping layer exists in the requested direction");
  const unchanged = (await readState(projectDir)).objects.filter((object) => object.layerGroupId === groupId);
  assertEqual(
    unchanged.map((object) => object.id).join(","),
    [bottom.id, unrelated.id, top.id, selected.id].join(","),
    "Layer reorder no-op should preserve layer order"
  );

  const restoredOrder = [bottom.id, unrelated.id, selected.id, top.id];
  const restored = await setLayerGroupOrder(projectDir, groupId, restoredOrder);
  assertEqual(restored.objects.map((object) => object.id).join(","), restoredOrder.join(","), "exact layer-order restore should return the requested order");
  assertEqual(restored.objects.map((object) => object.layerGroupIndex).join(","), "0,1,2,3", "exact layer-order restore should reindex every group member");
  const restoredState = (await readState(projectDir)).objects.filter((object) => object.layerGroupId === groupId);
  assertEqual(restoredState.map((object) => object.id).join(","), restoredOrder.join(","), "exact layer-order restore should rebuild persisted object order for DOM stacking");

  await setLayerGroupOrder(projectDir, groupId, restoredOrder.slice(1)).then(
    () => { throw new Error("exact layer-order restore should reject changed group membership"); },
    (error) => assertEqual(error.statusCode, 409, "exact layer-order restore should reject changed group membership")
  );
}

async function testStaleBackgroundFillCleanup() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-stale-bg-"));
  const stale = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "stale-background.png"
  });
  const fresh = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "fresh-background.png",
    allowDuplicate: true
  });

  await transformState(projectDir, {}, (state) => ({
    ...state,
    objects: state.objects.map((object) => {
      if (object.id === stale.id) {
        return {
          ...object,
          layerGroupKind: "background",
          layerGroupBackgroundStatus: "filling",
          createdAt: new Date(Date.now() - 10_000).toISOString()
        };
      }
      if (object.id === fresh.id) {
        return {
          ...object,
          layerGroupKind: "background",
          layerGroupBackgroundStatus: "filling",
          createdAt: new Date().toISOString()
        };
      }
      return object;
    })
  }));

  const state = await markStaleJobPlaceholders(projectDir, { backgroundTimeoutMs: 1000 });
  const staleObject = state.objects.find((object) => object.id === stale.id);
  const freshObject = state.objects.find((object) => object.id === fresh.id);
  assertEqual(staleObject.layerGroupBackgroundStatus, "failed", "stale background filling layers should be marked failed");
  assertEqual(freshObject.layerGroupBackgroundStatus, "filling", "fresh background filling layers should keep running status");
}

async function testPathImageDedupe() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-dedupe-"));
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-dedupe-source-"));
  const firstPath = path.join(sourceDir, "generated.png");
  const secondPath = path.join(sourceDir, "renamed.png");
  const buffer = Buffer.from(pngOne, "base64");
  await fs.writeFile(firstPath, buffer);
  await fs.writeFile(secondPath, buffer);

  const first = await addImage(projectDir, {
    path: firstPath,
    name: "generated.png"
  });
  const duplicate = await addImage(projectDir, {
    path: secondPath,
    name: "renamed.png"
  });
  const state = await readState(projectDir);
  assertEqual(duplicate.id, first.id, "path imports with identical image bytes should return the existing canvas object");
  assertEqual(state.objects.length, 1, "path imports with identical image bytes should not append duplicate objects");
  assertEqual(state.selection, first.id, "path import dedupe should keep the existing object selected");

  const repeated = await addImage(projectDir, {
    path: secondPath,
    name: "renamed.png",
    allowDuplicate: true
  });
  const repeatedState = await readState(projectDir);
  assertEqual(repeatedState.objects.length, 2, "allowDuplicate should preserve explicit duplicate image imports");
  if (repeated.id === first.id) throw new Error("allowDuplicate path imports should create a distinct object.");
}

async function testConnectedChromaKey() {
  try {
    await runPython(["-c", "from PIL import Image"]);
  } catch {
    console.warn("Skipping connected chroma-key smoke test; Pillow is unavailable.");
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-connected-key-"));
  const makeFixture = path.join(tmp, "make-fixture.py");
  await fs.writeFile(makeFixture, [
    "from PIL import Image, ImageDraw",
    "from pathlib import Path",
    "import sys",
    "root = Path(sys.argv[1])",
    "image = Image.new('RGBA', (32, 24), (251, 4, 225, 255))",
    "draw = ImageDraw.Draw(image)",
    "draw.rectangle((10, 8, 21, 17), fill=(210, 20, 20, 255))",
    "image.save(root / 'fixture.png')"
  ].join("\n"));
  await runPython([makeFixture, tmp]);

  await runPython([
    path.join(process.cwd(), "scripts", "remove_chroma_key_connected.py"),
    "--input", path.join(tmp, "fixture.png"),
    "--out", path.join(tmp, "cutout.png"),
    "--auto-key", "border",
    "--tolerance", "36",
    "--force"
  ]);

  const inspect = path.join(tmp, "inspect-cutout.py");
  await fs.writeFile(inspect, [
    "from PIL import Image",
    "from pathlib import Path",
    "import json, sys",
    "root = Path(sys.argv[1])",
    "image = Image.open(root / 'cutout.png').convert('RGBA')",
    "payload = {",
    "  'corner': image.getpixel((0, 0)),",
    "  'red': image.getpixel((12, 10)),",
    "}",
    "(root / 'inspect.json').write_text(json.dumps(payload), encoding='utf-8')"
  ].join("\n"));
  await runPython([inspect, tmp]);
  const result = JSON.parse(await fs.readFile(path.join(tmp, "inspect.json"), "utf8"));
  assertEqual(result.corner.join(","), "0,0,0,0", "connected chroma-key should make border background transparent");
  assertEqual(result.red.join(","), "210,20,20,255", "connected chroma-key should preserve isolated red foreground RGB and alpha");
}

async function testSelectionSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-selection-"));
  const image = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "selectable.png"
  });
  const selected = await updateSelection(projectDir, image.id);
  assertEqual(selected, image.id, "updateSelection should accept an existing object id");
  const cleared = await updateSelection(projectDir, "missing-object-id");
  assertEqual(cleared, null, "updateSelection should clear unknown object ids");
  const state = await readState(projectDir);
  assertEqual(state.selection, null, "selection state should not persist orphan object ids");

  const corruptProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-corrupt-state-"));
  await fs.mkdir(path.dirname(statePathFor(corruptProjectDir)), { recursive: true });
  await fs.writeFile(statePathFor(corruptProjectDir), `${JSON.stringify({
    version: 1,
    title: "Corrupt State",
    viewport: { x: 1, y: 2, zoom: 0.72 },
    objects: { id: "not-an-array" },
    selection: "missing-object"
  }, null, 2)}\n`);
  const corruptState = await readState(corruptProjectDir);
  assertEqual(Array.isArray(corruptState.objects), true, "readState should normalize corrupt object collections to an array");
  assertEqual(corruptState.objects.length, 0, "readState should drop non-array object collections");
  assertEqual(corruptState.selection, null, "readState should clear selections that do not point at existing objects");
}

async function testViewportSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-viewport-"));
  const minZoom = await updateViewport(projectDir, { x: 10, y: 20, zoom: -4 });
  assertEqual(minZoom.x, 10, "updateViewport should keep finite x");
  assertEqual(minZoom.y, 20, "updateViewport should keep finite y");
  assertEqual(minZoom.zoom, 0.12, "updateViewport should clamp zoom to the frontend minimum");
  const maxZoom = await updateViewport(projectDir, { zoom: 20 });
  assertEqual(maxZoom.zoom, 2.2, "updateViewport should clamp zoom to the frontend maximum");
  const unchanged = await updateViewport(projectDir, { zoom: "bad" });
  assertEqual(unchanged.zoom, 2.2, "updateViewport should ignore non-numeric zoom values");

  const legacyProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-legacy-viewport-"));
  await fs.mkdir(path.dirname(statePathFor(legacyProjectDir)), { recursive: true });
  const legacyBaseState = await readState(legacyProjectDir);
  await fs.writeFile(statePathFor(legacyProjectDir), `${JSON.stringify({
    ...legacyBaseState,
    viewport: { x: "bad", y: 24, zoom: 0 }
  }, null, 2)}\n`);
  const legacyState = await readState(legacyProjectDir);
  assertEqual(legacyState.viewport.x, 0, "readState should sanitize legacy viewport x values");
  assertEqual(legacyState.viewport.y, 24, "readState should preserve finite legacy viewport y values");
  assertEqual(legacyState.viewport.zoom, 0.12, "readState should clamp legacy viewport zoom values");
}

async function testCanvasIdPathIsolation() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-canvas-id-"));
  const slashCanvasId = "review/canvas";
  const underscoreCanvasId = "review_canvas";
  const slashStatePath = statePathFor(projectDir, slashCanvasId);
  const underscoreStatePath = statePathFor(projectDir, underscoreCanvasId);
  if (slashStatePath === underscoreStatePath) {
    throw new Error("canvasId storage paths should not collide after path sanitization.");
  }

  const slashObject = await addObject(projectDir, {
    type: "text",
    text: "slash canvas",
    name: "Slash Canvas"
  }, { canvasId: slashCanvasId });
  const underscoreObject = await addObject(projectDir, {
    type: "text",
    text: "underscore canvas",
    name: "Underscore Canvas"
  }, { canvasId: underscoreCanvasId });

  const slashState = await readState(projectDir, { canvasId: slashCanvasId });
  const underscoreState = await readState(projectDir, { canvasId: underscoreCanvasId });
  assertEqual(slashState.objects.length, 1, "canvasId with path separators should keep an isolated state file");
  assertEqual(slashState.objects[0].id, slashObject.id, "slash canvas should read its own object");
  assertEqual(underscoreState.objects.length, 1, "sanitized-looking canvasId should keep a separate state file");
  assertEqual(underscoreState.objects[0].id, underscoreObject.id, "underscore canvas should read its own object");

  const legacyProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-legacy-canvas-id-"));
  const legacyCanvasId = "legacy/canvas";
  const legacyStatePath = path.join(legacyCanvasDataDirFor(legacyProjectDir, legacyCanvasId), "codex-canvas.json");
  const migratedStatePath = statePathFor(legacyProjectDir, legacyCanvasId);
  await fs.mkdir(path.dirname(legacyStatePath), { recursive: true });
  await fs.writeFile(legacyStatePath, `${JSON.stringify({
    version: 1,
    title: "Legacy Canvas",
    viewport: { x: 0, y: 0, zoom: 0.72 },
    objects: [{ id: "legacy-object", type: "text", text: "legacy", x: 1, y: 2, width: 10, height: 10 }],
    selection: "legacy-object"
  }, null, 2)}\n`);
  const migratedState = await readState(legacyProjectDir, { canvasId: legacyCanvasId });
  assertEqual(migratedState.objects[0]?.id, "legacy-object", "unsafe legacy canvasId paths should migrate to collision-resistant storage");
  await fs.access(migratedStatePath);
}

async function testHttpObjectPatchSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-patch-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const image = await postJson(`${base}api/images${search}`, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: "safe.png",
      x: 12,
      y: 24
    });
    assertEqual(image.status, 201, "HTTP image setup should succeed");
    const patched = await fetch(`${base}api/objects/${image.body.id}${search}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        x: "bad",
        y: 64,
        crop: { x: 0.2, y: 0.25, width: 0.5, height: 0.4 },
        src: "https://example.invalid/evil.png",
        assetPath: "/tmp/evil.png",
        sourcePath: "/tmp/source.png",
        type: "text"
      })
    });
    const body = await patched.json();
    assertEqual(patched.status, 200, "HTTP object patch should succeed with sanitized fields");
    assertEqual(body.x, 12, "HTTP patch should ignore invalid coordinate values");
    assertEqual(body.y, 64, "HTTP patch should keep valid coordinate values");
    assertEqual(body.crop.width, 0.5, "HTTP patch should keep sanitized crop width");
    assertEqual(body.crop.height, 0.4, "HTTP patch should keep sanitized crop height");
    assertEqual(body.src, image.body.src, "HTTP patch should not mutate src");
    assertEqual(body.assetPath, image.body.assetPath, "HTTP patch should not mutate assetPath");
    assertEqual(body.sourcePath, image.body.sourcePath || null, "HTTP patch should not mutate sourcePath");
    assertEqual(body.type, "image", "HTTP patch should not mutate type");

    const selected = await postJson(`${base}api/selection${search}`, { selection: image.body.id });
    assertEqual(selected.status, 200, "HTTP selection should accept existing objects");
    assertEqual(selected.body.selection, image.body.id, "HTTP selection should return the selected object id");
    const orphan = await postJson(`${base}api/selection${search}`, { selection: "missing-object-id" });
    assertEqual(orphan.status, 200, "HTTP selection should tolerate unknown object ids");
    assertEqual(orphan.body.selection, null, "HTTP selection should clear unknown object ids instead of persisting orphans");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHttpImageInputBoundaries() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-image-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const noSource = await postJson(`${base}api/images${search}`, {});
    assertEqual(noSource.status, 400, "HTTP image import should reject missing image sources");
    assertEqual(noSource.body.error, "POST /api/images requires exactly one image input: path, url, or dataUrl.", "missing image sources should return a useful error");

    const missing = await postJson(`${base}api/images${search}`, {
      path: path.join(projectDir, "missing.png")
    });
    assertEqual(missing.status, 404, "HTTP image import should reject missing local paths as client errors");
    assertEqual(missing.body.error, "Image path does not exist.", "missing image paths should return a useful error");

    const directory = await postJson(`${base}api/images${search}`, {
      path: projectDir
    });
    assertEqual(directory.status, 400, "HTTP image import should reject directory paths as client errors");
    assertEqual(directory.body.error, "Image path must point to a file.", "directory image paths should return a useful error");

    const fakeImagePath = path.join(projectDir, "fake.png");
    await fs.writeFile(fakeImagePath, "not a real png");
    const fakeImage = await postJson(`${base}api/images${search}`, {
      path: fakeImagePath
    });
    assertEqual(fakeImage.status, 400, "HTTP image import should reject files that only have image extensions");
    assertEqual(fakeImage.body.error, "Image path must point to a supported image file.", "fake local images should return a useful error");

    const invalidDataUrl = await postJson(`${base}api/images${search}`, {
      dataUrl: "data:image/png;base64,not-base64!"
    });
    assertEqual(invalidDataUrl.status, 400, "HTTP image import should reject malformed base64 data URLs");
    assertEqual(invalidDataUrl.body.error, "dataUrl must contain valid base64 image data", "malformed data URLs should return a useful error");

    const fakeDataUrl = await postJson(`${base}api/images${search}`, {
      dataUrl: `data:image/png;base64,${Buffer.from("not a real png").toString("base64")}`
    });
    assertEqual(fakeDataUrl.status, 400, "HTTP image import should reject base64 payloads that are not images");
    assertEqual(fakeDataUrl.body.error, "dataUrl must contain supported image data", "fake image data URLs should return a useful error");

    const ambiguous = await postJson(`${base}api/images${search}`, {
      url: "https://example.invalid/image.png",
      dataUrl: `data:image/png;base64,${pngOne}`
    });
    assertEqual(ambiguous.status, 400, "HTTP image import should reject ambiguous image sources");
    assertEqual(ambiguous.body.error, "POST /api/images requires exactly one image input: path, url, or dataUrl.", "ambiguous image sources should return a useful error");

    const stateResponse = await fetch(`${base}api/state${search}`);
    const state = await stateResponse.json();
    assertEqual(state.objects.length, 0, "rejected image inputs should not create canvas objects");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testCanvasObjectSearch() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-search-"));
  const image = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "Sunset concept.png",
    prompt: "Warm city skyline with orange clouds",
    x: 12,
    y: 24
  });
  const text = await addObject(projectDir, {
    type: "text",
    text: "Client approval note",
    name: "Review Note"
  });
  const direct = await searchObjects(projectDir, { query: "skyline" });
  assertEqual(direct.total, 1, "store search should find objects by prompt");
  assertEqual(direct.results[0].id, image.id, "store search should return matching image object summaries");
  if (!direct.results[0].matchFields.includes("prompt")) throw new Error("store search should report matched prompt fields.");

  const typed = await searchObjects(projectDir, { query: "note", type: "text" });
  assertEqual(typed.total, 1, "store search should support type filters");
  assertEqual(typed.results[0].id, text.id, "store search type filter should return the text object");

  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const response = await fetch(`${base}api/search${search}&q=${encodeURIComponent("sunset")}&limit=5`);
    const body = await response.json();
    assertEqual(response.status, 200, "HTTP search should succeed");
    assertEqual(body.total, 1, "HTTP search should return matching objects");
    assertEqual(body.results[0].id, image.id, "HTTP search should return the matching image");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const cli = await runCliJson(["search", "approval", "--project", projectDir, "--json"]);
  assertEqual(cli.status, 0, "CLI search should succeed");
  assertEqual(cli.body.total, 1, "CLI search should return matching objects");
  assertEqual(cli.body.results[0].id, text.id, "CLI search should return the matching text object");
}

async function testCanvasPromptHistory() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-prompts-"));
  const first = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "first.png",
    prompt: "Moody neon city"
  });
  await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "duplicate.png",
    prompt: "Moody neon city"
  });
  const latest = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "latest.png",
    prompt: "Bright product render",
    imagegenPrompt: "Use the imagegen tool to create a bright product render with precise studio lighting.",
    sourceObjectId: first.id,
    layoutMode: "canvas-row"
  });

  const direct = await promptHistory(projectDir);
  assertEqual(direct.total, 2, "prompt history should de-duplicate repeated prompts");
  assertEqual(direct.prompts[0].prompt, "Use the imagegen tool to create a bright product render with precise studio lighting.", "prompt history should list newest full imagegen prompts first");
  assertEqual(direct.prompts[0].summaryPrompt, "Bright product render", "prompt history should retain the short prompt summary");
  assertEqual(direct.prompts[0].imagegenPrompt, "Use the imagegen tool to create a bright product render with precise studio lighting.", "prompt history should expose the full imagegen prompt");
  assertEqual(direct.prompts[0].objectId, latest.id, "prompt history should retain the object that used the prompt");
  assertEqual(direct.prompts[0].sourceObjectId, first.id, "prompt history should retain source object context");

  const fullPromptFiltered = await promptHistory(projectDir, { query: "studio lighting" });
  assertEqual(fullPromptFiltered.total, 1, "prompt history should support query filtering on full imagegen prompts");
  assertEqual(fullPromptFiltered.prompts[0].objectId, latest.id, "prompt history full prompt filtering should return the matching object");

  const filtered = await promptHistory(projectDir, { query: "neon" });
  assertEqual(filtered.total, 1, "prompt history should support query filtering");
  assertEqual(filtered.prompts[0].prompt, "Moody neon city", "prompt history filtering should return matching prompt text");

  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const response = await fetch(`${base}api/prompts${search}&q=${encodeURIComponent("product")}`);
    const body = await response.json();
    assertEqual(response.status, 200, "HTTP prompt history should succeed");
    assertEqual(body.total, 1, "HTTP prompt history should filter prompt text");
    assertEqual(body.prompts[0].prompt, "Use the imagegen tool to create a bright product render with precise studio lighting.", "HTTP prompt history should return full imagegen prompts");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const cli = await runCliJson(["prompts", "moody", "--project", projectDir, "--json"]);
  assertEqual(cli.status, 0, "CLI prompts should succeed");
  assertEqual(cli.body.total, 1, "CLI prompts should filter prompt history");
  assertEqual(cli.body.prompts[0].prompt, "Moody neon city", "CLI prompts should return matching prompt summaries");
}

async function testCanvasVersionGroups() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-versions-"));
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "source.png",
    prompt: "Base product render"
  });
  const first = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "blue-one.png",
    prompt: "Blue product variant",
    sourceObjectId: source.id,
    batchId: "batch-blue",
    layoutMode: "canvas-row"
  });
  const second = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "blue-two.png",
    prompt: "Blue product variant",
    sourceObjectId: source.id,
    batchId: "batch-blue",
    layoutMode: "canvas-row"
  });
  await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "manual.png",
    prompt: "Manual reference"
  });

  const direct = await versionGroups(projectDir, { query: "blue", groupBy: "sourceObjectId", objectLimit: 1 });
  assertEqual(direct.total, 1, "version groups should filter grouped objects by query");
  assertEqual(direct.groups[0].value, source.id, "version groups should group derivatives by sourceObjectId");
  assertEqual(direct.groups[0].count, 2, "version groups should retain full group counts when objects are limited");
  assertEqual(direct.groups[0].objects.length, 1, "version groups should cap returned objects per group");
  assertEqual(direct.groups[0].objects[0].id, second.id, "version groups should list newest grouped objects first");
  const limitedOlderMatch = await versionGroups(projectDir, { query: "blue-one", groupBy: "sourceObjectId", objectLimit: 1 });
  assertEqual(limitedOlderMatch.total, 1, "version groups should match all grouped objects even when returned objects are limited");
  assertEqual(limitedOlderMatch.groups[0].objects.length, 1, "version groups should keep objectLimit after matching full groups");

  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const response = await fetch(`${base}api/versions${search}&groupBy=batchId&q=${encodeURIComponent("batch-blue")}`);
    const body = await response.json();
    assertEqual(response.status, 200, "HTTP version groups should succeed");
    assertEqual(body.groupBy, "batchId", "HTTP version groups should use the requested grouping field");
    assertEqual(body.total, 1, "HTTP version groups should filter batch groups");
    assertEqual(body.groups[0].count, 2, "HTTP version groups should include grouped object counts");

    const invalid = await fetch(`${base}api/versions${search}&groupBy=notAField`);
    const invalidBody = await invalid.json();
    assertEqual(invalid.status, 400, "HTTP version groups should reject unsupported grouping fields");
    assertEqual(invalidBody.error, "Unsupported version group field: notAField", "HTTP version groups should return a useful grouping error");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const cli = await runCliJson(["versions", "variant", "--project", projectDir, "--group-by", "prompt", "--json"]);
  assertEqual(cli.status, 0, "CLI versions should succeed");
  assertEqual(cli.body.groupBy, "prompt", "CLI versions should pass the prompt grouping field");
  assertEqual(cli.body.total, 1, "CLI versions should filter prompt groups");
  assertEqual(cli.body.groups[0].value, first.prompt, "CLI versions should return matching prompt version groups");
}

async function testCollectorNumericBoundaries() {
  const invalidFixture = await createCollectFixtureProject("collector-invalid", 3);
  const invalid = await collectRecentImages(invalidFixture.projectDir, {
    roots: [invalidFixture.imagesDir],
    limit: -5,
    prompt: "collector invalid limit"
  });
  assertEqual(invalid.imported.length, 3, "collector should fall back to the default limit for invalid numeric input");

  const roundedFixture = await createCollectFixtureProject("collector-rounded", 3);
  const rounded = await collectRecentImages(roundedFixture.projectDir, {
    roots: [roundedFixture.imagesDir],
    limit: 1.6,
    prompt: "collector rounded limit"
  });
  assertEqual(rounded.imported.length, 2, "collector should round finite decimal limits consistently with other entry points");

  const cappedFixture = await createCollectFixtureProject("collector-capped", 105);
  const capped = await collectRecentImages(cappedFixture.projectDir, {
    roots: [cappedFixture.imagesDir],
    limit: 1000,
    prompt: "collector capped limit"
  });
  assertEqual(capped.imported.length, 100, "collector should cap oversized limits");
}

async function testThreadScopedCollectorDefaults() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-thread-collector-"));
  const projectDir = path.join(fixtureRoot, "project");
  const generatedImagesRoot = path.join(fixtureRoot, "generated_images");
  const threadId = "thread-collector-a";
  const threadDir = path.join(generatedImagesRoot, threadId);
  await fs.mkdir(threadDir, { recursive: true });
  await fs.mkdir(projectDir, { recursive: true });

  const targetPath = path.join(threadDir, "target.png");
  const globalPath = path.join(generatedImagesRoot, "global.png");
  const projectPath = path.join(projectDir, "project.png");
  await writeDistinctPng(targetPath, "thread-target");
  await writeDistinctPng(globalPath, "global-output");
  await writeDistinctPng(projectPath, "project-output");

  const scoped = await collectRecentImages(projectDir, {
    threadId,
    canvasId: canvasIdForThread(threadId),
    generatedImagesRoot,
    sinceMs: 0
  });
  assertEqual(scoped.scannedRoots.length, 1, "default collection should scan exactly one thread directory");
  assertEqual(scoped.scannedRoots[0], threadDir, "default collection should use generated_images/<threadId>");
  assertEqual(scoped.imported.length, 1, "default collection should import only the bound thread output");
  assertEqual(path.resolve(scoped.imported[0].sourcePath), path.resolve(targetPath), "default collection should not import global or project-root images");

  const unboundProjectDir = path.join(fixtureRoot, "unbound-project");
  await fs.mkdir(unboundProjectDir, { recursive: true });
  const unbound = await collectRecentImages(unboundProjectDir, {
    generatedImagesRoot,
    sinceMs: 0
  });
  assertEqual(unbound.scannedRoots.length, 0, "unbound default collection should be a safe no-op");
  assertEqual(unbound.imported.length, 0, "unbound default collection should not import global images");

  const recoveryDir = path.join(fixtureRoot, "recovery");
  const recoveryPath = path.join(recoveryDir, "recovered.png");
  await writeDistinctPng(recoveryPath, "direct-explicit-recovery");
  const recovered = await collectRecentImages(unboundProjectDir, {
    roots: [recoveryDir],
    generatedImagesRoot,
    sinceMs: 0
  });
  assertEqual(recovered.imported.length, 1, "explicit recovery roots should remain available without a thread binding");
  assertEqual(path.resolve(recovered.imported[0].sourcePath), path.resolve(recoveryPath), "explicit recovery should scan only the requested root");
}

async function testCliNumericBoundaries() {
  const projectDir = await createLimitFixtureProject("cli-limit");
  const invalid = await runCliJson(["search", "cli-limit", "--project", projectDir, "--limit", "-5", "--json"]);
  assertEqual(invalid.status, 0, "CLI search should accept invalid numeric limits without failing");
  assertEqual(invalid.body.total, 20, "CLI search should fall back to the default limit for invalid numeric input");

  const rounded = await runCliJson(["search", "cli-limit", "--project", projectDir, "--limit", "2.6", "--json"]);
  assertEqual(rounded.body.total, 3, "CLI search should round finite decimal limits consistently with store limits");

  const capped = await runCliJson(["search", "cli-limit", "--project", projectDir, "--limit", "1000", "--json"]);
  assertEqual(capped.body.total, 100, "CLI search should cap oversized limits");

  const versions = await runCliJson(["versions", "cli-limit", "--project", projectDir, "--group-by", "prompt", "--object-limit", "1000", "--json"]);
  assertEqual(versions.body.groups?.[0]?.count, 105, "CLI versions should keep full group counts when objectLimit is capped");
  assertEqual(versions.body.groups?.[0]?.objects?.length, 100, "CLI versions should cap oversized object limits");
}

async function testPortNumericBoundaries() {
  assertEqual(normalizePort(undefined), 43217, "missing port should use the default Codex-Canvas port");
  assertEqual(normalizePort(""), 43217, "blank port should use the default Codex-Canvas port");
  assertEqual(normalizePort(true), 43217, "flag-only port should use the default Codex-Canvas port");
  assertEqual(normalizePort("0"), 0, "port zero should remain valid for dynamic local binding");
  assertEqual(normalizePort("49152"), 49152, "string numeric ports should be accepted");
  assertEqual(normalizePort(65535), 65535, "the maximum TCP port should be accepted");
  assertEqual(normalizePort(-1), 43217, "negative ports should use the default Codex-Canvas port");
  assertEqual(normalizePort(65536), 43217, "out-of-range ports should use the default Codex-Canvas port");
  assertEqual(normalizePort(1.5), 43217, "fractional ports should use the default Codex-Canvas port");
  assertEqual(normalizePort(Infinity), 43217, "infinite ports should use the default Codex-Canvas port");
  assertEqual(normalizePort("not-a-port"), 43217, "non-numeric ports should use the default Codex-Canvas port");
}

async function testHttpQueryNumericBoundaries() {
  const projectDir = await createLimitFixtureProject("http-limit");
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const invalid = await fetch(`${base}api/search${search}&q=http-limit&limit=-5`);
    const invalidBody = await invalid.json();
    assertEqual(invalid.status, 200, "HTTP search should accept invalid numeric limits without failing");
    assertEqual(invalidBody.total, 20, "HTTP search should fall back to the default limit for invalid numeric input");

    const rounded = await fetch(`${base}api/search${search}&q=http-limit&limit=2.6`);
    const roundedBody = await rounded.json();
    assertEqual(roundedBody.total, 3, "HTTP search should round finite decimal limits consistently with store limits");

    const capped = await fetch(`${base}api/search${search}&q=http-limit&limit=1000`);
    const cappedBody = await capped.json();
    assertEqual(cappedBody.total, 100, "HTTP search should cap oversized limits");

    const versions = await fetch(`${base}api/versions${search}&groupBy=prompt&q=http-limit&object_limit=1000`);
    const versionsBody = await versions.json();
    assertEqual(versionsBody.groups?.[0]?.count, 105, "HTTP versions should keep full group counts when objectLimit is capped");
    assertEqual(versionsBody.groups?.[0]?.objects?.length, 100, "HTTP versions should cap oversized object_limit values");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHttpJsonBoundaries() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-json-"));
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    maxJsonBodyBytes: 64
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const malformed = await fetch(`${base}api/state${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{"
    });
    const malformedBody = await malformed.json();
    assertEqual(malformed.status, 400, "malformed JSON should return a client error");
    assertEqual(malformedBody.error, "Request body must be valid JSON.", "malformed JSON should return a useful error");

    const nonObject = await fetch(`${base}api/state${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null"
    });
    const nonObjectBody = await nonObject.json();
    assertEqual(nonObject.status, 400, "non-object JSON should return a client error");
    assertEqual(nonObjectBody.error, "Request body must be a JSON object.", "non-object JSON should describe the API contract");

    const tooLarge = await fetch(`${base}api/state${search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x".repeat(128) })
    });
    const tooLargeBody = await tooLarge.json();
    assertEqual(tooLarge.status, 413, "oversized JSON should return payload too large");
    if (!String(tooLargeBody.error || "").includes("limit")) {
      throw new Error("oversized JSON should describe the body limit.");
    }

    const viewportProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-viewport-"));
    const viewportServer = await createServer({ projectDir: viewportProjectDir, port: 0, autoCollect: false });
    const viewportBase = viewportServer.url.replace(/\?.*/, "");
    const viewportSearch = new URL(viewportServer.url).search;
    try {
      const negativeZoom = await postJson(`${viewportBase}api/state${viewportSearch}`, {
        viewport: { x: 5, y: 6, zoom: -1 }
      });
      assertEqual(negativeZoom.status, 200, "HTTP viewport update should accept numeric viewport payloads");
      assertEqual(negativeZoom.body.zoom, 0.12, "HTTP viewport update should clamp zoom to the frontend minimum");
      const hugeZoom = await postJson(`${viewportBase}api/state${viewportSearch}`, {
        viewport: { zoom: 100 }
      });
      assertEqual(hugeZoom.body.zoom, 2.2, "HTTP viewport update should clamp zoom to the frontend maximum");
    } finally {
      await new Promise((resolve) => viewportServer.server.close(resolve));
    }

    const badPath = await fetch(`${base}%E0%A4%A${search}`);
    const badPathBody = await badPath.json();
    assertEqual(badPath.status, 400, "malformed URL encoding should return a client error");
    assertEqual(badPathBody.error, "Request path must use valid URL encoding.", "malformed URL encoding should return a useful error");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHttpFileResponseBoundaries() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-files-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    for (const pathname of ["missing-static.js", "assets/missing-image.png"]) {
      const response = await fetch(`${base}${pathname}${search}`);
      const body = await response.json();
      assertEqual(response.status, 404, `missing ${pathname} should return not found`);
      assertEqual(body.error, "File not found.", `missing ${pathname} should not disclose filesystem paths`);
      if (/file:|\/Users\/|\\\\Users\\\\|codex-canvas-http-files/.test(JSON.stringify(body))) {
        throw new Error(`missing ${pathname} response should not include local filesystem paths.`);
      }
    }

    const traversal = await fetch(`${base}%2e%2e%2fpackage.json${search}`);
    assertEqual(traversal.status, 403, "static path traversal attempts should remain forbidden");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHttpProjectRegistrationBoundaries() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-projects-"));
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    assertEqual(new URL(url).searchParams.get("token"), null, "Codex-Canvas URLs should not expose runtime capability tokens");

    const missing = await postJson(`${base}api/projects${search}`, {});
    assertEqual(missing.status, 400, "HTTP project registration should reject missing projectDir");

    const empty = await postJson(`${base}api/projects${search}`, { projectDir: "" });
    assertEqual(empty.status, 400, "HTTP project registration should reject empty projectDir");

    const relative = await postJson(`${base}api/projects${search}`, { projectDir: "relative-project" });
    assertEqual(relative.status, 400, "HTTP project registration should reject relative projectDir");

    const registeredDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-projects-registered-"));
    const registered = await postJson(`${base}api/projects${search}`, {
      projectDir: registeredDir,
      autoCollect: false
    });
    assertEqual(registered.status, 201, "HTTP project registration should accept absolute projectDir");
    assertEqual(registered.body.project?.projectDir, registeredDir, "HTTP project registration should keep the supplied absolute projectDir");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHttpCanvasMutationScope() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-http-scope-"));
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false,
    chatThreadId: "thread-scope-a"
  });
  const base = url.replace(/\?.*/, "");
  const oldSearch = new URL(url).search;
  try {
    const initialStateResponse = await fetch(`${base}api/state${oldSearch}`);
    const initialState = await initialStateResponse.json();
    assertEqual(initialState.canvasScope?.threadId, "thread-scope-a", "HTTP state should expose its server-resolved thread scope");

    const created = await postJson(`${base}api/objects${oldSearch}`, {
      type: "text",
      text: "scope-a-only",
      expectedProjectId: initialState.canvasScope.projectId,
      expectedCanvasId: initialState.canvasScope.canvasId
    });
    assertEqual(created.status, 201, "matching expected canvas scope should allow a mutation");

    const groupPeer = await postJson(`${base}api/objects${oldSearch}`, {
      type: "text",
      text: "scope-a-peer",
      x: 8,
      y: 8,
      expectedProjectId: initialState.canvasScope.projectId,
      expectedCanvasId: initialState.canvasScope.canvasId
    });
    assertEqual(groupPeer.status, 201, "scope fixture should create an overlapping layer peer");
    const groupId = "scope-history-group";
    const grouped = await fetch(`${base}api/objects${oldSearch}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        updates: [
          { id: created.body.id, patch: { layerGroupId: groupId, layerGroupIndex: 0 } },
          { id: groupPeer.body.id, patch: { layerGroupId: groupId, layerGroupIndex: 1 } }
        ],
        expectedProjectId: initialState.canvasScope.projectId,
        expectedCanvasId: initialState.canvasScope.canvasId
      })
    });
    assertEqual(grouped.status, 200, "matching expected canvas scope should allow an atomic layer-group setup");

    const rebound = await postJson(`${base}api/chat-binding${oldSearch}`, { threadId: "thread-scope-b" });
    assertEqual(rebound.status, 200, "scope fixture should rebind through the original project URL");

    const staleRestore = await postJson(`${base}api/objects/restore${oldSearch}`, {
      objects: [{ object: created.body, index: 0 }],
      expectedProjectId: initialState.canvasScope.projectId,
      expectedCanvasId: initialState.canvasScope.canvasId
    });
    assertEqual(staleRestore.status, 409, "a stale undo must not restore objects through a project alias into another thread");

    const staleReorder = await postJson(`${base}api/layer-groups/${groupId}/reorder${oldSearch}`, {
      objectId: created.body.id,
      direction: "up",
      expectedProjectId: initialState.canvasScope.projectId,
      expectedCanvasId: initialState.canvasScope.canvasId
    });
    assertEqual(staleReorder.status, 409, "a stale layer-order undo must not mutate a rebound thread canvas");

    const staleExactOrder = await postJson(`${base}api/layer-groups/${groupId}/order${oldSearch}`, {
      objectIds: [created.body.id, groupPeer.body.id],
      expectedProjectId: initialState.canvasScope.projectId,
      expectedCanvasId: initialState.canvasScope.canvasId
    });
    assertEqual(staleExactOrder.status, 409, "an exact layer-order history restore must reject a stale rebound canvas scope");

    const reboundStateResponse = await fetch(`${base}api/state${oldSearch}`);
    const reboundState = await reboundStateResponse.json();
    assertEqual(reboundState.canvasScope?.threadId, "thread-scope-b", "old project URLs should report the rebound server scope");
    assertEqual(reboundState.objects.some((object) => object.text === "scope-a-only"), false, "rebound thread should remain free of stale undo objects");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testFrontendActionContract() {
  const html = await fs.readFile(path.join(process.cwd(), "public", "index.html"), "utf8");
  const app = await fs.readFile(path.join(process.cwd(), "public", "app.js"), "utf8");
  const styles = await fs.readFile(path.join(process.cwd(), "public", "styles.css"), "utf8");

  const domActions = quotedAttributeValues(html, "data-action");
  const translatedActions = objectKeysFromTranslationBlock(app, "actions");
  assertSetEqual(translatedActions, domActions, "translated actions should match visible action buttons");

  const domTools = new Set([
    ...quotedAttributeValues(html, "data-tool"),
    ...[...quotedAttributeValues(html, "data-view-action")]
      .filter((action) => action === "upload")
      .map(() => "upload-image")
  ]);
  const translatedTools = objectKeysFromTranslationBlock(app, "tools");
  assertSetEqual(translatedTools, domTools, "translated tools should match visible tool buttons");

  if (/selectionMoreMenu|selection-more-menu|isMoreMenuOpen|data-action=["']more["']/.test(`${html}\n${app}\n${styles}`)) {
    throw new Error("frontend should not keep orphan selection more-menu code without a More action.");
  }
  if (html.includes("appUpdateLabel") || html.includes('data-i18n="checkUpdates"')) {
    throw new Error("settings menu should merge version and update into one Version row.");
  }
  if (!html.includes('id="appUpdateButton" class="settings-menu-row settings-version-row"') || !html.includes("settings-version-value")) {
    throw new Error("merged Version row should remain a clickable update control with a combined value.");
  }
  if (app.includes("image.title = label") || app.includes("element.title = label")) {
    throw new Error("canvas image objects should not expose long native hover tooltips.");
  }
  if (!app.includes('const defaultQuickEditMarkColor = "#d93025"') || !app.includes("applyQuickEditDefaultMarkColor(action)")) {
    throw new Error("Quick Edit should default temporary markup to red without changing the global tool color default.");
  }
  if (!html.includes('data-tool="hand"') || !html.includes('data-history-action="undo"') || !html.includes('data-history-action="redo"')) {
    throw new Error("frontend should expose the default Hand tool plus Undo and Redo controls.");
  }
  if (!app.includes('const defaultCanvasTool = "hand"') || !app.includes('import { CanvasHistory } from "./canvas-history.js"')) {
    throw new Error("frontend should initialize the scoped canvas history with Hand as the default tool.");
  }

  const frontendImageJobActions = [...domActions].filter((action) => stableFrontendImageActions.includes(action));
  for (const action of frontendImageJobActions) {
    if (!translatedActions.has(action)) {
      throw new Error(`frontend image action ${action} should have a translated label.`);
    }
  }
  for (const action of stableFrontendImageActions) {
    if (!frontendImageJobActions.includes(action)) {
      throw new Error(`frontend should expose the existing stable ${action} image action.`);
    }
  }

  await assertHttpImageJobActionsAccepted();
}

async function testCanvasHistoryQueue() {
  const result = await execFileAsync(process.execPath, [path.join(process.cwd(), "scripts", "history-smoke.mjs")], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const payload = JSON.parse(result.stdout);
  assertEqual(payload.ok, true, "canvas history queue smoke should pass");
  assertEqual(payload.checks.length, 10, "canvas history queue smoke should cover its concurrency and scope boundaries");
}

async function assertHttpImageJobActionsAccepted() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-actions-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    for (const action of directImageJobActions) {
      const response = await postJson(`${base}api/jobs${search}`, {
        action,
        objectId: "missing-object"
      });
      assertEqual(response.status, 404, `HTTP image job action ${action} should pass stable action validation before object lookup`);
      if (/Unsupported image job action/.test(response.body.error || "")) {
        throw new Error(`HTTP image job action ${action} should be accepted as a stable backend action.`);
      }
    }

    const directEditText = await postJson(`${base}api/jobs${search}`, {
      action: "edit-text",
      objectId: "missing-object"
    });
    assertEqual(directEditText.status, 400, "HTTP image jobs should not start Edit Text without the text recognition workflow");
    if (!/text recognition workflow/.test(directEditText.body.error || "")) {
      throw new Error("HTTP image jobs should explain that Edit Text uses the text recognition workflow.");
    }

    const unsupported = await postJson(`${base}api/jobs${search}`, {
      action: "not-a-stable-action",
      objectId: "missing-object"
    });
    assertEqual(unsupported.status, 400, "HTTP image jobs should reject unknown stable action ids");
    if (!/Unsupported image job action/.test(unsupported.body.error || "")) {
      throw new Error("HTTP image jobs should return the unsupported-action validation error for unknown actions.");
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testImageJobErrorContract() {
  const app = await fs.readFile(path.join(process.cwd(), "public", "app.js"), "utf8");
  const styles = await fs.readFile(path.join(process.cwd(), "public", "styles.css"), "utf8");
  const runner = await fs.readFile(path.join(process.cwd(), "src", "codex-runner.mjs"), "utf8");
  if (!runner.includes('"--skip-git-repo-check"')) {
    throw new Error("Codex image jobs should skip the git repo trust check so thread-scoped canvas directories can run jobs.");
  }
  if (!/function summarizeCodexFailure/.test(runner) || !/Codex image job failed:/.test(runner)) {
    throw new Error("Codex image job failures should surface a concise CLI log detail instead of only the exit code.");
  }
  if (!app.includes("job-error-message") || !styles.includes(".job-error-message")) {
    throw new Error("Failed image job placeholders should render the job error text visibly.");
  }
  if (!styles.includes(".canvas-object.layer-background-filling .image-content::before") || !styles.includes("background-mask-ripple")) {
    throw new Error("Edit Elements filling background layers should render a distinct lightweight mask ripple.");
  }
  if (!app.includes("appUpdateInfo?.canUpdate && appUpdateInfo?.updateAvailable")) {
    throw new Error("frontend update button should not POST an update while the updater is blocked.");
  }
}

async function testThreadMigrationAssetPaths() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-migrate-"));
  const defaultImage = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "default.png"
  });
  const threadCanvasId = "thread-migration-test";
  const migrated = await readState(projectDir, { canvasId: threadCanvasId });
  const migratedImage = migrated.objects.find((object) => object.id === defaultImage.id);
  if (!migratedImage) throw new Error("Thread canvas migration should preserve default image objects.");
  const expectedAssetsDir = assetsDirFor(projectDir, threadCanvasId);
  if (!isInsidePath(expectedAssetsDir, migratedImage.assetPath || "")) {
    throw new Error("Thread canvas migration should rewrite assetPath into the thread assets directory.");
  }
  await fs.access(migratedImage.assetPath);

  const secondThreadCanvasId = "thread-migration-second";
  const secondThreadState = await readState(projectDir, { canvasId: secondThreadCanvasId });
  assertEqual(secondThreadState.objects.length, 0, "legacy default canvas objects should migrate only once and must not leak into a second thread");
}

async function testPersistentProjectRegistry() {
  const firstProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-first-"));
  const secondProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-second-"));
  const reboundProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-rebound-"));
  const registryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-file-"));
  const persistentRegistryPath = path.join(registryRoot, "projects.json");
  const first = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath
  });
  const firstBase = first.url.replace(/\?.*/, "");
  const firstSearch = new URL(first.url).search;
  const firstProjectId = new URL(first.url).searchParams.get("project");
  let registered;
  let reboundOldProjectId;
  let reboundNewProjectId;
  try {
    registered = await postJson(`${firstBase}api/projects${firstSearch}`, {
      projectDir: secondProjectDir,
      autoCollect: false,
      threadId: "thread-persisted-registry"
    });
    assertEqual(registered.status, 201, "HTTP project registration should succeed before registry persistence is checked");
    assertEqual(new URL(registered.body.url).searchParams.get("threadId"), "thread-persisted-registry", "Thread-scoped canvas URLs should include the bound threadId");
    assertEqual(new URL(registered.body.url).searchParams.get("token"), null, "Thread-scoped canvas URLs should not include runtime capability tokens");

    const rebound = await postJson(`${firstBase}api/projects${firstSearch}`, {
      projectDir: reboundProjectDir,
      autoCollect: false
    });
    assertEqual(rebound.status, 201, "HTTP project registration should support a project that will be rebound");
    reboundOldProjectId = new URL(rebound.body.url).searchParams.get("project");
    const reboundBinding = await postJson(`${firstBase}api/chat-binding?project=${encodeURIComponent(reboundOldProjectId)}`, {
      threadId: "thread-persisted-alias"
    });
    assertEqual(reboundBinding.status, 200, "HTTP chat binding should succeed before alias persistence is checked");
    assertEqual(new URL(reboundBinding.body.url).searchParams.get("threadId"), "thread-persisted-alias", "Chat binding should return a thread-scoped canvas URL");
    reboundNewProjectId = reboundBinding.body.projectId;
  } finally {
    await new Promise((resolve) => first.server.close(resolve));
  }

  const registryPayload = JSON.parse(await fs.readFile(persistentRegistryPath, "utf8"));
  assertEqual(registryPayload.capabilityToken, undefined, "Persistent project registry should not store runtime capability tokens");
  if (!registryPayload.projects?.some((project) => project.projectDir === secondProjectDir && project.chatThreadId === "thread-persisted-registry")) {
    throw new Error("Persistent project registry should store registered thread-scoped projects.");
  }
  if (!registryPayload.aliases?.some((alias) => alias.from === reboundOldProjectId && alias.to === reboundNewProjectId)) {
    throw new Error("Persistent project registry should store project id aliases created by chat binding.");
  }

  const restoredProjectId = new URL(registered.body.url).searchParams.get("project");
  const second = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath
  });
  const secondBase = second.url.replace(/\?.*/, "");
  assertEqual(new URL(second.url).searchParams.get("token"), null, "Restarted Codex-Canvas URLs should not include runtime capability tokens");
  try {
    const projectsResponse = await fetch(`${secondBase}api/projects`);
    const projectsBody = await projectsResponse.json();
    const restored = projectsBody.projects?.find((project) => project.id === restoredProjectId);
    if (!restored) throw new Error("Restarted Codex-Canvas server should restore registered projects from the persistent registry.");
    assertEqual(restored.projectDir, secondProjectDir, "Restored project should keep its projectDir");
    assertEqual(restored.chatThreadId, "thread-persisted-registry", "Restored project should keep its chat binding");
    assertEqual(restored.chatBound, true, "Restored project should report chat binding");
    assertEqual(restored.autoCollect, false, "Restored projects with explicit auto-collection opt-out should stay disabled");

    const stateResponse = await fetch(`${secondBase}api/state?project=${encodeURIComponent(restoredProjectId)}`);
    assertEqual(stateResponse.status, 200, "Restored project id should route to its canvas state after restart");

    const aliasStateResponse = await fetch(`${secondBase}api/state?project=${encodeURIComponent(reboundOldProjectId)}`);
    assertEqual(aliasStateResponse.status, 200, "Persisted project id aliases should route old open canvas URLs after restart");
  } finally {
    await new Promise((resolve) => second.server.close(resolve));
  }

  const third = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: true,
    persistentRegistryPath,
    autoCollectIntervalMs: 100,
    autoCollectWatchDebounceMs: 25
  });
  const thirdBase = third.url.replace(/\?.*/, "");
  try {
    const projectsResponse = await fetch(`${thirdBase}api/projects`);
    const projectsBody = await projectsResponse.json();
    const restoredInitial = projectsBody.projects?.find((project) => project.id === firstProjectId);
    if (!restoredInitial) throw new Error("Restarted Codex-Canvas server should restore the initial project from the persistent registry.");
    assertEqual(restoredInitial.autoCollect, false, "Initial projects with persisted auto-collection opt-out should stay disabled after restart");

    const imagePath = path.join(firstProjectDir, `initial-opt-out-${Date.now()}.png`);
    await fs.writeFile(imagePath, Buffer.from(pngOne, "base64"));
    await delay(700);
    const stateResponse = await fetch(`${thirdBase}api/state?project=${encodeURIComponent(firstProjectId)}`);
    const state = await stateResponse.json();
    if (state.objects?.some((object) => path.resolve(object.sourcePath || "") === path.resolve(imagePath))) {
      throw new Error("Persisted initial project auto-collection opt-out should prevent background image imports.");
    }
  } finally {
    await new Promise((resolve) => third.server.close(resolve));
  }
}

async function testPersistentProjectRegistryRestoredAutoCollector() {
  const firstProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-auto-first-"));
  const restoredProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-auto-restored-"));
  const registryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-registry-auto-file-"));
  const persistentRegistryPath = path.join(registryRoot, "projects.json");
  const generatedImagesRoot = path.join(registryRoot, "generated_images");
  const restoredThreadId = "thread-restored-auto-collector";
  const restoredThreadDir = path.join(generatedImagesRoot, restoredThreadId);
  await fs.mkdir(restoredThreadDir, { recursive: true });
  const first = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: true,
    persistentRegistryPath,
    generatedImagesRoot,
    autoCollectIntervalMs: 100,
    autoCollectWatchDebounceMs: 25
  });
  const firstBase = first.url.replace(/\?.*/, "");
  const firstSearch = new URL(first.url).search;
  let restoredProjectId;
  try {
    const registered = await postJson(`${firstBase}api/projects${firstSearch}`, {
      projectDir: restoredProjectDir,
      threadId: restoredThreadId
    });
    assertEqual(registered.status, 201, "HTTP project registration should persist an auto-collecting project");
    assertEqual(registered.body.project?.autoCollect, true, "newly registered projects should auto-collect by default");
    restoredProjectId = new URL(registered.body.url).searchParams.get("project");
  } finally {
    await new Promise((resolve) => first.server.close(resolve));
  }

  const second = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: true,
    persistentRegistryPath,
    generatedImagesRoot,
    autoCollectIntervalMs: 100,
    autoCollectWatchDebounceMs: 25
  });
  const secondBase = second.url.replace(/\?.*/, "");
  try {
    const projectsResponse = await fetch(`${secondBase}api/projects`);
    const projectsBody = await projectsResponse.json();
    const restored = projectsBody.projects?.find((project) => project.id === restoredProjectId);
    if (!restored) throw new Error("Restarted Codex-Canvas server should restore the auto-collecting project.");
    assertEqual(restored.projectDir, restoredProjectDir, "Restored auto-collecting project should keep its projectDir");
    assertEqual(restored.autoCollect, true, "Restored auto-collecting project should resume auto-collection when the service enables it");

    const imagePath = path.join(restoredThreadDir, `restored-auto-${Date.now()}.png`);
    await writeDistinctPng(imagePath, "restored-thread-output");
    const imported = await waitForStateObject(
      `${secondBase}api/state?project=${encodeURIComponent(restoredProjectId)}`,
      (object) => path.resolve(object.sourcePath || "") === path.resolve(imagePath),
      "restored project auto collector should import a new image after server restart"
    );
    assertEqual(imported.name, path.basename(imagePath), "restored project auto collector should import the bound thread image");
  } finally {
    await new Promise((resolve) => second.server.close(resolve));
  }
}

async function testAutoCollectorWatermark() {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-collector-"));
  const projectDir = path.join(fixtureRoot, "project");
  const generatedImagesRoot = path.join(fixtureRoot, "generated_images");
  const threadA = "thread-auto-collector-a";
  const threadB = "thread-auto-collector-b";
  const threadADir = path.join(generatedImagesRoot, threadA);
  const threadBDir = path.join(generatedImagesRoot, threadB);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(threadADir, { recursive: true });
  await fs.mkdir(threadBDir, { recursive: true });
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: true,
    chatThreadId: threadA,
    generatedImagesRoot,
    autoCollectIntervalMs: 60_000,
    autoCollectWatchDebounceMs: 50
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const registeredB = await postJson(`${base}api/projects${search}`, {
      projectDir,
      threadId: threadB
    });
    assertEqual(registeredB.status, 201, "a second thread canvas should register for isolation coverage");
    const threadBSearch = new URL(registeredB.body.url).search;

    const registeredUnbound = await postJson(`${base}api/projects${search}`, {
      projectDir
    });
    assertEqual(registeredUnbound.status, 201, "an unbound canvas should register for safe no-op coverage");
    const unboundSearch = new URL(registeredUnbound.body.url).search;

    const staleMtimeMs = Date.now();
    const firstPath = path.join(threadADir, "first.png");
    await writeDistinctPng(firstPath, "thread-a-first");
    await waitForObjectCount(`${base}api/state${search}`, 1, "auto collector watcher should import a new bound-thread image before the polling fallback");
    await delay(250);
    const untouchedB = await (await fetch(`${base}api/state${threadBSearch}`)).json();
    assertEqual(untouchedB.objects.length, 0, "thread A generated images must not leak into thread B");

    const secondPath = path.join(threadBDir, "second.png");
    await writeDistinctPng(secondPath, "thread-b-first");
    await waitForObjectCount(`${base}api/state${threadBSearch}`, 1, "thread B should collect its own generated image");
    const unchangedA = await (await fetch(`${base}api/state${search}`)).json();
    assertEqual(unchangedA.objects.length, 1, "thread B generated images must not leak into thread A");

    const stalePath = path.join(threadADir, "stale-but-new-file.png");
    await writeDistinctPng(stalePath, "stale-thread-a");
    await fs.utimes(stalePath, staleMtimeMs / 1000, staleMtimeMs / 1000);

    const invalidPath = path.join(threadADir, "extension-only.png");
    await fs.writeFile(invalidPath, Buffer.from("not a real png, but a unique image candidate"));
    await writeDistinctPng(path.join(projectDir, "project-root.png"), "project-root-output");
    await writeDistinctPng(path.join(generatedImagesRoot, "global-root.png"), "global-root-output");
    await delay(450);
    const stateA = await (await fetch(`${base}api/state${search}`)).json();
    const stateB = await (await fetch(`${base}api/state${threadBSearch}`)).json();
    const unboundState = await (await fetch(`${base}api/state${unboundSearch}`)).json();
    assertEqual(stateA.objects.length, 1, "thread auto collector should ignore stale, invalid, project-root, and global-root images");
    assertEqual(stateB.objects.length, 1, "thread B should remain isolated from project and global roots");
    assertEqual(unboundState.objects.length, 0, "unbound auto collection should be a safe no-op");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testMcpCanvasStatus() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-mcp-"));
  await addObject(projectDir, { type: "text", text: "mcp searchable note", name: "MCP Note", x: 10, y: 10 });
  const promptImage = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "mcp-prompt.png",
    prompt: "MCP prompt history sample"
  });
  const client = await startMcpServer();
  try {
    const initialized = await client.request("initialize", {});
    assertEqual(initialized.serverInfo?.version, "0.1.1", "MCP server version should match package version");
    const listed = await client.request("tools/list", {});
    if (!listed.tools?.some((tool) => tool.name === "canvas_status")) {
      throw new Error("MCP tools/list should expose canvas_status.");
    }
    assertMcpToolSchema(listed.tools);
    await assertMcpActionBoundaries(client, projectDir, promptImage.id);
    const status = await client.request("tools/call", {
      name: "canvas_status",
      arguments: { projectDir }
    });
    assertEqual(status.structuredContent?.objects, 2, "MCP canvas_status should read default canvas state");
    assertEqual(
      status.structuredContent?.chatBound,
      Boolean(process.env.CODEX_CANVAS_CODEX_THREAD_ID || process.env.CODEX_THREAD_ID),
      "MCP canvas_status should infer chat binding only when a Codex thread environment is available"
    );
    const opened = await client.request("tools/call", {
      name: "open_canvas",
      arguments: { projectDir, autoUpdate: false }
    });
    const openedText = opened.content?.find((item) => item.type === "text")?.text || "";
    if (!/Codex-Canvas is available: \[Open Codex-Canvas\]\(http:\/\/127\.0\.0\.1:\d+\/\?project=[^)]+\)/.test(openedText)) {
      throw new Error("MCP open_canvas should return a clickable Markdown link, not only a bare URL.");
    }
    assertEqual(opened.structuredContent?.url?.startsWith("http://127.0.0.1:"), true, "MCP open_canvas should keep the raw URL in structured content");
    const customCanvasId = "mcp-custom-canvas";
    await client.request("tools/call", {
      name: "add_image",
      arguments: {
        projectDir,
        canvasId: customCanvasId,
        dataUrl: `data:image/png;base64,${pngOne}`,
        name: "mcp-custom-canvas.png",
        prompt: "unique explicit canvas prompt"
      }
    });
    const customStatus = await client.request("tools/call", {
      name: "canvas_status",
      arguments: { projectDir, canvasId: customCanvasId }
    });
    assertEqual(customStatus.structuredContent?.canvasId, customCanvasId, "MCP canvas_status should accept an explicit canvasId");
    const inheritedMcpThread = Boolean(process.env.CODEX_CANVAS_CODEX_THREAD_ID || process.env.CODEX_THREAD_ID);
    assertEqual(
      customStatus.structuredContent?.objects,
      inheritedMcpThread ? 1 : 3,
      inheritedMcpThread
        ? "a second MCP canvas scope should not inherit default objects after the environment thread consumed the one-time migration"
        : "the first MCP canvas scope should include the one-time migrated default objects plus the new image"
    );
    const customSearch = await client.request("tools/call", {
      name: "search_canvas",
      arguments: { projectDir, canvasId: customCanvasId, query: "unique explicit canvas prompt" }
    });
    assertEqual(customSearch.structuredContent?.total, 1, "MCP add_image should write the new image to the explicit canvasId scope");
    const defaultStatus = await client.request("tools/call", {
      name: "canvas_status",
      arguments: { projectDir }
    });
    assertEqual(defaultStatus.structuredContent?.objects, 2, "MCP explicit canvasId writes should not leak into the default canvas");
    const defaultSearch = await client.request("tools/call", {
      name: "search_canvas",
      arguments: { projectDir, query: "unique explicit canvas prompt" }
    });
    assertEqual(defaultSearch.structuredContent?.total, 0, "MCP explicit canvasId image should not appear in default canvas search");
    const search = await client.request("tools/call", {
      name: "search_canvas",
      arguments: { projectDir, query: "searchable" }
    });
    assertEqual(search.structuredContent?.total, 1, "MCP search_canvas should search canvas object text");
    assertEqual(search.structuredContent?.results?.[0]?.matchFields?.includes("text"), true, "MCP search_canvas should report matched fields");
    const prompts = await client.request("tools/call", {
      name: "prompt_history",
      arguments: { projectDir, query: "sample" }
    });
    assertEqual(prompts.structuredContent?.total, 1, "MCP prompt_history should filter prompt history");
    assertEqual(prompts.structuredContent?.prompts?.[0]?.prompt, "MCP prompt history sample", "MCP prompt_history should return prompt summaries");
    const versions = await client.request("tools/call", {
      name: "version_groups",
      arguments: { projectDir, query: "sample", groupBy: "prompt" }
    });
    assertEqual(versions.structuredContent?.total, 1, "MCP version_groups should filter version groups");
    assertEqual(versions.structuredContent?.groups?.[0]?.value, "MCP prompt history sample", "MCP version_groups should return grouped object summaries");
    await assertRejects(
      () => client.request("tools/call", {
        name: "canvas_status",
        arguments: {}
      }),
      "MCP tool call requires projectDir.",
      "MCP canvas_status should reject missing projectDir instead of using cwd"
    );
    await assertRejects(
      () => client.request("tools/call", {
        name: "canvas_status",
        arguments: {}
      }),
      "MCP tool call requires projectDir.",
      "MCP canvas_status should return the invalid params JSON-RPC code",
      { code: -32602, statusCode: 400 }
    );
    await assertRejects(
      () => client.request("tools/call", {
        name: "canvas_status",
        arguments: { projectDir: "relative-project" }
      }),
      "MCP tool call requires an absolute projectDir.",
      "MCP canvas_status should reject relative projectDir instead of resolving against server cwd"
    );
  } finally {
    await client.stop();
  }
}

async function assertMcpActionBoundaries(client, projectDir, imageObjectId) {
  await assertRejects(
    () => client.request("tools/call", {
      name: "add_image",
      arguments: {
        projectDir,
        url: "https://example.invalid/image.png",
        dataUrl: `data:image/png;base64,${pngOne}`
      }
    }),
    "add_image requires exactly one image input",
    "MCP add_image should reject ambiguous image inputs",
    { code: -32602, statusCode: 400 }
  );

  for (const action of directImageJobActions) {
    await assertRejects(
      () => client.request("tools/call", {
        name: "start_image_job",
        arguments: { projectDir, objectId: "missing-object", action }
      }),
      "Canvas object not found",
      `MCP start_image_job should accept stable action ${action} before object lookup`,
      { code: -32004, statusCode: 404 }
    );
  }

  await assertRejects(
    () => client.request("tools/call", {
      name: "start_image_job",
      arguments: { projectDir, objectId: "missing-object", action: "edit-text" }
    }),
    "text recognition workflow",
    "MCP start_image_job should not bypass the Edit Text recognition workflow",
    { code: -32602, statusCode: 400 }
  );

  await assertRejects(
    () => client.request("tools/call", {
      name: "start_image_job",
      arguments: { projectDir, objectId: "missing-object", action: "not-a-stable-action" }
    }),
    "Unsupported image job action",
    "MCP start_image_job should reject unknown stable action ids",
    { code: -32602, statusCode: 400 }
  );

  await assertRejects(
    () => client.request("tools/call", {
      name: "send_to_chat",
      arguments: { projectDir, threadId: "thread-mcp-send", objectId: imageObjectId }
    }),
    "send_to_chat requires a stable chat action",
    "MCP send_to_chat should require a stable chat action",
    { code: -32602, statusCode: 400 }
  );

  await assertRejects(
    () => client.request("tools/call", {
      name: "send_to_chat",
      arguments: { projectDir, threadId: "thread-mcp-send", objectId: imageObjectId, action: "quick-edit" }
    }),
    "send_to_chat requires a stable chat action",
    "MCP send_to_chat should reject image job actions",
    { code: -32602, statusCode: 400 }
  );
}

async function testMcpNumericBoundaries() {
  const projectDir = await createLimitFixtureProject("mcp-limit");
  const client = await startMcpServer();
  try {
    await client.request("initialize", {});
    const invalid = await client.request("tools/call", {
      name: "search_canvas",
      arguments: { projectDir, query: "mcp-limit", limit: -5 }
    });
    assertEqual(invalid.structuredContent?.total, 20, "MCP search should fall back to the default limit for invalid numeric input");

    const rounded = await client.request("tools/call", {
      name: "search_canvas",
      arguments: { projectDir, query: "mcp-limit", limit: 2.6 }
    });
    assertEqual(rounded.structuredContent?.total, 3, "MCP search should round finite decimal limits consistently with store limits");

    const capped = await client.request("tools/call", {
      name: "search_canvas",
      arguments: { projectDir, query: "mcp-limit", limit: 1000 }
    });
    assertEqual(capped.structuredContent?.total, 100, "MCP search should cap oversized limits");

    const versions = await client.request("tools/call", {
      name: "version_groups",
      arguments: { projectDir, query: "mcp-limit", groupBy: "prompt", objectLimit: 1000 }
    });
    assertEqual(versions.structuredContent?.groups?.[0]?.count, 105, "MCP versions should keep full group counts when objectLimit is capped");
    assertEqual(versions.structuredContent?.groups?.[0]?.objects?.length, 100, "MCP versions should cap oversized object limits");
  } finally {
    await client.stop();
  }
}

function assertMcpToolSchema(tools = []) {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  for (const name of ["open_canvas", "canvas_status", "search_canvas", "prompt_history", "version_groups", "collect_recent_images"]) {
    const required = byName.get(name)?.inputSchema?.required || [];
    if (!required.includes("projectDir")) {
      throw new Error(`MCP ${name} should require projectDir.`);
    }
  }
  for (const name of ["add_image", "canvas_status", "search_canvas", "prompt_history", "version_groups", "collect_recent_images", "start_image_job", "send_to_chat"]) {
    const properties = byName.get(name)?.inputSchema?.properties || {};
    if (!properties.canvasId) {
      throw new Error(`MCP ${name} should declare canvasId when it accepts explicit canvas scopes.`);
    }
  }
  const addImageSchema = byName.get("add_image")?.inputSchema || {};
  const openCanvasProperties = byName.get("open_canvas")?.inputSchema?.properties || {};
  if (!openCanvasProperties.autoUpdate) {
    throw new Error("MCP open_canvas should expose autoUpdate so explicit opens can opt out of the default update check.");
  }
  if (!addImageSchema.required?.includes("projectDir")) {
    throw new Error("MCP add_image should require projectDir.");
  }
  const addImageChoices = JSON.stringify(addImageSchema.oneOf || addImageSchema.anyOf || []);
  for (const imageInput of ["path", "url", "dataUrl"]) {
    if (!addImageChoices.includes(imageInput)) {
      throw new Error(`MCP add_image should declare ${imageInput} as an accepted image input.`);
    }
  }
  const startImageJobRequired = byName.get("start_image_job")?.inputSchema?.required || [];
  for (const field of ["projectDir", "objectId", "action"]) {
    if (!startImageJobRequired.includes(field)) {
      throw new Error(`MCP start_image_job should require ${field}.`);
    }
  }
  const startImageJobActions = byName.get("start_image_job")?.inputSchema?.properties?.action?.enum || [];
  for (const action of directImageJobActions) {
    if (!startImageJobActions.includes(action)) {
      throw new Error(`MCP start_image_job should expose the stable ${action} action.`);
    }
  }
  if (startImageJobActions.includes("edit-text")) {
    throw new Error("MCP start_image_job should not expose direct edit-text; Edit Text uses the text recognition workflow.");
  }
  const sendToChatRequired = byName.get("send_to_chat")?.inputSchema?.required || [];
  for (const field of ["projectDir", "objectId", "action"]) {
    if (!sendToChatRequired.includes(field)) {
      throw new Error(`MCP send_to_chat should require ${field}.`);
    }
  }
  const sendToChatActions = byName.get("send_to_chat")?.inputSchema?.properties?.action?.enum || [];
  if (!sendToChatActions.includes("send-to-chat")) {
    throw new Error("MCP send_to_chat should expose the stable send-to-chat action.");
  }
}

async function testPackageOptionalDependencyScripts() {
  const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8"));
  if (packageJson.scripts?.postinstall) {
    throw new Error("package.json should not install optional Python dependencies from postinstall.");
  }
  assertEqual(
    packageJson.scripts?.["install:personal"],
    "node ./scripts/install-personal-plugin.mjs",
    "package.json should expose a deterministic personal marketplace installer"
  );
  const installerScript = await fs.readFile(path.join(process.cwd(), "scripts", "install-personal-plugin.mjs"), "utf8");
  if (!installerScript.includes("installRapidOcr({ optional: true })")) {
    throw new Error("personal plugin installer should best-effort install RapidOCR without blocking plugin installation.");
  }
  if (!installerScript.includes("--skip-ocr") || !installerScript.includes("CODEX_CANVAS_SKIP_OCR_INSTALL")) {
    throw new Error("personal plugin installer should let users skip best-effort RapidOCR installation.");
  }
  assertEqual(
    packageJson.scripts?.["doctor:deps"],
    "node ./bin/codex-canvas.mjs doctor-deps --json",
    "package.json should expose a non-installing optional dependency doctor script"
  );
  assertEqual(
    packageJson.scripts?.["visual:regression"],
    "node ./scripts/visual-regression.mjs",
    "package.json should expose reference screenshot regression checks"
  );
}

async function testPluginPackageManifest() {
  const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8"));
  const manifestPath = path.join(process.cwd(), ".codex-plugin", "plugin.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assertEqual(manifest.name, packageJson.name, "plugin manifest name should match package.json");
  if (manifest.version !== packageJson.version && !manifest.version?.startsWith(`${packageJson.version}+`)) {
    throw new Error("plugin manifest version should keep the npm package version as its base.");
  }
  assertEqual(manifest.skills, "./skills/", "plugin manifest should point at the packaged skills directory");
  assertEqual(manifest.mcpServers, "./.mcp.json", "plugin manifest should point at the packaged MCP config");

  const skillsStat = await fs.stat(path.join(process.cwd(), manifest.skills));
  if (!skillsStat.isDirectory()) {
    throw new Error("plugin manifest skills path should exist as a directory.");
  }
  const mcpPath = path.join(process.cwd(), manifest.mcpServers);
  const mcpConfig = JSON.parse(await fs.readFile(mcpPath, "utf8"));
  const server = mcpConfig.mcpServers?.["codex-canvas"];
  assertEqual(server?.command, "node", "MCP config should run through node");
  assertEqual(server?.cwd, ".", "MCP config should run from the plugin root");
  if (!server?.args?.includes("./src/mcp-server.mjs")) {
    throw new Error("MCP config should point at the packaged MCP server entrypoint.");
  }
  await fs.access(path.join(process.cwd(), "src", "mcp-server.mjs"));

  const { stdout } = await execFileAsync(npmExecutable(), ["pack", "--dry-run", "--json"], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024 * 5,
    windowsHide: true
  });
  const pack = JSON.parse(stdout)[0];
  const packedFiles = new Set(pack.files.map((file) => file.path));
  for (const requiredPath of [
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "INSTALL.md",
    "assets/icon.png",
    "bin/codex-canvas.mjs",
    "public/app.js",
    "public/canvas-history.js",
    "scripts/install-personal-plugin.mjs",
    "skills/canvas/SKILL.md",
    "src/mcp-server.mjs"
  ]) {
    if (!packedFiles.has(requiredPath)) {
      throw new Error(`npm pack should include ${requiredPath}.`);
    }
  }

  const canvasSkill = await fs.readFile(path.join(process.cwd(), "skills", "canvas", "SKILL.md"), "utf8");
  if (!canvasSkill.includes("Open the returned URL directly in the Codex in-app browser")) {
    throw new Error("canvas skill should require direct Codex in-app browser opening.");
  }
  if (!canvasSkill.includes("Do not open the URL with the operating system default browser")) {
    throw new Error("canvas skill should forbid falling back to the system default browser.");
  }
  if (!canvasSkill.includes("Do not rely on the user clicking a printed URL")) {
    throw new Error("canvas skill should avoid printed URL click fallback because it opens the default browser.");
  }
  if (!canvasSkill.includes("[Open Codex-Canvas](<url>)")) {
    throw new Error("canvas skill should tell agents to present returned canvas URLs as Markdown links.");
  }

  for (const file of packedFiles) {
    if (file === ".git" || file.startsWith(".git/")) {
      throw new Error("npm pack should not include git metadata.");
    }
    if (file === "node_modules" || file.startsWith("node_modules/")) {
      throw new Error("npm pack should not include installed dependencies.");
    }
    if (file === "canvas" || file.startsWith("canvas/")) {
      throw new Error("npm pack should not include local canvas runtime data.");
    }
  }
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function writeMinimalPluginPackage(rootDir) {
  await fs.mkdir(path.join(rootDir, ".codex-plugin"), { recursive: true });
  await fs.writeFile(path.join(rootDir, "package.json"), `${JSON.stringify({
    name: "codex-canvas",
    version: "0.1.1",
    repository: {
      type: "git",
      url: "https://github.com/Xiangyu-CAS/codex-canvas.git"
    }
  }, null, 2)}\n`);
  await fs.writeFile(path.join(rootDir, ".codex-plugin", "plugin.json"), `${JSON.stringify({
    name: "codex-canvas",
    version: "0.1.1+test",
    repository: "https://github.com/Xiangyu-CAS/codex-canvas.git"
  }, null, 2)}\n`);
}

async function createUpdateGitFixture() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-update-git-"));
  const source = path.join(tmp, "source");
  const remote = path.join(tmp, "remote.git");
  const local = path.join(tmp, "local");
  await fs.mkdir(source, { recursive: true });
  await git(["init", "-b", "main"], { cwd: source });
  await git(["config", "user.email", "codex-canvas@example.invalid"], { cwd: source });
  await git(["config", "user.name", "Codex Canvas Smoke"], { cwd: source });
  await writeMinimalPluginPackage(source);
  await git(["add", "."], { cwd: source });
  await git(["commit", "-m", "initial"], { cwd: source });
  await git(["clone", "--bare", source, remote], { cwd: tmp });
  await git(["clone", remote, local], { cwd: tmp });
  await git(["config", "user.email", "codex-canvas@example.invalid"], { cwd: local });
  await git(["config", "user.name", "Codex Canvas Smoke"], { cwd: local });
  return { tmp, source, remote, local };
}

async function git(args, { cwd }) {
  return execFileAsync("git", args, {
    cwd,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
}

async function testPersonalPluginInstaller() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-personal-plugin-"));
  const marketplacePath = path.join(tmp, ".agents", "plugins", "marketplace.json");
  await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
  await fs.writeFile(marketplacePath, `${JSON.stringify({
    name: "personal",
    interface: { displayName: "Personal" },
    plugins: [
      {
        name: "other-plugin",
        source: { source: "local", path: "./plugins/other-plugin" },
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Productivity"
      }
    ]
  }, null, 2)}\n`);

  const env = {
    ...process.env,
    CODEX_CANVAS_PERSONAL_HOME: tmp,
    CODEX_CANVAS_SKIP_OCR_INSTALL: "1"
  };
  for (let run = 0; run < 2; run += 1) {
    const { stdout } = await execFileAsync(process.execPath, [
      path.join(process.cwd(), "scripts", "install-personal-plugin.mjs"),
      "--json"
    ], {
      cwd: process.cwd(),
      env,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
    const result = JSON.parse(stdout);
    assertEqual(result.ok, true, "personal plugin installer should report success");
    assertEqual(result.sourcePath, "./plugins/codex-canvas", "personal plugin installer should use the marketplace-relative plugin path");
    assertEqual(result.optionalDependencies?.ocr?.skipped, true, "personal plugin installer should report skipped OCR install when disabled");
  }

  const marketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));
  const agentEntries = marketplace.plugins.filter((plugin) => plugin.name === "codex-canvas");
  assertEqual(agentEntries.length, 1, "personal plugin installer should keep one codex-canvas entry after repeated runs");
  assertEqual(agentEntries[0].source?.source, "local", "personal plugin entry should use a local source");
  assertEqual(agentEntries[0].source?.path, "./plugins/codex-canvas", "personal plugin entry should point at the deterministic link");
  assertEqual(agentEntries[0].policy?.installation, "AVAILABLE", "personal plugin entry should be installable");
  if (!marketplace.plugins.some((plugin) => plugin.name === "other-plugin")) {
    throw new Error("personal plugin installer should preserve existing marketplace plugins.");
  }

  const linkPath = path.join(tmp, "plugins", "codex-canvas");
  const linkedRealPath = await fs.realpath(linkPath);
  const repoRealPath = await fs.realpath(process.cwd());
  assertEqual(linkedRealPath, repoRealPath, "personal plugin link should resolve to this repository");

  const aliasTmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-personal-plugin-alias-"));
  const aliasPath = path.join(aliasTmp, "repo-alias");
  const aliasHome = path.join(aliasTmp, "home");
  const aliasLinkPath = path.join(aliasHome, "plugins", "codex-canvas");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  await fs.symlink(process.cwd(), aliasPath, linkType);
  await fs.mkdir(path.dirname(aliasLinkPath), { recursive: true });
  await fs.symlink(aliasPath, aliasLinkPath, linkType);
  await execFileAsync(process.execPath, [
    path.join(process.cwd(), "scripts", "install-personal-plugin.mjs"),
    "--json"
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_CANVAS_PERSONAL_HOME: aliasHome
    },
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const aliasLinkedRealPath = await fs.realpath(aliasLinkPath);
  assertEqual(aliasLinkedRealPath, repoRealPath, "personal plugin installer should accept existing links that resolve to this repository");

  const blockedTmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-personal-plugin-blocked-"));
  const blockedLinkPath = path.join(blockedTmp, "plugins", "codex-canvas");
  await fs.mkdir(blockedLinkPath, { recursive: true });
  const blocked = await execFileAsync(process.execPath, [
    path.join(process.cwd(), "scripts", "install-personal-plugin.mjs"),
    "--json"
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      CODEX_CANVAS_PERSONAL_HOME: blockedTmp
    },
    maxBuffer: 1024 * 1024,
    windowsHide: true
  }).then(
    () => ({ ok: true, stderr: "" }),
    (error) => ({ ok: false, stderr: error.stderr || error.message || "" })
  );
  assertEqual(blocked.ok, false, "personal plugin installer should refuse to replace a real plugin directory");
  if (!blocked.stderr.includes("Refusing to replace non-symlink plugin path")) {
    throw new Error("personal plugin installer should explain non-symlink path conflicts.");
  }
}

async function testDevPluginCacheLinker() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-dev-cache-"));
  const manifest = JSON.parse(await fs.readFile(path.join(process.cwd(), ".codex-plugin", "plugin.json"), "utf8"));
  const cachePath = path.join(tmp, ".codex", "plugins", "cache", "personal", manifest.name, manifest.version);
  const markerPath = path.join(cachePath, "cache-marker.txt");
  await fs.mkdir(cachePath, { recursive: true });
  await fs.writeFile(markerPath, "old-cache");

  const commonArgs = [
    path.join(process.cwd(), "scripts", "link-dev-plugin-cache.mjs"),
    "--home",
    tmp,
    "--json"
  ];
  const dryRun = await execFileAsync(process.execPath, [...commonArgs, "--dry-run"], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const dryRunResult = JSON.parse(dryRun.stdout);
  assertEqual(dryRunResult.ok, true, "dev cache linker dry run should report success");
  assertEqual(dryRunResult.dryRun, true, "dev cache linker should mark dry run output");
  assertEqual(await fs.readFile(markerPath, "utf8"), "old-cache", "dev cache linker dry run should not modify cache files");

  const linked = await execFileAsync(process.execPath, commonArgs, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const linkedResult = JSON.parse(linked.stdout);
  assertEqual(linkedResult.ok, true, "dev cache linker should report success");
  if (!linkedResult.backupPath) {
    throw new Error("dev cache linker should back up an existing real cache directory.");
  }
  assertEqual(
    await fs.readFile(path.join(linkedResult.backupPath, "cache-marker.txt"), "utf8"),
    "old-cache",
    "dev cache linker should preserve the old cache directory in the backup"
  );

  const linkedRealPath = await fs.realpath(cachePath);
  const repoRealPath = await fs.realpath(process.cwd());
  assertEqual(linkedRealPath, repoRealPath, "dev cache linker should make Codex cache resolve to this repository");

  const repeated = await execFileAsync(process.execPath, commonArgs, {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  const repeatedResult = JSON.parse(repeated.stdout);
  assertEqual(repeatedResult.alreadyLinked, true, "dev cache linker should be idempotent once cache points at the repository");
}

async function testAppUpdateStrategy() {
  const plainRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-update-plain-"));
  await writeMinimalPluginPackage(plainRoot);
  const plain = await appUpdateStatus({ rootDir: plainRoot });
  assertEqual(plain.canUpdate, false, "plain package installs should not claim automatic git updates");
  assertEqual(plain.blockedReason, "not-git", "plain package installs should report the non-git update blocker");
  assertEqual(plain.installKind, "package", "plain package installs should report package install kind");
  if (!plain.manualCommand?.includes("github.com/Xiangyu-CAS/codex-canvas.git")) {
    throw new Error("plain package update status should suggest the configured GitHub repository.");
  }

  const fixture = await createUpdateGitFixture();
  const clean = await appUpdateStatus({ rootDir: fixture.local, checkRemote: false });
  assertEqual(clean.canUpdate, true, "clean git checkouts with an upstream should support automatic updates");
  assertEqual(clean.strategy, "git-fast-forward", "git checkouts should use the fast-forward update strategy");
  assertEqual(clean.git.remote, "origin", "git updater should identify the update remote");
  assertEqual(clean.git.remoteBranch, "main", "git updater should identify the update branch");
  assertEqual(clean.installKind, "git-checkout", "git checkouts should report git install kind");

  await git(["config", "--unset", "branch.main.remote"], { cwd: fixture.local });
  await git(["config", "--unset", "branch.main.merge"], { cwd: fixture.local });
  const inferred = await appUpdateStatus({ rootDir: fixture.local, checkRemote: false });
  assertEqual(inferred.canUpdate, true, "git updater should infer origin/current-branch when no upstream is configured");
  assertEqual(inferred.git.upstreamConfigured, false, "inferred remote branches should remain distinguishable from configured upstreams");
  assertEqual(inferred.manualCommand.includes("pull --ff-only origin main"), true, "inferred update command should name the remote and branch explicitly");

  await fs.writeFile(path.join(fixture.local, "dirty.txt"), "local change");
  const dirty = await appUpdateStatus({ rootDir: fixture.local, checkRemote: false });
  assertEqual(dirty.canUpdate, false, "dirty git checkouts should block automatic updates");
  assertEqual(dirty.blockedReason, "dirty-worktree", "dirty git checkouts should report the dirty worktree blocker");
  await fs.rm(path.join(fixture.local, "dirty.txt"));

  await fs.writeFile(path.join(fixture.local, "local-commit.txt"), "local commit");
  await git(["add", "local-commit.txt"], { cwd: fixture.local });
  await git(["commit", "-m", "local commit"], { cwd: fixture.local });
  const ahead = await appUpdateStatus({ rootDir: fixture.local, checkRemote: false });
  assertEqual(ahead.canUpdate, false, "locally ahead git checkouts should block automatic updates");
  assertEqual(ahead.blockedReason, "local-ahead", "locally ahead git checkouts should report the local commits blocker");
}

async function testCliCollectHelp() {
  const { stdout } = await execFileAsync(process.execPath, [path.join(process.cwd(), "bin", "codex-canvas.mjs"), "help"], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  if (!stdout.includes("codex-canvas open [--project <dir>] [--host 127.0.0.1] [--port 43217] [--thread-id <codex-thread-id>] [--no-update]")) {
    throw new Error("CLI help should document that active opens can opt out of the default update check.");
  }
  if (!stdout.includes("Best-effort fast-forward update, then start or reuse the local server and print the canvas URL.")) {
    throw new Error("CLI help should describe the open-time auto-update behavior.");
  }
  if (!stdout.includes("codex-canvas import <image-path> [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--prompt <text>] [--name <name>]")) {
    throw new Error("CLI help should document import canvas scope flags.");
  }
  if (!stdout.includes("codex-canvas collect [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--from <dir,dir>] [--since-minutes 120] [--limit 20]")) {
    throw new Error("CLI help should document collect flags.");
  }
  if (!stdout.includes("codex-canvas search [query] [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--type image|text|drawing|job] [--limit 20] [--json]")) {
    throw new Error("CLI help should document search flags.");
  }
  if (!stdout.includes("codex-canvas prompts [query] [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--limit 20] [--json]")) {
    throw new Error("CLI help should document prompt history flags.");
  }
  if (!stdout.includes("codex-canvas versions [query] [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--group-by sourceObjectId|batchId|layoutMode|prompt] [--limit 20] [--object-limit 20] [--json]")) {
    throw new Error("CLI help should document version grouping flags.");
  }
  if (!stdout.includes("codex-canvas status [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--json]")) {
    throw new Error("CLI help should document status canvas scope flags.");
  }
  if (!stdout.includes("--canvas-id selects an explicit Codex-Canvas canvas scope and overrides --thread-id.")) {
    throw new Error("CLI help should document explicit canvas scope precedence.");
  }
  if (!stdout.includes("Import recent images from the bound thread directory, or explicit --from recovery roots.")) {
    throw new Error("CLI help should document thread-scoped collection defaults.");
  }
  if (!stdout.includes("--thread-id selects the canvas and default generated_images/<thread-id> collection scope.")) {
    throw new Error("CLI help should document the default thread collection directory.");
  }
  if (!stdout.includes("--from selects explicit project-relative or absolute recovery roots and bypasses the default thread directory.")) {
    throw new Error("CLI help should document explicit recovery roots.");
  }
  if (!stdout.includes("Search canvas objects by name, prompt, text, source path, or grouping metadata.")) {
    throw new Error("CLI help should document search behavior.");
  }
  if (!stdout.includes("List recent unique prompts from canvas objects.")) {
    throw new Error("CLI help should document prompt history behavior.");
  }
  if (!stdout.includes("Group canvas object version history by sourceObjectId, batchId, layoutMode, or prompt.")) {
    throw new Error("CLI help should document version grouping behavior.");
  }
}

async function testCliArgumentParsingAndErrors() {
  const collectFixture = await createCollectFixtureProject("cli-equals", 2);
  const collected = await runCliJson([
    "collect",
    `--project=${collectFixture.projectDir}`,
    `--from=${collectFixture.imagesDir}`,
    "--since-minutes=120",
    "--limit=1"
  ]);
  assertEqual(collected.status, 0, "CLI collect should accept --key=value options");
  assertEqual(collected.body.imported.length, 1, "CLI collect should apply equals-form limit values");
  assertEqual(collected.body.scannedRoots[0], collectFixture.imagesDir, "CLI collect should apply equals-form --from paths");

  const importProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-cli-import-"));
  const sourcePath = path.join(importProjectDir, "source.png");
  await fs.writeFile(sourcePath, Buffer.from(pngOne, "base64"));
  const imported = await runCliJson([
    "import",
    "--project",
    importProjectDir,
    "--prompt=option-before-positional",
    sourcePath
  ]);
  assertEqual(imported.status, 0, "CLI import should accept options before the image path");
  assertEqual(imported.body.sourcePath, sourcePath, "CLI import should use the positional image path after options");
  assertEqual(imported.body.prompt, "option-before-positional", "CLI import should apply equals-form prompt values");

  const unknown = await runCli(["does-not-exist"]);
  assertEqual(unknown.status, 1, "Unknown CLI commands should fail");
  if (!unknown.stderr.includes("Unknown command: does-not-exist")) {
    throw new Error("Unknown CLI commands should print a useful error.");
  }
  if (unknown.stderr.includes("\n    at ")) {
    throw new Error("Unknown CLI commands should not print a stack trace.");
  }

  const missingProject = await runCli(["status", "--project", "--json"]);
  assertEqual(missingProject.status, 1, "CLI options with missing values should fail");
  if (!missingProject.stderr.includes("--project requires a value.")) {
    throw new Error("CLI options with missing values should name the missing option.");
  }

  const missingLimit = await runCli(["search", "anything", "--project", importProjectDir, "--limit", "--json"]);
  assertEqual(missingLimit.status, 1, "CLI numeric options with missing values should fail");
  if (!missingLimit.stderr.includes("--limit requires a value.")) {
    throw new Error("CLI numeric options with missing values should name the missing option.");
  }

  const missingImportSource = await runCli(["import", "--project", importProjectDir]);
  assertEqual(missingImportSource.status, 1, "CLI import without an image source should fail");
  if (!missingImportSource.stderr.includes("import requires <image-path>")) {
    throw new Error("CLI import without an image source should print a useful error.");
  }

  const ambiguousImportSource = await runCli([
    "import",
    "--project",
    importProjectDir,
    sourcePath,
    "--url",
    "https://example.invalid/image.png"
  ]);
  assertEqual(ambiguousImportSource.status, 1, "CLI import with multiple image sources should fail");
  if (!ambiguousImportSource.stderr.includes("import requires exactly one image input")) {
    throw new Error("CLI import should reject ambiguous image sources.");
  }
}

async function testCliCodexThreadEnvironment() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-cli-thread-env-"));
  const codexThreadId = "thread-from-codex-env";
  const agentThreadId = "thread-from-agent-env";
  const baseEnv = {
    ...process.env,
    CODEX_CANVAS_PROJECT_DIR: projectDir
  };

  const codexEnvStatus = await runCliJson(["status", "--project", projectDir, "--json"], {
    env: {
      ...baseEnv,
      CODEX_CANVAS_CODEX_THREAD_ID: "",
      CODEX_THREAD_ID: codexThreadId
    }
  });
  assertEqual(codexEnvStatus.status, 0, "CLI status should accept CODEX_THREAD_ID from the Codex desktop environment");
  assertEqual(codexEnvStatus.body.canvasId, canvasIdForThread(codexThreadId), "CLI should derive a thread-scoped canvas from CODEX_THREAD_ID");

  const agentEnvStatus = await runCliJson(["status", "--project", projectDir, "--json"], {
    env: {
      ...baseEnv,
      CODEX_CANVAS_CODEX_THREAD_ID: agentThreadId,
      CODEX_THREAD_ID: codexThreadId
    }
  });
  assertEqual(agentEnvStatus.body.canvasId, canvasIdForThread(agentThreadId), "CODEX_CANVAS_CODEX_THREAD_ID should override CODEX_THREAD_ID for explicit plugin launches");

  const explicitStatus = await runCliJson(["status", "--project", projectDir, "--thread-id", "thread-from-flag", "--json"], {
    env: {
      ...baseEnv,
      CODEX_CANVAS_CODEX_THREAD_ID: agentThreadId,
      CODEX_THREAD_ID: codexThreadId
    }
  });
  assertEqual(explicitStatus.body.canvasId, canvasIdForThread("thread-from-flag"), "explicit --thread-id should override thread environment variables");

  const generatedImagesRoot = path.join(projectDir, "test-generated-images");
  const collectThreadId = "thread-cli-collector";
  const collectThreadDir = path.join(generatedImagesRoot, collectThreadId);
  const collectTargetPath = path.join(collectThreadDir, "target.png");
  await writeDistinctPng(collectTargetPath, "cli-thread-target");
  await writeDistinctPng(path.join(generatedImagesRoot, "global.png"), "cli-global-output");
  await writeDistinctPng(path.join(projectDir, "project-root.png"), "cli-project-output");
  const collected = await runCliJson([
    "collect",
    "--project", projectDir,
    "--thread-id", collectThreadId,
    "--since-minutes", "120"
  ], {
    env: {
      ...baseEnv,
      CODEX_CANVAS_GENERATED_IMAGES_ROOT: generatedImagesRoot,
      CODEX_CANVAS_CODEX_THREAD_ID: "",
      CODEX_THREAD_ID: ""
    }
  });
  assertEqual(collected.body.scannedRoots?.length, 1, "CLI default collection should scan one bound-thread directory");
  assertEqual(collected.body.scannedRoots?.[0], collectThreadDir, "CLI default collection should derive generated_images/<threadId>");
  assertEqual(collected.body.imported?.length, 1, "CLI default collection should import only the bound thread output");
  assertEqual(path.resolve(collected.body.imported?.[0]?.sourcePath || ""), path.resolve(collectTargetPath), "CLI collection should exclude project and global roots");

  const unbound = await runCliJson([
    "collect",
    "--project", projectDir,
    "--canvas-id", "cli-unbound-collector",
    "--since-minutes", "120"
  ], {
    env: {
      ...baseEnv,
      CODEX_CANVAS_GENERATED_IMAGES_ROOT: generatedImagesRoot,
      CODEX_CANVAS_CODEX_THREAD_ID: "",
      CODEX_THREAD_ID: ""
    }
  });
  assertEqual(unbound.body.scannedRoots?.length, 0, "CLI unbound default collection should be a safe no-op");
  assertEqual(unbound.body.imported?.length, 0, "CLI unbound collection should not import unrelated images");

  const recoveryDir = path.join(projectDir, "manual-recovery");
  const recoveryPath = path.join(recoveryDir, "recovered.png");
  await writeDistinctPng(recoveryPath, "cli-explicit-recovery");
  const recovered = await runCliJson([
    "collect",
    "--project", projectDir,
    "--canvas-id", "cli-explicit-recovery",
    "--from", recoveryDir,
    "--since-minutes", "120"
  ], {
    env: {
      ...baseEnv,
      CODEX_CANVAS_GENERATED_IMAGES_ROOT: generatedImagesRoot,
      CODEX_CANVAS_CODEX_THREAD_ID: "",
      CODEX_THREAD_ID: ""
    }
  });
  assertEqual(recovered.body.imported?.length, 1, "CLI explicit --from roots should remain available for manual recovery");
  assertEqual(path.resolve(recovered.body.imported?.[0]?.sourcePath || ""), path.resolve(recoveryPath), "CLI recovery should import the explicit root image");
}

async function testDoctorOptionalDepsWithoutPython() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-no-python-"));
  const emptyPath = path.join(tmp, "empty-path");
  await fs.mkdir(emptyPath);
  const env = {
    ...withoutPathEnv(process.env),
    PATH: emptyPath,
    CODEX_CANVAS_PROJECT_DIR: tmp
  };
  for (const command of ["doctor-ocr", "doctor-image-deps", "doctor-deps", "setup-deps"]) {
    const result = await runCliJson([command, "--json"], { env });
    assertEqual(result.status, 0, `${command} should not fail when Python is unavailable`);
    if (command === "doctor-deps") {
      assertEqual(result.body.available, false, "doctor-deps should report unavailable optional dependencies without Python");
    } else if (command === "setup-deps") {
      assertEqual(result.body.available, false, "setup-deps should remain optional when Python is unavailable");
    } else {
      assertEqual(result.body.available, false, `${command} should report unavailable optional dependencies without Python`);
    }
  }
}

async function testChatTurnActionContract() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-chat-turn-"));
  const fakeCodex = path.join(tmp, process.platform === "win32" ? "codex.cmd" : "codex");
  await fs.writeFile(fakeCodex, fakeCodexAppServerScript(), { mode: 0o755 });

  const previousCli = process.env.CODEX_CANVAS_CODEX_CLI;
  process.env.CODEX_CANVAS_CODEX_CLI = fakeCodex;
  const { server, url } = await createServer({
    projectDir: tmp,
    port: 0,
    autoCollect: false,
    chatThreadId: "thread-test"
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const image = await postJson(`${base}api/images${search}`, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: "chat.png"
    });
    assertEqual(image.status, 201, "test image should be added before chat turn");

    const missingAction = await postJson(`${base}api/chat-turn${search}`, {
      objectId: image.body.id
    });
    assertEqual(missingAction.status, 400, "chat turn should require stable send-to-chat action");

    const remoteImage = await postJson(`${base}api/images${search}`, {
      url: "https://example.invalid/chat.png",
      name: "remote-chat.png"
    });
    assertEqual(remoteImage.status, 201, "remote image should be added before chat turn boundary check");
    const remoteSent = await postJson(`${base}api/chat-turn${search}`, {
      action: "send-to-chat",
      objectId: remoteImage.body.id
    });
    assertEqual(remoteSent.status, 400, "chat turn should reject remote-only images before starting Codex");
    assertEqual(remoteSent.body.error, "The selected image must be a local canvas asset before sending to chat.", "remote-only chat turn should return a useful error");

    const sent = await postJson(`${base}api/chat-turn${search}`, {
      action: "send-to-chat",
      objectId: image.body.id
    });
    assertEqual(sent.status, 200, "chat turn with stable action should succeed");
    assertEqual(sent.body.status, "submitted", "visual chat turn should return after submission instead of blocking on completion");
    assertEqual(sent.body.completionPending, true, "visual chat turn should keep completion monitoring in the background");
  } finally {
    process.env.CODEX_CANVAS_CODEX_CLI = previousCli;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testStoreConcurrency() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-store-"));
  const created = await Promise.all(Array.from({ length: 20 }, (_, index) => (
    addObject(projectDir, { type: "text", text: `item-${index}`, x: index, y: index })
  )));
  let state = await readState(projectDir);
  assertEqual(state.objects.length, 20, "concurrent addObject should not lose objects");

  await Promise.all([
    ...created.map((object, index) => updateObject(projectDir, object.id, { x: 100 + index })),
    transformState(projectDir, {}, (current) => ({ ...current, title: "concurrent" }))
  ]);
  state = await readState(projectDir);
  assertEqual(state.title, "concurrent", "transformState should preserve metadata");
  assertEqual(new Set(state.objects.map((object) => object.x)).size, 20, "concurrent updateObject should not lose updates");

  await Promise.all([
    deleteObjects(projectDir, created.slice(0, 10).map((object) => object.id)),
    deleteObjects(projectDir, created.slice(10).map((object) => object.id))
  ]);
  state = await readState(projectDir);
  assertEqual(state.objects.length, 0, "concurrent deleteObjects should remove every object");

  const trimmed = await addObject(projectDir, { type: "text", text: "trimmed-delete" });
  const trimmedResult = await deleteObjects(projectDir, [`  ${trimmed.id}  `]);
  assertEqual(trimmedResult.ids[0], trimmed.id, "deleteObjects should trim object ids before matching objects");
  state = await readState(projectDir);
  assertEqual(state.objects.length, 0, "deleteObjects should delete objects when ids include surrounding whitespace");
}

async function testCrossProcessStoreLocking() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-process-lock-"));
  const projectDir = path.join(root, "shared-project");
  const startPath = path.join(root, "start-state-writers");
  await fs.mkdir(projectDir, { recursive: true });

  const writers = [
    startStoreProcessWorker(["add", projectDir, startPath, "left", "20"]),
    startStoreProcessWorker(["add", projectDir, startPath, "right", "20"])
  ];
  await fs.writeFile(startPath, "go\n");
  await Promise.all(writers);

  const state = await readState(projectDir);
  assertEqual(state.objects.length, 40, "cross-process state writes should not lose objects");
  assertEqual(new Set(state.objects.map((object) => object.text)).size, 40, "cross-process state writes should preserve every unique object");

  for (let round = 0; round < 4; round += 1) {
    const migrationProjectDir = path.join(root, `migration-project-${round}`);
    const migrationStartPath = path.join(root, `start-migration-${round}`);
    await fs.mkdir(migrationProjectDir, { recursive: true });
    await addObject(migrationProjectDir, { type: "text", text: `legacy-${round}` });

    const migrations = [
      startStoreProcessWorker(["migrate", migrationProjectDir, migrationStartPath, `thread-a-${round}`]),
      startStoreProcessWorker(["migrate", migrationProjectDir, migrationStartPath, `thread-b-${round}`])
    ];
    await fs.writeFile(migrationStartPath, "go\n");
    const migratedObjectCounts = (await Promise.all(migrations))
      .map((result) => result.objects)
      .sort((a, b) => a - b);
    assertEqual(migratedObjectCounts.join(","), "0,1", "only one concurrently opened thread canvas should inherit legacy objects");
  }

  const lockedMigrationProject = path.join(root, "locked-migration-project");
  const holderStartPath = path.join(root, "start-legacy-holder");
  const holderAcquiredPath = path.join(root, "legacy-holder-acquired");
  const holderReleasePath = path.join(root, "release-legacy-holder");
  const migrationStartPath = path.join(root, "start-locked-migration");
  await fs.mkdir(lockedMigrationProject, { recursive: true });
  await addObject(lockedMigrationProject, { type: "text", text: "legacy-seed" });

  const holder = startStoreProcessWorker([
    "hold-mutate",
    lockedMigrationProject,
    holderStartPath,
    holderAcquiredPath,
    holderReleasePath
  ]);
  await fs.writeFile(holderStartPath, "go\n");
  await waitForPath(holderAcquiredPath, "legacy mutation should acquire the default canvas state lock");

  const migration = startStoreProcessWorker([
    "migrate",
    lockedMigrationProject,
    migrationStartPath,
    "locked-thread"
  ]);
  await fs.writeFile(migrationStartPath, "go\n");
  const migrationLockPath = path.join(
    path.dirname(statePathFor(lockedMigrationProject)),
    ".legacy-thread-migration.json.lock"
  );
  await waitForPath(migrationLockPath, "thread migration should wait behind the active default canvas mutation");
  await fs.writeFile(holderReleasePath, "go\n");

  const [, migrated] = await Promise.all([holder, migration]);
  assertEqual(migrated.objects, 2, "thread migration should include a default-canvas mutation that already held the shared state lock");
  await addObject(lockedMigrationProject, { type: "text", text: "too-late" }).then(
    () => { throw new Error("claimed legacy default canvas should reject later writes"); },
    (error) => assertEqual(error.statusCode, 409, "claimed legacy default canvas should reject later writes instead of silently losing them")
  );

  const unclaimedDefaultProject = path.join(root, "unclaimed-default-project");
  await fs.mkdir(unclaimedDefaultProject, { recursive: true });
  const emptyThreadState = await readState(unclaimedDefaultProject, { canvasId: "empty-thread-first" });
  assertEqual(emptyThreadState.objects.length, 0, "an empty project thread should begin without legacy objects");
  const unboundObject = await addObject(unclaimedDefaultProject, { type: "text", text: "independent-unbound" });
  assertEqual(unboundObject.text, "independent-unbound", "a no-legacy migration marker should not freeze the independent unbound default canvas");
  const laterThreadState = await readState(unclaimedDefaultProject, { canvasId: "empty-thread-second" });
  assertEqual(laterThreadState.objects.length, 0, "an unbound default object created after the marker must not leak into a later thread canvas");
}

function startStoreProcessWorker(args) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(process.cwd(), "scripts", "store-process-worker.mjs");
    const child = spawn(process.execPath, [workerPath, ...args], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Store process worker timed out: ${stderr || stdout}`));
    }, 20_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Store process worker exited with ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        const line = stdout.trim().split(/\r?\n/).at(-1);
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error(`Store process worker returned invalid JSON: ${stdout || stderr}`, { cause: error }));
      }
    });
  });
}

async function waitForPath(filePath, message, timeoutMs = 5_000) {
  const startedAt = Date.now();
  for (;;) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      if (Date.now() - startedAt >= timeoutMs) throw new Error(message);
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
}

async function testDeleteUndoRestore() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-undo-"));
  const first = await addObject(projectDir, { type: "text", text: "first", x: 1, y: 1 });
  const second = await addObject(projectDir, { type: "text", text: "second", x: 2, y: 2 });
  const third = await addObject(projectDir, { type: "text", text: "third", x: 3, y: 3 });
  await updateSelection(projectDir, second.id);
  const beforeDelete = await readState(projectDir);
  const deletedEntries = [first.id, third.id].map((id) => {
    const index = beforeDelete.objects.findIndex((object) => object.id === id);
    return { object: beforeDelete.objects[index], index };
  });

  await deleteObjects(projectDir, [first.id, third.id]);
  let state = await readState(projectDir);
  assertEqual(state.objects.map((object) => object.id).join(","), second.id, "deleteObjects should remove the selected undo fixtures");

  const restored = await restoreObjects(projectDir, deletedEntries, { selection: third.id });
  assertEqual(restored.objects.map((object) => object.id).join(","), `${first.id},${third.id}`, "restoreObjects should keep original object ids");
  state = await readState(projectDir);
  assertEqual(state.objects.map((object) => object.id).join(","), `${first.id},${second.id},${third.id}`, "restoreObjects should reinsert objects at their original z-order");
  assertEqual(state.selection, third.id, "restoreObjects should restore requested selection when it belongs to restored objects");
}

async function testBatchObjectUpdateAtomicity() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-batch-update-"));
  const first = await addObject(projectDir, { type: "text", text: "first", x: 1, y: 2 });
  const second = await addObject(projectDir, { type: "text", text: "second", x: 3, y: 4 });
  const updated = await updateObjects(projectDir, [
    { id: first.id, patch: { x: 21, y: 22 } },
    { id: second.id, patch: { x: 23, y: 24 } }
  ], { selection: second.id });
  assertEqual(updated.objects.map((object) => object.x).join(","), "21,23", "batch update should return every updated object in request order");
  let state = await readState(projectDir);
  assertEqual(state.objects.map((object) => `${object.x}:${object.y}`).join(","), "21:22,23:24", "batch update should persist all patches together");
  assertEqual(state.selection, second.id, "batch update should persist its requested selection");

  await updateObjects(projectDir, [
    { id: first.id, patch: { x: 88 } },
    { id: "", patch: null }
  ]).then(
    () => { throw new Error("batch update should reject malformed members"); },
    (error) => assertEqual(error.statusCode, 400, "batch update should reject the whole malformed batch")
  );
  state = await readState(projectDir);
  assertEqual(state.objects.find((object) => object.id === first.id)?.x, 21, "malformed batch update should not commit its valid-looking members");

  await updateObjects(projectDir, [
    { id: first.id, patch: { x: 99 } },
    { id: "missing-object", patch: { x: 100 } }
  ]).then(
    () => { throw new Error("batch update should reject a missing member"); },
    (error) => assertEqual(error.statusCode, 404, "batch update should report a missing member before writing")
  );
  state = await readState(projectDir);
  assertEqual(state.objects.find((object) => object.id === first.id)?.x, 21, "failed batch update should not partially update earlier members");
}

async function testChatBindingAlias() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-rebind-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const first = await postJson(`${base}api/chat-binding${search}`, { threadId: "thread-one" });
    const second = await postJson(`${base}api/chat-binding${search}`, { threadId: "thread-two" });
    assertEqual(first.status, 200, "first chat binding should succeed");
    assertEqual(second.status, 200, "second chat binding through old project id should succeed");
    const stateResponse = await fetch(`${base}api/state${search}`);
    assertEqual(stateResponse.status, 200, "old project id alias should resolve after repeated binding");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testChatWebSocketFallback() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-chat-"));
  const fakeCodex = path.join(tmp, process.platform === "win32" ? "codex.cmd" : "codex");
  const imagePath = path.join(tmp, "image.png");
  await fs.writeFile(imagePath, Buffer.from(pngOne, "base64"));
  await fs.writeFile(fakeCodex, fakeCodexAppServerScript(), { mode: 0o755 });

  const previousCli = process.env.CODEX_CANVAS_CODEX_CLI;
  const previousWebSocket = globalThis.WebSocket;
  process.env.CODEX_CANVAS_CODEX_CLI = fakeCodex;
  globalThis.WebSocket = undefined;
  try {
    const result = await sendImageToBoundChat({
      projectDir: tmp,
      threadId: "thread-test",
      imagePath,
      prompt: "hello",
      waitForCompletion: true
    });
    assertEqual(result.status, "completed", "fallback WebSocket chat turn should complete");
  } finally {
    process.env.CODEX_CANVAS_CODEX_CLI = previousCli;
    globalThis.WebSocket = previousWebSocket;
  }
}

async function testEditTextCancellationCleanup() {
  const previous = process.env.CODEX_CANVAS_TEST_HELPERS;
  process.env.CODEX_CANVAS_TEST_HELPERS = "1";
  try {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-edit-text-cancel-"));
    const source = await addImage(projectDir, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: "source.png"
    });
    const placeholder = await addImage(projectDir, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: "edit-text-placeholder.png",
      sourceObjectId: source.id
    });
    const logPath = path.join(projectDir, "job.log");
    await markTextRecognitionCancelledForTest({
      id: "text-cancel-test",
      projectDir,
      canvasId: null,
      placeholder,
      placeholderId: placeholder.id,
      logPath
    }, Date.now() - 250);
    const state = await readState(projectDir);
    if (state.objects.some((object) => object.id === placeholder.id)) {
      throw new Error("Edit Text cancellation should remove its running placeholder immediately.");
    }
    await fs.access(logPath);
  } finally {
    if (previous === undefined) delete process.env.CODEX_CANVAS_TEST_HELPERS;
    else process.env.CODEX_CANVAS_TEST_HELPERS = previous;
  }
}

async function testQuickEditAnnotations() {
  const deps = await checkImageProcessingDepsAvailable();
  if (!deps.available) {
    console.warn(`Skipping quick edit annotation smoke test; missing optional image dependencies: ${deps.missing?.join(", ") || "unknown"}.`);
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-quick-edit-annotations-"));
  const fakeCodex = path.join(tmp, process.platform === "win32" ? "codex.cmd" : "codex");
  const makeSource = path.join(tmp, "make-source.py");
  await fs.writeFile(makeSource, [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "import sys",
    "root = Path(sys.argv[1])",
    "image = Image.new('RGBA', (48, 32), (240, 240, 240, 255))",
    "draw = ImageDraw.Draw(image)",
    "draw.rectangle((4, 4, 44, 28), outline=(30, 30, 30, 255), width=2)",
    "image.save(root / 'source.png')"
  ].join("\n"));
  await runPython([makeSource, tmp]);
  await fs.writeFile(fakeCodex, fakeCodexCaptureImageJobScript(), { mode: 0o755 });

  const previousCli = process.env.CODEX_CANVAS_CODEX_CLI;
  process.env.CODEX_CANVAS_CODEX_CLI = fakeCodex;
  try {
    const plainProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-quick-edit-plain-"));
    const plainSource = await addImage(plainProjectDir, {
      path: path.join(tmp, "source.png"),
      name: "plain-source.png",
      x: 20,
      y: 30,
      width: 96,
      height: 64
    });
    const plainJob = await createImageJob(plainProjectDir, {
      action: "quick-edit",
      objectId: plainSource.id,
      prompt: "Make the border blue"
    });
    await waitForImageJobDone(plainJob.id);
    const plainCapture = await readCapturedCodexJob(plainProjectDir, plainJob.id);
    assertEqual(path.resolve(plainCapture.imageArgs[0]), path.resolve(plainSource.assetPath), "Quick Edit without annotations should send the original source image");
    if (/temporary user annotations/.test(plainCapture.prompt || "")) {
      throw new Error("Quick Edit without annotations should not append the annotation prompt suffix.");
    }

    const annotatedProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-quick-edit-marked-"));
    const markedSource = await addImage(annotatedProjectDir, {
      path: path.join(tmp, "source.png"),
      name: "marked-source.png",
      x: 20,
      y: 30,
      width: 96,
      height: 64
    });
    await addObject(annotatedProjectDir, {
      type: "drawing",
      x: 40,
      y: 50,
      width: 24,
      height: 16,
      points: [{ x: 0, y: 0 }, { x: 24, y: 16 }],
      stroke: "#d93025",
      strokeWidth: 4
    });
    await addObject(annotatedProjectDir, {
      type: "text",
      text: "remove this",
      x: 60,
      y: 42,
      width: 70,
      height: 24,
      fontSize: 18,
      color: "#1a73e8"
    });
    await addObject(annotatedProjectDir, {
      type: "text",
      text: "outside",
      x: 240,
      y: 42,
      width: 70,
      height: 24,
      fontSize: 18,
      color: "#202124"
    });

    const annotatedJob = await createImageJob(annotatedProjectDir, {
      action: "quick-edit",
      objectId: markedSource.id,
      prompt: "Follow the markup"
    });
    await waitForImageJobDone(annotatedJob.id);
    const capture = await readCapturedCodexJob(annotatedProjectDir, annotatedJob.id);
    const imageArg = capture.imageArgs[0] || "";
    if (!imageArg.endsWith(path.join("inputs", "quick-edit-annotated.png"))) {
      throw new Error(`Quick Edit with annotations should send the composed annotated PNG, got ${imageArg}.`);
    }
    const prompt = capture.prompt || "";
    if (
      !/Follow the markup/.test(prompt)
      || !/temporary user annotations/.test(prompt)
      || !/Codex-Canvas annotation\/mask details/.test(prompt)
      || !/red \(#d93025\) drawing mask/.test(prompt)
      || !/blue \(#1a73e8\) text label: "remove this"/.test(prompt)
      || !/Treat this label as edit instruction text/.test(prompt)
      || !/Do not keep annotation/.test(prompt)
    ) {
      throw new Error("Quick Edit with annotations should append color-aware annotation and removal prompt details.");
    }

    const manifestPath = path.join(jobsDirFor(annotatedProjectDir), annotatedJob.id, "inputs", "quick-edit-annotations.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    assertEqual(manifest.items.length, 2, "Quick Edit should include only drawing/text annotations that overlap the source image");
    assertEqual(manifest.sourceSize.width, 48, "Quick Edit annotation manifest should use source image width");
    assertEqual(manifest.sourceSize.height, 32, "Quick Edit annotation manifest should use source image height");
    const drawing = manifest.items.find((item) => item.type === "drawing");
    if (!drawing) throw new Error("Quick Edit annotation manifest should include the overlapping drawing.");
    assertEqual(drawing.points[0].x, 10, "Quick Edit drawing x coordinates should scale from canvas to source pixels");
    assertEqual(drawing.points[0].y, 10, "Quick Edit drawing y coordinates should scale from canvas to source pixels");
    const text = manifest.items.find((item) => item.type === "text");
    if (!text || text.text !== "remove this") {
      throw new Error("Quick Edit annotation manifest should include the overlapping text label.");
    }
    await fs.access(imageArg);
  } finally {
    if (previousCli === undefined) delete process.env.CODEX_CANVAS_CODEX_CLI;
    else process.env.CODEX_CANVAS_CODEX_CLI = previousCli;
  }
}

async function testAlphaRecutEditOutputs() {
  const deps = await checkImageProcessingDepsAvailable();
  if (!deps.available) {
    console.warn(`Skipping alpha recut edit smoke test; missing optional image dependencies: ${deps.missing?.join(", ") || "unknown"}.`);
    return;
  }

  const previous = process.env.CODEX_CANVAS_TEST_HELPERS;
  process.env.CODEX_CANVAS_TEST_HELPERS = "1";
  try {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-alpha-recut-"));
    const makeImages = path.join(tmp, "make-images.py");
    await fs.writeFile(makeImages, [
      "from pathlib import Path",
      "from PIL import Image, ImageDraw",
      "import sys",
      "root = Path(sys.argv[1])",
      "transparent = Image.new('RGBA', (12, 10), (0, 0, 0, 0))",
      "draw = ImageDraw.Draw(transparent)",
      "draw.rectangle((4, 3, 6, 5), fill=(220, 40, 20, 255))",
      "transparent.putpixel((3, 3), (220, 40, 20, 128))",
      "transparent.save(root / 'transparent-source.png')",
      "opaque = Image.new('RGBA', (12, 10), (240, 240, 240, 255))",
      "opaque.save(root / 'opaque-source.png')",
      "generated = Image.new('RGBA', (12, 10), (255, 0, 255, 255))",
      "draw = ImageDraw.Draw(generated)",
      "draw.rectangle((2, 2, 9, 7), fill=(20, 180, 80, 255))",
      "generated.putpixel((1, 2), (220, 45, 220, 255))",
      "generated.save(root / 'generated-chroma.png')"
    ].join("\n"));
    await runPython([makeImages, tmp]);

    const generatedPath = path.join(tmp, "generated-chroma.png");
    const quickOutput = await prepareImageForCollectionForTest({
      action: "quick-edit",
      imagePath: path.join(tmp, "transparent-source.png"),
      sourceImagePath: path.join(tmp, "transparent-source.png"),
      outputDir: path.join(tmp, "quick-edit-output"),
      logPath: path.join(tmp, "quick-edit.log"),
      transparentLayerMode: true
    }, Date.now() - 1000, generatedPath);
    if (path.resolve(quickOutput) === path.resolve(generatedPath)) {
      throw new Error("Quick Edit should recut generated output when the source has transparency.");
    }

    const editTextOutput = await prepareImageForCollectionForTest({
      action: "edit-text",
      imagePath: path.join(tmp, "transparent-source.png"),
      sourceImagePath: path.join(tmp, "transparent-source.png"),
      outputDir: path.join(tmp, "edit-text-output"),
      logPath: path.join(tmp, "edit-text.log"),
      transparentLayerMode: true
    }, Date.now() - 1000, generatedPath);
    if (path.resolve(editTextOutput) === path.resolve(generatedPath)) {
      throw new Error("Edit Text should recut generated output when the source has transparency.");
    }

    const normalOutput = await prepareImageForCollectionForTest({
      action: "quick-edit",
      imagePath: path.join(tmp, "opaque-source.png"),
      sourceImagePath: path.join(tmp, "opaque-source.png"),
      outputDir: path.join(tmp, "normal-output"),
      logPath: path.join(tmp, "normal.log"),
      transparentLayerMode: false
    }, Date.now() - 1000, generatedPath);
    assertEqual(path.resolve(normalOutput), path.resolve(generatedPath), "Quick Edit should not recut normal opaque image outputs");

    const removeBgOutput = await prepareImageForCollectionForTest({
      action: "remove-bg",
      imagePath: path.join(tmp, "opaque-source.png"),
      sourceImagePath: path.join(tmp, "opaque-source.png"),
      outputDir: path.join(tmp, "remove-bg-output"),
      logPath: path.join(tmp, "remove-bg.log")
    }, Date.now() - 1000, generatedPath);
    if (path.resolve(removeBgOutput) === path.resolve(generatedPath)) {
      throw new Error("Remove BG should recut generated chroma PNG outputs even when they are already RGBA.");
    }

    const inspect = path.join(tmp, "inspect-alpha.py");
    await fs.writeFile(inspect, [
      "from pathlib import Path",
      "from PIL import Image",
      "import json, sys",
      "root = Path(sys.argv[1])",
      "quick = Image.open(sys.argv[2]).convert('RGBA')",
      "text = Image.open(sys.argv[3]).convert('RGBA')",
      "remove_bg = Image.open(sys.argv[4]).convert('RGBA')",
      "payload = {",
      "  'quickBackground': quick.getpixel((0, 0)),",
      "  'quickSourceTransparentNowFilled': quick.getpixel((8, 7)),",
      "  'quickInterior': quick.getpixel((5, 4)),",
      "  'textBackground': text.getpixel((0, 0)),",
      "  'textSourceTransparentNowFilled': text.getpixel((8, 7)),",
      "  'textInterior': text.getpixel((5, 4)),",
      "  'removeBgBackground': remove_bg.getpixel((0, 0)),",
      "  'removeBgHalo': remove_bg.getpixel((1, 2)),",
      "}",
      "(root / 'inspect.json').write_text(json.dumps(payload), encoding='utf-8')"
    ].join("\n"));
    await runPython([inspect, tmp, quickOutput, editTextOutput, removeBgOutput]);
    const result = JSON.parse(await fs.readFile(path.join(tmp, "inspect.json"), "utf8"));
    assertEqual(result.quickBackground[3], 0, "Quick Edit should remove generated chroma background");
    assertEqual(result.quickSourceTransparentNowFilled[3], 255, "Quick Edit should allow the edited silhouette to grow beyond source alpha");
    assertEqual(result.quickInterior.slice(0, 3).join(","), "20,180,80", "Quick Edit should keep generated RGB inside the recut alpha");
    assertEqual(result.textBackground[3], 0, "Edit Text should remove generated chroma background");
    assertEqual(result.textSourceTransparentNowFilled[3], 255, "Edit Text should allow the edited silhouette to grow beyond source alpha");
    assertEqual(result.textInterior.slice(0, 3).join(","), "20,180,80", "Edit Text should keep generated RGB inside the recut alpha");
    assertEqual(result.removeBgBackground[3], 0, "Remove BG should remove generated chroma background");
    if (result.removeBgHalo[0] > 120 || result.removeBgHalo[2] > 120) {
      throw new Error("Remove BG should despill obvious magenta halo pixels.");
    }
  } finally {
    if (previous === undefined) delete process.env.CODEX_CANVAS_TEST_HELPERS;
    else process.env.CODEX_CANVAS_TEST_HELPERS = previous;
  }
}

async function waitForImageJobDone(jobId) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const job = getImageJob(jobId);
    if (job.status === "done") return job;
    if (job.status === "failed") throw new Error(`Image job failed: ${job.error || "unknown error"}`);
    await delay(100);
  }
  throw new Error(`Image job did not finish: ${jobId}`);
}

async function readCapturedCodexJob(projectDir, jobId) {
  const capturePath = path.join(jobsDirFor(projectDir), jobId, "outputs", "codex-capture.json");
  return JSON.parse(await fs.readFile(capturePath, "utf8"));
}

async function testEditElementsScripts() {
  const deps = await checkImageProcessingDepsAvailable();
  if (!deps.available) {
    console.warn(`Skipping edit elements scripts smoke test; missing optional image dependencies: ${deps.missing?.join(", ") || "unknown"}.`);
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-elements-"));
  const makeImages = path.join(tmp, "make-images.py");
  await fs.writeFile(makeImages, [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "import sys",
    "root = Path(sys.argv[1])",
    "source = Image.new('RGBA', (48, 32), (255, 255, 255, 255))",
    "draw = ImageDraw.Draw(source)",
    "draw.rectangle((4, 4, 20, 22), fill=(255, 0, 0, 255))",
    "draw.rectangle((26, 6, 42, 24), fill=(0, 92, 255, 255))",
    "source.putpixel((0, 0), (255, 255, 255, 0))",
    "source.save(root / 'source.png')",
    "seg = Image.new('RGB', (48, 32), (255, 0, 255))",
    "draw = ImageDraw.Draw(seg)",
    "draw.rectangle((6, 6, 12, 20), fill=(255, 0, 102))",
    "draw.rectangle((13, 6, 18, 20), fill=(250, 0, 110))",
    "draw.rectangle((28, 8, 40, 22), fill=(0, 96, 255))",
    "seg.save(root / 'seg.png')",
    "completed = Image.new('RGBA', (24, 16), (20, 80, 140, 160))",
    "completed.save(root / 'completed.png')"
  ].join("\n"));

  await runPython([makeImages, tmp]);
  await runPython([
    path.join(process.cwd(), "scripts", "split_elements.py"),
    "--source", path.join(tmp, "source.png"),
    "--segmentation", path.join(tmp, "seg.png"),
    "--out-dir", path.join(tmp, "layers"),
    "--max-layers", "8",
    "--palette-size", "8",
    "--min-area-px", "20",
    "--mask-clean", "1",
    "--pad", "0",
    "--edge-feather", "0",
    "--mask-grow-color-distance", "36",
    "--merge-contained",
    "--merge-object-parts",
    "--fill-object-holes",
    "--write-reconstruction",
    "--force"
  ]);
  await runPython([
    path.join(process.cwd(), "scripts", "prepare_completed_background.py"),
    "--source", path.join(tmp, "source.png"),
    "--completed", path.join(tmp, "completed.png"),
    "--out", path.join(tmp, "background.png"),
    "--force"
  ]);

  const manifest = JSON.parse(await fs.readFile(path.join(tmp, "layers", "elements-manifest.json"), "utf8"));
  assertEqual(manifest.sourceSize.width, 48, "split_elements manifest should preserve source width");
  assertEqual(manifest.sourceSize.height, 32, "split_elements manifest should preserve source height");
  assertEqual(manifest.layers.length, 3, "split_elements should export two foreground layers plus residual background");
  assertEqual(manifest.exportedLayers, 3, "split_elements exported layer count should match manifest layers");
  assertEqual(manifest.maskGrowPixels, 2, "split_elements should record the foreground mask safety band");
  assertEqual(manifest.maskCleanPixels, 1, "split_elements should record the segmentation crack cleanup radius");
  assertEqual(manifest.mergeObjectParts, true, "split_elements should record object-part semantic merging");
  assertEqual(manifest.backgroundLayer, true, "split_elements should record that a residual background layer was exported");
  const backgroundLayer = manifest.layers.find((layer) => layer.kind === "background");
  if (!backgroundLayer) throw new Error("split_elements should include a residual background layer.");
  assertEqual(backgroundLayer.bbox.join(","), "0,0,48,32", "residual background should keep full-frame bounds when uncovered pixels span the canvas");
  const objectLayers = manifest.layers.filter((layer) => layer.kind !== "background");
  const redLayer = objectLayers.find((layer) => layer.bbox.join(",") === "4,4,21,23");
  if (!redLayer) throw new Error("split_elements should merge nearby red segmentation colors into one grown object layer.");
  const blueLayer = objectLayers.find((layer) => layer.bbox.join(",") === "26,6,43,25");
  if (!blueLayer) throw new Error("split_elements should preserve the independent blue object layer.");
  if (!objectLayers.every((layer) => layer.maskGrowPixels > 0)) {
    throw new Error("split_elements should grow foreground layer masks to avoid eroded object edges.");
  }
  for (const layer of manifest.layers) {
    await fs.access(layer.path);
  }
  if (!manifest.reconstruction?.reconstructionPath || manifest.reconstruction.coverageRatio < 0.99) {
    throw new Error("split_elements reconstruction output should cover the source image.");
  }
  assertEqual(manifest.backgroundMode, "chroma-key-magenta", "split_elements should treat magenta as the Edit Elements background key");
  await runPython([
    path.join(process.cwd(), "scripts", "verify_elements_layers.py"),
    "--manifest", path.join(tmp, "layers", "elements-manifest.json"),
    "--max-diff", "0",
    "--min-coverage", "1"
  ]);

  const makeChromaImages = path.join(tmp, "make-chroma-images.py");
  await fs.writeFile(makeChromaImages, [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "import sys",
    "root = Path(sys.argv[1])",
    "source = Image.new('RGBA', (96, 64), (255, 255, 255, 255))",
    "draw = ImageDraw.Draw(source)",
    "draw.rectangle((4, 4, 20, 24), fill=(24, 24, 24, 255))",
    "draw.rectangle((4, 40, 18, 56), fill=(20, 210, 90, 255))",
    "draw.rectangle((72, 40, 90, 56), fill=(20, 210, 90, 255))",
    "source.save(root / 'chroma-source.png')",
    "seg = Image.new('RGB', (96, 64), (255, 0, 255))",
    "draw = ImageDraw.Draw(seg)",
    "draw.rectangle((6, 6, 18, 22), fill=(24, 24, 24))",
    "draw.rectangle((6, 42, 16, 54), fill=(102, 255, 0))",
    "draw.rectangle((74, 42, 88, 54), fill=(102, 255, 0))",
    "seg.save(root / 'chroma-seg.png')"
  ].join("\n"));
  await runPython([makeChromaImages, tmp]);
  await runPython([
    path.join(process.cwd(), "scripts", "split_elements.py"),
    "--source", path.join(tmp, "chroma-source.png"),
    "--segmentation", path.join(tmp, "chroma-seg.png"),
    "--out-dir", path.join(tmp, "chroma-layers"),
    "--max-layers", "8",
    "--palette-size", "8",
    "--min-area-px", "20",
    "--mask-clean", "1",
    "--pad", "0",
    "--edge-feather", "0",
    "--mask-grow-color-distance", "36",
    "--merge-contained",
    "--merge-object-parts",
    "--fill-object-holes",
    "--write-reconstruction",
    "--force"
  ]);
  const chromaManifest = JSON.parse(await fs.readFile(path.join(tmp, "chroma-layers", "elements-manifest.json"), "utf8"));
  assertEqual(chromaManifest.backgroundMode, "chroma-key-magenta", "split_elements should detect the chroma-key background on generated masks");
  const chromaObjects = chromaManifest.layers.filter((layer) => layer.kind !== "background");
  assertEqual(chromaObjects.length, 3, "split_elements should preserve a dark foreground region and split far same-color objects");
  if (!chromaObjects.some((layer) => layer.segmentationColor === "#181818")) {
    throw new Error("split_elements should not drop dark foreground colors when the mask uses magenta background.");
  }

  const makeObjectPartImages = path.join(tmp, "make-object-part-images.py");
  await fs.writeFile(makeObjectPartImages, [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "import sys",
    "root = Path(sys.argv[1])",
    "source = Image.new('RGBA', (120, 80), (250, 250, 250, 255))",
    "draw = ImageDraw.Draw(source)",
    "draw.rounded_rectangle((16, 22, 86, 52), radius=8, fill=(20, 110, 220, 255))",
    "draw.rectangle((14, 50, 92, 62), fill=(245, 245, 245, 255))",
    "draw.rectangle((34, 30, 70, 36), fill=(25, 25, 25, 255))",
    "draw.ellipse((94, 20, 114, 42), fill=(255, 110, 0, 255))",
    "source.save(root / 'object-parts-source.png')",
    "seg = Image.new('RGB', (120, 80), (255, 0, 255))",
    "draw = ImageDraw.Draw(seg)",
    "draw.rounded_rectangle((16, 22, 86, 52), radius=8, fill=(0, 102, 255))",
    "draw.rectangle((14, 50, 92, 62), fill=(255, 255, 255))",
    "draw.rectangle((34, 30, 70, 36), fill=(24, 24, 24))",
    "draw.ellipse((94, 20, 114, 42), fill=(255, 102, 0))",
    "seg.save(root / 'object-parts-seg.png')"
  ].join("\n"));
  await runPython([makeObjectPartImages, tmp]);
  await runPython([
    path.join(process.cwd(), "scripts", "split_elements.py"),
    "--source", path.join(tmp, "object-parts-source.png"),
    "--segmentation", path.join(tmp, "object-parts-seg.png"),
    "--out-dir", path.join(tmp, "object-parts-layers"),
    "--max-layers", "8",
    "--palette-size", "8",
    "--min-area-px", "20",
    "--mask-clean", "1",
    "--pad", "0",
    "--edge-feather", "0",
    "--mask-grow-color-distance", "36",
    "--merge-contained",
    "--merge-object-parts",
    "--fill-object-holes",
    "--write-reconstruction",
    "--force"
  ]);
  const objectPartManifest = JSON.parse(await fs.readFile(path.join(tmp, "object-parts-layers", "elements-manifest.json"), "utf8"));
  const objectPartObjects = objectPartManifest.layers.filter((layer) => layer.kind !== "background");
  assertEqual(objectPartObjects.length, 2, "split_elements should merge attached multi-color product parts into one object while preserving separate nearby objects");

  const makeDecorImages = path.join(tmp, "make-decor-images.py");
  await fs.writeFile(makeDecorImages, [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "import sys",
    "root = Path(sys.argv[1])",
    "source = Image.new('RGBA', (160, 100), (245, 245, 245, 255))",
    "draw = ImageDraw.Draw(source)",
    "draw.rounded_rectangle((58, 18, 102, 76), radius=10, fill=(0, 160, 150, 255))",
    "draw.ellipse((18, 48, 42, 72), fill=(255, 140, 0, 255))",
    "for x, y, r in [(15,12,4),(31,18,5),(50,12,3),(121,17,4),(139,24,5),(132,48,4),(118,70,3),(35,84,4),(70,88,3),(105,87,4)]:",
    "    draw.ellipse((x-r, y-r, x+r, y+r), fill=(95, 220, 230, 255))",
    "source.save(root / 'decor-source.png')",
    "seg = Image.new('RGB', (160, 100), (255, 0, 255))",
    "draw = ImageDraw.Draw(seg)",
    "draw.rounded_rectangle((58, 18, 102, 76), radius=10, fill=(0, 170, 160))",
    "draw.ellipse((18, 48, 42, 72), fill=(255, 140, 0))",
    "for x, y, r in [(15,12,4),(31,18,5),(50,12,3),(121,17,4),(139,24,5),(132,48,4),(118,70,3),(35,84,4),(70,88,3),(105,87,4)]:",
    "    draw.ellipse((x-r, y-r, x+r, y+r), fill=(95, 220, 230))",
    "seg.save(root / 'decor-seg.png')"
  ].join("\n"));
  await runPython([makeDecorImages, tmp]);
  await runPython([
    path.join(process.cwd(), "scripts", "split_elements.py"),
    "--source", path.join(tmp, "decor-source.png"),
    "--segmentation", path.join(tmp, "decor-seg.png"),
    "--out-dir", path.join(tmp, "decor-layers"),
    "--max-layers", "12",
    "--palette-size", "8",
    "--min-area-px", "20",
    "--mask-clean", "1",
    "--pad", "0",
    "--edge-feather", "0",
    "--mask-grow-color-distance", "36",
    "--merge-contained",
    "--merge-object-parts",
    "--fill-object-holes",
    "--write-reconstruction",
    "--force"
  ]);
  const decorManifest = JSON.parse(await fs.readFile(path.join(tmp, "decor-layers", "elements-manifest.json"), "utf8"));
  const decorObjects = decorManifest.layers.filter((layer) => layer.kind !== "background");
  assertEqual(decorObjects.length, 3, "split_elements should merge many small same-color decoration fragments into one decor layer");
  if (!decorObjects.some((layer) => layer.decorativeMergedColors?.length)) {
    throw new Error("split_elements should report decorative fragment merging.");
  }

  const preparedBackground = await inspectPreparedBackground(tmp);
  assertEqual(preparedBackground.size, "48x32", "prepare_completed_background should resize completed backgrounds to source size");
  assertEqual(preparedBackground.transparentAlpha, 0, "prepare_completed_background should preserve transparent source alpha");
  assertEqual(preparedBackground.opaqueAlpha, 255, "prepare_completed_background should preserve opaque source alpha");
  if (preparedBackground.opaqueRed <= 20 || preparedBackground.opaqueRed >= 255) {
    throw new Error("prepare_completed_background should flatten translucent generated pixels against white.");
  }

  await assertRejects(
    () => runPython([
      path.join(process.cwd(), "scripts", "split_elements.py"),
      "--source", path.join(tmp, "source.png"),
      "--segmentation", path.join(tmp, "missing-segmentation.png"),
      "--out-dir", path.join(tmp, "missing-layers")
    ]),
    "Python smoke step failed",
    "split_elements should fail deterministically when the segmentation map is missing"
  );

  await testEditElementsLayerPlacement(tmp);
}

async function inspectPreparedBackground(tmp) {
  const inspect = path.join(tmp, "inspect-background.py");
  await fs.writeFile(inspect, [
    "from pathlib import Path",
    "from PIL import Image",
    "import json, sys",
    "root = Path(sys.argv[1])",
    "image = Image.open(root / 'background.png').convert('RGBA')",
    "transparent = image.getpixel((0, 0))",
    "opaque = image.getpixel((10, 10))",
    "payload = {",
    "  'size': f'{image.width}x{image.height}',",
    "  'transparentAlpha': transparent[3],",
    "  'opaqueAlpha': opaque[3],",
    "  'opaqueRed': opaque[0]",
    "}",
    "(root / 'inspect-background.json').write_text(json.dumps(payload), encoding='utf-8')"
  ].join("\n"));
  await runPython([inspect, tmp]);
  return JSON.parse(await fs.readFile(path.join(tmp, "inspect-background.json"), "utf8"));
}

async function testEditElementsLayerPlacement(tmp) {
  const previous = process.env.CODEX_CANVAS_TEST_HELPERS;
  const previousCli = process.env.CODEX_CANVAS_CODEX_CLI;
  process.env.CODEX_CANVAS_TEST_HELPERS = "1";
  try {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-elements-place-"));
    const outputDir = path.join(projectDir, "job-output");
    const elementsDir = path.join(outputDir, "elements");
    await fs.mkdir(elementsDir, { recursive: true });
    const fakeCodex = path.join(projectDir, process.platform === "win32" ? "codex.cmd" : "codex");
    await fs.writeFile(fakeCodex, fakeCodexCompletedBackgroundScript(), { mode: 0o755 });
    process.env.CODEX_CANVAS_CODEX_CLI = fakeCodex;

    const placementSourcePath = path.join(projectDir, "placement-source.png");
    const makePlacementSource = path.join(projectDir, "make-placement-source.py");
    await fs.writeFile(makePlacementSource, [
      "from PIL import Image, ImageDraw",
      "import sys",
      "image = Image.new('RGBA', (96, 64), (245, 245, 245, 255))",
      "draw = ImageDraw.Draw(image)",
      "draw.rectangle((10, 5, 30, 25), fill=(30, 90, 220, 255))",
      "image.save(sys.argv[1])"
    ].join("\n"));
    await runPython([makePlacementSource, placementSourcePath]);

    const backgroundPath = path.join(elementsDir, "element-01-background.png");
    const objectPath = path.join(elementsDir, "element-02-object.png");
    await fs.copyFile(path.join(tmp, "background.png"), backgroundPath);
    const makeObjectLayer = path.join(projectDir, "make-object-layer.py");
    await fs.writeFile(makeObjectLayer, [
      "from PIL import Image, ImageDraw",
      "import sys",
      "image = Image.new('RGBA', (20, 20), (0, 0, 0, 0))",
      "draw = ImageDraw.Draw(image)",
      "draw.rectangle((0, 0, 19, 19), fill=(30, 90, 220, 255))",
      "image.save(sys.argv[1])"
    ].join("\n"));
    await runPython([makeObjectLayer, objectPath]);

    const source = await addImage(projectDir, {
      path: path.join(tmp, "source.png"),
      name: "source.png",
      x: 20,
      y: 30,
      width: 96,
      height: 64
    });
    const placeholder = await addImage(projectDir, {
      path: path.join(tmp, "source.png"),
      name: "placeholder.png",
      allowDuplicate: true,
      x: 300,
      y: 200,
      width: 192,
      height: 128
    });
    const topLayer = await addImage(projectDir, {
      path: objectPath,
      name: "element-02-object.png"
    });
    const bottomLayer = await addImage(projectDir, {
      path: backgroundPath,
      name: "element-01-background.png"
    });

    await fs.writeFile(path.join(elementsDir, "elements-manifest.json"), `${JSON.stringify({
      source: placementSourcePath,
      sourceSize: { width: 96, height: 64 },
      backgroundCompleted: false,
      layers: [
        {
          index: 9,
          kind: "background",
          path: backgroundPath,
          bbox: [0, 0, 96, 64],
          areaPixels: 6144
        },
        {
          index: 0,
          kind: "object",
          path: objectPath,
          bbox: [10, 5, 30, 25],
          areaPixels: 400
        }
      ]
    }, null, 2)}\n`);

    const placementJob = {
      id: "placement-contract",
      canvasId: null,
      projectDir,
      outputDir,
      logPath: path.join(projectDir, "placement-contract.log"),
      sourceObjectId: source.id,
      imagePath: placementSourcePath,
      placeholder,
      placeholderId: placeholder.id,
      imported: [topLayer, bottomLayer]
    };
    await placeImportedElementLayersForTest(projectDir, placementJob);

    const state = await readState(projectDir);
    if (state.objects.some((object) => object.id === placeholder.id)) {
      throw new Error("Edit Elements placement should delete the job placeholder.");
    }
    const groupMembers = state.objects.filter((object) => object.layerGroupId === "layer_group_placement-contract");
    assertEqual(groupMembers.length, 2, "Edit Elements placement should assign every imported layer to one group");
    assertEqual(groupMembers[0].layerGroupKind, "background", "Edit Elements layer stack should place the background first");
    assertEqual(groupMembers[0].layerGroupIndex, 0, "Edit Elements background layer should default to the bottom layer index");
    assertEqual(groupMembers[0].layerGroupBackgroundStatus, "filling", "Edit Elements should place residual background immediately while completion runs");
    assertEqual(groupMembers[1].layerGroupKind, "object", "Edit Elements layer stack should place object layers above the background");
    assertEqual(groupMembers[1].layerGroupIndex, 1, "Edit Elements foreground layers should default above the background layer");
    assertEqual(state.selection, groupMembers[1].id, "Edit Elements placement should select the topmost group layer");
    assertEqual(groupMembers[0].x, 300, "background layer should align to placeholder x");
    assertEqual(groupMembers[0].y, 200, "background layer should align to placeholder y");
    assertEqual(groupMembers[0].width, 192, "background layer should scale to placeholder width");
    assertEqual(groupMembers[0].height, 128, "background layer should scale to placeholder height");
    assertEqual(groupMembers[1].x, 320, "object layer x should scale from manifest bbox");
    assertEqual(groupMembers[1].y, 210, "object layer y should scale from manifest bbox");
    assertEqual(groupMembers[1].width, 40, "object layer width should scale from manifest bbox");
    assertEqual(groupMembers[1].height, 40, "object layer height should scale from manifest bbox");
    for (const member of groupMembers) {
      assertEqual(member.layerGroupLocked, false, "Edit Elements layers should retain group metadata but start unlocked");
      assertEqual(member.layerGroupSourceObjectId, source.id, "Edit Elements group metadata should retain source object id");
      assertEqual(member.layerGroupOriginalX, 300, "Edit Elements group metadata should retain original placeholder x");
      assertEqual(member.layerGroupOriginalY, 200, "Edit Elements group metadata should retain original placeholder y");
      assertEqual(member.layerGroupOriginalWidth, 192, "Edit Elements group metadata should retain original placeholder width");
      assertEqual(member.layerGroupOriginalHeight, 128, "Edit Elements group metadata should retain original placeholder height");
    }
    const psd = await exportLayerGroupPsd(projectDir, "layer_group_placement-contract");
    assertEqual(psd.buffer.subarray(0, 4).toString("ascii"), "8BPS", "PSD export should write a Photoshop document");
    assertEqual(psd.layerCount, 2, "PSD export should include every image layer in the Edit Elements group");

    await waitForCondition(
      () => placementJob.backgroundCompletionRunning,
      "Edit Elements background completion should keep image jobs running so auto-collection cannot collect its raw output"
    );

    await reorderLayerGroupLayer(projectDir, "layer_group_placement-contract", groupMembers[1].id, "down");
    const movedDownState = await readState(projectDir);
    const movedDownMembers = movedDownState.objects.filter((object) => object.layerGroupId === "layer_group_placement-contract");
    assertEqual(movedDownMembers[0].id, groupMembers[1].id, "Layer down should move the selected object below its previous neighbor");
    await reorderLayerGroupLayer(projectDir, "layer_group_placement-contract", groupMembers[1].id, "up");
    const movedUpState = await readState(projectDir);
    const movedUpMembers = movedUpState.objects.filter((object) => object.layerGroupId === "layer_group_placement-contract");
    assertEqual(movedUpMembers[1].id, groupMembers[1].id, "Layer up should move the selected object above its previous neighbor");

    const readyBackground = await waitForLocalStateObject(
      projectDir,
      (object) => object.id === bottomLayer.id && object.layerGroupBackgroundStatus === "ready" && Number.isFinite(object.assetVersion),
      "Edit Elements background completion should replace the imported background layer in place"
    );
    assertEqual(placementJob.backgroundCompletionRunning, false, "Edit Elements background completion should stop blocking auto-collection after integration");
    assertEqual(readyBackground.layerGroupKind, "background", "completed background should remain the background group layer");
    const completedBackgroundPath = path.join(outputDir, "background-completion", "edit-elements-background-completed.png");
    const ignoredPaths = getIgnoredGeneratedImagePaths({ projectDir, canvasId: null }).map((item) => path.resolve(item));
    if (!ignoredPaths.includes(path.resolve(completedBackgroundPath))) {
      throw new Error("Edit Elements background completion output should be ignored by auto-collection after in-place replacement.");
    }
    const duplicateCollection = await collectRecentImages(projectDir, {
      roots: [path.dirname(completedBackgroundPath)],
      sinceMs: 0,
      limit: 10,
      prompt: "should not import completed background",
      excludePaths: ignoredPaths
    });
    assertEqual(duplicateCollection.imported.length, 0, "Edit Elements completed background output should not be collected as a separate canvas image");
    const completedManifest = JSON.parse(await fs.readFile(path.join(elementsDir, "elements-manifest.json"), "utf8"));
    assertEqual(completedManifest.backgroundCompleted, true, "background completion should update the elements manifest");
    await runPython([
      path.join(process.cwd(), "scripts", "verify_elements_layers.py"),
      "--manifest", path.join(elementsDir, "elements-manifest.json"),
      "--require-completed-background",
      "--write-final-composite", path.join(elementsDir, "completed-reconstruction.png")
    ]);
  } finally {
    if (previous === undefined) delete process.env.CODEX_CANVAS_TEST_HELPERS;
    else process.env.CODEX_CANVAS_TEST_HELPERS = previous;
    if (previousCli === undefined) delete process.env.CODEX_CANVAS_CODEX_CLI;
    else process.env.CODEX_CANVAS_CODEX_CLI = previousCli;
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function runCliJson(args, options = {}) {
  const result = await runCli(args, options);
  let body = {};
  try {
    body = JSON.parse(result.stdout.trim() || "{}");
  } catch (error) {
    throw new Error(`CLI did not print JSON for ${args.join(" ")}. stdout=${result.stdout.trim()} stderr=${result.stderr.trim()}`);
  }
  return { status: result.status, body };
}

async function runCli(args, options = {}) {
  return await execFileAsync(process.execPath, [path.join(process.cwd(), "bin", "codex-canvas.mjs"), ...args], {
    cwd: process.cwd(),
    env: options.env || process.env,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  }).then(
    (completed) => ({ ...completed, status: 0 }),
    (error) => ({
      stdout: error.stdout || "",
      stderr: error.stderr || "",
      status: error.code || 1
    })
  );
}

async function createLimitFixtureProject(label) {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), `codex-canvas-${label}-`));
  for (let index = 0; index < 105; index += 1) {
    await addImage(projectDir, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: `${label}-${index}.png`,
      prompt: `${label} shared prompt`
    });
  }
  return projectDir;
}

async function createCollectFixtureProject(label, count) {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), `codex-canvas-${label}-`));
  const imagesDir = path.join(projectDir, "generated");
  await fs.mkdir(imagesDir, { recursive: true });
  const basePng = Buffer.from(pngOne, "base64");
  for (let index = 0; index < count; index += 1) {
    await fs.writeFile(path.join(imagesDir, `${label}-${index}.png`), Buffer.concat([
      basePng,
      Buffer.from(`codex-canvas-${label}-${index}`)
    ]));
  }
  return { projectDir, imagesDir };
}

async function writeDistinctPng(filePath, label) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.concat([
    Buffer.from(pngOne, "base64"),
    Buffer.from(`codex-canvas-${label}`)
  ]));
}

function withoutPathEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"));
}

async function waitForObjectCount(url, expected, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const response = await fetch(url);
    const state = await response.json();
    if (state.objects?.length === expected) return state;
    await delay(100);
  }
  throw new Error(message);
}

async function waitForStateObject(url, predicate, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const response = await fetch(url);
    const state = await response.json();
    const object = state.objects?.find(predicate);
    if (object) return object;
    await delay(100);
  }
  throw new Error(message);
}

async function waitForLocalStateObject(projectDir, predicate, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const state = await readState(projectDir);
    const object = state.objects?.find(predicate);
    if (object) return object;
    await delay(100);
  }
  throw new Error(message);
}

async function waitForCondition(predicate, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsidePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function startMcpServer(options = {}) {
  const child = spawn(process.execPath, [path.join(process.cwd(), "src", "mcp-server.mjs")], {
    cwd: process.cwd(),
    env: options.env || process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  const errors = [];

  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) {
        const error = new Error(message.error.message || "MCP request failed");
        error.code = message.error.code;
        error.data = message.error.data;
        request.reject(error);
      } else {
        request.resolve(message.result);
      }
    }
  });

  const request = (method, params) => {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}${errors.length ? `: ${errors.join("").trim()}` : ""}`));
      }, 5000);
      timeout.unref?.();
      pending.set(id, { resolve, reject, timeout });
    });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  };

  const stop = () => new Promise((resolve) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("MCP server stopped."));
    }
    pending.clear();
    child.once("close", resolve);
    child.kill();
    setTimeout(resolve, 1000).unref?.();
  });

  return { request, stop };
}

async function runPython(args) {
  const candidates = process.platform === "win32"
    ? [["py", ["-3", ...args]], ["python", args], ["python3", args]]
    : [["python3", args], ["python", args]];
  const errors = [];
  for (const [command, commandArgs] of candidates) {
    try {
      await execFileAsync(command, commandArgs, { maxBuffer: 1024 * 1024, windowsHide: true });
      return;
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }
  throw new Error(`Python smoke step failed. ${errors.join(" | ")}`);
}

function fakeCodexAppServerScript() {
  return `#!/usr/bin/env node
const crypto = require("crypto");
const net = require("net");
const listen = process.argv[process.argv.indexOf("--listen") + 1];
const port = Number(new URL(listen).port);
function encode(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  return Buffer.concat([Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]), payload]);
}
function decode(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  }
  const masked = Boolean(buffer[1] & 0x80);
  const mask = masked ? buffer.slice(offset, offset + 4) : null;
  offset += masked ? 4 : 0;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return { opcode, text: payload.toString("utf8"), bytesRead: offset + length };
}
net.createServer((socket) => {
  let handshaken = false;
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshaken) {
      const end = buffer.indexOf("\\r\\n\\r\\n");
      if (end < 0) return;
      const header = buffer.slice(0, end).toString("utf8");
      const key = /sec-websocket-key:\\s*(.+)/i.exec(header)[1].trim();
      const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Accept: " + accept, "", ""].join("\\r\\n"));
      buffer = buffer.slice(end + 4);
      handshaken = true;
    }
    for (;;) {
      const frame = decode(buffer);
      if (!frame) return;
      buffer = buffer.slice(frame.bytesRead);
      if (frame.opcode !== 1) {
        if (frame.opcode === 8) socket.end();
        continue;
      }
      const message = JSON.parse(frame.text);
      if (message.method === "turn/start") {
        socket.write(encode(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-1" } } })));
        socket.write(encode(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: message.params.threadId, turn: { id: "turn-1", status: "completed", durationMs: 7 } } })));
      } else {
        socket.write(encode(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })));
      }
    }
  });
}).listen(port, "127.0.0.1");
`;
}

function fakeCodexCompletedBackgroundScript() {
  return `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const outputDir = process.env.CODEX_CANVAS_JOB_OUTPUT_DIR;
if (!outputDir) {
  console.error("CODEX_CANVAS_JOB_OUTPUT_DIR is required");
  process.exit(2);
}
setTimeout(() => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, "edit-elements-background-completed.png"), Buffer.from("${pngOne}", "base64"));
}, 1200);
`;
}

function fakeCodexCaptureImageJobScript() {
  return `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const outputDir = process.env.CODEX_CANVAS_JOB_OUTPUT_DIR;
if (!outputDir) {
  console.error("CODEX_CANVAS_JOB_OUTPUT_DIR is required");
  process.exit(2);
}
const args = process.argv.slice(2);
const imageArgs = [];
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === "--image" && args[index + 1]) imageArgs.push(args[index + 1]);
}
const prompt = args[args.length - 1] || "";
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(outputDir, "codex-capture.json"), JSON.stringify({ args, imageArgs, prompt }, null, 2));
fs.copyFileSync(imageArgs[0], path.join(outputDir, "quick-edit-result.png"));
fs.appendFileSync(path.join(outputDir, "quick-edit-result.png"), Buffer.from("codex-canvas-quick-edit-output"));
`;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

async function assertRejects(fn, expectedMessage, message, expected = {}) {
  try {
    await fn();
  } catch (error) {
    if (!String(error?.message || "").includes(expectedMessage)) {
      throw new Error(`${message}. Expected rejection containing ${JSON.stringify(expectedMessage)}, got ${JSON.stringify(error?.message || String(error))}.`);
    }
    if (Object.hasOwn(expected, "code") && error?.code !== expected.code) {
      throw new Error(`${message}. Expected JSON-RPC code ${expected.code}, got ${JSON.stringify(error?.code)}.`);
    }
    if (Object.hasOwn(expected, "statusCode") && error?.data?.statusCode !== expected.statusCode) {
      throw new Error(`${message}. Expected statusCode ${expected.statusCode}, got ${JSON.stringify(error?.data?.statusCode)}.`);
    }
    return;
  }
  throw new Error(`${message}. Expected rejection.`);
}

function assertSetEqual(actual, expected, message) {
  const actualValues = [...actual].sort();
  const expectedValues = [...expected].sort();
  if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expectedValues)}, got ${JSON.stringify(actualValues)}.`);
  }
}

function quotedAttributeValues(source, attribute) {
  const values = new Set();
  const pattern = new RegExp(`${attribute}="([^"]+)"`, "g");
  for (const match of source.matchAll(pattern)) values.add(match[1]);
  return values;
}

function objectKeysFromTranslationBlock(source, blockName) {
  const start = source.indexOf(`${blockName}: {`);
  if (start < 0) return new Set();
  const openBrace = source.indexOf("{", start);
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const block = source.slice(openBrace + 1, index);
        return new Set([...block.matchAll(/^\s*(?:"([^"]+)"|([a-zA-Z0-9_-]+))\s*:/gm)]
          .map((match) => match[1] || match[2]));
      }
    }
  }
  return new Set();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
