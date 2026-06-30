import http from "node:http";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { collectRecentImages } from "./collector.mjs";
import { sendImageToBoundChat } from "./codex-chat.mjs";
import { createImageJob, createTextRecognitionJob, getActivePlaceholderIds, getIgnoredGeneratedImagePaths, getImageJob, getTextRecognitionJob, hasRunningImageJobs, submitTextRecognitionEdit } from "./jobs.mjs";
import { assetsDirFor, projectRegistryPath, publicDir, runtimePathFor } from "./paths.mjs";
import { addImage, addObject, deleteObject, deleteObjects, ensureProjectStore, markStaleJobPlaceholders, promptHistory, readState, searchObjects, updateObject, updateProjectMeta, updateSelection, updateViewport, versionGroups } from "./store.mjs";
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
const maxQueryLimit = 100;

export async function createServer({ projectDir, host = "127.0.0.1", port = 43217, autoCollect = true, chatThreadId = null, autoCollectIntervalMs = 5000, autoCollectWatchDebounceMs = 250, maxJsonBodyBytes = defaultMaxJsonBodyBytes, persistentRegistryPath = projectRegistryPath() } = {}) {
  const registry = createProjectRegistry({ host, port, autoCollect, autoCollectIntervalMs, autoCollectWatchDebounceMs, maxJsonBodyBytes, persistentRegistryPath });
  const initialProject = await registerProject(registry, projectDir, { autoCollect, chatThreadId });
  await restorePersistedProjects(registry);

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
  await persistProjectRegistrySafely(registry);
  server.on("close", () => {
    for (const project of registry.projects.values()) {
      stopAutoCollector(project);
    }
  });

  return { server, url: projectUrl(registry, initialProject.id) };
}

async function handleRequest(request, response, context) {
  const requestUrl = new URL(request.url, "http://agent-canvas.local");
  const pathname = decodePathname(requestUrl.pathname);
  requireCapabilityToken(request, requestUrl, pathname, context.registry);

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
    await persistProjectRegistrySafely(context.registry);
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

  if (request.method === "GET" && pathname === "/api/search") {
    return sendJson(response, 200, await searchObjects(projectDir, {
      query: requestUrl.searchParams.get("q") || requestUrl.searchParams.get("query") || "",
      type: requestUrl.searchParams.get("type") || null,
      limit: parsePositiveIntegerQueryParam(requestUrl.searchParams, "limit", 20),
      canvasId: project.canvasId
    }));
  }

  if (request.method === "GET" && pathname === "/api/prompts") {
    return sendJson(response, 200, await promptHistory(projectDir, {
      query: requestUrl.searchParams.get("q") || requestUrl.searchParams.get("query") || "",
      limit: parsePositiveIntegerQueryParam(requestUrl.searchParams, "limit", 20),
      canvasId: project.canvasId
    }));
  }

  if (request.method === "GET" && pathname === "/api/versions") {
    return sendJson(response, 200, await versionGroups(projectDir, {
      query: requestUrl.searchParams.get("q") || requestUrl.searchParams.get("query") || "",
      groupBy: requestUrl.searchParams.get("groupBy") || requestUrl.searchParams.get("group_by") || "sourceObjectId",
      limit: parsePositiveIntegerQueryParam(requestUrl.searchParams, "limit", 20),
      objectLimit: parsePositiveIntegerQueryParam(requestUrl.searchParams, "objectLimit", 20, "object_limit"),
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
    requireSingleImageInput(body);
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
    await persistProjectRegistrySafely(context.registry);
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
      "cache-control": "no-cache",
      "referrer-policy": "no-referrer"
    });
    response.end(buffer);
  } catch {
    sendJson(response, 404, { error: "File not found." });
  }
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer"
  });
  response.end(JSON.stringify(body));
}

function parsePositiveIntegerQueryParam(searchParams, name, defaultValue, fallbackName = null) {
  const rawValue = searchParams.get(name) ?? (fallbackName ? searchParams.get(fallbackName) : null);
  if (rawValue === null || rawValue === "") return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return Math.min(maxQueryLimit, Math.max(1, Math.round(parsed)));
}

