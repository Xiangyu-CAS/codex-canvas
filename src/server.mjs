import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import crypto from "node:crypto";
import { collectRecentImages } from "./collector.mjs";
import { createImageJob, createTextRecognitionJob, getActivePlaceholderIds, getIgnoredGeneratedImagePaths, getImageJob, getTextRecognitionJob, hasRunningImageJobs, submitTextRecognitionEdit } from "./jobs.mjs";
import { assetsDirFor, publicDir, runtimePathFor } from "./paths.mjs";
import { addImage, addObject, deleteObject, ensureProjectStore, markStaleJobPlaceholders, readState, updateObject, updateProjectMeta, updateSelection, updateViewport } from "./store.mjs";

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

export async function createServer({ projectDir, host = "127.0.0.1", port = 43217, autoCollect = true } = {}) {
  const registry = createProjectRegistry({ host, port });
  const initialProject = await registerProject(registry, projectDir, { autoCollect });

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
    const body = await readJson(request);
    const project = await registerProject(context.registry, body.projectDir, {
      autoCollect: body.autoCollect !== false
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
      activePlaceholderIds: getActivePlaceholderIds()
    }));
  }

  if (request.method === "POST" && pathname === "/api/state") {
    const body = await readJson(request);
    if (body.title !== undefined) {
      return sendJson(response, 200, await updateProjectMeta(projectDir, body));
    }
    return sendJson(response, 200, await updateViewport(projectDir, body.viewport || {}));
  }

  if (request.method === "POST" && pathname === "/api/images") {
    const body = await readJson(request);
    return sendJson(response, 201, await addImage(projectDir, body));
  }

  if (request.method === "POST" && pathname === "/api/objects") {
    const body = await readJson(request);
    return sendJson(response, 201, await addObject(projectDir, body));
  }

  if (request.method === "POST" && pathname === "/api/selection") {
    const body = await readJson(request);
    return sendJson(response, 200, { selection: await updateSelection(projectDir, body.selection || null) });
  }

  if (request.method === "POST" && pathname === "/api/jobs") {
    const body = await readJson(request);
    return sendJson(response, 202, await createImageJob(projectDir, body));
  }

  if (request.method === "POST" && pathname === "/api/text-recognition") {
    const body = await readJson(request);
    return sendJson(response, 202, await createTextRecognitionJob(projectDir, body));
  }

  const jobMatch = /^\/api\/jobs\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && jobMatch) {
    return sendJson(response, 200, getImageJob(jobMatch[1]));
  }

  const textRecognitionMatch = /^\/api\/text-recognition\/([^/]+)$/.exec(pathname);
  if (request.method === "GET" && textRecognitionMatch) {
    return sendJson(response, 200, getTextRecognitionJob(textRecognitionMatch[1]));
  }

  const textRecognitionRunMatch = /^\/api\/text-recognition\/([^/]+)\/run$/.exec(pathname);
  if (request.method === "POST" && textRecognitionRunMatch) {
    const body = await readJson(request);
    return sendJson(response, 202, await submitTextRecognitionEdit(projectDir, textRecognitionRunMatch[1], body));
  }

  const objectMatch = /^\/api\/objects\/([^/]+)$/.exec(pathname);
  if (request.method === "PATCH" && objectMatch) {
    const body = await readJson(request);
    return sendJson(response, 200, await updateObject(projectDir, objectMatch[1], body));
  }

  if (request.method === "DELETE" && objectMatch) {
    return sendJson(response, 200, await deleteObject(projectDir, objectMatch[1]));
  }

  if (request.method === "GET" && pathname.startsWith("/assets/")) {
    const assetName = path.basename(pathname);
    return sendFile(response, path.join(assetsDirFor(projectDir), assetName));
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

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
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

function createProjectRegistry({ host, port }) {
  return {
    host,
    port,
    baseUrl: `http://${host}:${port}/`,
    pid: process.pid,
    defaultProjectId: null,
    projects: new Map()
  };
}

async function registerProject(registry, projectDir, { autoCollect = true } = {}) {
  const resolvedProjectDir = path.resolve(projectDir || process.cwd());
  await ensureProjectStore(resolvedProjectDir);
  const id = projectIdFor(resolvedProjectDir);
  const existing = registry.projects.get(id);
  if (existing) {
    existing.autoCollect = existing.autoCollect || autoCollect;
    if (autoCollect && !existing.collectorTimer) startAutoCollector(existing);
    return existing;
  }

  const project = {
    id,
    projectDir: resolvedProjectDir,
    autoCollect,
    collectSinceMs: Date.now(),
    registeredAt: new Date().toISOString(),
    collectorTimer: null
  };
  registry.projects.set(id, project);
  registry.defaultProjectId ||= id;
  if (autoCollect) startAutoCollector(project);
  return project;
}

function startAutoCollector(project) {
  project.collectorTimer = setInterval(() => {
    if (hasRunningImageJobs()) return;
    collectRecentImages(project.projectDir, {
      sinceMs: project.collectSinceMs,
      limit: 10,
      prompt: "Auto-collected while Agent-Canvas was open",
      excludePaths: getIgnoredGeneratedImagePaths()
    }).catch((error) => {
      console.error(`Agent-Canvas auto-collect failed for ${project.projectDir}: ${error.message}`);
    });
  }, 5000);
  project.collectorTimer.unref?.();
}

function resolveRequestProject(registry, requestUrl) {
  const requestedId = requestUrl.searchParams.get("project") || registry.defaultProjectId;
  const project = requestedId ? registry.projects.get(requestedId) : null;
  if (project) return project;
  const error = new Error(`Canvas project not found: ${requestedId || "(missing)"}`);
  error.statusCode = 404;
  throw error;
}

async function listProjects(registry) {
  return Promise.all(Array.from(registry.projects.values()).map(publicProject));
}

async function publicProject(project) {
  let title = path.basename(project.projectDir) || project.projectDir;
  try {
    const state = await readState(project.projectDir);
    title = state.title || title;
  } catch {
    // A broken project state should not hide the rest of the registered canvases.
  }
  return {
    id: project.id,
    title,
    projectDir: project.projectDir,
    registeredAt: project.registeredAt,
    autoCollect: project.autoCollect
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
      startedAt: new Date().toISOString(),
      autoCollect: project.autoCollect
    }, null, 2)}\n`
  );
}

function projectUrl(registry, projectId) {
  const url = new URL(registry.baseUrl);
  url.searchParams.set("project", projectId);
  return url.toString();
}

function projectIdFor(projectDir) {
  return crypto.createHash("sha1").update(path.resolve(projectDir)).digest("base64url").slice(0, 12);
}

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
