// Browser and MCP App share the editor; only I/O crosses this boundary.
export const sidebar = window.codexCanvasApp || null;
export const canvasOrigin = sidebar ? "http://codex-canvas.local" : window.location.origin;
export const canvasFetch = (...args) => sidebar ? sidebar.fetch(...args) : window.fetch(...args);
export const preferences = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch { /* Optional in a sandbox. */ } }
};
