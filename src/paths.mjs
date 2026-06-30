import path from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const publicDir = path.join(pluginRoot, "public");
export const maxSafePathSegmentLength = 120;

export function resolveProjectDir(value) {
  return path.resolve(value || process.env.AGENT_CANVAS_PROJECT_DIR || process.cwd());
}

export function dataDirFor(projectDir) {
  return path.join(projectDir, "canvas");
}

export function canvasDataDirFor(projectDir, canvasId = null) {
  return canvasId ? path.join(dataDirFor(projectDir), "threads", safePathSegment(canvasId)) : dataDirFor(projectDir);
}

export function statePathFor(projectDir, canvasId = null) {
  return path.join(canvasDataDirFor(projectDir, canvasId), "agent-canvas.json");
}

export function assetsDirFor(projectDir, canvasId = null) {
  return path.join(canvasDataDirFor(projectDir, canvasId), "assets");
}

export function jobsDirFor(projectDir, canvasId = null) {
  return path.join(canvasDataDirFor(projectDir, canvasId), "jobs");
}

export function runtimePathFor(projectDir) {
  return path.join(dataDirFor(projectDir), ".agent-canvas-runtime.json");
}

export function safePathSegment(value) {
  return String(value || "default").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, maxSafePathSegmentLength) || "default";
}
