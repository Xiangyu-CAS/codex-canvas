#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = path.resolve(rootDir, options.outputDir);
  const packageJson = await readJson(path.join(rootDir, "package.json"));
  const packageLock = await readJson(path.join(rootDir, "package-lock.json"));
  const pluginJson = await readJson(path.join(rootDir, ".codex-plugin", "plugin.json"));

  validateReleaseMetadata({ packageJson, packageLock, pluginJson });
  if (!options.allowDirty) await requireCleanWorkingTree();

  const version = packageJson.version;
  const tag = process.env.RELEASE_TAG || `v${version}`;
  const expectedTag = `v${version}`;
  if (tag !== expectedTag) {
    throw new Error(`Release tag ${JSON.stringify(tag)} does not match package version ${JSON.stringify(expectedTag)}.`);
  }
  if (process.env.RELEASE_VERSION && process.env.RELEASE_VERSION !== version) {
    throw new Error(`RELEASE_VERSION ${JSON.stringify(process.env.RELEASE_VERSION)} does not match package version ${JSON.stringify(version)}.`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  const packed = await npmPack(outputDir);
  validatePackedFiles(packed.files);

  const archiveName = `${packageJson.name}-${tag}.tgz`;
  const archivePath = path.join(outputDir, archiveName);
  const packedPath = path.join(outputDir, packed.filename);
  if (path.resolve(packedPath) !== path.resolve(archivePath)) {
    await fs.rm(archivePath, { force: true });
    await fs.rename(packedPath, archivePath);
  }

  const archive = await fileDigest(archivePath);
  const manifest = {
    schemaVersion: 1,
    name: packageJson.name,
    version,
    tag,
    channel: "stable",
    commit: await releaseCommit(),
    publishedAt: releaseTimestamp(),
    artifacts: {
      universal: {
        file: archiveName,
        format: "tgz",
        platform: "universal",
        size: archive.size,
        sha256: archive.sha256
      }
    },
    requirements: {
      node: packageJson.engines?.node || null
    }
  };

  const manifestName = "release-manifest.json";
  const manifestPath = path.join(outputDir, manifestName);
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const manifestDigest = await fileDigest(manifestPath);
  const checksums = [
    `${archive.sha256}  ${archiveName}`,
    `${manifestDigest.sha256}  ${manifestName}`
  ];
  await fs.writeFile(path.join(outputDir, "SHA256SUMS"), `${checksums.join("\n")}\n`);

  console.log(JSON.stringify({
    ok: true,
    outputDir,
    version,
    tag,
    files: [archiveName, manifestName, "SHA256SUMS"]
  }, null, 2));
}

function parseArgs(args) {
  let outputDir = "dist/release";
  let allowDirty = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output-dir") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output-dir requires a path.");
      }
      outputDir = value;
      index += 1;
      continue;
    }
    if (arg === "--allow-dirty") {
      allowDirty = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/build-release.mjs [--output-dir <path>] [--allow-dirty]");
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { outputDir, allowDirty };
}

