import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import { collectRecentImages } from "./collector.mjs";
import { sendImageToBoundChat } from "./codex-chat.mjs";
import { createImageJob, createTextRecognitionJob, getActivePlaceholderIds, getIgnoredGeneratedImagePaths, getImageJob, getTextRecognitionJob, hasRunningImageJobs, submitTextRecognitionEdit } from "./jobs.mjs";
import { assetsDirFor, publicDir, runtimePathFor } from "./paths.mjs";
import { addImage, addObject, deleteObject, deleteObjects, ensureProjectStore, markStaleJobPlaceholders, readState, updateObject, updateProjectMeta, updateSelection, updateViewport } from "./store.mjs";
import { canvasIdForThread, normalizeThreadId } from "./runtime.mjs";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};
const defaultMaxJsonBodyBytes = 32 * 1024 * 1024;

export async function createServer({ projectDir, host = "127.0.0.1", port = 43217, autoCollect = true, chatThreadId = null, autoCollectIntervalMs = 5000, maxJsonBodyBytes = defaultMaxJsonBodyBytes } = {}) {
  const registry = createProjectRegistry({ host, port, autoCollectIntervalMs, maxJsonBodyBytes });
  const initialProject = await registerProject(registry, projectDir, { autoCollect, chatThreadId });

  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, { registry });
    } catch (error) {
      const status = error.statusCode || 500;
      sendJson(response, status, {
        error: status === 500 ? "Internal server error" : error.message
      });
      if (status === 500) console.error(error);
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  registry.baseUrl = `http://${host}:${address.port}/`;
  registry.pid = process.pid;
  await writeProjectRuntime(registry, initialProject);
  server.on("close", () => {
    for (const project of registry.projects.values()) {
      if (project.collectorTimer) clearInterval(project.collectorTimer);
    }
  });

  return { server, url: projectUrl(registry, initialProject.id) };
}

