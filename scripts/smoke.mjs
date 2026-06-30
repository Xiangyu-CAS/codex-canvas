import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sendImageToBoundChat } from "../src/codex-chat.mjs";
import { placeImportedElementLayersForTest } from "../src/jobs.mjs";
import { checkImageProcessingDepsAvailable } from "../src/ocr-setup.mjs";
import { assetsDirFor } from "../src/paths.mjs";
import { createServer as createAgentCanvasServer } from "../src/server.mjs";
import { addImage, addObject, deleteObjects, promptHistory, readState, searchObjects, transformState, updateObject, versionGroups } from "../src/store.mjs";

const execFileAsync = promisify(execFile);

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
let smokeProjectRegistryPath = null;

async function main() {
  const results = [];
  for (const [name, test] of [
    ["store concurrency", testStoreConcurrency],
    ["object patch sanitization", testObjectPatchSanitization],
    ["http object patch sanitization", testHttpObjectPatchSanitization],
    ["http image input boundaries", testHttpImageInputBoundaries],
    ["canvas object search", testCanvasObjectSearch],
    ["canvas prompt history", testCanvasPromptHistory],
    ["canvas version groups", testCanvasVersionGroups],
    ["http json boundaries", testHttpJsonBoundaries],
    ["http project registration boundaries", testHttpProjectRegistrationBoundaries],
    ["frontend action contract", testFrontendActionContract],
    ["thread migration asset paths", testThreadMigrationAssetPaths],
    ["persistent project registry", testPersistentProjectRegistry],
    ["persistent project registry restored auto collector", testPersistentProjectRegistryRestoredAutoCollector],
    ["mcp canvas status", testMcpCanvasStatus],
    ["auto collector watcher watermark", testAutoCollectorWatermark],
    ["package optional dependency scripts", testPackageOptionalDependencyScripts],
    ["personal plugin installer", testPersonalPluginInstaller],
    ["cli collect help", testCliCollectHelp],
    ["doctor optional deps without python", testDoctorOptionalDepsWithoutPython],
    ["chat binding alias", testChatBindingAlias],
    ["chat websocket fallback", testChatWebSocketFallback],
    ["chat turn action contract", testChatTurnActionContract],
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
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-registry-smoke-"));
    smokeProjectRegistryPath = path.join(tmp, "projects.json");
  }
  return smokeProjectRegistryPath;
}

async function testObjectPatchSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-patch-"));
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

async function testHttpObjectPatchSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-http-patch-"));
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHttpImageInputBoundaries() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-http-image-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
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
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testCanvasObjectSearch() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-search-"));
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
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-prompts-"));
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
    sourceObjectId: first.id,
    layoutMode: "canvas-row"
  });

  const direct = await promptHistory(projectDir);
  assertEqual(direct.total, 2, "prompt history should de-duplicate repeated prompts");
  assertEqual(direct.prompts[0].prompt, "Bright product render", "prompt history should list newest unique prompts first");
  assertEqual(direct.prompts[0].objectId, latest.id, "prompt history should retain the object that used the prompt");
  assertEqual(direct.prompts[0].sourceObjectId, first.id, "prompt history should retain source object context");

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
    assertEqual(body.prompts[0].prompt, "Bright product render", "HTTP prompt history should return prompt summaries");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const cli = await runCliJson(["prompts", "moody", "--project", projectDir, "--json"]);
  assertEqual(cli.status, 0, "CLI prompts should succeed");
  assertEqual(cli.body.total, 1, "CLI prompts should filter prompt history");
  assertEqual(cli.body.prompts[0].prompt, "Moody neon city", "CLI prompts should return matching prompt summaries");
}

async function testCanvasVersionGroups() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-versions-"));
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

