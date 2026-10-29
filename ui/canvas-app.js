import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "Codex Canvas", version: "1.0.0" },
  { availableDisplayModes: ["fullscreen"] }, { autoResize: false });
let session;
let started = false;
let disposed = false;
let resolveSession;
const sessionReady = new Promise(resolve => { resolveSession = resolve; });
const assets = new Map();
const downloads = new Map();
const lifetime = new AbortController();
const emptyImage = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
const status = document.createElement("div");
status.id = "canvasConnection";
Object.assign(status.style, { position: "fixed", inset: "0", display: "grid", placeContent: "center", gap: "16px", background: "#f7f7f8", color: "#202124", font: "14px system-ui", zIndex: "9999", padding: "32px", textAlign: "center" });
status.textContent = "Connecting to Codex Canvas…";
document.body.append(status);

function showOpenAction(message) {
  status.replaceChildren();
  status.style.display = "grid";
  const label = document.createElement("div");
  label.textContent = message;
  const button = document.createElement("button");
  button.textContent = "Open canvas for this chat / 打开当前画布";
  button.onclick = async () => {
    button.disabled = true;
    try {
      await app.sendMessage({ role: "user", content: [{ type: "text", text: "Open Codex-Canvas in the plugin sidebar for this chat's active workspace. Call open_canvas with the absolute projectDir and current threadId." }] });
    } catch { button.disabled = false; }
  };
  status.append(label, button);
}

function acceptSession(result) {
  if (result.isError) return;
  const next = result._meta?.canvasSession;
  if (!next) {
    if (!session && result.structuredContent?.needsProject) showOpenAction("Choose this chat's workspace to open the canvas. / 请绑定当前对话的工作区。");
    return;
  }
  const nextSession = { ...next, threadId: result.structuredContent?.threadId || "" };
  const changed = session && (nextSession.projectId !== session.projectId || nextSession.sessionId !== session.sessionId || nextSession.threadId !== session.threadId);
  if (changed) {
    clearAssets();
  }
  // Re-opening the same panel must not invalidate an in-flight asset request.
  if (!session || changed) session = nextSession;
  status.style.display = "none";
  resolveSession(session);
  if (changed) {
    const openedSession = session;
    window.codexCanvasApp.onScopeChange?.().catch(() => {
      if (!disposed && session === openedSession) showOpenAction("Could not load this canvas. Reopen it from the chat.");
    });
  }
}
app.ontoolresult = acceptSession;
app.onteardown = async () => {
  disposed = true;
  lifetime.abort();
  clearAssets();
  for (const [url, timer] of downloads) {
    clearTimeout(timer);
    URL.revokeObjectURL(url);
  }
  downloads.clear();
  document.removeEventListener("error", onImageError, true);
  return {};
};
app.onclose = () => { showOpenAction("Canvas connection closed. Reopen it from this chat. / 画布连接已断开，请重新打开。"); };

async function request(path, options = {}) {
  const requestedSession = session;
  await sessionReady;
  const requestSession = requestedSession || session;
  if (disposed) throw new Error("Canvas panel is closed.");
  const result = await app.callServerTool({ name: "canvas_app_request", arguments: {
    sessionId: requestSession.sessionId, path, method: options.method || "GET",
    ...(options.body ? { body: JSON.parse(options.body) } : {})
  } }, { timeout: 120000, signal: options.signal });
  if (disposed) throw new Error("Canvas panel is closed.");
  if (result.isError || !result.structuredContent) throw new Error("Canvas request failed. Reopen the canvas from this chat.");
  const data = result.structuredContent;
  const bytes = data.encoding === "base64" ? Uint8Array.from(atob(data.body), ch => ch.charCodeAt(0)) : JSON.stringify(data.body);
  return new Response(bytes, { status: data.status, headers: data.headers });
}

