import readline from "node:readline";
import path from "node:path";
import { main as cliMain, normalizePort } from "./cli.mjs";
import { collectRecentImages } from "./collector.mjs";
import { sendImageToBoundChat, sendMentionToBoundChat } from "./codex-chat.mjs";
import { createImageJob } from "./jobs.mjs";
import { addImage, promptHistory, readState, searchObjects, versionGroups } from "./store.mjs";
import { pluginRoot, resolveProjectDir } from "./paths.mjs";
import { canvasIdForThread, normalizeThreadId } from "./runtime.mjs";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

const defaultToolLimit = 20;
const maxToolLimit = 100;
const defaultSinceMinutes = 120;
const millisecondsPerMinute = 60_000;

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method?.startsWith("notifications/")) return;

  try {
    const result = await handle(message.method, message.params || {});
    respond(message.id, result);
  } catch (error) {
    respondError(message.id, error);
  }
});

async function handle(method, params) {
  if (method === "initialize") {
    return {
      protocolVersion: params.protocolVersion || "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: { name: "codex-canvas", version: "0.1.1" }
    };
  }

  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "open_canvas",
          description: "Start the Codex-Canvas local server and return the browser URL.",
          inputSchema: {
            type: "object",
            required: ["projectDir"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              port: { type: "number", description: "Local port. Defaults to 43217." },
              threadId: { type: "string", description: "Codex thread id to bind this canvas to for canvas-to-chat and thread-scoped canvas state. Defaults to the current Codex thread when available." },
              autoUpdate: { type: "boolean", description: "Run the best-effort Codex-Canvas fast-forward updater before opening. Defaults to true." }
            }
          }
        },
        {
          name: "add_image",
          description: "Copy or register an image into the current project canvas.",
          inputSchema: {
            type: "object",
            required: ["projectDir"],
            oneOf: [
              { required: ["path"] },
              { required: ["url"] },
              { required: ["dataUrl"] }
            ],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              path: { type: "string", description: "Local image path to copy into the canvas assets folder." },
              url: { type: "string", description: "Remote image URL to place on the canvas." },
              dataUrl: { type: "string", description: "Base64 image data URL." },
              name: { type: "string" },
              prompt: { type: "string" },
              imagegenPrompt: { type: "string", description: "Full prompt sent to the image generation runner, when available." },
              threadId: { type: "string", description: "Codex thread id whose canvas should receive the image. Pass this explicitly for thread-scoped canvases; omitted means the default project canvas." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." }
            }
          }
        },
        {
          name: "canvas_status",
          description: "Read Codex-Canvas state for the active project.",
          inputSchema: {
            type: "object",
            required: ["projectDir"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              threadId: { type: "string", description: "Codex thread id whose canvas status should be read. Pass this explicitly for thread-scoped canvases; omitted means the default project canvas." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." }
            }
          }
        },
        {
          name: "search_canvas",
          description: "Search Codex-Canvas objects by name, prompt, text, source path, or layer metadata.",
          inputSchema: {
            type: "object",
            required: ["projectDir"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              query: { type: "string", description: "Search text. Empty query returns the first matching objects." },
              type: { type: "string", enum: ["image", "text", "drawing", "job"], description: "Optional canvas object type filter." },
              limit: { type: "number", description: "Maximum number of results. Defaults to 20, capped at 100." },
              threadId: { type: "string", description: "Codex thread id whose canvas should be searched. Pass explicitly for thread-scoped canvases; omitted means the default project canvas." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." }
            }
          }
        },
        {
          name: "prompt_history",
          description: "List recent unique prompts used by Codex-Canvas objects.",
          inputSchema: {
            type: "object",
            required: ["projectDir"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              query: { type: "string", description: "Optional text to filter prompts." },
              limit: { type: "number", description: "Maximum number of prompts. Defaults to 20, capped at 100." },
              threadId: { type: "string", description: "Codex thread id whose canvas prompt history should be read. Pass explicitly for thread-scoped canvases; omitted means the default project canvas." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." }
            }
          }
        },
        {
          name: "version_groups",
          description: "Group Codex-Canvas object version history by sourceObjectId, batchId, layoutMode, or prompt.",
          inputSchema: {
            type: "object",
            required: ["projectDir"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              query: { type: "string", description: "Optional text to filter version groups or grouped objects." },
              groupBy: { type: "string", enum: ["sourceObjectId", "batchId", "layoutMode", "prompt"], description: "Version grouping field. Defaults to sourceObjectId." },
              limit: { type: "number", description: "Maximum number of groups. Defaults to 20, capped at 100." },
              objectLimit: { type: "number", description: "Maximum number of objects returned per group. Defaults to 20, capped at 100." },
              threadId: { type: "string", description: "Codex thread id whose canvas version groups should be read. Pass explicitly for thread-scoped canvases; omitted means the default project canvas." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." }
            }
          }
        },
        {
          name: "collect_recent_images",
          description: "Import recent images from the bound Codex thread directory, or from explicit recovery roots. Use as a fallback after imagegen when exact output paths are not known.",
          inputSchema: {
            type: "object",
            required: ["projectDir"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              roots: {
                type: "array",
                items: { type: "string" },
                description: "Optional absolute or project-relative recovery directories. When omitted, only ~/.codex/generated_images/<threadId> is scanned; without a bound thread the default scan is a safe no-op."
              },
              sourceObjectId: {
                type: "string",
                description: "When collecting an image generated from a selected canvas object, place results in a row to the right of that source object."
              },
              threadId: { type: "string", description: "Codex thread id whose generated_images directory and canvas should be used. Pass explicitly for thread-scoped collection; omitted collection is a no-op unless roots are provided." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." },
              sinceMinutes: { type: "number", description: "Only import images modified in the last N minutes. Defaults to 120." },
              limit: { type: "number", description: "Maximum number of images to import. Defaults to 20." },
              prompt: { type: "string" }
            }
          }
        },
        {
          name: "start_image_job",
          description: "Start an Codex-Canvas background image action for a selected canvas image using a stable action id.",
          inputSchema: {
            type: "object",
            required: ["projectDir", "objectId", "action"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              objectId: { type: "string", description: "Canvas image object id to edit." },
              action: {
                type: "string",
                enum: ["quick-edit", "remove-bg", "expand", "edit-elements"],
                description: "Stable Codex-Canvas action id."
              },
              prompt: { type: "string", description: "Optional user guidance for quick-edit or expand." },
              threadId: { type: "string", description: "Codex thread id whose canvas owns the selected object. Pass explicitly for thread-scoped canvases." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." }
            }
          }
        },
        {
          name: "send_to_chat",
          description: "Send a selected Codex-Canvas image to the explicitly bound Codex thread.",
          inputSchema: {
            type: "object",
            required: ["projectDir", "objectId", "action"],
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              action: {
                type: "string",
                enum: ["send-to-chat", "mention-file"],
                description: "Stable Codex-Canvas chat action id. send-to-chat sends visual input; mention-file sends a Codex @file-style mention."
              },
              objectId: { type: "string", description: "Canvas image object id to send." },
              threadId: { type: "string", description: "Codex thread id to receive the selected image. Defaults to the current Codex thread when available." },
              canvasId: { type: "string", description: "Explicit Codex-Canvas canvas id. Overrides the canvas id derived from threadId." },
              includeImage: { type: "boolean", description: "For mention-file only, also attach the local image visual input in the same turn." }
            }
          }
        }
      ]
    };
  }

  if (method === "tools/call") {
    const args = params.arguments || {};
    if (params.name === "open_canvas") {
      const projectDir = requireProjectDir(args);
      const entrypoint = path.join(pluginRoot, "bin", "codex-canvas.mjs");
      const cliArgs = ["open", "--project", projectDir, "--port", String(normalizePort(args.port))];
      if (args.threadId) cliArgs.push("--thread-id", args.threadId);
      if (args.autoUpdate === false) cliArgs.push("--no-update");
      const output = await captureConsole(() => cliMain(
        cliArgs,
        { entrypoint }
      ));
      const url = output.trim().split(/\s+/).pop();
      return textResult(`Codex-Canvas is available: [Open Codex-Canvas](${url})`, { url, projectDir, threadId: normalizeThreadId(args.threadId) || environmentThreadId() });
    }

    if (params.name === "add_image") {
      const projectDir = requireProjectDir(args);
      requireSingleImageInput(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const object = await addImage(projectDir, args, { canvasId: canvas.canvasId });
      return textResult(`Added image to Codex-Canvas: ${object.name}`, object);
    }

    if (params.name === "canvas_status") {
      const projectDir = requireProjectDir(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const state = await readState(projectDir, { canvasId: canvas.canvasId });
      return textResult(`Codex-Canvas has ${state.objects.length} object(s).`, {
        projectDir,
        canvasId: canvas.canvasId,
        objects: state.objects.length,
        selection: state.selection,
        chatThreadId: canvas.threadId || null,
        chatBound: Boolean(canvas.threadId),
        updatedAt: state.updatedAt
      });
    }

    if (params.name === "search_canvas") {
      const projectDir = requireProjectDir(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const result = await searchObjects(projectDir, {
        query: args.query || "",
        type: args.type || null,
        limit: normalizeToolLimit(args.limit),
        canvasId: canvas.canvasId
      });
      return textResult(`Found ${result.total} Codex-Canvas object(s).`, result);
    }

    if (params.name === "prompt_history") {
      const projectDir = requireProjectDir(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const result = await promptHistory(projectDir, {
        query: args.query || "",
        limit: normalizeToolLimit(args.limit),
        canvasId: canvas.canvasId
      });
      return textResult(`Found ${result.total} Codex-Canvas prompt(s).`, result);
    }

    if (params.name === "version_groups") {
      const projectDir = requireProjectDir(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const result = await versionGroups(projectDir, {
        query: args.query || "",
        groupBy: args.groupBy || "sourceObjectId",
        limit: normalizeToolLimit(args.limit),
        objectLimit: normalizeToolLimit(args.objectLimit),
        canvasId: canvas.canvasId
      });
      return textResult(`Found ${result.total} Codex-Canvas version group(s).`, result);
    }

    if (params.name === "collect_recent_images") {
      const projectDir = requireProjectDir(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const result = await collectRecentImages(projectDir, {
        roots: Array.isArray(args.roots) ? args.roots : [],
        sinceMs: sinceMsFromMinutes(args.sinceMinutes),
        limit: normalizeToolLimit(args.limit),
        prompt: args.prompt || "Collected after image generation",
        sourceObjectId: args.sourceObjectId || null,
        canvasId: canvas.canvasId,
        threadId: canvas.threadId
      });
      return textResult(`Collected ${result.imported.length} recent image(s) into Codex-Canvas.`, result);
    }

    if (params.name === "start_image_job") {
      const projectDir = requireProjectDir(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const job = await createImageJob(projectDir, {
        objectId: args.objectId,
        action: args.action,
        prompt: args.prompt || ""
      }, { canvasId: canvas.canvasId });
      return textResult(`Started ${args.action} for Codex-Canvas object ${args.objectId}.`, job);
    }

    if (params.name === "send_to_chat") {
      const projectDir = requireProjectDir(args);
      const canvas = await resolveCanvasOptions(projectDir, args);
      requireSendToChatAction(args);
      if (!canvas.threadId) {
        const error = new Error("send_to_chat requires an explicit Codex threadId.");
        error.statusCode = 400;
        throw error;
      }
      const state = await readState(projectDir, { canvasId: canvas.canvasId });
      const object = state.objects.find((item) => item.id === args.objectId);
      if (!object || (object.type || "image") !== "image") {
        const error = new Error("A selected canvas image object is required before sending to chat.");
        error.statusCode = 400;
        throw error;
      }
      const imagePath = object.assetPath || object.sourcePath;
      const result = args.action === "mention-file"
        ? await sendMentionToBoundChat({
          projectDir,
          threadId: canvas.threadId,
          filePath: imagePath,
          prompt: `Codex-Canvas mentioned @${object.name || "selected-image"} as a file context. Do not analyze or edit it yet. Reply only that the file is available and wait for the next instruction.`,
          includeImage: args.includeImage === true
        })
        : await sendImageToBoundChat({
          projectDir,
          threadId: canvas.threadId,
          imagePath,
          prompt: "Use this selected Codex-Canvas image as context."
        });
      return textResult(`Sent Codex-Canvas object ${object.id} to Codex thread ${canvas.threadId}.`, {
        ...result,
        action: args.action,
        objectId: object.id,
        imagePath
      });
    }
  }

  throw new Error(`Unsupported MCP method: ${method}`);
}

function requireProjectDir(args = {}) {
  const projectDir = typeof args.projectDir === "string" ? args.projectDir.trim() : "";
  if (!projectDir) {
    const error = new Error("MCP tool call requires projectDir.");
    error.statusCode = 400;
    throw error;
  }
  if (!path.isAbsolute(projectDir)) {
    const error = new Error("MCP tool call requires an absolute projectDir.");
    error.statusCode = 400;
    throw error;
  }
  return resolveProjectDir(projectDir);
}

function textResult(text, data) {
  return {
    content: [{ type: "text", text }],
    structuredContent: data
  };
}

function requireSingleImageInput(args = {}) {
  const present = ["path", "url", "dataUrl"].filter((field) => typeof args[field] === "string" && args[field].trim());
  if (present.length === 1) return;
  const error = new Error("add_image requires exactly one image input: path, url, or dataUrl.");
  error.statusCode = 400;
  throw error;
}

function requireSendToChatAction(args = {}) {
  if (args.action === "send-to-chat" || args.action === "mention-file") return;
  const error = new Error("send_to_chat requires a stable chat action: send-to-chat or mention-file.");
  error.statusCode = 400;
  throw error;
}

function normalizeToolLimit(value) {
  if (value === undefined || value === null || value === "") return defaultToolLimit;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return defaultToolLimit;
  return Math.min(maxToolLimit, Math.max(1, Math.round(number)));
}

function sinceMsFromMinutes(value) {
  const minutes = normalizeSinceMinutes(value);
  const now = Date.now();
  const deltaMs = minutes * millisecondsPerMinute;
  const sinceMs = now - deltaMs;
  if (!Number.isFinite(deltaMs) || !Number.isFinite(sinceMs)) {
    return now - defaultSinceMinutes * millisecondsPerMinute;
  }
  return sinceMs;
}

function normalizeSinceMinutes(value) {
  if (value === undefined || value === null || value === "") return defaultSinceMinutes;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return defaultSinceMinutes;
  return number;
}

function respond(id, result) {
  if (id === undefined || id === null) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, error) {
  if (id === undefined || id === null) return;
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: jsonRpcErrorCode(statusCode),
      message: error?.message || String(error),
      data: { statusCode }
    }
  })}\n`);
}

function jsonRpcErrorCode(statusCode) {
  if (statusCode === 400) return -32602;
  if (statusCode === 403) return -32003;
  if (statusCode === 404) return -32004;
  if (statusCode === 409) return -32009;
  if (statusCode === 503) return -32003;
  return -32000;
}

async function captureConsole(fn) {
  const original = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

async function resolveCanvasOptions(projectDir, args = {}, runtime = null) {
  const explicitThreadId = normalizeThreadId(args.threadId);
  const explicitCanvasId = normalizeThreadId(args.canvasId);
  const threadId = explicitThreadId || environmentThreadId();
  const canvasId = explicitCanvasId || canvasIdForThread(explicitThreadId);
  return {
    threadId,
    canvasId: canvasId || canvasIdForThread(threadId) || null
  };
}

function environmentThreadId() {
  return normalizeThreadId(process.env.CODEX_CANVAS_CODEX_THREAD_ID || process.env.CODEX_THREAD_ID);
}