async function testHttpJsonBoundaries() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-http-json-"));
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

    const badPath = await fetch(`${base}%E0%A4%A${search}`);
    const badPathBody = await badPath.json();
    assertEqual(badPath.status, 400, "malformed URL encoding should return a client error");
    assertEqual(badPathBody.error, "Request path must use valid URL encoding.", "malformed URL encoding should return a useful error");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testHttpProjectRegistrationBoundaries() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-http-projects-"));
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: false
  });
  const base = url.replace(/\?.*/, "");
  try {
    const missing = await postJson(`${base}api/projects`, {});
    assertEqual(missing.status, 400, "HTTP project registration should reject missing projectDir");

    const empty = await postJson(`${base}api/projects`, { projectDir: "" });
    assertEqual(empty.status, 400, "HTTP project registration should reject empty projectDir");

    const relative = await postJson(`${base}api/projects`, { projectDir: "relative-project" });
    assertEqual(relative.status, 400, "HTTP project registration should reject relative projectDir");

    const registeredDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-http-projects-registered-"));
    const registered = await postJson(`${base}api/projects`, {
      projectDir: registeredDir,
      autoCollect: false
    });
    assertEqual(registered.status, 201, "HTTP project registration should accept absolute projectDir");
    assertEqual(registered.body.project?.projectDir, registeredDir, "HTTP project registration should keep the supplied absolute projectDir");
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
}

async function testThreadMigrationAssetPaths() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-migrate-"));
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
}

async function testPersistentProjectRegistry() {
  const firstProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-registry-first-"));
  const secondProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-registry-second-"));
  const registryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-registry-file-"));
  const persistentRegistryPath = path.join(registryRoot, "projects.json");
  const first = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath
  });
  const firstBase = first.url.replace(/\?.*/, "");
  let registered;
  try {
    registered = await postJson(`${firstBase}api/projects`, {
      projectDir: secondProjectDir,
      autoCollect: false,
      threadId: "thread-persisted-registry"
    });
    assertEqual(registered.status, 201, "HTTP project registration should succeed before registry persistence is checked");
  } finally {
    await new Promise((resolve) => first.server.close(resolve));
  }

  const registryPayload = JSON.parse(await fs.readFile(persistentRegistryPath, "utf8"));
  if (!registryPayload.projects?.some((project) => project.projectDir === secondProjectDir && project.chatThreadId === "thread-persisted-registry")) {
    throw new Error("Persistent project registry should store registered thread-scoped projects.");
  }

  const restoredProjectId = new URL(registered.body.url).searchParams.get("project");
  const second = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: false,
    persistentRegistryPath
  });
  const secondBase = second.url.replace(/\?.*/, "");
  try {
    const projectsResponse = await fetch(`${secondBase}api/projects`);
    const projectsBody = await projectsResponse.json();
    const restored = projectsBody.projects?.find((project) => project.id === restoredProjectId);
    if (!restored) throw new Error("Restarted Agent-Canvas server should restore registered projects from the persistent registry.");
    assertEqual(restored.projectDir, secondProjectDir, "Restored project should keep its projectDir");
    assertEqual(restored.chatThreadId, "thread-persisted-registry", "Restored project should keep its chat binding");
    assertEqual(restored.chatBound, true, "Restored project should report chat binding");
    assertEqual(restored.autoCollect, false, "Restored projects with explicit auto-collection opt-out should stay disabled");

    const stateResponse = await fetch(`${secondBase}api/state?project=${encodeURIComponent(restoredProjectId)}`);
    assertEqual(stateResponse.status, 200, "Restored project id should route to its canvas state after restart");
  } finally {
    await new Promise((resolve) => second.server.close(resolve));
  }
}