function createProjectRegistry({ host, port, autoCollect, autoCollectIntervalMs, autoCollectWatchDebounceMs, maxJsonBodyBytes, persistentRegistryPath }) {
  return {
    host,
    port,
    capabilityToken: crypto.randomBytes(24).toString("base64url"),
    autoCollect,
    autoCollectIntervalMs,
    autoCollectWatchDebounceMs,
    maxJsonBodyBytes,
    persistentRegistryPath,
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

function decodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch (error) {
    if (error instanceof URIError) {
      const clientError = new Error("Request path must use valid URL encoding.");
      clientError.statusCode = 400;
      throw clientError;
    }
    throw error;
  }
}

function requireCapabilityToken(request, requestUrl, pathname, registry) {
  if (!requiresCapabilityToken(request, pathname)) return;
  const token = request.headers["x-agent-canvas-token"] || requestUrl.searchParams.get("token");
  if (isCapabilityToken(token) && token === registry.capabilityToken) return;
  const error = new Error("Agent-Canvas API writes require the runtime capability token.");
  error.statusCode = 403;
  throw error;
}

function isCapabilityToken(token) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{24,}$/.test(token);
}

function requiresCapabilityToken(request, pathname) {
  if (!pathname.startsWith("/api/")) return false;
  return !["GET", "HEAD", "OPTIONS"].includes(request.method);
}

function requireHttpProjectDir(projectDir) {
  if (typeof projectDir !== "string" || projectDir.length === 0 || !path.isAbsolute(projectDir)) {
    const error = new Error("POST /api/projects requires projectDir to be a non-empty absolute path.");
    error.statusCode = 400;
    throw error;
  }
  return projectDir;
}

function requireSingleImageInput(body = {}) {
  const present = ["path", "url", "dataUrl"].filter((field) => typeof body[field] === "string" && body[field].trim());
  if (present.length === 1) return;
  const error = new Error("POST /api/images requires exactly one image input: path, url, or dataUrl.");
  error.statusCode = 400;
  throw error;
}

async function registerProject(registry, projectDir, { autoCollect = true, chatThreadId = null, canvasId: explicitCanvasId = null, registeredAt = null } = {}) {
  const resolvedProjectDir = path.resolve(projectDir || process.cwd());
  const normalizedThreadId = normalizeThreadId(chatThreadId);
  const canvasId = normalizeThreadId(explicitCanvasId) || canvasIdForThread(normalizedThreadId);
  await ensureProjectStore(resolvedProjectDir, { canvasId });
  const id = projectIdFor(resolvedProjectDir, canvasId);
  const existing = registry.projects.get(id);
  if (existing) {
    existing.autoCollect = Boolean(autoCollect);
    if (normalizedThreadId) existing.chatThreadId = normalizedThreadId;
    existing.canvasId = canvasId;
    if (registeredAt && !existing.registeredAt) existing.registeredAt = registeredAt;
    if (existing.autoCollect) startAutoCollector(existing, registry);
    else stopAutoCollector(existing);
    return existing;
  }

  const project = {
    id,
    projectDir: resolvedProjectDir,
    autoCollect,
    chatThreadId: normalizedThreadId,
    canvasId,
    collectSinceMs: Date.now(),
    registeredAt: registeredAt || new Date().toISOString(),
    collectorTimer: null,
    collectorWatchers: [],
    collectorWatchDebounceTimer: null,
    collectorRunning: false
  };
  registry.projects.set(id, project);
  registry.defaultProjectId ||= id;
  if (autoCollect) startAutoCollector(project, registry);
  return project;
}

async function restorePersistedProjects(registry) {
  const { projects: entries, aliases, capabilityToken } = await readPersistedRegistry(registry.persistentRegistryPath);
  if (isCapabilityToken(capabilityToken)) registry.capabilityToken = capabilityToken;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.projectDir !== "string" || !path.isAbsolute(entry.projectDir)) continue;
    if (!await directoryExists(entry.projectDir)) continue;
    await registerProject(registry, entry.projectDir, {
      autoCollect: registry.autoCollect && entry.autoCollect !== false,
      chatThreadId: entry.chatThreadId || null,
      canvasId: entry.canvasId || null,
      registeredAt: typeof entry.registeredAt === "string" ? entry.registeredAt : null
    }).catch((error) => {
      console.error(`Agent-Canvas skipped persisted project ${entry.projectDir}: ${error.message}`);
    });
  }
  for (const alias of aliases) {
    if (!alias || typeof alias !== "object") continue;
    const from = typeof alias.from === "string" ? alias.from : "";
    const to = typeof alias.to === "string" ? alias.to : "";
    if (from && to && registry.projects.has(to)) registry.projectAliases.set(from, to);
  }
}

