import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const staleUpdateLockMs = 30 * 60_000;
const userScope = createHash("sha256").update(os.homedir()).digest("hex").slice(0, 16);
const coordinationDir = path.join(os.tmpdir(), `codex-canvas-${userScope}`);

export function updateLockPath() {
  return path.join(coordinationDir, "update.lock");
}

export async function createOperationLease(kind, details = {}) {
  await fs.mkdir(coordinationDir, { recursive: true, mode: 0o700 });
  if (await updateLockIsActive()) throw updateInProgressError();

  const token = randomUUID();
  const leasePath = path.join(coordinationDir, `operation-${token}.json`);
  const handle = await fs.open(leasePath, "wx", 0o600);
  let released = false;
  const release = async () => {
    if (released) return;
    released = true;
    await handle.close().catch(() => {});
    await fs.rm(leasePath, { force: true }).catch(() => {});
  };

  try {
    await handle.writeFile(`${JSON.stringify({
      schemaVersion: 1,
      token,
      kind: String(kind || "operation"),
      pid: process.pid,
      startedAt: new Date().toISOString(),
      ...sanitizeDetails(details)
    })}\n`);
    // Close the race with an updater that created update.lock after our first
    // check. The updater scans leases only after its lock exists, so either it
    // sees this lease or this second check rejects the operation.
    if (await updateLockIsActive()) {
      await release();
      throw updateInProgressError();
    }
    return { token, path: leasePath, release };
  } catch (error) {
    await release();
    throw error;
  }
}

export async function activeOperationLeases() {
  await fs.mkdir(coordinationDir, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(coordinationDir, { withFileTypes: true }).catch(() => []);
  const active = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.startsWith("operation-") || !entry.name.endsWith(".json")) continue;
    const leasePath = path.join(coordinationDir, entry.name);
    const contents = await fs.readFile(leasePath, "utf8").catch(() => "");
    let lease = null;
    try {
      lease = JSON.parse(contents);
    } catch {
      lease = null;
    }
    const live = Number.isInteger(lease?.pid) && processIsAlive(lease.pid);
    if (lease?.schemaVersion === 1 && live) {
      active.push(lease);
    } else {
      await fs.rm(leasePath, { force: true }).catch(() => {});
    }
  }
  return active;
}

export async function removeStaleUpdateLock() {
  const lockPath = updateLockPath();
  const stat = await fs.stat(lockPath).catch(() => null);
  if (stat && Date.now() - stat.mtimeMs > staleUpdateLockMs) {
    await fs.rm(lockPath, { force: true }).catch(() => {});
    return true;
  }
  return false;
}

function sanitizeDetails(details) {
  const result = {};
  for (const key of ["action", "projectDir", "canvasId", "threadId"]) {
    if (typeof details?.[key] === "string" && details[key].trim()) result[key] = details[key].trim();
  }
  return result;
}

async function updateLockIsActive() {
  await removeStaleUpdateLock();
  try {
    await fs.access(updateLockPath());
    return true;
  } catch {
    return false;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function updateInProgressError() {
  const error = new Error("Codex-Canvas is installing an update; wait for it to finish before starting another background operation.");
  error.statusCode = 409;
  error.code = "update-in-progress";
  return error;
}
