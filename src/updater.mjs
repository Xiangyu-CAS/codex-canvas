import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveCodexExecutable, spawnCodexProcess, stopCodexProcess } from "./codex-runner.mjs";
import { fetchTextResponse } from "./http-text-response.mjs";
import { activeOperationLeases, removeStaleUpdateLock, updateLockPath } from "./operation-leases.mjs";
import { pluginRoot } from "./paths.mjs";

const execFileAsync = promisify(execFile);
const stableReleaseTag = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;
const publishedReleaseCache = new Map();
const publishedReleaseCacheMs = 5 * 60_000;
const pendingReleaseCacheMs = 30_000;
const githubReleaseTimeoutMs = 15_000;
const gitFetchTimeoutMs = 10_000;
let activeUpdate = null;

export function clearPublishedReleaseCacheForTest() {
  publishedReleaseCache.clear();
}

export async function appUpdateStatus({
  checkRemote = false,
  rootDir = pluginRoot,
  sourceRoot = null,
  discoverInstall = true,
  releaseProvider = githubReleaseProvider,
  releaseCheckTimeoutMs = githubReleaseTimeoutMs
} = {}) {
  const runtimeRoot = path.resolve(rootDir);
  const runtimeInfo = await readPackageInfo(runtimeRoot);
  const installKindHint = installKindFor(runtimeRoot);
  const shouldDiscoverInstall = discoverInstall && (
    installKindHint === "codex-cache"
    || samePath(runtimeRoot, pluginRoot)
  );
  const install = shouldDiscoverInstall
    ? await discoverInstalledPlugin(runtimeInfo.name, runtimeInfo.pluginVersion || runtimeInfo.version)
    : null;
  const resolvedSourceRoot = await realpathOrSelf(sourceRoot || install?.sourcePath || runtimeRoot);
  const sourceInfo = samePath(resolvedSourceRoot, runtimeRoot)
    ? runtimeInfo
    : await readPackageInfo(resolvedSourceRoot).catch(() => null);
  const git = sourceInfo
    ? await gitStatus({ checkRemote, rootDir: resolvedSourceRoot })
    : emptyGitStatus("Configured plugin source does not contain a readable package.json.");
  const installKind = installKindHint === "git-checkout" && !git.available
    ? "package"
    : installKindHint;
  let publishedRelease = null;
  let releaseError = null;
  if (git.available) {
    try {
      publishedRelease = await releaseProvider({
        repository: sourceInfo?.repository || runtimeInfo.repository,
        checkRemote,
        timeoutMs: releaseCheckTimeoutMs
      });
    } catch (error) {
      releaseError = conciseProcessError(error);
    }
  }
  const release = git.available && publishedRelease
    ? await publishedStableRelease({ git, rootDir: resolvedSourceRoot, publishedRelease })
    : null;
  const installedVersion = normalizeVersion(install?.version || runtimeInfo.pluginVersion || runtimeInfo.version);
  const sourceVersion = normalizeVersion(sourceInfo?.pluginVersion || sourceInfo?.version);
  const updateAvailable = Boolean(release && compareVersions(release.version, installedVersion) > 0);
  const releaseRelation = updateAvailable && release
    ? await releaseRelationFor({ git, release, rootDir: resolvedSourceRoot })
    : null;
  const blockedReason = updateBlockedReason({
    git,
    install,
    installKind,
    release,
    releaseError,
    releaseRelation,
    sourceInfo
  });
  const canUpdate = !blockedReason;

  return {
    name: runtimeInfo.name,
    version: runtimeInfo.version,
    pluginVersion: runtimeInfo.pluginVersion,
    installedVersion,
    sourceVersion,
    latestVersion: release?.version || null,
    releaseTag: release?.tag || null,
    releaseCommit: release?.commit || null,
    releaseUrl: release?.url || null,
    repository: runtimeInfo.repository,
    installKind,
    source: git.available ? "git-release" : "package",
    strategy: canUpdate ? "git-release-fast-forward" : "manual",
    canUpdate,
    updateAvailable,
    restartRequired: false,
    blockedReason,
    blockedMessage: blockedReason
      ? blockedMessageFor(blockedReason, { git, release, releaseError, releaseRelation })
      : null,
    manualCommand: manualCommandFor({
      sourceRoot: resolvedSourceRoot,
      git,
      install,
      repository: runtimeInfo.repository,
      release,
      blockedReason
    }),
    install: install ? {
      marketplaceName: install.marketplaceName,
      version: install.version,
      sourcePath: install.sourcePath,
      error: install.error || null
    } : null,
    sourceRoot: resolvedSourceRoot,
    releaseRelation,
    releaseError,
    git
  };
}

