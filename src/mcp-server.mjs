import readline from "node:readline";
import path from "node:path";
import { main as cliMain } from "./cli.mjs";
import { collectRecentImages } from "./collector.mjs";
import { addImage, readState } from "./store.mjs";
import { pluginRoot, resolveProjectDir } from "./paths.mjs";

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
      serverInfo: { name: "agent-canvas", version: "0.1.0" }
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
              port: { type: "number", description: "Local port. Defaults to 43217." }
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
              prompt: { type: "string" }
            }
          }
        },
        {
          name: "canvas_status",
          description: "Read Agent-Canvas state for the active project.",
          inputSchema: {
            type: "object",
            properties: {
              projectDir: { type: "string" }
            }
          }
        },
        {
          name: "collect_recent_images",
          description: "Scan the project for recent image files and import them into Agent-Canvas. Use as a fallback after imagegen when exact output paths are not known.",
          inputSchema: {
            type: "object",
            properties: {
              projectDir: { type: "string" },
              roots: {
                type: "array",
                items: { type: "string" },
                description: "Optional project-relative directories to scan. Defaults to the full project, excluding canvas assets."
              },
              sourceObjectId: {
                type: "string",
                description: "When collecting an image generated from a selected canvas object, place results in a row to the right of that source object."
              },
              sinceMinutes: { type: "number", description: "Only import images modified in the last N minutes. Defaults to 120." },
              limit: { type: "number", description: "Maximum number of images to import. Defaults to 20." },
              prompt: { type: "string" }
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
      const output = await captureConsole(() => cliMain(
        ["open", "--project", projectDir, "--port", String(args.port || 43217)],
        { entrypoint }
      ));
      const url = output.trim().split(/\s+/).pop();
      return textResult(`Agent-Canvas is available at ${url}`, { url, projectDir });
    }

    if (params.name === "add_image") {
      const projectDir = resolveProjectDir(args.projectDir);
      const object = await addImage(projectDir, args);
      return textResult(`Added image to Agent-Canvas: ${object.name}`, object);
    }

    if (params.name === "canvas_status") {
      const projectDir = resolveProjectDir(args.projectDir);
      const state = await readState(projectDir);
      return textResult(`Agent-Canvas has ${state.objects.length} object(s).`, {
        projectDir,
        objects: state.objects.length,
        selection: state.selection,
        updatedAt: state.updatedAt
      });
    }

    if (params.name === "collect_recent_images") {
      const projectDir = resolveProjectDir(args.projectDir);
      const sinceMinutes = Number(args.sinceMinutes || 120);
      const result = await collectRecentImages(projectDir, {
        roots: Array.isArray(args.roots) ? args.roots : [],
        sinceMs: Date.now() - sinceMinutes * 60 * 1000,
        limit: Number(args.limit || 20),
        prompt: args.prompt || "Collected after image generation",
        sourceObjectId: args.sourceObjectId || null
      });
      return textResult(`Collected ${result.imported.length} recent image(s) into Agent-Canvas.`, result);
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
