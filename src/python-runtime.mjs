import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

function runtimePath(purpose) {
  if (!["image-processing", "ocr"].includes(purpose)) throw new Error("Unknown Python runtime purpose.");
  const directory = process.env.CODEX_CANVAS_PYTHON_CONFIG_DIR
    || path.join(os.homedir(), ".agents", "codex-canvas", "python");
  return path.join(directory, `${purpose}.json`);
}

// Read on every operation: a setup command can repair a running service whose
// inherited PATH predates the Python installation. Doctor never writes here.
export async function pythonCandidates(args, purpose = "image-processing") {
  const configured = process.env.CODEX_CANVAS_PYTHON;
  if (configured) return [[configured, args]];
  const candidates = [];
  try {
    const saved = JSON.parse(await fs.readFile(runtimePath(purpose), "utf8"));
    if (typeof saved.executable === "string" && path.isAbsolute(saved.executable)) {
      candidates.push([saved.executable, args]);
    }
  } catch { /* Missing, stale or malformed configuration falls back to PATH. */ }
  candidates.push(...(process.platform === "win32"
    ? [["py", ["-3", ...args]], ["python", args], ["python3", args]]
    : [["python3", args], ["python", args]]));
  return candidates;
}

export async function rememberPythonRuntime(result, purpose) {
  if (!result.available || !path.isAbsolute(result.pythonExecutable || "")) return;
  const file = runtimePath(purpose);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify({ executable: result.pythonExecutable })}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
