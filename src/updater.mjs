import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pluginRoot } from "./paths.mjs";

const execFileAsync = promisify(execFile);

export async function appUpdateStatus({ checkRemote = false, rootDir = pluginRoot } = {}) {
  const packageInfo = await readPackageInfo(rootDir);
  const git = await gitStatus({ checkRemote, rootDir });
  const blockedReason = updateBlockedReason(git);
  const canUpdate = !blockedReason;
  return {
    name: packageInfo.name,
    version: packageInfo.version,
    pluginVersion: packageInfo.pluginVersion,
    repository: packageInfo.repository,
    installKind: installKindFor(rootDir, git),
    source: git.available ? "git" : "package",
    strategy: canUpdate ? "git-fast-forward" : "manual",
    canUpdate,
    updateAvailable: git.behind > 0,
    blockedReason,
    blockedMessage: blockedReason ? blockedMessageFor(blockedReason, git) : null,
    manualCommand: manualCommandFor({ rootDir, git, repository: packageInfo.repository, blockedReason }),
    git
  };
}

export async function updateApp({ rootDir = pluginRoot } = {}) {
  const before = await appUpdateStatus({ checkRemote: true, rootDir });
  if (!before.canUpdate) {
    const error = new Error(before.blockedMessage || "Codex-Canvas cannot be updated automatically from this install.");
    error.statusCode = 409;
    error.code = before.blockedReason || "update-unavailable";
    error.details = before;
    throw error;
  }

  if (!before.updateAvailable) {
    return {
      ...before,
      updated: false,
      output: "Codex-Canvas is already up to date."
    };
  }

  const pullArgs = before.git.upstreamConfigured
    ? ["pull", "--ff-only"]
    : ["pull", "--ff-only", before.git.remote, before.git.remoteBranch];
  const pulled = await runGit(pullArgs, { rootDir, timeoutMs: 30000 });
  const after = await appUpdateStatus({ checkRemote: false, rootDir });
  return {
    ...after,
    updated: true,
    previousVersion: before.version,
    previousHead: before.git.head,
    output: pulled.stdout.trim() || pulled.stderr.trim()
  };
}

async function readPackageInfo(rootDir) {
  const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
  let pluginVersion = null;
  let pluginRepository = null;
  try {
    const pluginJson = JSON.parse(await fs.readFile(path.join(rootDir, ".codex-plugin", "plugin.json"), "utf8"));
    pluginVersion = pluginJson.version || null;
    pluginRepository = pluginJson.repository || pluginJson.homepage || null;
  } catch {
    pluginVersion = null;
  }
  return {
    name: packageJson.name || "codex-canvas",
    version: packageJson.version || "0.0.0",
    pluginVersion,
    repository: repositoryUrl(packageJson.repository) || pluginRepository
  };
}

