import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const homeDir = path.resolve(options.home || process.env.AGENT_CANVAS_PERSONAL_HOME || os.homedir());
  const manifest = JSON.parse(await fs.readFile(path.join(rootDir, ".codex-plugin", "plugin.json"), "utf8"));
  const pluginName = manifest.name || "agent-canvas";
  const pluginVersion = manifest.version;

  if (!pluginVersion) {
    throw new Error("Plugin manifest must include a version before linking the Codex cache.");
  }

  const cachePath = path.join(homeDir, ".codex", "plugins", "cache", "personal", pluginName, pluginVersion);
  const result = await linkCacheToSource({
    cachePath,
    rootDir,
    dryRun: options.dryRun
  });

  const payload = {
    ok: true,
    dryRun: options.dryRun,
    plugin: pluginName,
    version: pluginVersion,
    pluginRoot: rootDir,
    cachePath,
    ...result
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (result.alreadyLinked) {
    console.log(`Codex plugin cache already points at ${rootDir}`);
  } else {
    if (result.backupPath) {
      console.log(`Backed up existing plugin cache to ${result.backupPath}`);
    }
    console.log(`Linked Codex plugin cache: ${cachePath} -> ${rootDir}`);
  }
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    json: false,
    home: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--home") {
      options.home = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--home=")) {
      options.home = arg.slice("--home=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function linkCacheToSource({ cachePath, rootDir, dryRun }) {
  await fs.mkdir(path.dirname(cachePath), { recursive: true });

  const existingLinkTarget = await readExistingLink(cachePath);
  if (existingLinkTarget && await pathsReferToSameEntry(existingLinkTarget, rootDir)) {
    return { alreadyLinked: true, backupPath: null };
  }

  let backupPath = null;
  if (await pathExists(cachePath)) {
    if (existingLinkTarget) {
      if (!dryRun) await fs.rm(cachePath, { force: true, recursive: true });
    } else {
      backupPath = await nextBackupPath(cachePath);
      if (!dryRun) await fs.rename(cachePath, backupPath);
    }
  }

  if (!dryRun) {
    await fs.symlink(rootDir, cachePath, process.platform === "win32" ? "junction" : "dir");
  }

  return { alreadyLinked: false, backupPath };
}

async function readExistingLink(linkPath) {
  try {
    const stat = await fs.lstat(linkPath);
    if (!stat.isSymbolicLink()) return null;
    return path.resolve(path.dirname(linkPath), await fs.readlink(linkPath));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
    throw error;
  }
}

async function nextBackupPath(cachePath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt}`;
    const candidate = `${cachePath}.backup-${timestamp}${suffix}`;
    if (!await pathExists(candidate)) return candidate;
  }
  throw new Error(`Could not choose a backup path for ${cachePath}`);
}

async function pathsReferToSameEntry(firstPath, secondPath) {
  try {
    const firstRealPath = await fs.realpath(firstPath);
    const secondRealPath = await fs.realpath(secondPath);
    return normalizeComparablePath(firstRealPath) === normalizeComparablePath(secondRealPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return normalizeComparablePath(path.resolve(firstPath)) === normalizeComparablePath(path.resolve(secondPath));
    }
    throw error;
  }
}

function normalizeComparablePath(filePath) {
  const normalized = path.normalize(filePath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