export async function updateApp(options = {}) {
  if (activeUpdate) return activeUpdate;
  activeUpdate = performUpdate(options).finally(() => {
    activeUpdate = null;
  });
  return activeUpdate;
}

async function performUpdate({
  rootDir = pluginRoot,
  sourceRoot = null,
  discoverInstall = true,
  releaseProvider = githubReleaseProvider,
  releaseCheckTimeoutMs = githubReleaseTimeoutMs
} = {}) {
  const before = await appUpdateStatus({
    checkRemote: true,
    rootDir,
    sourceRoot,
    discoverInstall,
    releaseProvider,
    releaseCheckTimeoutMs
  });
  if (!before.canUpdate) throw updateError(before);

  if (!before.updateAvailable) {
    return {
      ...before,
      updated: false,
      output: before.latestVersion
        ? `Codex-Canvas ${before.installedVersion} is the latest published release.`
        : "Codex-Canvas has no published release yet."
    };
  }

  if (!before.releaseTag || !before.releaseCommit) {
    throw updateError({
      ...before,
      blockedReason: "no-release",
      blockedMessage: "No stable Codex-Canvas release is available."
    });
  }

  const updateLock = await acquireCrossProcessUpdateLock(before.sourceRoot);
  try {
    const output = [];
    if (before.releaseRelation === "fast-forward") {
      const merged = await runGit(
        ["merge", "--ff-only", `refs/tags/${before.releaseTag}`],
        { rootDir: before.sourceRoot, timeoutMs: 30000 }
      );
      output.push(merged.stdout.trim() || merged.stderr.trim() || `Fast-forwarded to ${before.releaseTag}.`);
    } else if (before.releaseRelation !== "at-release") {
      throw updateError({
        ...before,
        blockedReason: "release-not-fast-forward",
        blockedMessage: "The plugin source cannot fast-forward safely to the published release."
      });
    }

    const releasedInfo = await readPackageInfo(before.sourceRoot);
    const releasedVersion = normalizeVersion(releasedInfo.pluginVersion || releasedInfo.version);
    if (releasedVersion !== before.latestVersion) {
      throw updateError({
        ...before,
        blockedReason: "release-version-mismatch",
        blockedMessage: `Release ${before.releaseTag} contains plugin version ${releasedVersion || "unknown"}.`
      });
    }

    if (await pathExists(path.join(before.sourceRoot, "package-lock.json"))) {
      await runPortableExecutable(npmExecutable(), ["ci", "--omit=dev", "--ignore-scripts"], {
        cwd: before.sourceRoot,
        timeoutMs: 120000
      });
      output.push("Installed production dependencies from package-lock.json.");
    }

    let reinstalled = false;
    let installedPath = null;
    if (before.install?.marketplaceName) {
      const installed = await runPortableExecutable(
        await resolveCodexExecutable(),
        ["plugin", "add", `${before.name}@${before.install.marketplaceName}`, "--json"],
        { cwd: before.sourceRoot, timeoutMs: 60000 }
      );
      const installResult = parseJsonCommandOutput(installed.stdout, "codex plugin add");
      const installedResultVersion = normalizeVersion(installResult.version);
      if (installedResultVersion !== before.latestVersion || !installResult.installedPath) {
        throw updateError({
          ...before,
          blockedReason: "plugin-reinstall-invalid",
          blockedMessage: `Codex installed ${installedResultVersion || "an unknown version"} instead of ${before.latestVersion}.`
        });
      }
      installedPath = await realpathOrSelf(installResult.installedPath);
      reinstalled = true;
      output.push(`Reinstalled ${before.name}@${before.install.marketplaceName} in the Codex plugin cache.`);
    }

    const postflightRoot = installedPath || rootDir;
    const after = await appUpdateStatus({
      checkRemote: false,
      rootDir: postflightRoot,
      sourceRoot: before.sourceRoot,
      discoverInstall,
      releaseProvider,
      releaseCheckTimeoutMs
    });
    if (normalizeVersion(after.installedVersion) !== before.latestVersion) {
      throw updateError({
        ...before,
        blockedReason: "plugin-reinstall-invalid",
        blockedMessage: `Post-update verification still found Codex-Canvas ${after.installedVersion || "with an unknown version"}.`
      });
    }
    return {
      ...after,
      updated: true,
      reinstalled,
      installedPath,
      restartRequired: true,
      previousVersion: before.installedVersion,
      previousHead: before.git.head,
      latestVersion: before.latestVersion,
      releaseTag: before.releaseTag,
      output: output.filter(Boolean).join("\n")
    };
  } finally {
    await updateLock.release();
  }
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
  const base = emptyGitStatus();

  try {
    const root = (await runGit(["rev-parse", "--show-toplevel"], { rootDir })).stdout.trim();
    const branch = await optionalGit(["symbolic-ref", "--quiet", "--short", "HEAD"], { rootDir });
    const head = (await runGit(["rev-parse", "HEAD"], { rootDir })).stdout.trim();
    const status = (await runGit(["status", "--porcelain"], { rootDir })).stdout.trim();
    const configuredUpstream = await optionalGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { rootDir }
    );
    const remote = await updateRemoteFor({ rootDir, branch, configuredUpstream });
    const remoteUrl = remote
      ? await optionalGit(["config", "--get", `remote.${remote}.url`], { rootDir })
      : "";
    let fetchError = null;

    if (checkRemote && remote) {
      try {
        await runGit(["fetch", "--quiet", "--tags", remote], { rootDir, timeoutMs: gitFetchTimeoutMs });
      } catch (error) {
        fetchError = conciseProcessError(error);
      }
    }

    const fallbackRemoteBranch = !configuredUpstream && branch && remote
      ? await existingRemoteBranch({ rootDir, remote, branch })
      : null;
    const upstream = configuredUpstream || fallbackRemoteBranch;
    const counts = upstream
      ? await optionalGit(["rev-list", "--left-right", "--count", `HEAD...${upstream}`], { rootDir })
      : "";
    const [aheadText, behindText] = counts.split(/\s+/);
    const tagsText = upstream
      ? await optionalGit(["tag", "--merged", upstream, "--list", "v*"], { rootDir })
      : "";
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
      behind: Number(behindText) || 0,
      tags: tagsText.split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean),
      fetchError
    };
  } catch (error) {
    return {
      ...base,
      error: conciseProcessError(error)
    };
  }
}