async function gitStatus({ checkRemote, rootDir }) {
  const base = {
    available: false,
    root: null,
    branch: null,
    detached: false,
    upstream: null,
    upstreamConfigured: false,
    remote: null,
    remoteUrl: null,
    remoteBranch: null,
    head: null,
    dirty: false,
    ahead: 0,
    behind: 0,
    error: null
  };

  try {
    const root = (await runGit(["rev-parse", "--show-toplevel"], { rootDir })).stdout.trim();
    const branch = await optionalGit(["symbolic-ref", "--quiet", "--short", "HEAD"], { rootDir });
    const head = (await runGit(["rev-parse", "--short", "HEAD"], { rootDir })).stdout.trim();
    const status = (await runGit(["status", "--porcelain"], { rootDir })).stdout.trim();
    const configuredUpstream = await optionalGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { rootDir });
    const remote = await updateRemoteFor({ rootDir, branch, configuredUpstream });
    const remoteUrl = remote ? await optionalGit(["config", "--get", `remote.${remote}.url`], { rootDir }) : "";

    if (checkRemote && remote) {
      await optionalGit(["fetch", "--quiet", remote], { rootDir, timeoutMs: 15000 });
    }

    const fallbackRemoteBranch = !configuredUpstream && branch && remote
      ? await existingRemoteBranch({ rootDir, remote, branch })
      : null;
    const upstream = configuredUpstream || fallbackRemoteBranch;
    const counts = upstream ? await optionalGit(["rev-list", "--left-right", "--count", `HEAD...${upstream}`], { rootDir }) : "";
    const [aheadText, behindText] = counts.split(/\s+/);
    return {
      ...base,
      available: true,
      root,
      branch: branch || null,
      detached: !branch,
      upstream: upstream || null,
      upstreamConfigured: Boolean(configuredUpstream),
      remote,
      remoteUrl: remoteUrl || null,
      remoteBranch: remoteBranchName(upstream, remote),
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

async function runGit(args, { rootDir = pluginRoot, timeoutMs = 5000 } = {}) {
  return execFileAsync("git", ["-C", rootDir, ...args], {
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024
  });
}

async function updateRemoteFor({ rootDir, branch, configuredUpstream }) {
  if (configuredUpstream?.includes("/")) return configuredUpstream.split("/")[0];
  if (branch) {
    const configuredRemote = await optionalGit(["config", "--get", `branch.${branch}.remote`], { rootDir });
    if (configuredRemote && configuredRemote !== ".") return configuredRemote;
  }
  const originUrl = await optionalGit(["config", "--get", "remote.origin.url"], { rootDir });
  return originUrl ? "origin" : null;
}

async function existingRemoteBranch({ rootDir, remote, branch }) {
  const candidate = `${remote}/${branch}`;
  const ref = await optionalGit(["rev-parse", "--verify", "--quiet", `refs/remotes/${candidate}`], { rootDir });
  return ref ? candidate : null;
}

function remoteBranchName(upstream, remote) {
  if (!upstream || !remote) return null;
  const prefix = `${remote}/`;
  return upstream.startsWith(prefix) ? upstream.slice(prefix.length) : null;
}

function updateBlockedReason(git) {
  if (!git.available) return "not-git";
  if (git.detached) return "detached-head";
  if (git.dirty) return "dirty-worktree";
  if (!git.remote || !git.remoteBranch) return "no-upstream";
  if (git.ahead > 0) return "local-ahead";
  return null;
}

function blockedMessageFor(reason, git) {
  const messages = {
    "not-git": "Codex-Canvas is not running from a git checkout, so automatic update is unavailable.",
    "detached-head": "Codex-Canvas is running from a detached git HEAD; switch to a branch before updating.",
    "dirty-worktree": "Codex-Canvas has local changes; commit or stash them before updating.",
    "no-upstream": "Current git branch has no remote branch to fast-forward from.",
    "local-ahead": "Current git branch has local commits; resolve or push them before using automatic update."
  };
  if (reason === "local-ahead" && git.behind > 0) {
    return "Current git branch has diverged from its remote branch; resolve it manually before using automatic update.";
  }
  return messages[reason] || "Codex-Canvas cannot be updated automatically from this install.";
}

function manualCommandFor({ rootDir, git, repository, blockedReason }) {
  if (git.available && git.remote && git.remoteBranch && !blockedReason) {
    return git.upstreamConfigured
      ? `git -C ${quoteShell(rootDir)} pull --ff-only`
      : `git -C ${quoteShell(rootDir)} pull --ff-only ${quoteShell(git.remote)} ${quoteShell(git.remoteBranch)}`;
  }
  if (blockedReason === "dirty-worktree" || blockedReason === "local-ahead") {
    return `git -C ${quoteShell(rootDir)} status --short --branch`;
  }
  if (repository) {
    return `git clone ${quoteShell(repository)} codex-canvas`;
  }
  return null;
}

function installKindFor(rootDir, git) {
  const normalized = path.normalize(rootDir);
  if (git.available) return "git-checkout";
  if (normalized.includes(path.join(".codex", "plugins", "cache"))) return "codex-cache";
  if (normalized.includes(`node_modules${path.sep}`)) return "package";
  return "package";
}

function repositoryUrl(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.url === "string") return value.url;
  return null;
}

function quoteShell(value) {
  const text = String(value);
  if (/^[a-zA-Z0-9_./:@-]+$/.test(text)) return text;
  return `'${text.replaceAll("'", "'\\''")}'`;
}