async function handleRequest(request, response, context) {
  const requestUrl = new URL(request.url, "http://agent-canvas.local");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (request.method === "GET" && pathname === "/api/projects") {
    return sendJson(response, 200, { projects: await listProjects(context.registry) });
  }

  if (request.method === "POST" && pathname === "/api/projects") {
    const body = await readJson(request, context.registry);
    const projectDir = requireHttpProjectDir(body.projectDir);
    const project = await registerProject(context.registry, projectDir, {
      autoCollect: body.autoCollect !== false,
      chatThreadId: body.chatThreadId || body.threadId || null
    });
    await writeProjectRuntime(context.registry, project);
    return sendJson(response, 201, {
      project: await publicProject(project),
      url: projectUrl(context.registry, project.id)
    });
  }

  const project = resolveRequestProject(context.registry, requestUrl);
  const projectDir = project.projectDir;

  if (request.method === "GET" && pathname === "/api/state") {
    return sendJson(response, 200, await markStaleJobPlaceholders(projectDir, {
      activePlaceholderIds: getActivePlaceholderIds(jobScopeFor(project)),
      canvasId: project.canvasId
    }));
  }

  if (request.method === "POST" && pathname === "/api/state") {
    const body = await readJson(request, context.registry);
    if (body.title !== undefined) {
      return sendJson(response, 200, await updateProjectMeta(projectDir, body, storeOptionsFor(project)));
    }
    return sendJson(response, 200, await updateViewport(projectDir, body.viewport || {}, storeOptionsFor(project)));
  }

  if (request.method === "POST" && pathname === "/api/images") {
    const body = await readJson(request, context.registry);
    return sendJson(response, 201, await addImage(projectDir, body, storeOptionsFor(project)));
  }

  if (request.method === "POST" && pathname === "/api/objects") {
    const body = await readJson(request, context.registry);
    return sendJson(response, 201, await addObject(projectDir, body, storeOptionsFor(project)));
  }

  if (request.method === "DELETE" && pathname === "/api/objects") {
    const body = await readJson(request, context.registry);
    return sendJson(response, 200, await deleteObjects(projectDir, body.ids || [], storeOptionsFor(project)));
  }

  if (request.method === "POST" && pathname === "/api/selection") {
    const body = await readJson(request, context.registry);
    return sendJson(response, 200, { selection: await updateSelection(projectDir, body.selection || null, storeOptionsFor(project)) });
  }

  if (request.method === "GET" && pathname === "/api/chat-binding") {
    return sendJson(response, 200, {
      threadId: project.chatThreadId || null,
      bound: Boolean(project.chatThreadId)
    });
  }

  if (request.method === "POST" && pathname === "/api/chat-binding") {
    const body = await readJson(request, context.registry);
    const threadId = normalizeThreadId(body.threadId);
    if (!threadId) {
      const error = new Error("A Codex threadId is required to bind Agent-Canvas to chat.");
      error.statusCode = 400;
      throw error;
    }
    const rebound = await bindProjectToThread(context.registry, project, threadId);
    await writeProjectRuntime(context.registry, rebound);
    return sendJson(response, 200, {
      threadId,
      bound: true,
      projectId: rebound.id,
      url: projectUrl(context.registry, rebound.id)
    });
  }

  if (request.method === "POST" && pathname === "/api/chat-turn") {
    const body = await readJson(request, context.registry);
    return sendJson(response, 200, await sendObjectToBoundChat(projectDir, project, body));
  }

  if (request.method === "POST" && pathname === "/api/jobs") {
    const body = await readJson(request, context.registry);
    return sendJson(response, 202, await createImageJob(projectDir, body, storeOptionsFor(project)));
  }

  if (request.method === "POST" && pathname === "/api/text-recognition") {
    const body = await readJson(request, context.registry);
    return sendJson(response, 202, await createTextRecognitionJob(projectDir, body, storeOptionsFor(project)));
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && jobMatch) {
    return sendJson(response, 200, getImageJob(jobMatch[1], jobScopeFor(project)));
  }

  const textRecognitionMatch = /^\/api\/text-recognition\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && textRecognitionMatch) {
    return sendJson(response, 200, getTextRecognitionJob(textRecognitionMatch[1], jobScopeFor(project)));
  }

  const textRecognitionRunMatch = /^\/api\/text-recognition\/([^/]+)\/run$/.exec(pathname);
  if (request.method === "POST" && textRecognitionRunMatch) {
    const body = await readJson(request, context.registry);
    return sendJson(response, 202, await submitTextRecognitionEdit(projectDir, textRecognitionRunMatch[1], body, storeOptionsFor(project)));
  }

  const objectMatch = /^\/api\/objects\/([^/]+)$/.exec(pathname);
  if (request.method === "PATCH" && objectMatch) {
    const body = await readJson(request, context.registry);
    return sendJson(response, 200, await updateObject(projectDir, objectMatch[1], body, storeOptionsFor(project)));
  }

  if (request.method === "DELETE" && objectMatch) {
    return sendJson(response, 200, await deleteObject(projectDir, objectMatch[1], storeOptionsFor(project)));
  }

  if (request.method === "GET" && pathname.startsWith("/assets/")) {
    const assetName = path.basename(pathname);
    return sendFile(response, path.join(assetsDirFor(projectDir, project.canvasId), assetName));
  }

  if (request.method === "GET") {
    const filePath = pathname === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, pathname);
    if (!isInside(publicDir, filePath)) {
      return sendJson(response, 403, { error: "Forbidden" });
    }
    return sendFile(response, filePath);
  }

  response.writeHead(405).end();
}

async function readJson(request, { maxJsonBodyBytes = defaultMaxJsonBodyBytes } = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > maxJsonBodyBytes) {
      const error = new Error(`JSON request body exceeds the ${formatBytes(maxJsonBodyBytes)} limit.`);
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("Request body must be a JSON object.");
    error.statusCode = 400;
    throw error;
  }
  return parsed;
}

