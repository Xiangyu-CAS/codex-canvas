#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
  for (const sourceOnlyScript of ["install:dev-cache", "smoke", "smoke:visual", "visual:regression", "verify:release", "verify:archive", "build:release", "test"]) {
    if (installedPackage.scripts?.[sourceOnlyScript]) {
      throw new Error(`Installed release archive exposes source-only npm script: ${sourceOnlyScript}`);
    }
  }
  await Promise.all([
    fs.access(path.join(pluginRoot, "public", "app.js")),
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
  console.log(`Release archive installed and started successfully: ${path.basename(archivePath)}`);
} finally {
  await fs.rm(installRoot, { recursive: true, force: true });
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