async function requireCleanWorkingTree() {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  if (stdout.trim()) {
    throw new Error("Release packages must be built from a clean Git checkout. Commit or remove local changes first.");
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function validateReleaseMetadata({ packageJson, packageLock, pluginJson }) {
  if (!packageJson.name || !packageJson.version) {
    throw new Error("package.json must contain name and version fields.");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(packageJson.version)) {
    throw new Error(`Package version is not a release SemVer: ${JSON.stringify(packageJson.version)}.`);
  }
  if (pluginJson.name !== packageJson.name) {
    throw new Error(`Plugin name ${JSON.stringify(pluginJson.name)} does not match package name ${JSON.stringify(packageJson.name)}.`);
  }
  if (pluginJson.version !== packageJson.version) {
    throw new Error(`Plugin version ${JSON.stringify(pluginJson.version)} does not match package version ${JSON.stringify(packageJson.version)}.`);
  }
  if (packageLock.name !== packageJson.name || packageLock.packages?.[""]?.name !== packageJson.name) {
    throw new Error("package-lock.json root package name does not match package.json.");
  }
  if (packageLock.version !== packageJson.version || packageLock.packages?.[""]?.version !== packageJson.version) {
    throw new Error("package-lock.json root version does not match package.json.");
  }
}

async function npmPack(outputDir) {
  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  const preview = await runNpmPack(npmExecutable, ["pack", "--dry-run", "--json"], rootDir);
  const stageDir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-canvas-release-stage-"));
  try {
    for (const entry of preview.files || []) {
      const relativePath = String(entry.path || "");
      if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
        throw new Error(`npm pack returned an unsafe package path: ${JSON.stringify(relativePath)}.`);
      }
      const sourcePath = path.join(rootDir, relativePath);
      const targetPath = path.join(stageDir, relativePath);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.copyFile(sourcePath, targetPath);
    }
    await sanitizeReleasePackageJson(stageDir);
    return await runNpmPack(
      npmExecutable,
      ["pack", "--json", "--pack-destination", outputDir],
      stageDir
    );
  } finally {
    await fs.rm(stageDir, { recursive: true, force: true });
  }
}

async function runNpmPack(npmExecutable, args, cwd) {
  const { stdout } = await runPortableCommand(npmExecutable, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result) || result.length !== 1 || !result[0]?.filename) {
    throw new Error("npm pack did not return exactly one package.");
  }
  return result[0];
}

async function sanitizeReleasePackageJson(stageDir) {
  const packagePath = path.join(stageDir, "package.json");
  const packageJson = await readJson(packagePath);
  for (const script of [
    "install:dev-cache",
    "smoke",
    "smoke:visual",
    "visual:regression",
    "verify:release",
    "verify:archive",
    "build:release",
    "test"
  ]) {
    delete packageJson.scripts?.[script];
  }
  await fs.writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
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
      const result = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString()
      };
      if (code === 0) {
        resolve(result);
      } else {
        reject(Object.assign(
          new Error(`${command} failed with ${signal || `exit code ${code}`}.`),
          result,
          { code, signal }
        ));
      }
    });
  });
}

function validatePackedFiles(files) {
  const names = new Set((files || []).map((entry) => entry.path));
  for (const required of [
    "package.json",
    ".codex-plugin/plugin.json",
    ".mcp.json",
    "bin/codex-canvas.mjs",
    "public/app.js",
    "public/canvas-history.js",
    "public/index.html",
    "public/styles.css",
    "scripts/checkout-stable-release.mjs",
    "skills/canvas/SKILL.md",
    "src/cli.mjs",
    "src/mcp-server.mjs",
    "src/operation-leases.mjs",
    "src/server.mjs",
    "src/updater.mjs",
    "src/version.mjs"
  ]) {
    if (!names.has(required)) {
      throw new Error(`Release archive is missing required file: ${required}`);
    }
  }

  const forbiddenPaths = [
    ".github/",
    "assets/original/",
    "assets/readme/",
    "docs/",
    "scripts/reference-screenshots/",
    "scripts/smoke.mjs",
    "scripts/visual-regression.mjs",
    "scripts/visual-smoke.mjs"
  ];
  const forbidden = [...names].filter((name) => forbiddenPaths.some((candidate) => (
    candidate.endsWith("/") ? name.startsWith(candidate) : name === candidate
  )));
  if (forbidden.length > 0) {
    throw new Error(`Release archive contains development-only files: ${forbidden.join(", ")}`);
  }
}

async function fileDigest(filePath) {
  const contents = await fs.readFile(filePath);
  return {
    size: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

async function releaseCommit() {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: rootDir,
    encoding: "utf8"
  });
  const head = stdout.trim();
  const configured = process.env.RELEASE_COMMIT?.trim();
  if (configured && configured !== head) {
    throw new Error(`RELEASE_COMMIT ${JSON.stringify(configured)} does not match checked-out commit ${JSON.stringify(head)}.`);
  }
  return head;
}

function releaseTimestamp() {
  const value = process.env.RELEASE_PUBLISHED_AT || new Date().toISOString();
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf())) {
    throw new Error(`Invalid RELEASE_PUBLISHED_AT value: ${JSON.stringify(value)}.`);
  }
  return timestamp.toISOString();
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
