import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sendImageToBoundChat } from "../src/codex-chat.mjs";
import { assetsDirFor } from "../src/paths.mjs";
import { createServer } from "../src/server.mjs";
import { addImage, addObject, deleteObjects, readState, transformState, updateObject } from "../src/store.mjs";

const execFileAsync = promisify(execFile);

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

async function main() {
  const results = [];
  for (const [name, test] of [
    ["store concurrency", testStoreConcurrency],
    ["object patch sanitization", testObjectPatchSanitization],
    ["http object patch sanitization", testHttpObjectPatchSanitization],
    ["thread migration asset paths", testThreadMigrationAssetPaths],
    ["mcp canvas status", testMcpCanvasStatus],
    ["auto collector watermark", testAutoCollectorWatermark],
    ["chat binding alias", testChatBindingAlias],
    ["chat websocket fallback", testChatWebSocketFallback],
    ["chat turn action contract", testChatTurnActionContract],
    ["edit elements scripts", testEditElementsScripts]
  ]) {
    await test();
    results.push(name);
  }
  console.log(JSON.stringify({ ok: true, tests: results }, null, 2));
}

async function testObjectPatchSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-patch-"));
  const image = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "safe.png",
    x: 10,
    y: 20
  });
  const updated = await updateObject(projectDir, image.id, {
    x: "not-a-number",
    y: 42,
    width: -10,
    src: "https://example.invalid/evil.png",
    assetPath: "/tmp/evil.png",
    sourcePath: "/tmp/source.png",
    type: "text",
    createdAt: "1900-01-01T00:00:00.000Z"
  });
  assertEqual(updated.x, 10, "updateObject should ignore non-numeric coordinates");
  assertEqual(updated.y, 42, "updateObject should keep valid numeric coordinates");
  assertEqual(updated.width, 1, "updateObject should clamp dimensions");
  assertEqual(updated.src, image.src, "updateObject should not allow src mutation");
  assertEqual(updated.assetPath, image.assetPath, "updateObject should not allow assetPath mutation");
  assertEqual(updated.sourcePath, image.sourcePath || null, "updateObject should not allow sourcePath mutation");
  assertEqual(updated.type, "image", "updateObject should not allow type mutation");
  assertEqual(updated.createdAt, image.createdAt, "updateObject should not allow createdAt mutation");
}

