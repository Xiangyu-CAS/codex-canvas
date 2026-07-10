import crypto from "node:crypto";
import path from "node:path";
import net from "node:net";
import { resolveCodexExecutable, spawnCodexProcess } from "./codex-runner.mjs";
import { APP_VERSION } from "./version.mjs";
import { createOperationLease } from "./operation-leases.mjs";

const appServerStartupTimeoutMs = 5000;
const chatTurnTimeoutMs = 120000;
const chatBackgroundCompletionTimeoutMs = 30 * 60_000;
const maxBufferedNotifications = 50;
const activeChatOperations = new Set();

export async function sendImageToBoundChat({ projectDir, threadId, imagePath, prompt, waitForCompletion = false }) {
  if (!threadId) {
    const error = new Error("Codex-Canvas is not bound to a Codex thread.");
    error.statusCode = 409;
    throw error;
  }
  if (!imagePath) {
    const error = new Error("The selected image must be a local canvas asset before sending to chat.");
    error.statusCode = 400;
    throw error;
  }
  return sendInputsToBoundChat({
    projectDir,
    threadId,
    waitForCompletion,
    completionTimeoutMs: waitForCompletion ? chatTurnTimeoutMs : chatBackgroundCompletionTimeoutMs,
    input: [
      {
        type: "text",
        text: prompt || "Use this selected Codex-Canvas image as context.",
        text_elements: []
      },
      {
        type: "localImage",
        path: imagePath
      }
    ]
  });
}

export async function sendMentionToBoundChat({ projectDir, threadId, filePath, prompt, includeImage = false }) {
  if (!threadId) {
    const error = new Error("Codex-Canvas is not bound to a Codex thread.");
    error.statusCode = 409;
    throw error;
  }
  if (!filePath) {
    const error = new Error("The selected image must be a local canvas asset before mentioning it in chat.");
    error.statusCode = 400;
    throw error;
  }
  const input = [
    {
      type: "text",
      text: prompt || "Mention this Codex-Canvas file as context and wait for the next instruction.",
      text_elements: []
    },
    {
      type: "mention",
      name: path.basename(filePath),
      path: filePath
    }
  ];
  if (includeImage) {
    input.push({
      type: "localImage",
      path: filePath
    });
  }
  return sendInputsToBoundChat({
    projectDir,
    threadId,
    input
  });
}

async function sendInputsToBoundChat({ projectDir, threadId, input, waitForCompletion = true, completionTimeoutMs = chatTurnTimeoutMs }) {
  const operationLease = await createOperationLease("chat-turn", { projectDir, threadId });
  let server;
  try {
    server = await startAppServer();
  } catch (error) {
    await operationLease.release();
    throw error;
  }
  const client = new JsonRpcWebSocketClient(`ws://127.0.0.1:${server.port}`);
  const operation = { client, server, operationLease, closing: null };
  activeChatOperations.add(operation);
  let cleanupInFinally = true;
  try {
    await client.open();
    await client.request("initialize", {
      clientInfo: { name: "codex-canvas", version: APP_VERSION },
      capabilities: null
    });
    await client.request("thread/resume", {
      threadId,
      cwd: projectDir
    });

    const turnResponse = await client.request("turn/start", {
      threadId,
      input
    });
    const turnId = turnResponse?.turn?.id || null;
    const isTargetCompletion = (message) => {
      if (message.method !== "turn/completed" || message.params?.threadId !== threadId) return false;
      if (!turnId) return true;
      return message.params?.turn?.id === turnId;
    };

    if (!waitForCompletion) {
      cleanupInFinally = false;
      monitorChatTurnCompletion({ operation, predicate: isTargetCompletion, timeoutMs: completionTimeoutMs });
      return {
        threadId,
        turnId,
        status: "submitted",
        durationMs: null,
        completionPending: true
      };
    }

    const completion = await client.waitForNotification(isTargetCompletion, completionTimeoutMs);

    return {
      threadId,
      turnId: completion.params?.turn?.id || turnId,
      status: completion.params?.turn?.status || "completed",
      durationMs: completion.params?.turn?.durationMs || null
    };
  } finally {
    if (cleanupInFinally) {
      await closeActiveChatOperation(operation);
    }
  }
}

