import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pluginRoot } from "./paths.mjs";

const execFileAsync = promisify(execFile);

export async function appUpdateStatus({ checkRemote = false } = {}) {
  const packageInfo = await readPackageInfo();
  const git = await gitStatus({ checkRemote });
  return {
    name: packageInfo.name,
    version: packageInfo.version,
    pluginVersion: packageInfo.pluginVersion,
    source: git.available ? "git" : "package",
    canUpdate: git.available && Boolean(git.upstream),
    updateAvailable: git.behind > 0,
    git
  };
}

export async function updateApp() {
  const before = await appUpdateStatus({ checkRemote: true });
  if (!before.git.available) {
    const error = new Error("Codex-Canvas is not installed from a git checkout, so in-app git update is unavailable.");
    error.statusCode = 409;
    throw error;
  }
  if (!before.git.upstream) {
    const error = new Error("Current git branch has no upstream; configure an upstream or update manually.");
    error.statusCode = 409;
    throw error;
  }
  if (before.git.dirty) {
    const error = new Error("Working tree has local changes; commit or stash them before updating.");
    error.statusCode = 409;
    throw error;
  }

  const pulled = await runGit(["pull", "--ff-only"], { timeoutMs: 30000 });
  const after = await appUpdateStatus({ checkRemote: false });
  return {
    ...after,
    updated: true,
    previousVersion: before.version,
    previousHead: before.git.head,
    output: pulled.stdout.trim() || pulled.stderr.trim()
  };
}

async function readPackageInfo() {
  const packageJson = JSON.parse(await fs.readFile(path.join(pluginRoot, "package.json"), "utf8"));
  let pluginVersion = null;
  try {
    const pluginJson = JSON.parse(await fs.readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
    pluginVersion = pluginJson.version || null;
  } catch {
    pluginVersion = null;
  }
  return {
    name: packageJson.name || "codex-canvas",
    version: packageJson.version || "0.0.0",
    pluginVersion
  };
}

async function gitStatus({ checkRemote }) {
  const base = {
    available: false,
    root: null,
    branch: null,
    upstream: null,
    head: null,
    dirty: false,
    ahead: 0,
    behind: 0,
    error: null
  };

  try {
    const root = (await runGit(["rev-parse", "--show-toplevel"])).stdout.trim();
    const branch = (await runGit(["rev-parse", "--abbrev-ref", "HEAD"])).stdout.trim();
    const head = (await runGit(["rev-parse", "--short", "HEAD"])).stdout.trim();
    const status = (await runGit(["status", "--porcelain"])).stdout.trim();
    const upstream = await optionalGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);

    if (checkRemote && upstream) {
      await optionalGit(["fetch", "--quiet"], { timeoutMs: 15000 });
    }

    const counts = upstream ? await optionalGit(["rev-list", "--left-right", "--count", "HEAD...@{u}"]) : "";
    const [aheadText, behindText] = counts.split(/\s+/);
    return {
      ...base,
      available: true,
      root,
      branch,
      upstream: upstream || null,
      head,
      dirty: Boolean(status),
      ahead: Number(aheadText) || 0,
      behind: Number(behindText) || 0
    };
  } catch (error) {
    return {
      ...base,
      error: error?.message || String(error)
    };
  }
}

async function optionalGit(args, options = {}) {
  try {
    return (await runGit(args, options)).stdout.trim();
  } catch {
    return "";
  }
}

async function runGit(args, { timeoutMs = 5000 } = {}) {
  return execFileAsync("git", ["-C", pluginRoot, ...args], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024
  });
}
