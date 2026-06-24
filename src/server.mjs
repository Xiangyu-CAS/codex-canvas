import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { collectRecentImages } from "./collector.mjs";
import { assetsDirFor, publicDir, runtimePathFor } from "./paths.mjs";
import { addImage, addObject, deleteObject, ensureProjectStore, readState, updateObject, updateProjectMeta, updateSelection, updateViewport } from "./store.mjs";

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
  await ensureProjectStore(projectDir);
  const collectSinceMs = Date.now();

  const server = http.createServer(async (request, response) => {
    try {
      await handleRequest(request, response, { projectDir });
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
  const url = `http://${host}:${address.port}/`;
  await fs.mkdir(path.dirname(runtimePathFor(projectDir)), { recursive: true });
  await fs.writeFile(
    runtimePathFor(projectDir),
    `${JSON.stringify({
      url,
      pid: process.pid,
      projectDir,
      startedAt: new Date().toISOString(),
      autoCollect
    }, null, 2)}\n`
  );

  let collectorTimer = null;
  if (autoCollect) {
    collectorTimer = setInterval(() => {
      collectRecentImages(projectDir, {
        sinceMs: collectSinceMs,
        limit: 10,
        prompt: "Auto-collected while Agent-Canvas was open"
      }).catch((error) => {
        console.error(`Agent-Canvas auto-collect failed: ${error.message}`);
      });
    }, 5000);
    collectorTimer.unref?.();
    server.on("close", () => clearInterval(collectorTimer));
  }

  return { server, url };
}

async function handleRequest(request, response, context) {
  const requestUrl = new URL(request.url, "http://agent-canvas.local");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (request.method === "GET" && pathname === "/api/state") {
    return sendJson(response, 200, await readState(context.projectDir));
  }

  if (request.method === "POST" && pathname === "/api/state") {
    const body = await readJson(request);
    if (body.title !== undefined) {
      return sendJson(response, 200, await updateProjectMeta(context.projectDir, body));
    }
    return sendJson(response, 200, await updateViewport(context.projectDir, body.viewport || {}));
  }

  if (request.method === "POST" && pathname === "/api/images") {
    const body = await readJson(request);
    return sendJson(response, 201, await addImage(context.projectDir, body));
  }

  if (request.method === "POST" && pathname === "/api/objects") {
    const body = await readJson(request);
    return sendJson(response, 201, await addObject(context.projectDir, body));
  }

  if (request.method === "POST" && pathname === "/api/selection") {
    const body = await readJson(request);
    return sendJson(response, 200, { selection: await updateSelection(context.projectDir, body.selection || null) });
  }

  const objectMatch = /^\/api\/objects\/([^/]+)$/.exec(pathname);
  if (request.method === "PATCH" && objectMatch) {
    const body = await readJson(request);
    return sendJson(response, 200, await updateObject(context.projectDir, objectMatch[1], body));
  }

  if (request.method === "DELETE" && objectMatch) {
    return sendJson(response, 200, await deleteObject(context.projectDir, objectMatch[1]));
  }

  if (request.method === "GET" && pathname.startsWith("/assets/")) {
    const assetName = path.basename(pathname);
    return sendFile(response, path.join(assetsDirFor(context.projectDir), assetName));
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

function isInside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