function monitorChatTurnCompletion({ operation, predicate, timeoutMs }) {
  operation.client.waitForNotification(predicate, timeoutMs)
    .catch(() => {})
    .finally(() => closeActiveChatOperation(operation).catch(() => {}));
}

export async function stopActiveChatOperations() {
  await Promise.allSettled([...activeChatOperations].map((operation) => closeActiveChatOperation(operation)));
}

export function hasActiveChatOperations() {
  return activeChatOperations.size > 0;
}

async function closeActiveChatOperation(operation) {
  if (operation.closing) return operation.closing;
  operation.closing = (async () => {
    activeChatOperations.delete(operation);
    operation.client.close();
    try {
      await operation.server.stop();
    } finally {
      await operation.operationLease.release();
    }
  })();
  return operation.closing;
}

async function startAppServer() {
  const executable = await resolveCodexExecutable();
  const port = await allocatePort();
  const child = spawnCodexProcess(executable, ["app-server", "--listen", `ws://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const output = [];
  let collectStartupOutput = true;
  const collect = (chunk) => {
    if (collectStartupOutput) output.push(chunk.toString());
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  try {
    await waitForWebSocket(port, appServerStartupTimeoutMs);
  } catch (error) {
    stopChild(child);
    const detail = output.join("").trim();
    error.message = detail ? `${error.message}: ${detail}` : error.message;
    throw error;
  }
  collectStartupOutput = false;
  output.length = 0;

  return {
    port,
    stop: () => stopAppServer(child)
  };
}

function stopChild(child) {
  if (!child || child.killed) return;
  child.kill();
}

function stopAppServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(forceTimer);
      clearTimeout(resolveTimer);
      resolve();
    };
    const forceTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    }, 750);
    const resolveTimer = setTimeout(resolve, 2500);
    forceTimer.unref?.();
    resolveTimer.unref?.();
    child.once("close", done);
    child.kill();
  });
}

function allocatePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address?.port;
      server.close(() => {
        if (Number.isInteger(port)) resolve(port);
        else reject(new Error("Could not allocate a local app-server port."));
      });
    });
  });
}

async function waitForWebSocket(port, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const socket = createWebSocket(`ws://127.0.0.1:${port}`);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out opening Codex app-server WebSocket.")), 500);
        socket.addEventListener("open", () => {
          clearTimeout(timeout);
          socket.close();
          resolve();
        }, { once: true });
        socket.addEventListener("error", (event) => {
          clearTimeout(timeout);
          reject(event?.error || new Error("Codex app-server WebSocket is not ready."));
        }, { once: true });
      });
      return;
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw lastError || new Error("Codex app-server did not start in time.");
}

class JsonRpcWebSocketClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.notificationWaiters = [];
  }

  open() {
    this.socket = createWebSocket(this.url);
    this.socket.addEventListener("message", (event) => this.handleMessage(String(event.data)));
    this.socket.addEventListener("close", () => this.rejectPending(new Error("Codex app-server connection closed.")));
    this.socket.addEventListener("error", () => this.rejectPending(new Error("Codex app-server connection failed.")));
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", () => reject(new Error("Codex app-server connection failed.")), { once: true });
    });
  }

  request(method, params, timeoutMs = chatTurnTimeoutMs) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request timed out: ${method}`));
      }, timeoutMs);
      timeout.unref?.();
      this.pending.set(id, { resolve, reject, timeout, method });
    });
    this.socket.send(JSON.stringify(payload));
    return promise;
  }

  waitForNotification(predicate, timeoutMs) {
    const existing = this.notifications.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.notificationWaiters = this.notificationWaiters.filter((waiter) => waiter.resolve !== resolve);
        reject(new Error("Timed out waiting for Codex chat turn completion."));
      }, timeoutMs);
      timeout.unref?.();
      this.notificationWaiters.push({ predicate, resolve, reject, timeout });
    });
  }

  handleMessage(text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message || `${pending.method} failed`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!message.method) return;
    let matchedWaiter = false;
    for (const waiter of [...this.notificationWaiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timeout);
      this.notificationWaiters = this.notificationWaiters.filter((item) => item !== waiter);
      waiter.resolve(message);
      matchedWaiter = true;
    }
    if (!matchedWaiter) {
      this.notifications.push(message);
      if (this.notifications.length > maxBufferedNotifications) {
        this.notifications.splice(0, this.notifications.length - maxBufferedNotifications);
      }
    }
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.notificationWaiters = [];
  }

  close() {
    if (!this.socket || this.socket.readyState >= 2) return;
    this.socket.close();
  }
}

function createWebSocket(url) {
  if (typeof WebSocket === "function") return new WebSocket(url);
  return new NodeLoopbackWebSocket(url);
}

class NodeLoopbackWebSocket {
  constructor(url) {
    this.url = new URL(url);
    if (this.url.protocol !== "ws:" || !["127.0.0.1", "localhost"].includes(this.url.hostname)) {
      throw new Error("Node fallback WebSocket only supports local ws:// app-server URLs.");
    }
    this.readyState = 0;
    this.listeners = new Map();
    this.buffer = Buffer.alloc(0);
    this.socket = net.createConnection({ host: this.url.hostname, port: Number(this.url.port) });
    this.socket.on("connect", () => this.sendHandshake());
    this.socket.on("data", (chunk) => this.handleData(chunk));
    this.socket.on("error", (error) => this.emit("error", { error }));
    this.socket.on("close", () => {
      this.readyState = 3;
      this.emit("close", {});
    });
  }

  addEventListener(type, listener, options = {}) {
    const wrapped = options.once
      ? (event) => {
        this.removeEventListener(type, wrapped);
        listener(event);
      }
      : listener;
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(wrapped);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  send(text) {
    if (this.readyState !== 1) throw new Error("Codex app-server WebSocket is not open.");
    this.socket.write(encodeClientTextFrame(String(text)));
  }

  close() {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    this.socket.write(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));
    this.socket.end();
  }

  sendHandshake() {
    const key = crypto.randomBytes(16).toString("base64");
    const pathname = `${this.url.pathname || "/"}${this.url.search || ""}`;
    this.socket.write([
      `GET ${pathname} HTTP/1.1`,
      `Host: ${this.url.host}`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n"));
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.readyState === 0) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      this.buffer = this.buffer.slice(headerEnd + 4);
      if (!/^HTTP\/1\.1 101\b/.test(header)) {
        this.emit("error", { error: new Error("Codex app-server rejected WebSocket upgrade.") });
        this.socket.end();
        return;
      }
      this.readyState = 1;
      this.emit("open", {});
    }

    for (;;) {
      const frame = decodeServerFrame(this.buffer);
      if (!frame) return;
      this.buffer = this.buffer.slice(frame.bytesRead);
      if (frame.opcode === 0x1) this.emit("message", { data: frame.payload.toString("utf8") });
      else if (frame.opcode === 0x8) this.close();
      else if (frame.opcode === 0x9) this.socket.write(encodeClientControlFrame(0xA, frame.payload));
    }
  }

  emit(type, event) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(event);
  }
}

function encodeClientTextFrame(text) {
  return encodeClientFrame(0x1, Buffer.from(text, "utf8"));
}

function encodeClientControlFrame(opcode, payload) {
  return encodeClientFrame(opcode, payload);
}

function encodeClientFrame(opcode, payload) {
  const mask = crypto.randomBytes(4);
  const lengthBytes = payload.length < 126
    ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
    : payload.length <= 0xffff
      ? Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
      : Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | 127]), uint64Buffer(payload.length)]);
  const masked = Buffer.alloc(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    masked[index] = payload[index] ^ mask[index % 4];
  }
  return Buffer.concat([lengthBytes, mask, masked]);
}

function decodeServerFrame(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = Boolean(buffer[1] & 0x80);
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    length = high * 2 ** 32 + low;
    offset += 8;
  }
  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + length) return null;
  const mask = masked ? buffer.slice(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.slice(offset, offset + length));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }
  return { opcode, payload, bytesRead: offset + length };
}

function uint64Buffer(value) {
  const buffer = Buffer.alloc(8);
  const high = Math.floor(value / 2 ** 32);
  const low = value >>> 0;
  buffer.writeUInt32BE(high, 0);
  buffer.writeUInt32BE(low, 4);
  return buffer;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
