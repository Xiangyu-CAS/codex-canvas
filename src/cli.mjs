import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { addImage, ensureProjectStore, promptHistory, readState, searchObjects, versionGroups } from "./store.mjs";
import { createServer } from "./server.mjs";
import { collectRecentImages } from "./collector.mjs";
import { projectRegistryPath, resolveProjectDir } from "./paths.mjs";
import { checkImageProcessingDepsAvailable, checkOptionalPythonDepsAvailable, checkRapidOcrAvailable, installImageProcessingDeps, installOptionalPythonDeps, installRapidOcr } from "./ocr-setup.mjs";
import { canvasIdForThread, readRuntime, writeRuntime, normalizeThreadId } from "./runtime.mjs";
import { appUpdateStatus, updateApp } from "./updater.mjs";

const defaultLimit = 20;
const maxLimit = 100;
const defaultSinceMinutes = 120;
const defaultPort = 43217;
const maxPort = 65535;

export async function main(args, context = {}) {
  const command = args[0] || "help";
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const { options, positionals } = parseOptions(args.slice(1));
  const projectDir = resolveProjectDir(optionValue(options, ["project"], "--project"));

  if (command === "start") {
    const port = normalizePort(optionValue(options, ["port"], "--port") ?? process.env.CODEX_CANVAS_PORT);
    const host = optionValue(options, ["host"], "--host") || process.env.CODEX_CANVAS_HOST || "127.0.0.1";
    const autoCollect = options["no-auto-collect"] !== true;
    const chatThreadId = normalizeThreadId(optionValue(options, ["thread-id", "threadId"], "--thread-id") || environmentThreadId());
    const { url } = await createServer({ projectDir, host, port, autoCollect, chatThreadId });
    console.log(`Codex-Canvas listening on ${url}`);
    console.log(`Project: ${projectDir}`);
    console.log(`Auto-collect: ${autoCollect ? "enabled" : "disabled"}`);
    console.log(`Chat thread: ${chatThreadId || "(not bound)"}`);
    await new Promise(() => {});
    return;
  }

  if (command === "open") {
    const port = normalizePort(optionValue(options, ["port"], "--port") ?? process.env.CODEX_CANVAS_PORT);
    const host = optionValue(options, ["host"], "--host") || process.env.CODEX_CANVAS_HOST || "127.0.0.1";
    const defaultUrl = `http://${host}:${port}/`;
    const autoCollect = options["no-auto-collect"] !== true;
    const autoUpdate = options["no-update"] !== true && process.env.CODEX_CANVAS_OPEN_AUTO_UPDATE !== "0";
    const chatThreadId = normalizeThreadId(optionValue(options, ["thread-id", "threadId"], "--thread-id") || environmentThreadId());
    if (autoUpdate) await autoUpdateBeforeOpen();
    await ensureProjectStore(projectDir, { canvasId: canvasIdForThread(chatThreadId) });
    const runtime = await readRuntime(projectDir);
    const existingUrl = await openExistingCanvas(runtime?.url, projectDir, { autoCollect, chatThreadId, allowLegacy: true });
    if (existingUrl) {
      console.log(existingUrl);
      return;
    }

    const defaultExistingUrl = await openExistingCanvas(defaultUrl, projectDir, { autoCollect, chatThreadId, allowLegacy: false });
    if (defaultExistingUrl) {
      console.log(defaultExistingUrl);
      return;
    }

    const entrypoint = context.entrypoint || fileURLToPath(import.meta.url);
    const startArgs = [entrypoint, "start", "--project", projectDir, "--host", host, "--port", String(port)];
    if (!autoCollect) startArgs.push("--no-auto-collect");
    if (chatThreadId) startArgs.push("--thread-id", chatThreadId);
    const child = spawn(process.execPath, startArgs, {
      cwd: projectDir,
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        CODEX_CANVAS_PROJECT_DIR: projectDir
      }
    });
    child.unref();

    const url = await waitForRuntime(projectDir, 5000);
    console.log(url);
    return;
  }

  if (command === "import" || command === "add-image") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const imagePath = optionValue(options, ["path"], "--path") || positionals[0];
    const url = optionValue(options, ["url"], "--url");
    const dataUrl = optionValue(options, ["dataUrl", "data-url"], "--dataUrl");
    if (!imagePath && !url && !dataUrl) {
      throw usageError("import requires <image-path>, --path, --url, or --dataUrl.");
    }
    requireSingleImageInput({ path: imagePath, url, dataUrl });
    const prompt = optionValue(options, ["prompt"], "--prompt") || "";
    const name = optionValue(options, ["name"], "--name");
    const object = await addImage(projectDir, { path: imagePath, url, dataUrl, prompt, name }, { canvasId: canvas.canvasId });
    console.log(JSON.stringify(object, null, 2));
    return;
  }

  if (command === "collect") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const sinceMinutes = normalizeNonNegativeNumber(optionValue(options, ["since-minutes", "since"], "--since-minutes"), defaultSinceMinutes);
    const limit = normalizePositiveInteger(optionValue(options, ["limit"], "--limit"), defaultLimit, maxLimit);
    const roots = parseList(optionValue(options, ["from", "roots"], "--from"));
    const result = await collectRecentImages(projectDir, {
      roots,
      limit,
      sinceMs: Date.now() - sinceMinutes * 60 * 1000,
      prompt: optionValue(options, ["prompt"], "--prompt") || "Collected after image generation",
      sourceObjectId: optionValue(options, ["source-object-id", "sourceObjectId"], "--source-object-id") || null,
      canvasId: canvas.canvasId,
      threadId: canvas.threadId
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "search") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const query = optionValue(options, ["query"], "--query") || positionals[0] || "";
    const result = await searchObjects(projectDir, {
      query,
      type: optionValue(options, ["type"], "--type") || null,
      limit: normalizePositiveInteger(optionValue(options, ["limit"], "--limit"), defaultLimit, maxLimit),
      canvasId: canvas.canvasId
    });
    if (flagEnabled(options.json)) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Found ${result.total} canvas object(s)${query ? ` for "${query}"` : ""}.`);
      for (const object of result.results) {
        const label = object.name || object.text || object.id;
        const fields = object.matchFields.length ? ` [${object.matchFields.join(", ")}]` : "";
        console.log(`- ${object.id} ${object.type} ${label}${fields}`);
      }
    }
    return;
  }

  if (command === "prompts" || command === "prompt-history") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const query = optionValue(options, ["query"], "--query") || positionals[0] || "";
    const result = await promptHistory(projectDir, {
      query,
      limit: normalizePositiveInteger(optionValue(options, ["limit"], "--limit"), defaultLimit, maxLimit),
      canvasId: canvas.canvasId
    });
    if (flagEnabled(options.json)) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Found ${result.total} prompt(s)${query ? ` matching "${query}"` : ""}.`);
      for (const item of result.prompts) {
        console.log(`- ${item.prompt} (${item.objectId}${item.objectName ? `, ${item.objectName}` : ""})`);
      }
    }
    return;
  }

  if (command === "versions" || command === "version-groups") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const query = optionValue(options, ["query"], "--query") || positionals[0] || "";
    const result = await versionGroups(projectDir, {
      query,
      groupBy: optionValue(options, ["group-by", "groupBy"], "--group-by") || "sourceObjectId",
      limit: normalizePositiveInteger(optionValue(options, ["limit"], "--limit"), defaultLimit, maxLimit),
      objectLimit: normalizePositiveInteger(optionValue(options, ["object-limit", "objectLimit"], "--object-limit"), defaultLimit, maxLimit),
      canvasId: canvas.canvasId
    });
    if (flagEnabled(options.json)) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Found ${result.total} version group(s) by ${result.groupBy}${query ? ` matching "${query}"` : ""}.`);
      for (const group of result.groups) {
        const latest = group.latestAt ? `, latest ${group.latestAt}` : "";
        console.log(`- ${group.value} (${group.count} object(s)${latest})`);
      }
    }
    return;
  }

  if (command === "status") {
    const runtime = await readRuntime(projectDir);
    const canvas = await resolveCanvasOptions(projectDir, options, runtime);
    const state = await readState(projectDir, { canvasId: canvas.canvasId });
    const payload = {
      projectDir,
      runtime,
      canvasId: canvas.canvasId,
      objects: state.objects.length,
      selection: state.selection
    };
    if (flagEnabled(options.json)) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`Project: ${projectDir}`);
      console.log(`Canvas objects: ${payload.objects}`);
      console.log(`Selected: ${payload.selection || "(none)"}`);
      console.log(`Canvas ID: ${payload.canvasId || "(default)"}`);
      console.log(`URL: ${runtime?.url || "(not running)"}`);
    }
    return;
  }

  if (command === "update") {
    const checkOnly = flagEnabled(options.check);
    const result = checkOnly
      ? await appUpdateStatus({ checkRemote: true })
      : await updateApp();
    if (flagEnabled(options.json)) {
      console.log(JSON.stringify(result, null, 2));
    } else if (checkOnly) {
      console.log(`Codex-Canvas ${result.version}`);
      if (result.canUpdate) {
        console.log(`Update strategy: ${result.strategy} from ${result.git.remote}/${result.git.remoteBranch}.`);
      } else {
        console.log(`Automatic update unavailable: ${result.blockedMessage || "manual update required"}`);
      }
      console.log(result.updateAvailable
        ? `Update available: ${result.git.behind} commit(s) behind.`
        : "No update available.");
      if (result.manualCommand) console.log(`Manual command: ${result.manualCommand}`);
    } else {
      console.log(result.output || "Codex-Canvas update completed.");
      console.log(`Current version: ${result.version}`);
      console.log(`Current git head: ${result.git.head || "(unknown)"}`);
    }
    return;
  }

  if (command === "setup-ocr") {
    const result = await installRapidOcr({ optional: flagEnabled(options.optional) });
    if (flagEnabled(options.json)) console.log(JSON.stringify(result, null, 2));
    else console.log(result.message);
    return;
  }

  if (command === "setup-image-deps") {
    const result = await installImageProcessingDeps({ optional: flagEnabled(options.optional) });
    if (flagEnabled(options.json)) console.log(JSON.stringify(result, null, 2));
    else console.log(result.message);
    return;
  }

  if (command === "setup-deps") {
    const result = await installOptionalPythonDeps();
    if (flagEnabled(options.json)) console.log(JSON.stringify(result, null, 2));
    else console.log(result.message);
    return;
  }

  if (command === "doctor-ocr") {
    const result = await checkRapidOcrAvailable();
    if (flagEnabled(options.json)) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.available
        ? `RapidOCR available: ${result.backend}${result.version ? ` ${result.version}` : ""}`
        : `RapidOCR unavailable${result.error ? `: ${result.error}` : ""}`);
    }
    return;
  }

  if (command === "doctor-image-deps") {
    const result = await checkImageProcessingDepsAvailable();
    if (flagEnabled(options.json)) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.available
        ? `Image processing dependencies available: Pillow ${result.versions?.Pillow || ""} numpy ${result.versions?.numpy || ""}`.trim()
        : `Image processing dependencies unavailable${result.missing?.length ? `: missing ${result.missing.join(", ")}` : ""}${result.error ? ` (${result.error})` : ""}`);
    }
    return;
  }

  if (command === "doctor-deps") {
    const result = await checkOptionalPythonDepsAvailable();
    if (flagEnabled(options.json)) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.available
        ? "Optional Python dependencies available."
        : "Optional Python dependencies unavailable; OCR and Edit Elements will use fallbacks or report feature-specific errors.");
    }
    return;
  }

  throw usageError(`Unknown command: ${command}. Run "codex-canvas help" for usage.`);
}

async function autoUpdateBeforeOpen() {
  try {
    const result = await updateApp();
    if (result.updated) {
      console.error(`Codex-Canvas updated from ${result.previousHead || "unknown"} to ${result.git.head || "unknown"} before opening.`);
    }
    return result;
  } catch (error) {
    const message = error?.details?.blockedMessage || error?.message || String(error);
    console.error(`Codex-Canvas auto-update skipped: ${message}`);
    return { updated: false, error: message };
  }
}

function parseOptions(args) {
  const options = {};
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const equalsIndex = arg.indexOf("=");
    if (equalsIndex > 2) {
      options[arg.slice(2, equalsIndex)] = arg.slice(equalsIndex + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return { options, positionals };
}

function optionValue(options, names, label = null) {
  for (const name of names) {
    if (!Object.prototype.hasOwnProperty.call(options, name)) continue;
    const value = options[name];
    if (value === true) throw usageError(`${label || `--${name}`} requires a value.`);
    return value;
  }
  return undefined;
}

function flagEnabled(value) {
  return value === true || value === "" || value === "true" || value === "1";
}

function usageError(message) {
  const error = new Error(message);
  error.name = "CliUsageError";
  error.cliUsage = true;
  error.exitCode = 1;
  return error;
}

function requireSingleImageInput(input) {
  const present = ["path", "url", "dataUrl"].filter((field) => typeof input[field] === "string" && input[field].trim());
  if (present.length === 1) return;
  throw usageError("import requires exactly one image input: <image-path>, --path, --url, or --dataUrl.");
}

function parseList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizePositiveInteger(value, fallback, max) {
  if (value === undefined || value === null || value === true) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.round(number)));
}

function normalizeNonNegativeNumber(value, fallback) {
  if (value === undefined || value === null || value === true) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || !Number.isFinite(number * 60 * 1000)) return fallback;
  return number;
}

export function normalizePort(value, fallback = defaultPort) {
  if (value === undefined || value === null || value === true) return fallback;
  if (typeof value === "string" && value.trim() === "") return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > maxPort) return fallback;
  return number;
}

async function waitForRuntime(projectDir, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runtime = await readRuntime(projectDir);
    if (runtime?.url && await isAgentCanvasAlive(runtime.url)) return runtime.url;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Codex-Canvas server did not start in time");
}

async function resolveCanvasOptions(projectDir, options = {}, runtime = null) {
  const currentRuntime = runtime || await readRuntime(projectDir);
  const explicitThreadId = normalizeThreadId(
    optionValue(options, ["thread-id", "threadId"], "--thread-id")
    || environmentThreadId()
  );
  const threadId = normalizeThreadId(
    explicitThreadId
    || currentRuntime?.chatThreadId
  );
  const canvasId = normalizeThreadId(optionValue(options, ["canvas-id", "canvasId"], "--canvas-id"))
    || canvasIdForThread(explicitThreadId)
    || currentRuntime?.canvasId
    || canvasIdForThread(threadId);
  return {
    threadId,
    canvasId: canvasId || null
  };
}

async function isAgentCanvasAlive(url) {
  return await supportsProjectRegistry(url)
    || await supportsProjectState(url)
    || await servesAgentCanvasApp(url);
}

async function openExistingCanvas(url, projectDir, { autoCollect, chatThreadId, allowLegacy }) {
  if (!url) return null;

  if (await supportsProjectRegistry(url)) {
    const registered = await registerRemoteProject(url, projectDir, { autoCollect, chatThreadId });
    await writeRuntime(projectDir, registered.runtime);
    return registered.url;
  }

  if (allowLegacy && (await supportsProjectState(url) || await servesAgentCanvasApp(url))) {
    return url;
  }

  return null;
}

async function supportsProjectRegistry(url) {
  const response = await fetchWithTimeout(apiUrl(url, "/api/projects"));
  return response?.ok === true;
}

async function supportsProjectState(url) {
  const response = await fetchWithTimeout(apiUrl(url, "/api/state"));
  return response?.ok === true;
}

async function servesAgentCanvasApp(url) {
  const response = await fetchWithTimeout(url);
  if (!response?.ok) return false;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return false;
  const html = await response.text().catch(() => "");
  return html.includes("<title>Codex-Canvas</title>");
}

function apiUrl(baseUrl, pathname) {
  const url = new URL(baseUrl);
  url.pathname = pathname;
  return url;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 750) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function registerRemoteProject(baseUrl, projectDir, { autoCollect = true, chatThreadId = null } = {}) {
  const response = await fetchWithTimeout(apiUrl(baseUrl, "/api/projects"), {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ projectDir, autoCollect, chatThreadId })
  }, 2000);
  if (!response) {
    throw new Error("Codex-Canvas server did not respond to project registration.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Codex-Canvas server did not accept the project registration.");
  }
  const project = payload.project || {};
  return {
    url: payload.url,
    runtime: {
      url: payload.url,
      pid: null,
      projectDir,
      projectId: project.id || null,
      canvasId: project.canvasId || null,
      chatThreadId: project.chatThreadId || chatThreadId || null,
      startedAt: new Date().toISOString(),
      autoCollect,
      reused: true
    }
  };
}

function environmentThreadId() {
  return process.env.CODEX_CANVAS_CODEX_THREAD_ID || process.env.CODEX_THREAD_ID || null;
}

function printHelp() {
  console.log(`
