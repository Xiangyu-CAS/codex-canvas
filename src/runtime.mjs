import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { maxSafePathSegmentLength, runtimePathFor, safePathSegment } from "./paths.mjs";

const canvasIdPrefix = "thread";
const canvasIdHashLength = 16;

export async function readRuntime(projectDir) {
  try {
    return JSON.parse(await fs.readFile(runtimePathFor(projectDir), "utf8"));
  } catch {
    return null;
  }
}

export async function writeRuntime(projectDir, runtime) {
  await fs.mkdir(path.dirname(runtimePathFor(projectDir)), { recursive: true });
  await fs.writeFile(runtimePathFor(projectDir), `${JSON.stringify(runtime, null, 2)}\n`);
  return runtime;
}

export async function updateRuntime(projectDir, patch) {
  const current = await readRuntime(projectDir);
  return writeRuntime(projectDir, {
    ...(current || {}),
    ...patch,
    updatedAt: new Date().toISOString()
  });
}

export function normalizeThreadId(value) {
  const threadId = typeof value === "string" ? value.trim() : "";
  return threadId || null;
}

export function canvasIdForThread(threadId) {
  const normalized = normalizeThreadId(threadId);
  if (!normalized) return null;

  const hash = crypto.createHash("sha256").update(normalized).digest("base64url").slice(0, canvasIdHashLength);
  const maxReadableLength = maxSafePathSegmentLength - canvasIdPrefix.length - hash.length - 2;
  const readable = safePathSegment(normalized).slice(0, maxReadableLength);
  return `${canvasIdPrefix}-${readable || "id"}-${hash}`;
}