async function testHttpObjectPatchSanitization() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-http-patch-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const image = await postJson(`${base}api/images${search}`, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: "safe.png",
      x: 12,
      y: 24
    });
    assertEqual(image.status, 201, "HTTP image setup should succeed");
    const patched = await fetch(`${base}api/objects/${image.body.id}${search}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        x: "bad",
        y: 64,
        src: "https://example.invalid/evil.png",
        assetPath: "/tmp/evil.png",
        sourcePath: "/tmp/source.png",
        type: "text"
      })
    });
    const body = await patched.json();
    assertEqual(patched.status, 200, "HTTP object patch should succeed with sanitized fields");
    assertEqual(body.x, 12, "HTTP patch should ignore invalid coordinate values");
    assertEqual(body.y, 64, "HTTP patch should keep valid coordinate values");
    assertEqual(body.src, image.body.src, "HTTP patch should not mutate src");
    assertEqual(body.assetPath, image.body.assetPath, "HTTP patch should not mutate assetPath");
    assertEqual(body.sourcePath, image.body.sourcePath || null, "HTTP patch should not mutate sourcePath");
    assertEqual(body.type, "image", "HTTP patch should not mutate type");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testThreadMigrationAssetPaths() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-migrate-"));
  const defaultImage = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "default.png"
  });
  const threadCanvasId = "thread-migration-test";
  const migrated = await readState(projectDir, { canvasId: threadCanvasId });
  const migratedImage = migrated.objects.find((object) => object.id === defaultImage.id);
  if (!migratedImage) throw new Error("Thread canvas migration should preserve default image objects.");
  const expectedAssetsDir = assetsDirFor(projectDir, threadCanvasId);
  if (!isInsidePath(expectedAssetsDir, migratedImage.assetPath || "")) {
    throw new Error("Thread canvas migration should rewrite assetPath into the thread assets directory.");
  }
  await fs.access(migratedImage.assetPath);
}

async function testAutoCollectorWatermark() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-collector-"));
  const { server, url } = await createServer({
    projectDir,
    port: 0,
    autoCollect: true,
    autoCollectIntervalMs: 100
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const staleMtimeMs = Date.now();
    const firstPath = path.join(projectDir, "first.png");
    await fs.writeFile(firstPath, Buffer.from(pngOne, "base64"));
    await waitForObjectCount(`${base}api/state${search}`, 1, "auto collector should import a new project image");

    const stalePath = path.join(projectDir, "stale-but-new-file.png");
    await fs.writeFile(stalePath, Buffer.from("not a real png, but a unique image candidate"));
    await fs.utimes(stalePath, staleMtimeMs / 1000, staleMtimeMs / 1000);
    await delay(450);
    const stateResponse = await fetch(`${base}api/state${search}`);
    const state = await stateResponse.json();
    assertEqual(state.objects.length, 1, "auto collector should advance its watermark after a successful scan");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testMcpCanvasStatus() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-mcp-"));
  await addObject(projectDir, { type: "text", text: "mcp", x: 10, y: 10 });
  const client = await startMcpServer();
  try {
    const initialized = await client.request("initialize", {});
    assertEqual(initialized.serverInfo?.version, "0.1.1", "MCP server version should match package version");
    const listed = await client.request("tools/list", {});
    if (!listed.tools?.some((tool) => tool.name === "canvas_status")) {
      throw new Error("MCP tools/list should expose canvas_status.");
    }
    const status = await client.request("tools/call", {
      name: "canvas_status",
      arguments: { projectDir }
    });
    assertEqual(status.structuredContent?.objects, 1, "MCP canvas_status should read default canvas state");
    assertEqual(status.structuredContent?.chatBound, false, "MCP canvas_status should not infer chat binding without threadId");
  } finally {
    await client.stop();
  }
}

async function testChatTurnActionContract() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-chat-turn-"));
  const fakeCodex = path.join(tmp, process.platform === "win32" ? "codex.cmd" : "codex");
  await fs.writeFile(fakeCodex, fakeCodexAppServerScript(), { mode: 0o755 });

  const previousCli = process.env.AGENT_CANVAS_CODEX_CLI;
  process.env.AGENT_CANVAS_CODEX_CLI = fakeCodex;
  const { server, url } = await createServer({
    projectDir: tmp,
    port: 0,
    autoCollect: false,
    chatThreadId: "thread-test"
  });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const image = await postJson(`${base}api/images${search}`, {
      dataUrl: `data:image/png;base64,${pngOne}`,
      name: "chat.png"
    });
    assertEqual(image.status, 201, "test image should be added before chat turn");

    const missingAction = await postJson(`${base}api/chat-turn${search}`, {
      objectId: image.body.id
    });
    assertEqual(missingAction.status, 400, "chat turn should require stable send-to-chat action");

    const sent = await postJson(`${base}api/chat-turn${search}`, {
      action: "send-to-chat",
      objectId: image.body.id
    });
    assertEqual(sent.status, 200, "chat turn with stable action should succeed");
    assertEqual(sent.body.status, "completed", "chat turn should complete through fake app-server");
  } finally {
    process.env.AGENT_CANVAS_CODEX_CLI = previousCli;
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testStoreConcurrency() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-store-"));
  const created = await Promise.all(Array.from({ length: 20 }, (_, index) => (
    addObject(projectDir, { type: "text", text: `item-${index}`, x: index, y: index })
  )));
  let state = await readState(projectDir);
  assertEqual(state.objects.length, 20, "concurrent addObject should not lose objects");

  await Promise.all([
    ...created.map((object, index) => updateObject(projectDir, object.id, { x: 100 + index })),
    transformState(projectDir, {}, (current) => ({ ...current, title: "concurrent" }))
  ]);
  state = await readState(projectDir);
  assertEqual(state.title, "concurrent", "transformState should preserve metadata");
  assertEqual(new Set(state.objects.map((object) => object.x)).size, 20, "concurrent updateObject should not lose updates");

  await Promise.all([
    deleteObjects(projectDir, created.slice(0, 10).map((object) => object.id)),
    deleteObjects(projectDir, created.slice(10).map((object) => object.id))
  ]);
  state = await readState(projectDir);
  assertEqual(state.objects.length, 0, "concurrent deleteObjects should remove every object");
}

async function testChatBindingAlias() {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-rebind-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const base = url.replace(/\?.*/, "");
  const search = new URL(url).search;
  try {
    const first = await postJson(`${base}api/chat-binding${search}`, { threadId: "thread-one" });
    const second = await postJson(`${base}api/chat-binding${search}`, { threadId: "thread-two" });
    assertEqual(first.status, 200, "first chat binding should succeed");
    assertEqual(second.status, 200, "second chat binding through old project id should succeed");
    const stateResponse = await fetch(`${base}api/state${search}`);
    assertEqual(stateResponse.status, 200, "old project id alias should resolve after repeated binding");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function testChatWebSocketFallback() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-chat-"));
  const fakeCodex = path.join(tmp, process.platform === "win32" ? "codex.cmd" : "codex");
  const imagePath = path.join(tmp, "image.png");
  await fs.writeFile(imagePath, Buffer.from(pngOne, "base64"));
  await fs.writeFile(fakeCodex, fakeCodexAppServerScript(), { mode: 0o755 });

  const previousCli = process.env.AGENT_CANVAS_CODEX_CLI;
  const previousWebSocket = globalThis.WebSocket;
  process.env.AGENT_CANVAS_CODEX_CLI = fakeCodex;
  globalThis.WebSocket = undefined;
  try {
    const result = await sendImageToBoundChat({
      projectDir: tmp,
      threadId: "thread-test",
      imagePath,
      prompt: "hello"
    });
    assertEqual(result.status, "completed", "fallback WebSocket chat turn should complete");
  } finally {
    process.env.AGENT_CANVAS_CODEX_CLI = previousCli;
    globalThis.WebSocket = previousWebSocket;
  }
}

async function testEditElementsScripts() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "agent-canvas-elements-"));
  const makeImages = path.join(tmp, "make-images.py");
  await fs.writeFile(makeImages, [
    "from pathlib import Path",
    "from PIL import Image, ImageDraw",
    "import sys",
    "root = Path(sys.argv[1])",
    "source = Image.new('RGBA', (32, 32), (255, 255, 255, 255))",
    "draw = ImageDraw.Draw(source)",
    "draw.rectangle((8, 8, 18, 18), fill=(255, 0, 0, 255))",
    "source.save(root / 'source.png')",
    "seg = Image.new('RGB', (32, 32), (0, 0, 0))",
    "draw = ImageDraw.Draw(seg)",
    "draw.rectangle((8, 8, 18, 18), fill=(255, 0, 102))",
    "seg.save(root / 'seg.png')",
    "completed = Image.new('RGBA', (32, 32), (240, 240, 240, 255))",
    "completed.save(root / 'completed.png')"
  ].join("\n"));

  await runPython([makeImages, tmp]);
  await runPython([
    path.join(process.cwd(), "scripts", "split_elements.py"),
    "--source", path.join(tmp, "source.png"),
    "--segmentation", path.join(tmp, "seg.png"),
    "--out-dir", path.join(tmp, "layers"),
    "--max-layers", "8",
    "--palette-size", "8",
    "--force"
  ]);
  await runPython([
    path.join(process.cwd(), "scripts", "prepare_completed_background.py"),
    "--source", path.join(tmp, "source.png"),
    "--completed", path.join(tmp, "completed.png"),
    "--out", path.join(tmp, "background.png"),
    "--force"
  ]);

  const manifest = JSON.parse(await fs.readFile(path.join(tmp, "layers", "elements-manifest.json"), "utf8"));
  assertEqual(manifest.layers.length, 2, "split_elements should export foreground and background layers");
  await fs.access(path.join(tmp, "background.png"));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitForObjectCount(url, expected, message) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 4000) {
    const response = await fetch(url);
    const state = await response.json();
    if (state.objects?.length === expected) return state;
    await delay(100);
  }
  throw new Error(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isInsidePath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function startMcpServer() {
  const child = spawn(process.execPath, [path.join(process.cwd(), "src", "mcp-server.mjs")], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"]
  });
  let nextId = 1;
  let buffer = "";
  const pending = new Map();
  const errors = [];

  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error.message || "MCP request failed"));
      else request.resolve(message.result);
    }
  });

  const request = (method, params) => {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}${errors.length ? `: ${errors.join("").trim()}` : ""}`));
      }, 5000);
      timeout.unref?.();
      pending.set(id, { resolve, reject, timeout });
    });
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  };

  const stop = () => new Promise((resolve) => {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("MCP server stopped."));
    }
    pending.clear();
    child.once("close", resolve);
    child.kill();
    setTimeout(resolve, 1000).unref?.();
  });

  return { request, stop };
}