async function sendFile(response, filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(buffer);
  } catch {
    sendJson(response, 404, { error: `File not found: ${pathToFileURL(filePath).href}` });
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function createProjectRegistry({ host, port, autoCollectIntervalMs, maxJsonBodyBytes }) {
  return {
    host,
    port,
    autoCollectIntervalMs,
    maxJsonBodyBytes,
    baseUrl: `http://${host}:${port}/`,
    pid: process.pid,
    defaultProjectId: null,
    projects: new Map(),
    projectAliases: new Map()
  };
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MiB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${bytes} bytes`;
}

function requireHttpProjectDir(projectDir) {
  if (typeof projectDir !== "string" || projectDir.length === 0 || !path.isAbsolute(projectDir)) {
    const error = new Error("POST /api/projects requires projectDir to be a non-empty absolute path.");
    error.statusCode = 400;
    throw error;
  }
  return projectDir;
}

async function registerProject(registry, projectDir, { autoCollect = true, chatThreadId = null } = {}) {
  const resolvedProjectDir = path.resolve(projectDir || process.cwd());
  const normalizedThreadId = normalizeThreadId(chatThreadId);
  const canvasId = canvasIdForThread(normalizedThreadId);
  await ensureProjectStore(resolvedProjectDir, { canvasId });
  const id = projectIdFor(resolvedProjectDir, canvasId);
  const existing = registry.projects.get(id);
  if (existing) {
    existing.autoCollect = existing.autoCollect || autoCollect;
    if (normalizedThreadId) existing.chatThreadId = normalizedThreadId;
    existing.canvasId = canvasId;
    if (autoCollect && !existing.collectorTimer) startAutoCollector(existing, registry.autoCollectIntervalMs);
    return existing;
  }

  const project = {
    id,
    projectDir: resolvedProjectDir,
    autoCollect,
    chatThreadId: normalizedThreadId,
    canvasId,
    collectSinceMs: Date.now(),
    registeredAt: new Date().toISOString(),
    collectorTimer: null,
    collectorRunning: false
  };
  registry.projects.set(id, project);
  registry.defaultProjectId ||= id;
  if (autoCollect) startAutoCollector(project, registry.autoCollectIntervalMs);
  return project;
}

function startAutoCollector(project, intervalMs = 5000) {
  project.collectorTimer = setInterval(() => {
    runAutoCollectorPass(project).catch((error) => {
      console.error(`Agent-Canvas auto-collect failed for ${project.projectDir}: ${error.message}`);
    });
  }, intervalMs);
  project.collectorTimer.unref?.();
}

async function runAutoCollectorPass(project) {
  if (project.collectorRunning) return;
  if (hasRunningImageJobs(jobScopeFor(project))) return;
  project.collectorRunning = true;
  const scanStartedAt = Date.now();
  try {
    await collectRecentImages(project.projectDir, {
      sinceMs: project.collectSinceMs,
      limit: 10,
      prompt: "Auto-collected while Agent-Canvas was open",
      excludePaths: getIgnoredGeneratedImagePaths(jobScopeFor(project)),
      canvasId: project.canvasId
    });
    project.collectSinceMs = Math.max(project.collectSinceMs, scanStartedAt);
  } finally {
    project.collectorRunning = false;
  }
}

function resolveRequestProject(registry, requestUrl) {
  const requestedId = requestUrl.searchParams.get("project") || registry.defaultProjectId;
  const resolvedId = resolveProjectAlias(registry, requestedId);
  const project = resolvedId ? registry.projects.get(resolvedId) : null;
  if (project) return project;
  const error = new Error(`Canvas project not found: ${requestedId || "(missing)"}`);
  error.statusCode = 404;
  throw error;
}

function resolveProjectAlias(registry, projectId) {
  let current = projectId || null;
  const seen = new Set();
  while (current && !registry.projects.has(current) && registry.projectAliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = registry.projectAliases.get(current);
  }
  return current;
}

async function listProjects(registry) {
  return Promise.all(Array.from(registry.projects.values()).map(publicProject));
}

async function publicProject(project) {
  let title = path.basename(project.projectDir) || project.projectDir;
  try {
    const state = await readState(project.projectDir, storeOptionsFor(project));
    title = state.title || title;
  } catch {
    // A broken project state should not hide the rest of the registered canvases.
  }
  return {
    id: project.id,
    title,
    projectDir: project.projectDir,
    canvasId: project.canvasId || null,
    chatThreadId: project.chatThreadId || null,
    chatBound: Boolean(project.chatThreadId),
    registeredAt: project.registeredAt,
    autoCollect: project.autoCollect
  };
}

async function sendObjectToBoundChat(projectDir, project, body = {}) {
  if (body.action !== "send-to-chat") {
    const error = new Error("Send to chat requires the stable send-to-chat action.");
    error.statusCode = 400;
    throw error;
  }
  const threadId = normalizeThreadId(project.chatThreadId);
  if (!threadId) {
    const error = new Error("Agent-Canvas is not bound to a Codex thread.");
    error.statusCode = 409;
    throw error;
  }
  const objectId = typeof body.objectId === "string" ? body.objectId : "";
  const state = await readState(projectDir, storeOptionsFor(project));
  const object = state.objects.find((item) => item.id === objectId);
  if (!object || (object.type || "image") !== "image") {
    const error = new Error("A selected canvas image is required before sending to chat.");
    error.statusCode = 400;
    throw error;
  }
  const imagePath = object.assetPath || object.sourcePath;
  const result = await sendImageToBoundChat({
    projectDir,
    threadId,
    imagePath,
    prompt: sendToChatPrompt()
  });
  return {
    ...result,
    objectId: object.id,
    imagePath
  };
}

function sendToChatPrompt() {
  return "Use this selected Agent-Canvas image as context.";
}

async function bindProjectToThread(registry, project, threadId) {
  const normalizedThreadId = normalizeThreadId(threadId);
  const canvasId = canvasIdForThread(normalizedThreadId);
  const nextId = projectIdFor(project.projectDir, canvasId);
  const existing = registry.projects.get(nextId);
  if (existing) {
    existing.chatThreadId = normalizedThreadId;
    existing.canvasId = canvasId;
    if (project.id !== nextId) {
      aliasProjectId(registry, project.id, nextId);
      registry.projects.delete(project.id);
      if (project.collectorTimer) clearInterval(project.collectorTimer);
      if (registry.defaultProjectId === project.id) registry.defaultProjectId = nextId;
    }
    return existing;
  }

  const previousId = project.id;
  project.id = nextId;
  project.chatThreadId = normalizedThreadId;
  project.canvasId = canvasId;
  await ensureProjectStore(project.projectDir, { canvasId });
  registry.projects.delete(previousId);
  registry.projects.set(nextId, project);
  aliasProjectId(registry, previousId, nextId);
  if (registry.defaultProjectId === previousId) registry.defaultProjectId = nextId;
  return project;
}

function aliasProjectId(registry, previousId, nextId) {
  registry.projectAliases.set(previousId, nextId);
  for (const [alias, target] of registry.projectAliases.entries()) {
    if (target === previousId) registry.projectAliases.set(alias, nextId);
  }
}

function storeOptionsFor(project) {
  return { canvasId: project.canvasId || null };
}

function jobScopeFor(project) {
  return {
    projectDir: project.projectDir,
    canvasId: project.canvasId || null
  };
}

async function writeProjectRuntime(registry, project) {
  await fs.mkdir(path.dirname(runtimePathFor(project.projectDir)), { recursive: true });
  await fs.writeFile(
    runtimePathFor(project.projectDir),
    `${JSON.stringify({
      url: projectUrl(registry, project.id),
      pid: registry.pid,
      projectDir: project.projectDir,
      projectId: project.id,
      canvasId: project.canvasId || null,
      startedAt: new Date().toISOString(),
      autoCollect: project.autoCollect,
      chatThreadId: project.chatThreadId || null
    }, null, 2)}\n`
  );
}

function projectUrl(registry, projectId) {
  const url = new URL(registry.baseUrl);
  url.searchParams.set("project", projectId);
  return url.toString();
}

function projectIdFor(projectDir, canvasId = null) {
  return crypto.createHash("sha1")
    .update(`${path.resolve(projectDir)}\n${canvasId || "default"}`)
    .digest("base64url")
    .slice(0, 12);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
