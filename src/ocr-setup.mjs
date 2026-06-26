import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultPackageName = "rapidocr_onnxruntime";

export async function checkRapidOcrAvailable() {
  const script = `
import json
import sys

for name in ("rapidocr_onnxruntime", "rapidocr"):
    try:
        module = __import__(name)
        print(json.dumps({"available": True, "backend": name, "version": getattr(module, "__version__", None)}))
        sys.exit(0)
    except Exception:
        pass

print(json.dumps({"available": False, "backend": None, "version": None}))
`;

  const errors = [];
  for (const [command, args] of pythonCandidates(["-c", script])) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      const result = JSON.parse(stdout.trim() || "{}");
      return {
        available: result.available === true,
        backend: result.backend || null,
        version: result.version || null,
        pythonCommand: command,
        pythonArgs: args.slice(0, args.length - 2)
      };
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }

  return {
    available: false,
    backend: null,
    version: null,
    pythonCommand: null,
    pythonArgs: [],
    error: errors.join(" | ")
  };
}

export async function installRapidOcr({ optional = false } = {}) {
  if (process.env.AGENT_CANVAS_SKIP_OCR_INSTALL === "1") {
    return {
      installed: false,
      skipped: true,
      available: false,
      message: "Skipped because AGENT_CANVAS_SKIP_OCR_INSTALL=1."
    };
  }

  const existing = await checkRapidOcrAvailable();
  if (existing.available) {
    return {
      installed: false,
      skipped: true,
      available: true,
      backend: existing.backend,
      version: existing.version,
      pythonCommand: existing.pythonCommand,
      message: `${existing.backend} is already installed.`
    };
  }

  const packageName = process.env.AGENT_CANVAS_OCR_PACKAGE || defaultPackageName;
  const errors = [];
  for (const [command, baseArgs] of pythonCandidates([])) {
    const args = [...baseArgs, "-m", "pip", "install", "--user", packageName];
    try {
      await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 1024 * 1024 * 12
      });
      const installed = await checkRapidOcrAvailable();
      if (installed.available) {
        return {
          installed: true,
          skipped: false,
          available: true,
          backend: installed.backend,
          version: installed.version,
          pythonCommand: installed.pythonCommand,
          message: `${installed.backend} installed successfully.`
        };
      }
      errors.push(`${command}: pip completed but RapidOCR was still unavailable`);
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }

  const message = `RapidOCR install failed: ${errors.join(" | ")}`;
  if (optional) {
    return {
      installed: false,
      skipped: false,
      available: false,
      message
    };
  }

  throw new Error(message);
}

function pythonCandidates(args) {
  return process.platform === "win32"
    ? [["py", ["-3", ...args]], ["python", args], ["python3", args]]
    : [["python3", args], ["python", args]];
}
