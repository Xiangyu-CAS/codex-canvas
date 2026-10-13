import { App } from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "Codex Canvas", version: "1.0.0" },
  { availableDisplayModes: ["fullscreen"] }, { autoResize: false });
let session;
let started = false;
let disposed = false;
let resolveSession;
const sessionReady = new Promise(resolve => { resolveSession = resolve; });
const assets = new Map();
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
  const changed = session && next.projectId !== session.projectId;
  if (changed) {
    for (const asset of assets.values()) if (asset.url) URL.revokeObjectURL(asset.url);
    assets.clear();
  }
  session = { ...next, threadId: result.structuredContent?.threadId || "" };
  status.style.display = "none";
  resolveSession(session);
  if (changed) window.codexCanvasApp.onScopeChange?.().catch(() => showOpenAction("Could not load this canvas. Reopen it from the chat."));
}
app.ontoolresult = acceptSession;
app.onteardown = async () => {
  disposed = true;
  for (const asset of assets.values()) if (asset.url) URL.revokeObjectURL(asset.url);
  assets.clear();
  return {};
};
app.onclose = () => { showOpenAction("Canvas connection closed. Reopen it from this chat. / 画布连接已断开，请重新打开。"); };

async function request(path, options = {}) {
  await sessionReady;
  if (disposed) throw new Error("Canvas panel is closed.");
  const result = await app.callServerTool({ name: "canvas_app_request", arguments: {
    sessionId: session.sessionId, path, method: options.method || "GET",
    ...(options.body ? { body: JSON.parse(options.body) } : {})
  } }, { timeout: 120000 });
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
    const wanted = new Set();
    for (const object of objects) {
      if (disposed || session !== assetSession) return;
      if (!object.src || object.src.startsWith("data:")) continue;
      const key = assetKey(object);
      wanted.add(key);
      if (assets.has(key)) continue;
      const entry = {};
      assets.set(key, entry);
      try {
        const response = await request(`/api/app-assets/${encodeURIComponent(object.id)}`);
        if (!response.ok) throw new Error("Image unavailable");
        entry.blob = await response.blob();
        if (disposed || session !== assetSession) return;
        entry.url = URL.createObjectURL(entry.blob);
      } catch { assets.delete(key); }
    }
    if (disposed || session !== assetSession) return;
    for (const [key, entry] of assets) if (!wanted.has(key)) {
      if (entry.url) URL.revokeObjectURL(entry.url);
      assets.delete(key);
    }
  },
  async download(href, filename) {
    // Even fetch(blob:) is blocked by connect-src 'none' in an MCP sandbox.
    let blob = [...assets.values()].find(asset => asset.url === href)?.blob;
    if (!blob && href.startsWith("data:")) {
      const match = href.match(/^data:([^;,]+);base64,(.*)$/s);
      if (match) blob = new Blob([Uint8Array.from(atob(match[2]), ch => ch.charCodeAt(0))], { type: match[1] });
    }
    if (!blob) {
      const response = await request(href);
      if (!response.ok) throw new Error("Download failed.");
      blob = await response.blob();
    }
    if (app.getHostCapabilities()?.downloadFile) {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(",")[1]); reader.onerror = reject; reader.readAsDataURL(blob);
      });
      const result = await app.downloadFile({ contents: [{ type: "resource", resource: { uri: `file:///${encodeURIComponent(filename)}`, mimeType: blob.type, blob: data } }] });
      if (result.isError) throw new Error("Download failed.");
    } else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }
};

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