async function readPersistedRegistry(registryPath) {
  try {
    const payload = JSON.parse(await fs.readFile(registryPath, "utf8"));
    if (Array.isArray(payload)) return { projects: payload, aliases: [], capabilityToken: null };
    return {
      projects: Array.isArray(payload?.projects) ? payload.projects : [],
      aliases: Array.isArray(payload?.aliases) ? payload.aliases : [],
      capabilityToken: typeof payload?.capabilityToken === "string" ? payload.capabilityToken : null
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return { projects: [], aliases: [], capabilityToken: null };
    console.error(`Agent-Canvas could not read project registry ${registryPath}: ${error.message}`);
    return { projects: [], aliases: [], capabilityToken: null };
  }
}

async function persistProjectRegistry(registry) {
  const projects = Array.from(registry.projects.values())
    .map((project) => ({
      id: project.id,
      projectDir: project.projectDir,
      canvasId: project.canvasId || null,
      chatThreadId: project.chatThreadId || null,
      autoCollect: project.autoCollect,
      registeredAt: project.registeredAt
    }))
    .sort((a, b) => a.projectDir.localeCompare(b.projectDir) || String(a.canvasId || "").localeCompare(String(b.canvasId || "")));
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    capabilityToken: registry.capabilityToken,
    projects,
    aliases: Array.from(registry.projectAliases.entries())
      .filter(([, to]) => registry.projects.has(to))
      .map(([from, to]) => ({ from, to }))
      .sort((a, b) => a.from.localeCompare(b.from))
  };
  await fs.mkdir(path.dirname(registry.persistentRegistryPath), { recursive: true });
  const tempPath = `${registry.persistentRegistryPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  await fs.rename(tempPath, registry.persistentRegistryPath);
}

async function persistProjectRegistrySafely(registry) {
  try {
    await persistProjectRegistry(registry);
  } catch (error) {
    console.error(`Agent-Canvas could not write project registry ${registry.persistentRegistryPath}: ${error.message}`);
  }
}

async function directoryExists(directoryPath) {
  try {
    const stat = await fs.stat(directoryPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function startAutoCollector(project, registry) {
  if (project.collectorTimer) return;
  const intervalMs = registry.autoCollectIntervalMs || 5000;
  project.collectorTimer = setInterval(() => {
    runAutoCollectorPass(project).catch((error) => {
      console.error(`Agent-Canvas auto-collect failed for ${project.projectDir}: ${error.message}`);
    });
  }, intervalMs);
  project.collectorTimer.unref?.();
  startAutoCollectorWatchers(project, registry);
}

function startAutoCollectorWatchers(project, registry) {
  stopAutoCollectorWatchers(project);
  for (const root of autoCollectorWatchRoots(project.projectDir)) {
    let watcher;
    try {
      watcher = watch(root, { persistent: false }, () => scheduleAutoCollectorPass(project, registry.autoCollectWatchDebounceMs));
    } catch {
      continue;
    }
    watcher.on("error", () => {
      watcher.close();
      project.collectorWatchers = project.collectorWatchers.filter((item) => item !== watcher);
    });
    watcher.unref?.();
    project.collectorWatchers.push(watcher);
  }
}

function autoCollectorWatchRoots(projectDir) {
  return [...new Set([
    path.resolve(projectDir),
    path.join(os.homedir(), ".codex", "generated_images")
  ])];
}

function scheduleAutoCollectorPass(project, debounceMs = 250) {
  if (!project.autoCollect) return;
  if (project.collectorWatchDebounceTimer) clearTimeout(project.collectorWatchDebounceTimer);
  project.collectorWatchDebounceTimer = setTimeout(() => {
    project.collectorWatchDebounceTimer = null;
    runAutoCollectorPass(project).catch((error) => {
      console.error(`Agent-Canvas auto-collect watcher failed for ${project.projectDir}: ${error.message}`);
    });
  }, Math.max(25, debounceMs));
  project.collectorWatchDebounceTimer.unref?.();
}

function stopAutoCollector(project) {
  if (project.collectorTimer) clearInterval(project.collectorTimer);
  project.collectorTimer = null;
  stopAutoCollectorWatchers(project);
}

function stopAutoCollectorWatchers(project) {
  if (project.collectorWatchDebounceTimer) clearTimeout(project.collectorWatchDebounceTimer);
  project.collectorWatchDebounceTimer = null;
  for (const watcher of project.collectorWatchers || []) {
    try {
      watcher.close();
    } catch {
      // Closing a watcher that already emitted an error is harmless.
    }
  }
  project.collectorWatchers = [];
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
      stopAutoCollector(project);
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
  url.searchParams.set("token", registry.capabilityToken);
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