function emptyGitStatus(error = null) {
  return {
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
    tags: [],
    fetchError: null,
    error
  };
}

async function publishedStableRelease({ git, rootDir, publishedRelease }) {
  const parsed = parseVersionTag(publishedRelease.tag);
  if (!parsed || parsed.prerelease.length > 0) return null;

  const packageText = await optionalGit(["show", `${publishedRelease.tag}:package.json`], { rootDir });
  const pluginText = await optionalGit(["show", `${publishedRelease.tag}:.codex-plugin/plugin.json`], { rootDir });
  const commit = await optionalGit(["rev-list", "-n", "1", publishedRelease.tag], { rootDir });
  let packageVersion = null;
  let pluginVersion = null;
  try {
    packageVersion = normalizeVersion(JSON.parse(packageText).version);
    pluginVersion = normalizeVersion(JSON.parse(pluginText).version);
  } catch {
    // The mismatch below gives callers a stable, user-facing release error.
  }
  const version = versionString(parsed);
  return {
    tag: publishedRelease.tag,
    version,
    commit: commit || null,
    url: publishedRelease.url || null,
    valid: Boolean(
      git.tags.includes(publishedRelease.tag)
      && commit
      && commit === publishedRelease.commit
      && packageVersion === version
      && pluginVersion === version
    ),
    packageVersion,
    pluginVersion,
    manifestCommit: publishedRelease.commit
  };
}

