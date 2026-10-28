#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import { createMcpClient } from "./mcp-app-client.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const archivePath = path.resolve(
  rootDir,
  process.argv[2] || path.join("dist", "release", `${packageJson.name}-v${packageJson.version}.tgz`)
);
const installRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-release-install-"));

try {
  await runPortableCommand(npmExecutable(), [
    "install",
    "--prefix",
    installRoot,
    "--omit=dev",
    "--ignore-scripts",
    archivePath
  ], { cwd: rootDir });

  const pluginRoot = path.join(installRoot, "node_modules", packageJson.name);
  const installedPackage = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"));
  const installedPlugin = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  if (installedPackage.version !== packageJson.version || installedPlugin.version !== packageJson.version) {
    throw new Error("Installed release archive version does not match package.json.");
  }
  for (const sourceOnlyScript of ["install:dev-cache", "smoke", "smoke:visual", "visual:regression", "verify:release", "verify:archive", "build:release", "test", "test:python", "test:edit-text"]) {
    if (installedPackage.scripts?.[sourceOnlyScript]) {
      throw new Error(`Installed release archive exposes source-only npm script: ${sourceOnlyScript}`);
    }
  }
  await Promise.all([
    fs.access(path.join(pluginRoot, "public", "app.js")),
    fs.access(path.join(pluginRoot, "public", "canvas-app.html")),
    fs.access(path.join(pluginRoot, "public", "canvas-transport.js")),
    fs.access(path.join(pluginRoot, "public", "canvas-history.js")),
    fs.access(path.join(pluginRoot, "src", "operation-leases.mjs")),
    fs.access(path.join(pluginRoot, "src", "updater.mjs")),
    fs.access(path.join(pluginRoot, "skills", "canvas", "SKILL.md"))
  ]);
  const { stdout } = await execFileAsync(process.execPath, [path.join(pluginRoot, "bin", "codex-canvas.mjs"), "help"], {
    cwd: pluginRoot,
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
  if (!stdout.includes("Codex-Canvas") || !stdout.includes("update")) {
    throw new Error("Installed release archive CLI smoke check returned unexpected output.");
  }
  await verifyInstalledImageCollection(pluginRoot, installRoot);
  console.log(`Release archive installed and started successfully: ${path.basename(archivePath)}`);
} finally {
  await fs.rm(installRoot, { recursive: true, force: true });
}

async function verifyInstalledImageCollection(pluginRoot, installRoot) {
  const projectDir = path.join(installRoot, "synthetic-project");
  const generatedRoot = path.join(installRoot, "synthetic-generated");
  const threadId = "release-test-thread";
  const generatedDir = path.join(generatedRoot, threadId);
  await fs.mkdir(projectDir, { recursive: true });
  await fs.mkdir(generatedDir, { recursive: true });
  const client = createMcpClient(pathToFileURL(`${pluginRoot}${path.sep}`), {
    env: { CODEX_CANVAS_GENERATED_IMAGES_ROOT: generatedRoot }
  });
  const call = (name, args) => client.request("tools/call", { name, arguments: args });
  try {
    const opened = await call("open_canvas", { projectDir, threadId });
    const sessionId = opened._meta.canvasSession.sessionId;
    const request = async (route) => (await call("canvas_app_request", { sessionId, path: route })).structuredContent;
    const state = async () => (await request("/api/state")).body;
    const legacy = new PNG({ width: 32, height: 24 });
    legacy.data.fill(128);
    const legacyBytes = PNG.sync.write(legacy);
    const legacyPath = path.join(generatedDir, "legacy.png");
    await fs.writeFile(legacyPath, legacyBytes.subarray(0, 33));
    const oldObject = (await call("add_image", { projectDir, threadId, path: legacyPath, layoutMode: "session-column" })).structuredContent;
    await fs.writeFile(legacyPath, legacyBytes);
    const restored = await waitFor(async () => (await state()).objects.find(object => object.id === oldObject.id && object.assetVersion > 0), "repair of an existing truncated image");
    const restoredAsset = await request(`/api/app-assets/${encodeURIComponent(restored.id)}`);
    if (restoredAsset.encoding !== "base64" || !Buffer.from(restoredAsset.body, "base64").equals(legacyBytes)) {
      throw new Error("Installed package did not restore the original image bytes.");
    }

    const generated = new PNG({ width: 40, height: 30 });
    generated.data.fill(64);
    const bytes = PNG.sync.write(generated);
    const source = path.join(generatedDir, "new.png");
    await fs.writeFile(source, bytes.subarray(0, 33));
    await new Promise(resolve => setTimeout(resolve, 900));
    if ((await state()).objects.some(object => object.sourcePath === source)) {
      throw new Error("Installed package imported an incomplete PNG.");
    }
    await fs.writeFile(source, bytes);
    const image = await waitFor(async () => (await state()).objects.find(object => object.sourcePath === source), "automatic image collection");
    const asset = await request(`/api/app-assets/${encodeURIComponent(image.id)}`);
    if (asset.encoding !== "base64" || !Buffer.from(asset.body, "base64").equals(bytes)) {
      throw new Error("Installed package did not serve the complete collected image.");
    }
  } finally {
    await client.close();
  }
}

async function waitFor(check, description) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

async function runPortableCommand(command, args, options = {}) {
  if (!(process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command))) {
    return execFileAsync(command, args, options);
  }
  const child = spawn(command, args, {
    ...options,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = { stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() };
      if (code === 0) resolve(result);
      else reject(Object.assign(new Error(`${command} failed with ${signal || `exit code ${code}`}.`), result, { code, signal }));
    });
  });
}