async function runPython(args) {
  const candidates = process.platform === "win32"
    ? [["py", ["-3", ...args]], ["python", args], ["python3", args]]
    : [["python3", args], ["python", args]];
  const errors = [];
  for (const [command, commandArgs] of candidates) {
    try {
      await execFileAsync(command, commandArgs, { maxBuffer: 1024 * 1024, windowsHide: true });
      return;
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }
  throw new Error(`Python smoke step failed. ${errors.join(" | ")}`);
}

function fakeCodexAppServerScript() {
  return `#!/usr/bin/env node
const crypto = require("crypto");
const net = require("net");
const listen = process.argv[process.argv.indexOf("--listen") + 1];
const port = Number(new URL(listen).port);
function encode(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  return Buffer.concat([Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]), payload]);
}
function decode(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  }
  const masked = Boolean(buffer[1] & 0x80);
  const mask = masked ? buffer.slice(offset, offset + 4) : null;
  offset += masked ? 4 : 0;
  if (buffer.length < offset + length) return null;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (mask) for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
  return { opcode, text: payload.toString("utf8"), bytesRead: offset + length };
}
net.createServer((socket) => {
  let handshaken = false;
  let buffer = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshaken) {
      const end = buffer.indexOf("\\r\\n\\r\\n");
      if (end < 0) return;
      const header = buffer.slice(0, end).toString("utf8");
      const key = /sec-websocket-key:\\s*(.+)/i.exec(header)[1].trim();
      const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      socket.write(["HTTP/1.1 101 Switching Protocols", "Upgrade: websocket", "Connection: Upgrade", "Sec-WebSocket-Accept: " + accept, "", ""].join("\\r\\n"));
      buffer = buffer.slice(end + 4);
      handshaken = true;
    }
    for (;;) {
      const frame = decode(buffer);
      if (!frame) return;
      buffer = buffer.slice(frame.bytesRead);
      if (frame.opcode !== 1) {
        if (frame.opcode === 8) socket.end();
        continue;
      }
      const message = JSON.parse(frame.text);
      if (message.method === "turn/start") {
        socket.write(encode(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { turn: { id: "turn-1" } } })));
        socket.write(encode(JSON.stringify({ jsonrpc: "2.0", method: "turn/completed", params: { threadId: message.params.threadId, turn: { id: "turn-1", status: "completed", durationMs: 7 } } })));
      } else {
        socket.write(encode(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: {} })));
      }
    }
  });
}).listen(port, "127.0.0.1");
`;
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