async function githubReleaseProvider({ repository, checkRemote, timeoutMs = githubReleaseTimeoutMs }) {
  const slug = githubRepositorySlug(repository);
  if (!slug) throw new Error("Codex-Canvas repository is not a supported GitHub URL.");

  const cached = publishedReleaseCache.get(slug);
  if (!checkRemote) return cached?.release || null;
  if (cached && Date.now() - cached.checkedAt < cached.ttlMs) return cached.release;

  return withAbortTimeout(timeoutMs, async (signal) => {
    const response = await fetchTextResponse(`https://api.github.com/repos/${slug}/releases/latest`, {
      signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "codex-canvas-updater",
        "x-github-api-version": "2022-11-28"
      }
    });
    if (response.status === 404) {
      cachePublishedRelease(slug, null, pendingReleaseCacheMs);
      return null;
    }
    if (!response.ok) {
      throw new Error(`GitHub release API returned ${response.status}.`);
    }

    const release = await response.json();
    const parsed = parseVersionTag(release?.tag_name);
    if (release?.draft || release?.prerelease || !parsed || parsed.prerelease.length > 0) {
      cachePublishedRelease(slug, null, pendingReleaseCacheMs);
      return null;
    }

    const version = versionString(parsed);
    const archiveName = `codex-canvas-v${version}.tgz`;
    const assets = new Map((Array.isArray(release.assets) ? release.assets : []).map((asset) => [asset?.name, asset]));
    const archiveAsset = assets.get(archiveName);
    const manifestAsset = assets.get("release-manifest.json");
    const checksumsAsset = assets.get("SHA256SUMS");
    if (![archiveAsset, manifestAsset, checksumsAsset].every(releaseAssetReady)) {
      cachePublishedRelease(slug, null, pendingReleaseCacheMs);
      return null;
    }

    const [manifestResponse, checksumsResponse] = await Promise.all([
      fetchTextResponse(manifestAsset.browser_download_url, {
        signal,
        headers: {
          accept: "application/json",
          "user-agent": "codex-canvas-updater"
        }
      }),
      fetchTextResponse(checksumsAsset.browser_download_url, {
        signal,
        headers: {
          accept: "text/plain",
          "user-agent": "codex-canvas-updater"
        }
      })
    ]);
    if (!manifestResponse.ok) {
      throw new Error(`Release manifest download returned ${manifestResponse.status}.`);
    }
    if (!checksumsResponse.ok) {
      throw new Error(`Release checksum download returned ${checksumsResponse.status}.`);
    }
    const manifestText = await manifestResponse.text();
    const checksumsText = await checksumsResponse.text();
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      throw new Error(`Release ${release.tag_name} manifest is not valid JSON: ${error.message}`);
    }
    const artifact = manifest?.artifacts?.universal;
    const checksums = parseChecksumFile(checksumsText);
    const manifestSha256 = createHash("sha256").update(manifestText).digest("hex");
    if (
      manifest?.schemaVersion !== 1
      || manifest?.name !== "codex-canvas"
      || manifest?.version !== version
      || manifest?.tag !== release.tag_name
      || manifest?.channel !== "stable"
      || !/^[0-9a-f]{40}$/i.test(manifest?.commit || "")
      || artifact?.file !== archiveName
      || !/^[0-9a-f]{64}$/i.test(artifact?.sha256 || "")
      || checksums.get("release-manifest.json") !== manifestSha256
      || checksums.get(archiveName) !== artifact.sha256
    ) {
      throw new Error(`Release ${release.tag_name} has invalid or inconsistent release metadata.`);
    }

    const published = {
      tag: release.tag_name,
      version,
      commit: manifest.commit,
      url: release.html_url || null,
      publishedAt: release.published_at || null
    };
    cachePublishedRelease(slug, published, publishedReleaseCacheMs);
    return published;
  });
}

