import path from "node:path";
import { fileURLToPath } from "node:url";

export const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const publicDir = path.join(pluginRoot, "public");

export function resolveProjectDir(value) {
  return path.resolve(value || process.env.AGENT_CANVAS_PROJECT_DIR || process.cwd());
}

export function dataDirFor(projectDir) {
  return path.join(projectDir, "canvas");
}

export function statePathFor(projectDir) {
  return path.join(dataDirFor(projectDir), "agent-canvas.json");
}

export function assetsDirFor(projectDir) {
  return path.join(dataDirFor(projectDir), "assets");
}

export function runtimePathFor(projectDir) {
  return path.join(dataDirFor(projectDir), ".agent-canvas-runtime.json");
}
