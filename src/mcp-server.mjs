import readline from "node:readline";
import path from "node:path";
import { main as cliMain } from "./cli.mjs";
import { collectRecentImages } from "./collector.mjs";
import { sendImageToBoundChat } from "./codex-chat.mjs";
import { createImageJob } from "./jobs.mjs";
import { addImage, readState } from "./store.mjs";
import { pluginRoot, resolveProjectDir } from "./paths.mjs";
import { canvasIdForThread, normalizeThreadId } from "./runtime.mjs";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

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
      serverInfo: { name: "agent-canvas", version: "0.1.1" }
    };
  }

  if (method === "tools/list") {
    return {
      tools: [
        {
          name: "open_canvas",
          description: "Start the Agent-Canvas local server and return the browser URL.",
          inputSchema: {
            type: "object",
            properties: {
              projectDir: { type: "string", description: "Absolute path to the active Codex project." },
              port: { type: "number", description: "Local port. Defaults to 43217." },
              threadId: { type: "string", description: "Codex thread id to bind this canvas to for canvas-to-chat and thread-scoped canvas state." }
            }
          }
        },
        {
          name: "add_image",
          description: "Copy or register an image into the current project canvas.",
          inputSchema: {
            type: "object",
            properties: {
              projectDir: { type: "string" },
              path: { type: "string", description: "Local image path to copy into the canvas assets folder." },
              url: { type: "string", description: "Remote image URL to place on the canvas." },
              dataUrl: { type: "string", description: "Base64 image data URL." },
              name: { type: "string" },
              prompt: { type: "string" },
              threadId: { type: "string", description: "Codex thread id whose canvas should receive the image. Pass this explicitly for thread-scoped canvases; omitted means the default project canvas." }
            }
          }
        },
        {
          name: "canvas_status",
          description: "Read Agent-Canvas state for the active project.",
          inputSchema: {
            type: "object",
            properties: {
              projectDir: { type: "string" },
              threadId: { type: "string", description: "Codex thread id whose canvas status should be read. Pass this explicitly for thread-scoped canvases; omitted means the default project canvas." }
            }
          }
        },
        {
          name: "collect_recent_images",
          description: "Scan recent generated and project images and import them into Agent-Canvas. Use as a fallback after imagegen when exact output paths are not known.",
          inputSchema: {
            type: "object",
            properties: {
              projectDir: { type: "string" },
              roots: {
                type: "array",
                items: { type: "string" },
                description: "Optional project-relative directories to scan. Defaults to ~/.codex/generated_images plus the current project, excluding canvas assets."
              },
              sourceObjectId: {
                type: "string",
                description: "When collecting an image generated from a selected canvas object, place results in a row to the right of that source object."
              },
              threadId: { type: "string", description: "Codex thread id whose canvas should receive collected images. Pass this explicitly for thread-scoped canvases; omitted means the default project canvas." },
              sinceMinutes: { type: "number", description: "Only import images modified in the last N minutes. Defaults to 120." },
              limit: { type: "number", description: "Maximum number of images to import. Defaults to 20." },
              prompt: { type: "string" }
            }
          }
        },
        {
          name: "start_image_job",
          description: "Start an Agent-Canvas background image action for a selected canvas image using a stable action id.",
          inputSchema: {
            type: "object",
            required: ["projectDir", "objectId", "action"],
            properties: {
              projectDir: { type: "string" },
              objectId: { type: "string", description: "Canvas image object id to edit." },
              action: {
                type: "string",
                enum: ["quick-edit", "remove-bg", "edit-elements"],
                description: "Stable Agent-Canvas action id. Edit Text uses the frontend recognition flow."
              },
              prompt: { type: "string", description: "User edit request for quick-edit only." },
              threadId: { type: "string", description: "Codex thread id whose canvas owns the selected object. Pass explicitly for thread-scoped canvases." }
            }
          }
        },
        {
          name: "send_to_chat",
          description: "Send a selected Agent-Canvas image to the explicitly bound Codex thread.",
          inputSchema: {
            type: "object",
            required: ["projectDir", "objectId", "threadId"],
            properties: {
              projectDir: { type: "string" },
              objectId: { type: "string", description: "Canvas image object id to send." },
              threadId: { type: "string", description: "Codex thread id to receive the selected image." }
            }
          }
        }
      ]
    };
  }

  if (method === "tools/call") {
    const args = params.arguments || {};
    if (params.name === "open_canvas") {
      const projectDir = resolveProjectDir(args.projectDir);
      const entrypoint = path.join(pluginRoot, "bin", "agent-canvas.mjs");
      const cliArgs = ["open", "--project", projectDir, "--port", String(args.port || 43217)];
      if (args.threadId) cliArgs.push("--thread-id", args.threadId);
      const output = await captureConsole(() => cliMain(
        cliArgs,
        { entrypoint }
      ));
      const url = output.trim().split(/\s+/).pop();
      return textResult(`Agent-Canvas is available at ${url}`, { url, projectDir, threadId: args.threadId || null });
    }

    if (params.name === "add_image") {
      const projectDir = resolveProjectDir(args.projectDir);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const object = await addImage(projectDir, args, { canvasId: canvas.canvasId });
      return textResult(`Added image to Agent-Canvas: ${object.name}`, object);
    }

    if (params.name === "canvas_status") {
      const projectDir = resolveProjectDir(args.projectDir);
      const runtime = await readRuntime(projectDir);
      const canvas = await resolveCanvasOptions(projectDir, args, runtime);
      const state = await readState(projectDir, { canvasId: canvas.canvasId });
      return textResult(`Agent-Canvas has ${state.objects.length} object(s).`, {
        projectDir,
        canvasId: canvas.canvasId,
        objects: state.objects.length,
        selection: state.selection,
        chatThreadId: canvas.threadId || null,
        chatBound: Boolean(canvas.threadId),
        updatedAt: state.updatedAt
      });
    }

    if (params.name === "collect_recent_images") {
      const projectDir = resolveProjectDir(args.projectDir);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const sinceMinutes = Number(args.sinceMinutes || 120);
      const result = await collectRecentImages(projectDir, {
        roots: Array.isArray(args.roots) ? args.roots : [],
        sinceMs: Date.now() - sinceMinutes * 60 * 1000,
        limit: Number(args.limit || 20),
        prompt: args.prompt || "Collected after image generation",
        sourceObjectId: args.sourceObjectId || null,
        canvasId: canvas.canvasId
      });
      return textResult(`Collected ${result.imported.length} recent image(s) into Agent-Canvas.`, result);
    }

    if (params.name === "start_image_job") {
      const projectDir = resolveProjectDir(args.projectDir);
      const canvas = await resolveCanvasOptions(projectDir, args);
      const job = await createImageJob(projectDir, {
        objectId: args.objectId,
        action: args.action,
        prompt: args.prompt || ""
      }, { canvasId: canvas.canvasId });
      return textResult(`Started ${args.action} for Agent-Canvas object ${args.objectId}.`, job);
    }

    if (params.name === "send_to_chat") {
      const projectDir = resolveProjectDir(args.projectDir);
      const canvas = await resolveCanvasOptions(projectDir, args);
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
      const result = await sendImageToBoundChat({
        projectDir,
        threadId: canvas.threadId,
        imagePath,
        prompt: "Use this selected Agent-Canvas image as context."
      });
      return textResult(`Sent Agent-Canvas object ${object.id} to Codex thread ${canvas.threadId}.`, {
        ...result,
        objectId: object.id,
        imagePath
      });
    }
  }

  throw new Error(`Unsupported MCP method: ${method}`);
}

function textResult(text, data) {
  return {
    content: [{ type: "text", text }],
    structuredContent: data
  };
}

function respond(id, result) {
  if (id === undefined || id === null) return;
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function respondError(id, error) {
  if (id === undefined || id === null) return;
  process.stdout.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id,
    error: {
      code: -32000,
      message: error?.message || String(error)
    }
  })}\n`);
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
  const threadId = explicitThreadId;
  const canvasId = explicitCanvasId || canvasIdForThread(explicitThreadId);
  return {
    threadId,
    canvasId: canvasId || null
  };
}