function releaseAssetReady(asset) {
  return Boolean(
    asset
    && asset.state === "uploaded"
    && Number.isFinite(asset.size)
    && asset.size > 0
    && asset.browser_download_url
  );
}

function parseChecksumFile(contents) {
  const checksums = new Map();
  for (const line of String(contents || "").split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line.trimEnd());
    if (match) checksums.set(match[2], match[1].toLowerCase());
  }
  return checksums;
}

async function withAbortTimeout(timeoutMs, operation) {
  const normalizedTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.max(1, Math.round(timeoutMs))
    : githubReleaseTimeoutMs;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, normalizedTimeout);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(`GitHub release check timed out after ${normalizedTimeout} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cachePublishedRelease(slug, release, ttlMs) {
  publishedReleaseCache.set(slug, {
    release,
    checkedAt: Date.now(),
    ttlMs
  });
}

function githubRepositorySlug(repository) {
  const value = repositoryUrl(repository);
  if (!value) return null;
  const sshMatch = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(value);
  if (sshMatch) return sshMatch[1];
  try {
    const url = new URL(value);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const pathname = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    return /^[^/]+\/[^/]+$/.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

async function releaseRelationFor({ git, release, rootDir }) {
  if (!git.head || !release.commit) return "unrelated";
  if (git.head === release.commit) return "at-release";
  try {
    await runGit(["merge-base", "--is-ancestor", "HEAD", release.commit], { rootDir });
    return "fast-forward";
  } catch {
    return "unrelated";
  }
}

async function discoverInstalledPlugin(name, preferredVersion) {
  try {
    const result = await runPortableExecutable(await resolveCodexExecutable(), ["plugin", "list", "--json"], {
      timeoutMs: 10000
    });
    const payload = JSON.parse(result.stdout);
    const candidates = (Array.isArray(payload.installed) ? payload.installed : [])
      .filter((plugin) => plugin?.name === name && plugin?.installed !== false && plugin?.source?.path)
      .sort((left, right) => {
        const leftPreferred = normalizeVersion(left.version) === normalizeVersion(preferredVersion) ? 1 : 0;
        const rightPreferred = normalizeVersion(right.version) === normalizeVersion(preferredVersion) ? 1 : 0;
        return rightPreferred - leftPreferred;
      });
    const installed = candidates[0];
    if (!installed) return null;
    return {
      marketplaceName: installed.marketplaceName || null,
      version: installed.version || null,
      sourcePath: await realpathOrSelf(installed.source.path),
      error: null
    };
  } catch (error) {
    return {
      marketplaceName: null,
      version: preferredVersion || null,
      sourcePath: null,
      error: conciseProcessError(error)
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
  return runExecutable("git", ["-C", rootDir, ...args], { timeoutMs });
}

async function runExecutable(command, args, { cwd, timeoutMs = 5000 } = {}) {
  return execFileAsync(command, args, {
    cwd,
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true
  });
}

async function runPortableExecutable(command, args, { cwd, timeoutMs = 5000 } = {}) {
  if (!(process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command))) {
    return runExecutable(command, args, { cwd, timeoutMs });
  }

  const child = spawnCodexProcess(command, args, {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void (async () => {
        await stopCodexProcess(child);
        const error = new Error(`${path.basename(command)} timed out after ${timeoutMs} ms.`);
        error.stdout = Buffer.concat(stdout).toString();
        error.stderr = Buffer.concat(stderr).toString();
        reject(error);
      })();
    }, timeoutMs);
    timeout.unref?.();
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (timedOut) return;
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (timedOut) return;
      const result = {
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString()
      };
      if (code === 0) {
        resolve(result);
        return;
      }
      const error = new Error(`${path.basename(command)} failed with ${signal || `exit code ${code}`}.`);
      Object.assign(error, result, { code, signal });
      reject(error);
    });
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

function updateBlockedReason({ git, install, installKind, release, releaseError, releaseRelation, sourceInfo }) {
  if (installKind === "codex-cache" && (!install || !install.sourcePath)) return "source-not-found";
  if (installKind === "codex-cache" && !install.marketplaceName) return "plugin-reinstall-unavailable";
  if (!sourceInfo || !git.available) return "not-git";
  if (git.fetchError) return "remote-check-failed";
  if (releaseError) return "release-check-failed";
  if (git.detached) return "detached-head";
  if (git.dirty) return "dirty-worktree";
  if (!git.remote || !git.remoteBranch) return "no-upstream";
  if (git.ahead > 0) return "local-ahead";
  if (release && !release.valid) return "release-version-mismatch";
  if (releaseRelation === "unrelated") return "release-not-fast-forward";
  return null;
}

function blockedMessageFor(reason, { git, release, releaseError } = {}) {
  const messages = {
    "not-git": "The configured Codex-Canvas source is not a Git checkout, so automatic release updates are unavailable.",
    "source-not-found": "Could not locate the installed Codex-Canvas marketplace source. Reinstall the personal plugin manually.",
    "plugin-reinstall-unavailable": "Could not identify the installed Codex-Canvas marketplace, so the versioned plugin cache cannot be refreshed safely.",
    "detached-head": "The Codex-Canvas source is at a detached Git HEAD; switch it to its tracked branch before updating.",
    "dirty-worktree": "The Codex-Canvas source has local changes; commit or stash them before updating.",
    "no-upstream": "The Codex-Canvas source branch has no remote branch to verify published release tags against.",
    "local-ahead": "The Codex-Canvas source has local commits; push or resolve them before installing a release.",
    "remote-check-failed": `Could not refresh Codex-Canvas release tags${git?.fetchError ? `: ${git.fetchError}` : "."}`,
    "release-check-failed": `Could not verify the latest published GitHub Release${releaseError ? `: ${releaseError}` : "."}`,
    "release-version-mismatch": `Published tag ${release?.tag || "(unknown)"} does not match its package and plugin versions.`,
    "release-not-fast-forward": "The Codex-Canvas source is not an ancestor of the latest release; automatic update would overwrite or mix local code.",
    "plugin-reinstall-invalid": "Codex did not activate the expected plugin release.",
    "no-release": "No stable Codex-Canvas release is available."
  };
  return messages[reason] || "Codex-Canvas cannot be updated automatically from this install.";
}

function manualCommandFor({ sourceRoot, git, install, repository, release, blockedReason }) {
  if (git.available && release?.tag && !blockedReason) {
    const commands = [
      `git -C ${quoteShell(sourceRoot)} fetch --tags ${quoteShell(git.remote)}`,
      `git -C ${quoteShell(sourceRoot)} merge --ff-only ${quoteShell(release.tag)}`
    ];
    if (install?.marketplaceName) {
      commands.push(`codex plugin add ${quoteShell(`codex-canvas@${install.marketplaceName}`)}`);
    }
    return commands.join("\n");
  }
  if (["dirty-worktree", "local-ahead", "release-not-fast-forward"].includes(blockedReason)) {
    return `git -C ${quoteShell(sourceRoot)} status --short --branch`;
  }
  if (repository) return `git clone ${quoteShell(repository)} codex-canvas`;
  return null;
}

function installKindFor(rootDir) {
  const normalized = path.normalize(rootDir);
  if (normalized.includes(`${path.join(".codex", "plugins", "cache")}${path.sep}`)) return "codex-cache";
  if (normalized.includes(`node_modules${path.sep}`)) return "package";
  return "git-checkout";
}

function parseVersionTag(tag) {
  const match = stableReleaseTag.exec(String(tag || ""));
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function parseVersion(value) {
  const text = normalizeVersion(value);
  if (!text) return null;
  return parseVersionTag(`v${text}`);
}

function normalizeVersion(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/^v/, "").split("+")[0];
  return parseVersionTag(`v${text}`) ? text : null;
}

function compareVersions(left, right) {
  const leftParsed = parseVersion(left);
  const rightParsed = parseVersion(right);
  if (!leftParsed && !rightParsed) return 0;
  if (!leftParsed) return -1;
  if (!rightParsed) return 1;
  return compareParsedVersions(leftParsed, rightParsed);
}

function compareParsedVersions(left, right) {
  for (const field of ["major", "minor", "patch"]) {
    if (left[field] !== right[field]) return left[field] > right[field] ? 1 : -1;
  }
  if (!left.prerelease.length && right.prerelease.length) return 1;
  if (left.prerelease.length && !right.prerelease.length) return -1;
  const count = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < count; index += 1) {
    const leftPart = left.prerelease[index];
    const rightPart = right.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber > rightNumber ? 1 : -1;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function versionString(parsed) {
  return `${parsed.major}.${parsed.minor}.${parsed.patch}${parsed.prerelease.length ? `-${parsed.prerelease.join(".")}` : ""}`;
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
  if (process.platform === "win32") return `"${text.replaceAll('"', '""')}"`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function updateError(details) {
  const error = new Error(details.blockedMessage || "Codex-Canvas cannot be updated automatically from this install.");
  error.statusCode = 409;
  error.code = details.blockedReason || "update-unavailable";
  error.details = details;
  return error;
}

