import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { addImage, ensureProjectStore, readState } from "./store.mjs";
import { createServer } from "./server.mjs";
import { collectRecentImages } from "./collector.mjs";
import { resolveProjectDir, runtimePathFor } from "./paths.mjs";
import { checkRapidOcrAvailable, installRapidOcr } from "./ocr-setup.mjs";

export async function main(args, context = {}) {
  const command = args[0] || "help";
  const options = parseOptions(args.slice(1));
  const projectDir = resolveProjectDir(options.project);

  if (command === "start") {
    const port = Number(options.port || process.env.AGENT_CANVAS_PORT || 43217);
    const host = options.host || process.env.AGENT_CANVAS_HOST || "127.0.0.1";
    const autoCollect = options["no-auto-collect"] !== true;
    const { url } = await createServer({ projectDir, host, port, autoCollect });
    console.log(`Agent-Canvas listening on ${url}`);
    console.log(`Project: ${projectDir}`);
    console.log(`Auto-collect: ${autoCollect ? "enabled" : "disabled"}`);
    await new Promise(() => {});
    return;
  }

  if (command === "open") {
    await ensureProjectStore(projectDir);
    const port = Number(options.port || process.env.AGENT_CANVAS_PORT || 43217);
    const host = options.host || process.env.AGENT_CANVAS_HOST || "127.0.0.1";
    const defaultUrl = `http://${host}:${port}/`;
    const autoCollect = options["no-auto-collect"] !== true;
    const runtime = await readRuntime(projectDir);
    if (runtime && await isAgentCanvasAlive(runtime.url)) {
      const registered = await registerRemoteProject(runtime.url, projectDir, { autoCollect });
      await writeRuntime(projectDir, registered.runtime);
      console.log(registered.url);
      return;
    }

    if (await isAgentCanvasAlive(defaultUrl)) {
      const registered = await registerRemoteProject(defaultUrl, projectDir, { autoCollect });
      await writeRuntime(projectDir, registered.runtime);
      console.log(registered.url);
      return;
    }

    const entrypoint = context.entrypoint || fileURLToPath(import.meta.url);
    const startArgs = [entrypoint, "start", "--project", projectDir, "--host", host, "--port", String(port)];
    if (!autoCollect) startArgs.push("--no-auto-collect");
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
    const imagePath = options.path || args[1];
    const url = options.url;
    const dataUrl = options.dataUrl;
    const prompt = options.prompt || "";
    const name = options.name;
    const object = await addImage(projectDir, { path: imagePath, url, dataUrl, prompt, name });
    console.log(JSON.stringify(object, null, 2));
    return;
  }

  if (command === "collect") {
    const sinceMinutes = Number(options["since-minutes"] || options.since || 120);
    const limit = Number(options.limit || 20);
    const roots = parseList(options.from || options.roots);
    const result = await collectRecentImages(projectDir, {
      roots,
      limit,
      sinceMs: Date.now() - sinceMinutes * 60 * 1000,
      prompt: options.prompt || "Collected after image generation",
      sourceObjectId: options["source-object-id"] || options.sourceObjectId || null
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (command === "status") {
    const state = await readState(projectDir);
    const runtime = await readRuntime(projectDir);
    const payload = {
      projectDir,
      runtime,
      objects: state.objects.length,
      selection: state.selection
    };
    if (options.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`Project: ${projectDir}`);
      console.log(`Canvas objects: ${payload.objects}`);
      console.log(`Selected: ${payload.selection || "(none)"}`);
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

async function readRuntime(projectDir) {
  try {
    return JSON.parse(await fs.readFile(runtimePathFor(projectDir), "utf8"));
  } catch {
    return null;
  }
}

async function writeRuntime(projectDir, runtime) {
  await fs.mkdir(path.dirname(runtimePathFor(projectDir)), { recursive: true });
  await fs.writeFile(runtimePathFor(projectDir), `${JSON.stringify(runtime, null, 2)}\n`);
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

async function isAgentCanvasAlive(url) {
  try {
    const response = await fetch(new URL("/api/projects", url));
    return response.ok;
  } catch {
    return false;
  }
}

async function registerRemoteProject(baseUrl, projectDir, { autoCollect = true } = {}) {
  const response = await fetch(new URL("/api/projects", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectDir, autoCollect })
  });
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
  agent-canvas open [--project <dir>] [--host 127.0.0.1] [--port 43217]
  agent-canvas start [--project <dir>] [--host 127.0.0.1] [--port 43217] [--no-auto-collect]
  agent-canvas import <image-path> [--project <dir>] [--prompt <text>] [--name <name>]
  agent-canvas collect [--project <dir>] [--from <dir,dir>] [--since-minutes 120] [--limit 20]
  agent-canvas status [--project <dir>] [--json]
  agent-canvas setup-ocr [--optional] [--json]
  agent-canvas doctor-ocr [--json]

Commands:
  open      Start the local server in the background and print the canvas URL.
  start     Run the local canvas server in the foreground with auto-collection enabled.
  import    Copy an image into the project canvas and place it on the board.
  collect   Import recent image files from the project as a fallback auto-collector.
  status    Print current canvas runtime and object count.
  setup-ocr Install RapidOCR for local Edit Text recognition.
  doctor-ocr Check whether local RapidOCR is available.
`.trim());
}