async function testPersistentProjectRegistryRestoredAutoCollector() {
  const firstProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-registry-auto-first-"));
  const restoredProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-registry-auto-restored-"));
  const registryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-registry-auto-file-"));
  const persistentRegistryPath = path.join(registryRoot, "projects.json");
  const first = await createServer({
    projectDir: firstProjectDir,
    port: 0,
    autoCollect: true,
    persistentRegistryPath,
    autoCollectIntervalMs: 100,
    autoCollectWatchDebounceMs: 25
  });
  const firstBase = first.url.replace(/\?.*/, "");
  let restoredProjectId;
  try {
    const registered = await postJson(`${firstBase}api/projects`, {
      projectDir: restoredProjectDir
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
    autoCollectIntervalMs: 100,
    autoCollectWatchDebounceMs: 25
  });
  const secondBase = second.url.replace(/\?.*/, "");
  try {
    const projectsResponse = await fetch(`${secondBase}api/projects`);
    const projectsBody = await projectsResponse.json();
    const restored = projectsBody.projects?.find((project) => project.id === restoredProjectId);
    if (!restored) throw new Error("Restarted Agent-Canvas server should restore the auto-collecting project.");
    assertEqual(restored.projectDir, restoredProjectDir, "Restored auto-collecting project should keep its projectDir");
    assertEqual(restored.autoCollect, true, "Restored auto-collecting project should resume auto-collection when the service enables it");

    const imagePath = path.join(restoredProjectDir, `restored-auto-${Date.now()}.png`);
    await fs.writeFile(imagePath, Buffer.from(pngOne, "base64"));
    const imported = await waitForStateObject(
      `${secondBase}api/state?project=${encodeURIComponent(restoredProjectId)}`,
      (object) => path.resolve(object.sourcePath || "") === path.resolve(imagePath),
      "restored project auto collector should import a new image after server restart"
    );
    assertEqual(imported.name, path.basename(imagePath), "restored project auto collector should import the new project image");
  } finally {
    await new Promise((resolve) => second.server.close(resolve));
  }
}

async function testAutoCollectorWatermark() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-collector-"));
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: true,
    autoCollectIntervalMs: 60_000,
    autoCollectWatchDebounceMs: 50
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const staleMtimeMs = Date.now();
    const firstPath = path.join(projectDir, "first.png");
    await fs.writeFile(firstPath, Buffer.from(pngOne, "base64"));
    await waitForObjectCount(`${base}api/state${search}`, 1, "auto collector watcher should import a new project image before the polling fallback");

    const stalePath = path.join(projectDir, "stale-but-new-file.png");
    await fs.writeFile(stalePath, Buffer.from("not a real png, but a unique image candidate"));
    await fs.utimes(stalePath, staleMtimeMs / 1000, staleMtimeMs / 1000);
    await delay(450);
    const stateResponse = await fetch(`${base}api/state${search}`);
    const state = await stateResponse.json();
    assertEqual(state.objects.length, 1, "auto collector should advance its watermark after a successful scan");

    const baselineDir = path.join(projectDir, "scripts", "reference-screenshots");
    await fs.mkdir(baselineDir, { recursive: true });
    await fs.writeFile(path.join(baselineDir, "baseline.png"), Buffer.from(pngOne, "base64"));
    await delay(450);
    const baselineStateResponse = await fetch(`${base}api/state${search}`);
    const baselineState = await baselineStateResponse.json();
    assertEqual(baselineState.objects.length, 1, "auto collector should ignore visual regression reference screenshots");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testMcpCanvasStatus() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-mcp-"));
  await addObject(projectDir, { type: "text", text: "mcp searchable note", name: "MCP Note", x: 10, y: 10 });
  await addImage(projectDir, {
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
    const status = await client.request("tools/call", {
      name: "canvas_status",
      arguments: { projectDir }
    });
    assertEqual(status.structuredContent?.objects, 2, "MCP canvas_status should read default canvas state");
    assertEqual(status.structuredContent?.chatBound, false, "MCP canvas_status should not infer chat binding without threadId");
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
        arguments: { projectDir: "relative-project" }
      }),
      "MCP tool call requires an absolute projectDir.",
      "MCP canvas_status should reject relative projectDir instead of resolving against server cwd"
    );
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
  const addImageSchema = byName.get("add_image")?.inputSchema || {};
  if (!addImageSchema.required?.includes("projectDir")) {
    throw new Error("MCP add_image should require projectDir.");
  }
  const addImageAnyOf = JSON.stringify(addImageSchema.anyOf || []);
  for (const imageInput of ["path", "url", "dataUrl"]) {
    if (!addImageAnyOf.includes(imageInput)) {
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
  for (const action of ["quick-edit", "remove-bg", "expand", "edit-elements"]) {
    if (!startImageJobActions.includes(action)) {
      throw new Error(`MCP start_image_job should expose the stable ${action} action.`);
    }
  }
  const sendToChatRequired = byName.get("send_to_chat")?.inputSchema?.required || [];
  for (const field of ["projectDir", "objectId", "threadId"]) {
    if (!sendToChatRequired.includes(field)) {
      throw new Error(`MCP send_to_chat should require ${field}.`);
    }
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
  assertEqual(
    packageJson.scripts?.["doctor:deps"],
    "node ./bin/agent-canvas.mjs doctor-deps --json",
    "package.json should expose a non-installing optional dependency doctor script"
  );
  assertEqual(
    packageJson.scripts?.["visual:regression"],
    "node ./scripts/visual-regression.mjs",
    "package.json should expose reference screenshot regression checks"
  );
}

async function testPersonalPluginInstaller() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-personal-plugin-"));
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
    AGENT_CANVAS_PERSONAL_HOME: tmp
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
    assertEqual(result.sourcePath, "./plugins/agent-canvas", "personal plugin installer should use the marketplace-relative plugin path");
  }

  const marketplace = JSON.parse(await fs.readFile(marketplacePath, "utf8"));
  const agentEntries = marketplace.plugins.filter((plugin) => plugin.name === "agent-canvas");
  assertEqual(agentEntries.length, 1, "personal plugin installer should keep one agent-canvas entry after repeated runs");
  assertEqual(agentEntries[0].source?.source, "local", "personal plugin entry should use a local source");
  assertEqual(agentEntries[0].source?.path, "./plugins/agent-canvas", "personal plugin entry should point at the deterministic link");
  assertEqual(agentEntries[0].policy?.installation, "AVAILABLE", "personal plugin entry should be installable");
  if (!marketplace.plugins.some((plugin) => plugin.name === "other-plugin")) {
    throw new Error("personal plugin installer should preserve existing marketplace plugins.");
  }

  const linkPath = path.join(tmp, "plugins", "agent-canvas");
  const linkedRealPath = await fs.realpath(linkPath);
  const repoRealPath = await fs.realpath(process.cwd());
  assertEqual(linkedRealPath, repoRealPath, "personal plugin link should resolve to this repository");
}

