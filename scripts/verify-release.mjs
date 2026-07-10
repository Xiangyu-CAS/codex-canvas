#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const [packageJson, packageLock, pluginJson, releaseManifest] = await Promise.all([
  readJson("package.json"),
  readJson("package-lock.json"),
  readJson(path.join(".codex-plugin", "plugin.json")),
  readJson(".release-please-manifest.json")
]);

const version = packageJson.version;
const versions = {
  "package.json": version,
  "package-lock.json": packageLock.version,
  "package-lock.json packages['']": packageLock.packages?.[""]?.version,
  ".codex-plugin/plugin.json": pluginJson.version
};

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
  throw new Error(`package.json version is not a release SemVer: ${JSON.stringify(version)}.`);
}
for (const [source, candidate] of Object.entries(versions)) {
  if (candidate !== version) {
    throw new Error(`${source} version ${JSON.stringify(candidate)} does not match package.json ${JSON.stringify(version)}.`);
  }
}
if (pluginJson.name !== packageJson.name || packageLock.name !== packageJson.name || packageLock.packages?.[""]?.name !== packageJson.name) {
  throw new Error("Package, lockfile, and Codex plugin names must match.");
}

const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;
if (releaseManifest["."] !== undefined && releaseManifest["."] !== version) {
  throw new Error(`.release-please-manifest.json version ${JSON.stringify(releaseManifest["."])} does not match package.json ${JSON.stringify(version)}.`);
}
if (tag?.startsWith("v") && releaseManifest["."] !== version) {
  throw new Error("A tagged release requires .release-please-manifest.json to contain the package version.");
}
if (tag?.startsWith("v") && tag !== `v${version}`) {
  throw new Error(`Release tag ${JSON.stringify(tag)} does not match v${version}.`);
}

console.log(`Release metadata is consistent for ${packageJson.name} v${version}.`);

async function readJson(relativePath) {
  return JSON.parse(await fs.readFile(path.join(rootDir, relativePath), "utf8"));
}