function assetKey(object) { return `${object.src}\n${object.assetVersion || 0}`; }
window.codexCanvasApp = {
  get scope() { return session; },
  get active() { return !disposed && !document.hidden; },
  fetch: request,
  assetUrl(src, object) { return assets.get(assetKey({ ...object, src }))?.url || (src.startsWith("data:") ? src : emptyImage); },
  async prepareAssets(objects) {
    const assetSession = session;
    const wanted = new Set(objects.filter(object => object.src && !object.src.startsWith("data:")).map(assetKey));
    for (const [key, entry] of assets) if (!wanted.has(key)) {
      releaseAsset(entry);
      assets.delete(key);
    }
    for (const object of objects) {
      if (disposed || session !== assetSession) return;
      if (!object.src || object.src.startsWith("data:")) continue;
      const key = assetKey(object);
      const existing = assets.get(key);
      if (existing) { await existing.pending; continue; }
      const entry = { controller: new AbortController(), objectId: object.id };
      assets.set(key, entry);
      entry.pending = (async () => {
        let stage = "request";
        try {
          const response = await request(`/api/app-assets/${encodeURIComponent(object.id)}`, { signal: entry.controller.signal });
          if (!response.ok) throw new Error("Image unavailable");
          stage = "read";
          const blob = await response.blob();
          if (disposed || session !== assetSession || assets.get(key) !== entry) return;
          stage = "convert";
          // MCP Apps' baseline CSP supports data: images, not necessarily blob:.
          // Cache only the data URL; downloads reconstruct bytes on demand.
          const url = await readBlobAsDataUrl(blob, entry.controller.signal);
          if (disposed || session !== assetSession || assets.get(key) !== entry) return;
          entry.url = url;
        } catch {
          // An old request must never delete a replacement entry in a new scope.
          if (!disposed && session === assetSession && assets.get(key) === entry) {
            assets.delete(key);
            console.warn("Codex Canvas image load failed; retrying on refresh.", { objectId: object.id, stage });
          }
        } finally {
          entry.pending = null;
          entry.controller = null;
        }
      })();
      await entry.pending;
    }
  },
  async download(href, filename) {
    if (disposed) throw new Error("Canvas panel is closed.");
    // Even fetch(blob:) is blocked by connect-src 'none' in an MCP sandbox.
    let blob;
    if (!blob && href.startsWith("data:")) {
      const match = href.match(/^data:([^;,]+);base64,(.*)$/s);
      if (match) blob = new Blob([Uint8Array.from(atob(match[2]), ch => ch.charCodeAt(0))], { type: match[1] });
    }
    if (!blob) {
      const response = await request(href);
      if (!response.ok) throw new Error("Download failed.");
      blob = await response.blob();
    }
    if (disposed) throw new Error("Canvas panel is closed.");
    if (app.getHostCapabilities()?.downloadFile) {
      const data = (await readBlobAsDataUrl(blob, lifetime.signal)).split(",")[1];
      if (disposed) throw new Error("Canvas panel is closed.");
      const result = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${encodeURIComponent(filename)}`, mimeType: blob.type, blob: data } }] });
      if (result.isError) throw new Error("Download failed.");
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 60000);
      downloads.set(url, timer);
    }
  }
};

function releaseAsset(entry) {
  entry.controller?.abort();
  entry.url = null;
}

function clearAssets() {
  for (const entry of assets.values()) releaseAsset(entry);
  assets.clear();
}

function onImageError(event) {
  const image = event.target;
  if (image?.tagName !== "IMG") return;
  for (const [key, entry] of assets) if (entry.url === image.src) {
    releaseAsset(entry);
    assets.delete(key);
    console.warn("Codex Canvas image decode failed; retrying on refresh.", { objectId: entry.objectId });
  }
}
document.addEventListener("error", onImageError, true);

function readBlobAsDataUrl(blob, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const finish = (error) => {
      reader.onload = reader.onerror = reader.onabort = null;
      signal?.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(reader.result);
    };
    const abort = () => { reader.abort(); finish(new Error("Image conversion cancelled.")); };
    reader.onload = () => finish();
    reader.onerror = () => finish(reader.error || new Error("Image conversion failed."));
    reader.onabort = () => finish(new Error("Image conversion cancelled."));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    try { reader.readAsDataURL(blob); } catch (error) { finish(error); }
  });
}

try {
  await app.connect(undefined, { timeout: 15000 });
  const host = app.getHostContext();
  if (host?.displayMode !== "fullscreen" && host?.availableDisplayModes?.includes("fullscreen")) {
    await app.requestDisplayMode({ mode: "fullscreen" }).catch(() => {});
  }
  await sessionReady;
  if (!started) { started = true; await import("../public/app.js"); }
} catch (error) {
  showOpenAction(`Could not open canvas: ${error.message}`);
}