async function testCliCollectHelp() {
  const { stdout } = await execFileAsync(process.execPath, [path.join(process.cwd(), "bin", "agent-canvas.mjs"), "help"], {
    cwd: process.cwd(),
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  if (!stdout.includes("agent-canvas collect [--project <dir>] [--from <dir,dir>] [--since-minutes 120] [--limit 20]")) {
    throw new Error("CLI help should document collect flags.");
  }
  if (!stdout.includes("agent-canvas search [query] [--project <dir>] [--type image|text|drawing|job] [--limit 20] [--json]")) {
    throw new Error("CLI help should document search flags.");
  }
  if (!stdout.includes("agent-canvas prompts [query] [--project <dir>] [--limit 20] [--json]")) {
    throw new Error("CLI help should document prompt history flags.");
  }
  if (!stdout.includes("agent-canvas versions [query] [--project <dir>] [--group-by sourceObjectId|batchId|layoutMode|prompt] [--limit 20] [--object-limit 20] [--json]")) {
    throw new Error("CLI help should document version grouping flags.");
  }
  if (!stdout.includes("Import recent image files from ~/.codex/generated_images and the project.")) {
    throw new Error("CLI help should document collect default roots.");
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

async function testDoctorOptionalDepsWithoutPython() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-no-python-"));
  const emptyPath = path.join(tmp, "empty-path");
  await fs.mkdir(emptyPath);
  const env = {
    ...withoutPathEnv(process.env),
    PATH: emptyPath,
    AGENT_CANVAS_PROJECT_DIR: tmp
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
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-chat-turn-"));
  const fakeCodex = path.join(tmp, process.platform === "win32" ? "codex.cmd" : "codex");
  await fs.writeFile(fakeCodex, fakeCodexAppServerScript(), { mode: 0o755 });

  const previousCli = process.env.AGENT_CANVAS_CODEX_CLI;
  process.env.AGENT_CANVAS_CODEX_CLI = fakeCodex;
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

    const sent = await postJson(`${base}api/chat-turn${search}`, {
      action: "send-to-chat",
      objectId: image.body.id
    });
    assertEqual(sent.status, 200, "chat turn with stable action should succeed");
    assertEqual(sent.body.status, "completed", "chat turn should complete through fake app-server");
  } finally {
    process.env.AGENT_CANVAS_CODEX_CLI = previousCli;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testStoreConcurrency() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-store-"));
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
}

async function testChatBindingAlias() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-rebind-"));
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
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-chat-"));
  const fakeCodex = path.join(tmp, process.platform === "win32" ? "codex.cmd" : "codex");
  const imagePath = path.join(tmp, "image.png");
  await fs.writeFile(imagePath, Buffer.from(pngOne, "base64"));
  await fs.writeFile(fakeCodex, fakeCodexAppServerScript(), { mode: 0o755 });

  const previousCli = process.env.AGENT_CANVAS_CODEX_CLI;
  const previousWebSocket = globalThis.WebSocket;
  process.env.AGENT_CANVAS_CODEX_CLI = fakeCodex;
  globalThis.WebSocket = undefined;
  try {
    const result = await sendImageToBoundChat({
      projectDir: tmp,
      threadId: "thread-test",
      imagePath,
      prompt: "hello"
    });
    assertEqual(result.status, "completed", "fallback WebSocket chat turn should complete");
  } finally {
    process.env.AGENT_CANVAS_CODEX_CLI = previousCli;
    globalThis.WebSocket = previousWebSocket;
  }
}

async function testEditElementsScripts() {
  const deps = await checkImageProcessingDepsAvailable();
  if (!deps.available) {
    console.warn(`Skipping edit elements scripts smoke test; missing optional image dependencies: ${deps.missing?.join(", ") || "unknown"}.`);
    return;
  }

  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-elements-"));
  const makeImages = path.join(tmp, "make-images.py");
  await fs.writeFile(makeImages, [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "import sys",
    "root = Path(sys.argv[1])",
    "source = Image.new('RGBA', (48, 32), (255, 255, 255, 255))",
    "draw = ImageDraw.Draw(source)",
    "draw.rectangle((6, 6, 18, 20), fill=(255, 0, 0, 255))",
    "draw.rectangle((28, 8, 40, 22), fill=(0, 92, 255, 255))",
    "source.putpixel((0, 0), (255, 255, 255, 0))",
    "source.save(root / 'source.png')",
    "seg = Image.new('RGB', (48, 32), (0, 0, 0))",
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
    "--pad", "0",
    "--edge-feather", "0",
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
  assertEqual(manifest.backgroundLayer, true, "split_elements should record that a residual background layer was exported");
  const backgroundLayer = manifest.layers.find((layer) => layer.kind === "background");
  if (!backgroundLayer) throw new Error("split_elements should include a residual background layer.");
  assertEqual(backgroundLayer.bbox.join(","), "0,0,48,32", "residual background should keep full-frame bounds when uncovered pixels span the canvas");
  const objectLayers = manifest.layers.filter((layer) => layer.kind !== "background");
  const redLayer = objectLayers.find((layer) => layer.bbox.join(",") === "6,6,19,21");
  if (!redLayer) throw new Error("split_elements should merge nearby red segmentation colors into one object layer.");
  const blueLayer = objectLayers.find((layer) => layer.bbox.join(",") === "28,8,41,23");
  if (!blueLayer) throw new Error("split_elements should preserve the independent blue object layer.");
  for (const layer of manifest.layers) {
    await fs.access(layer.path);
  }
  if (!manifest.reconstruction?.reconstructionPath || manifest.reconstruction.coverageRatio < 0.99) {
    throw new Error("split_elements reconstruction output should cover the source image.");
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
  const previous = process.env.AGENT_CANVAS_TEST_HELPERS;
  process.env.AGENT_CANVAS_TEST_HELPERS = "1";
  try {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-elements-place-"));
    const outputDir = path.join(projectDir, "job-output");
    const elementsDir = path.join(outputDir, "elements");
    await fs.mkdir(elementsDir, { recursive: true });

    const backgroundPath = path.join(elementsDir, "element-01-background.png");
    const objectPath = path.join(elementsDir, "element-02-object.png");
    await fs.copyFile(path.join(tmp, "background.png"), backgroundPath);
    await fs.writeFile(objectPath, Buffer.from(pngOne, "base64"));

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
      sourceSize: { width: 96, height: 64 },
      backgroundCompleted: true,
      layers: [
        {
          index: 0,
          kind: "background",
          path: backgroundPath,
          bbox: [0, 0, 96, 64],
          areaPixels: 6144
        },
        {
          index: 2,
          kind: "object",
          path: objectPath,
          bbox: [10, 5, 30, 25],
          areaPixels: 400
        }
      ]
    }, null, 2)}\n`);

    await placeImportedElementLayersForTest(projectDir, {
      id: "placement-contract",
      canvasId: null,
      outputDir,
      sourceObjectId: source.id,
      placeholder,
      placeholderId: placeholder.id,
      imported: [topLayer, bottomLayer]
    });

    const state = await readState(projectDir);
    if (state.objects.some((object) => object.id === placeholder.id)) {
      throw new Error("Edit Elements placement should delete the job placeholder.");
    }
    const groupMembers = state.objects.filter((object) => object.layerGroupId === "layer_group_placement-contract");
    assertEqual(groupMembers.length, 2, "Edit Elements placement should assign every imported layer to one group");
    assertEqual(groupMembers[0].layerGroupKind, "background", "Edit Elements layer stack should place the background first");
    assertEqual(groupMembers[1].layerGroupKind, "object", "Edit Elements layer stack should place object layers above the background");
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
      assertEqual(member.layerGroupLocked, true, "Edit Elements grouped layers should start locked");
      assertEqual(member.layerGroupSourceObjectId, source.id, "Edit Elements group metadata should retain source object id");
      assertEqual(member.layerGroupOriginalX, 300, "Edit Elements group metadata should retain original placeholder x");
      assertEqual(member.layerGroupOriginalY, 200, "Edit Elements group metadata should retain original placeholder y");
      assertEqual(member.layerGroupOriginalWidth, 192, "Edit Elements group metadata should retain original placeholder width");
      assertEqual(member.layerGroupOriginalHeight, 128, "Edit Elements group metadata should retain original placeholder height");
    }
  } finally {
    if (previous === undefined) delete process.env.AGENT_CANVAS_TEST_HELPERS;
    else process.env.AGENT_CANVAS_TEST_HELPERS = previous;
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
  const result = await execFileAsync(process.execPath, [path.join(process.cwd(), "bin", "agent-canvas.mjs"), ...args], {
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
  let body = {};
  try {
    body = JSON.parse(result.stdout.trim() || "{}");
  } catch (error) {
    throw new Error(`CLI did not print JSON for ${args.join(" ")}. stdout=${result.stdout.trim()} stderr=${result.stderr.trim()}`);
  }
  return { status: result.status, body };
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsidePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function startMcpServer() {
  const child = spawn(process.execPath, [path.join(process.cwd(), "src", "mcp-server.mjs")], {
    cwd: process.cwd(),
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
      if (message.error) request.reject(new Error(message.error.message || "MCP request failed"));
      else request.resolve(message.result);
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

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

async function assertRejects(fn, expectedMessage, message) {
  try {
    await fn();
  } catch (error) {
    if (!String(error?.message || "").includes(expectedMessage)) {
      throw new Error(`${message}. Expected rejection containing ${JSON.stringify(expectedMessage)}, got ${JSON.stringify(error?.message || String(error))}.`);
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
