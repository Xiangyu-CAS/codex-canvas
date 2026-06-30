import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { addImage, ensureProjectStore, promptHistory, readState, searchObjects, versionGroups } from "./store.mjs";
import { createServer } from "./server.mjs";
import { collectRecentImages } from "./collector.mjs";
import { resolveProjectDir } from "./paths.mjs";
import { checkImageProcessingDepsAvailable, checkOptionalPythonDepsAvailable, checkRapidOcrAvailable, installImageProcessingDeps, installOptionalPythonDeps, installRapidOcr } from "./ocr-setup.mjs";
import { canvasIdForThread, readRuntime, writeRuntime, normalizeThreadId } from "./runtime.mjs";

export async function main(args, context = {}) {
  const command = args[0] || "help";
  const options = parseOptions(args.slice(1));
  const projectDir = resolveProjectDir(options.project);

  if (command === "start") {
    const port = Number(options.port || process.env.AGENT_CANVAS_PORT || 43217);
    const host = options.host || process.env.AGENT_CANVAS_HOST || "127.0.0.1";
    const autoCollect = options["no-auto-collect"] !== true;
    const chatThreadId = normalizeThreadId(options["thread-id"] || options.threadId || process.env.AGENT_CANVAS_CODEX_THREAD_ID);
    const { url } = await createServer({ projectDir, host, port, autoCollect, chatThreadId });
    console.log(`Agent-Canvas listening on ${url}`);
    console.log(`Project: ${projectDir}`);
    console.log(`Auto-collect: ${autoCollect ? "enabled" : "disabled"}`);
    console.log(`Chat thread: ${chatThreadId || "(not bound)"}`);
    await new Promise(() => {});
    return;
  }

  if (command === "open") {
    const port = Number(options.port || process.env.AGENT_CANVAS_PORT || 43217);
    const host = options.host || process.env.AGENT_CANVAS_HOST || "127.0.0.1";
    const defaultUrl = `http://${host}:${port}/`;
    const autoCollect = options["no-auto-collect"] !== true;
    const chatThreadId = normalizeThreadId(options["thread-id"] || options.threadId || process.env.AGENT_CANVAS_CODEX_THREAD_ID);
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
        AGENT_CANVAS_PROJECT_DIR: projectDir
      }
    });
    child.unref();

    const url = await waitForRuntime(projectDir, 5000);
    console.log(url);
    return;
  }

  if (command === "import" || command === "add-image") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const imagePath = options.path || args[1];
    const url = options.url;
    const dataUrl = options.dataUrl;
    const prompt = options.prompt || "";
    const name = options.name;
    const object = await addImage(projectDir, { path: imagePath, url, dataUrl, prompt, name }, { canvasId: canvas.canvasId });
    console.log(JSON.stringify(object, null, 2));
    return;
  }

  if (command === "collect") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const sinceMinutes = Number(options["since-minutes"] || options.since || 120);
    const limit = Number(options.limit || 20);
    const roots = parseList(options.from || options.roots);
    const result = await collectRecentImages(projectDir, {
      roots,
      limit,
      sinceMs: Date.now() - sinceMinutes * 60 * 1000,
      prompt: options.prompt || "Collected after image generation",
      sourceObjectId: options["source-object-id"] || options.sourceObjectId || null,
      canvasId: canvas.canvasId
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "search") {
    const canvas = await resolveCanvasOptions(projectDir, options);
    const query = options.query || args[1] || "";
    const result = await searchObjects(projectDir, {
      query,
      type: options.type || null,
      limit: Number(options.limit || 20),
      canvasId: canvas.canvasId
    });
    if (options.json) {
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
    const query = options.query || args[1] || "";
    const result = await promptHistory(projectDir, {
      query,
      limit: Number(options.limit || 20),
      canvasId: canvas.canvasId
    });
    if (options.json) {
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
    const query = options.query || args[1] || "";
    const result = await versionGroups(projectDir, {
      query,
      groupBy: options["group-by"] || options.groupBy || "sourceObjectId",
      limit: Number(options.limit || 20),
      objectLimit: Number(options["object-limit"] || options.objectLimit || 20),
      canvasId: canvas.canvasId
    });
    if (options.json) {
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
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`Project: ${projectDir}`);
      console.log(`Canvas objects: ${payload.objects}`);
      console.log(`Selected: ${payload.selection || "(none)"}`);
      console.log(`Canvas ID: ${payload.canvasId || "(default)"}`);
      console.log(`URL: ${runtime?.url || "(not running)"}`);
    }
    return;
  }

  if (command === "setup-ocr") {
    const result = await installRapidOcr({ optional: options.optional === true });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.message);
    return;
  }

  if (command === "setup-image-deps") {
    const result = await installImageProcessingDeps({ optional: options.optional === true });
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.message);
    return;
  }

  if (command === "setup-deps") {
    const result = await installOptionalPythonDeps();
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else console.log(result.message);
    return;
  }

  if (command === "doctor-ocr") {
    const result = await checkRapidOcrAvailable();
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.available
        ? `RapidOCR available: ${result.backend}${result.version ? ` ${result.version}` : ""}`
        : `RapidOCR unavailable${result.error ? `: ${result.error}` : ""}`);
    }
    return;
  }

  if (command === "doctor-image-deps") {
    const result = await checkImageProcessingDepsAvailable();
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.available
        ? `Image processing dependencies available: Pillow ${result.versions?.Pillow || ""} numpy ${result.versions?.numpy || ""}`.trim()
        : `Image processing dependencies unavailable${result.missing?.length ? `: missing ${result.missing.join(", ")}` : ""}${result.error ? ` (${result.error})` : ""}`);
    }
    return;
  }

  if (command === "doctor-deps") {
    const result = await checkOptionalPythonDepsAvailable();
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.available
        ? "Optional Python dependencies available."
        : "Optional Python dependencies unavailable; OCR and Edit Elements will use fallbacks or report feature-specific errors.");
    }
    return;
  }

  printHelp();
}

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }
  return options;
}