function npmExecutable() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function parseJsonCommandOutput(stdout, commandName) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`${commandName} did not return valid JSON: ${error.message}`);
  }
}

function conciseProcessError(error) {
  return String(error?.stderr || error?.stdout || error?.message || error).trim().split(/\r?\n/).slice(-3).join(" ");
}

async function realpathOrSelf(value) {
  const resolved = path.resolve(value);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function acquireCrossProcessUpdateLock(sourceRoot) {
  const normalizedSource = path.resolve(sourceRoot);
  const lockPath = updateLockPath();
  await fs.mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  let handle;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (attempt === 0 && await removeStaleUpdateLock()) {
        continue;
      }
      const conflict = new Error("Another Codex-Canvas process is already installing an update. Wait for it to finish and try again.");
      conflict.statusCode = 409;
      conflict.code = "update-in-progress";
      throw conflict;
    }
  }
  if (!handle) throw new Error("Could not acquire the Codex-Canvas update lock.");
  try {
    await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, sourceRoot: normalizedSource, startedAt: new Date().toISOString() })}\n`);
    const activeLeases = await activeOperationLeases();
    if (activeLeases.length > 0) {
      const kinds = [...new Set(activeLeases.map((lease) => lease.kind).filter(Boolean))].join(", ");
      const error = new Error(`Wait for active Codex-Canvas background operations to finish before updating${kinds ? ` (${kinds})` : ""}.`);
      error.statusCode = 409;
      error.code = "active-operations";
      throw error;
    }
  } catch (error) {
    await handle.close().catch(() => {});
    await fs.rm(lockPath, { force: true }).catch(() => {});
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await handle.close().catch(() => {});
      const contents = await fs.readFile(lockPath, "utf8").catch(() => "");
      if (contents.includes(`"token":"${token}"`)) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
      }
    }
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function samePath(left, right) {
  const normalize = (value) => {
    const normalized = path.normalize(path.resolve(value));
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return normalize(left) === normalize(right);
}
