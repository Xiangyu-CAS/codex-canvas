import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pluginName = "agent-canvas";
const pluginCategory = "Productivity";
const marketplaceName = "personal";

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const homeDir = path.resolve(process.env.AGENT_CANVAS_PERSONAL_HOME || os.homedir());
  const linkPath = path.join(homeDir, "plugins", pluginName);
  const marketplacePath = path.join(homeDir, ".agents", "plugins", "marketplace.json");
  const sourcePath = `./plugins/${pluginName}`;

  if (!options.dryRun) {
    await ensurePluginLink(linkPath, rootDir);
    await writeMarketplace(marketplacePath, sourcePath);
  }

  const payload = {
    ok: true,
    dryRun: options.dryRun,
    plugin: pluginName,
    pluginRoot: rootDir,
    linkPath,
    marketplacePath,
    sourcePath
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`Agent-Canvas personal plugin entry is available at ${marketplacePath}`);
    console.log(`Plugin link: ${linkPath} -> ${rootDir}`);
  }
}

function parseArgs(args) {
  return {
    dryRun: args.includes("--dry-run"),
    json: args.includes("--json")
  };
}

async function ensurePluginLink(linkPath, targetPath) {
  await fs.mkdir(path.dirname(linkPath), { recursive: true });

  const existing = await readExistingLink(linkPath);
  if (existing && await pathsReferToSameEntry(existing, targetPath)) return;
  if (existing) {
    await fs.rm(linkPath, { force: true, recursive: true });
  } else if (await pathExists(linkPath)) {
    throw new Error(`Refusing to replace non-symlink plugin path: ${linkPath}. Remove that path or choose a different AGENT_CANVAS_PERSONAL_HOME.`);
  }

  try {
    await fs.symlink(targetPath, linkPath, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const afterRace = await readExistingLink(linkPath);
    if (!afterRace || !(await pathsReferToSameEntry(afterRace, targetPath))) throw error;
  }
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

async function writeMarketplace(marketplacePath, sourcePath) {
  await fs.mkdir(path.dirname(marketplacePath), { recursive: true });
  const marketplace = await readMarketplace(marketplacePath);
  const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const nextEntry = {
    name: pluginName,
    source: {
      source: "local",
      path: sourcePath
    },
    policy: {
      installation: "AVAILABLE",
      authentication: "ON_INSTALL"
    },
    category: pluginCategory
  };
  const nextPlugins = [
    ...plugins.filter((plugin) => plugin?.name !== pluginName),
    nextEntry
  ];
  const nextMarketplace = {
    ...marketplace,
    name: marketplace.name || marketplaceName,
    interface: {
      ...(marketplace.interface || {}),
      displayName: marketplace.interface?.displayName || "Personal"
    },
    plugins: nextPlugins
  };
  await fs.writeFile(marketplacePath, `${JSON.stringify(nextMarketplace, null, 2)}\n`);
}

async function readMarketplace(marketplacePath) {
  try {
    return JSON.parse(await fs.readFile(marketplacePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return {};
    if (error instanceof SyntaxError) {
      const wrapped = new Error(`Marketplace JSON is invalid: ${marketplacePath}`);
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