function parseList(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

async function waitForRuntime(projectDir, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const runtime = await readRuntime(projectDir);
    if (runtime?.url && await isAgentCanvasAlive(runtime.url)) return runtime.url;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Agent-Canvas server did not start in time");
}

async function resolveCanvasOptions(projectDir, options = {}, runtime = null) {
  const currentRuntime = runtime || await readRuntime(projectDir);
  const explicitThreadId = normalizeThreadId(
    options["thread-id"]
    || options.threadId
    || process.env.AGENT_CANVAS_CODEX_THREAD_ID
  );
  const threadId = normalizeThreadId(
    explicitThreadId
    || currentRuntime?.chatThreadId
  );
  const canvasId = normalizeThreadId(options["canvas-id"] || options.canvasId)
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
  return html.includes("<title>Agent-Canvas</title>");
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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectDir, autoCollect, chatThreadId })
  }, 2000);
  if (!response) {
    throw new Error("Agent-Canvas server did not respond to project registration.");
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Agent-Canvas server did not accept the project registration.");
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

function printHelp() {
  console.log(`
Agent-Canvas

Usage:
  agent-canvas open [--project <dir>] [--host 127.0.0.1] [--port 43217] [--thread-id <codex-thread-id>]
  agent-canvas start [--project <dir>] [--host 127.0.0.1] [--port 43217] [--thread-id <codex-thread-id>] [--no-auto-collect]
  agent-canvas import <image-path> [--project <dir>] [--prompt <text>] [--name <name>]
  agent-canvas collect [--project <dir>] [--from <dir,dir>] [--since-minutes 120] [--limit 20]
  agent-canvas search [query] [--project <dir>] [--type image|text|drawing|job] [--limit 20] [--json]
  agent-canvas prompts [query] [--project <dir>] [--limit 20] [--json]
  agent-canvas versions [query] [--project <dir>] [--group-by sourceObjectId|batchId|layoutMode|prompt] [--limit 20] [--object-limit 20] [--json]
  agent-canvas status [--project <dir>] [--json]
  agent-canvas setup-deps [--json]
  agent-canvas setup-ocr [--optional] [--json]
  agent-canvas setup-image-deps [--optional] [--json]
  agent-canvas doctor-ocr [--json]
  agent-canvas doctor-image-deps [--json]
  agent-canvas doctor-deps [--json]

Commands:
  open      Start the local server in the background and print the canvas URL.
  start     Run the local canvas server in the foreground with auto-collection enabled.
  import    Copy an image into the project canvas and place it on the board.
  collect   Import recent image files from ~/.codex/generated_images and the project.
  search    Search canvas objects by name, prompt, text, source path, or grouping metadata.
  prompts   List recent unique prompts from canvas objects.
  versions  Group canvas object version history by sourceObjectId, batchId, layoutMode, or prompt.
  status    Print current canvas runtime and object count.
  setup-ocr Explicitly install RapidOCR for local Edit Text recognition.
  setup-image-deps Explicitly install Pillow and numpy for Edit Elements local layer processing.
  setup-deps Explicitly install optional Python dependencies for OCR and Edit Elements.
  doctor-ocr Check whether local RapidOCR is available.
  doctor-image-deps Check whether Pillow and numpy are available.
  doctor-deps Check all optional Python dependencies without installing them.
`.trim());
}