Codex-Canvas

Usage:
  codex-canvas open [--project <dir>] [--host 127.0.0.1] [--port 43217] [--thread-id <codex-thread-id>] [--no-update]
  codex-canvas start [--project <dir>] [--host 127.0.0.1] [--port 43217] [--thread-id <codex-thread-id>] [--no-auto-collect]
  codex-canvas import <image-path> [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--prompt <text>] [--name <name>]
  codex-canvas collect [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--from <dir,dir>] [--since-minutes 120] [--limit 20]
  codex-canvas search [query] [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--type image|text|drawing|job] [--limit 20] [--json]
  codex-canvas prompts [query] [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--limit 20] [--json]
  codex-canvas versions [query] [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--group-by sourceObjectId|batchId|layoutMode|prompt] [--limit 20] [--object-limit 20] [--json]
  codex-canvas status [--project <dir>] [--thread-id <id>] [--canvas-id <id>] [--json]
  codex-canvas update [--check] [--json]
  codex-canvas setup-deps [--json]
  codex-canvas setup-ocr [--optional] [--json]
  codex-canvas setup-image-deps [--optional] [--json]
  codex-canvas doctor-ocr [--json]
  codex-canvas doctor-image-deps [--json]
  codex-canvas doctor-deps [--json]

Commands:
  open      Best-effort fast-forward update, then start or reuse the local server and print the canvas URL.
  start     Run the local canvas server in the foreground with auto-collection enabled.
  import    Copy an image into the project canvas and place it on the board.
  collect   Import recent images from the bound thread directory, or explicit --from recovery roots.
  search    Search canvas objects by name, prompt, text, source path, or grouping metadata.
  prompts   List recent unique prompts from canvas objects.
  versions  Group canvas object version history by sourceObjectId, batchId, layoutMode, or prompt.
  status    Print current canvas runtime and object count.
  update    Check for or apply a git fast-forward update for this Codex-Canvas install.
  setup-ocr Explicitly install RapidOCR for local Edit Text recognition.
  setup-image-deps Explicitly install Pillow and numpy for Edit Elements local layer processing.
  setup-deps Explicitly install optional Python dependencies for OCR and Edit Elements.
  doctor-ocr Check whether local RapidOCR is available.
  doctor-image-deps Check whether Pillow and numpy are available.
  doctor-deps Check all optional Python dependencies without installing them.

Canvas scope:
  --thread-id selects the canvas and default generated_images/<thread-id> collection scope.
  --canvas-id selects an explicit Codex-Canvas canvas scope and overrides --thread-id.
  --from selects explicit project-relative or absolute recovery roots and bypasses the default thread directory.
`.trim());
}
