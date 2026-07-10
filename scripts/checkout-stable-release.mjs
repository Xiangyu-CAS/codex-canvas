#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { fetchTextResponse } from "../src/http-text-response.mjs";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseArgs(process.argv.slice(2));

await requireCleanCheckout();
await git(["fetch", "--quiet", "--tags", options.remote]);

const remoteBranch = await defaultRemoteBranch(options.remote);
const upstream = `${options.remote}/${remoteBranch}`;
const tags = (await git([
  "tag",
  "--merged",
  upstream,
  "--list",
  "v*",
  "--sort=-version:refname"
])).stdout.split(/\r?\n/).map((tag) => tag.trim()).filter(Boolean);
const remoteUrl = (await git(["config", "--get", `remote.${options.remote}.url`])).stdout.trim();
const publishedRelease = await fetchPublishedRelease(remoteUrl);
const releaseTag = publishedRelease.tag;
if (!tags.includes(releaseTag)) throw new Error(`Published release ${releaseTag} is not reachable from ${upstream}.`);
const releaseCommit = (await git(["rev-list", "-n", "1", releaseTag])).stdout.trim();
if (releaseCommit !== publishedRelease.commit) {
  throw new Error(`Published release ${releaseTag} manifest does not identify its immutable Git tag commit.`);
}
await verifyTagVersions(releaseTag, publishedRelease.version);

const branchExists = await gitSucceeds(["show-ref", "--verify", "--quiet", `refs/heads/${options.branch}`]);
if (branchExists) {
  await git(["switch", options.branch]);
  await git(["merge", "--ff-only", releaseTag]);
} else {
  await git(["switch", "--create", options.branch, releaseTag]);
}
await git(["branch", `--set-upstream-to=${upstream}`, options.branch]);

const head = (await git(["rev-parse", "HEAD"])).stdout.trim();
if (head !== releaseCommit) {
  throw new Error(`${options.branch} contains commits beyond ${releaseTag}; refusing to install unreleased source.`);
}

console.log(JSON.stringify({
  ok: true,
  branch: options.branch,
  upstream,
  releaseTag,
  releaseCommit
}, null, 2));

function parseArgs(args) {
  const options = { remote: "origin", branch: "codex-canvas-stable" };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--remote" || arg === "--branch") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      options[arg.slice(2)] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  for (const [name, value] of Object.entries(options)) {
    if (!/^[A-Za-z0-9._/-]+$/.test(value)) throw new Error(`Invalid ${name}: ${value}`);
  }
  return options;
}

async function requireCleanCheckout() {
  const root = (await git(["rev-parse", "--show-toplevel"])).stdout.trim();
  if (path.resolve(root) !== rootDir) throw new Error("Stable checkout must run from the Codex-Canvas repository root.");
  const status = (await git(["status", "--porcelain"])).stdout.trim();
  if (status) throw new Error("Codex-Canvas source has local changes; use a fresh clone for the stable release checkout.");
}

async function defaultRemoteBranch(remote) {
  const symbolic = (await optionalGit(["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`])).trim();
  if (symbolic.startsWith(`${remote}/`)) return symbolic.slice(remote.length + 1);
  const main = (await optionalGit(["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/main`])).trim();
  if (main) return "main";
  throw new Error(`Could not determine the default branch for remote ${remote}.`);
}

async function fetchPublishedRelease(repository) {
  const slug = githubRepositorySlug(repository);
  if (!slug) throw new Error("Stable checkout requires a github.com repository remote.");
  return withAbortTimeout(15_000, async (signal) => {
    const response = await fetchTextResponse(`https://api.github.com/repos/${slug}/releases/latest`, {
      signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "codex-canvas-stable-checkout",
        "x-github-api-version": "2022-11-28"
      }
    });
    if (response.status === 404) throw new Error("No published Codex-Canvas GitHub Release is available yet.");
    if (!response.ok) throw new Error(`GitHub release API returned ${response.status}.`);
    const release = await response.json();
    if (release?.draft || release?.prerelease || !/^v\d+\.\d+\.\d+$/.test(release?.tag_name || "")) {
      throw new Error("The latest GitHub Release is not a stable vX.Y.Z release.");
    }

    const version = release.tag_name.slice(1);
    const archiveName = `codex-canvas-${release.tag_name}.tgz`;
    const assets = new Map((Array.isArray(release.assets) ? release.assets : []).map((asset) => [asset?.name, asset]));
    const archiveAsset = assets.get(archiveName);
    const manifestAsset = assets.get("release-manifest.json");
    const checksumsAsset = assets.get("SHA256SUMS");
    if (![archiveAsset, manifestAsset, checksumsAsset].every(releaseAssetReady)) {
      throw new Error(`Release ${release.tag_name} is not ready: its package, manifest, and checksum assets must finish uploading first.`);
    }

    const [manifestResponse, checksumsResponse] = await Promise.all([
      fetchTextResponse(manifestAsset.browser_download_url, { signal, headers: { "user-agent": "codex-canvas-stable-checkout" } }),
      fetchTextResponse(checksumsAsset.browser_download_url, { signal, headers: { "user-agent": "codex-canvas-stable-checkout" } })
    ]);
    if (!manifestResponse.ok || !checksumsResponse.ok) throw new Error(`Could not download release metadata for ${release.tag_name}.`);
    const manifestText = await manifestResponse.text();
    const checksums = parseChecksumFile(await checksumsResponse.text());
    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (error) {
      throw new Error(`Release ${release.tag_name} manifest is not valid JSON: ${error.message}`);
    }
    const manifestSha256 = createHash("sha256").update(manifestText).digest("hex");
    const artifact = manifest?.artifacts?.universal;
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
    return { tag: release.tag_name, version, commit: manifest.commit };
  });
}

async function verifyTagVersions(tag, expectedVersion) {
  const [packageText, pluginText] = await Promise.all([
    git(["show", `${tag}:package.json`]).then(({ stdout }) => stdout),
    git(["show", `${tag}:.codex-plugin/plugin.json`]).then(({ stdout }) => stdout)
  ]);
  const packageVersion = JSON.parse(packageText).version;
  const pluginVersion = JSON.parse(pluginText).version;
  if (packageVersion !== expectedVersion || pluginVersion !== expectedVersion) {
    throw new Error(`Release ${tag} package and plugin versions must both equal ${expectedVersion}.`);
  }
}

function releaseAssetReady(asset) {
  return Boolean(asset?.state === "uploaded" && Number.isFinite(asset?.size) && asset.size > 0 && asset.browser_download_url);
}

function parseChecksumFile(contents) {
  const checksums = new Map();
  for (const line of String(contents || "").split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s{2}(.+)$/.exec(line.trimEnd());
    if (match) checksums.set(match[2], match[1].toLowerCase());
  }
  return checksums;
}

function githubRepositorySlug(repository) {
  const ssh = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/.exec(repository);
  if (ssh) return ssh[1];
  try {
    const url = new URL(repository);
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const pathname = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/, "");
    return /^[^/]+\/[^/]+$/.test(pathname) ? pathname : null;
  } catch {
    return null;
  }
}

async function withAbortTimeout(timeoutMs, operation) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (timedOut) throw new Error(`GitHub release verification timed out after ${timeoutMs} ms.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function optionalGit(args) {
  try {
    return (await git(args)).stdout;
  } catch {
    return "";
  }
}

async function gitSucceeds(args) {
  try {
    await git(args);
    return true;
  } catch {
    return false;
  }
}

function git(args) {
  return execFileAsync("git", ["-C", rootDir, ...args], {
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true
  });
}
