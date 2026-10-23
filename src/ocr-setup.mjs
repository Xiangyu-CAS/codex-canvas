import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pythonCandidates, rememberPythonRuntime } from "./python-runtime.mjs";

const execFileAsync = promisify(execFile);
const defaultPackageName = "rapidocr_onnxruntime";
const imageProcessingPackages = ["Pillow", "numpy"];

export async function checkRapidOcrAvailable() {
  const script = `
import json
import sys

for name in ("rapidocr_onnxruntime", "rapidocr"):
    try:
        module = __import__(name)
        print(json.dumps({"available": True, "backend": name, "version": getattr(module, "__version__", None), "pythonExecutable": sys.executable}))
        sys.exit(0)
    except Exception:
        pass

print(json.dumps({"available": False, "backend": None, "version": None}))
`;

  const errors = [];
  let unavailable;
  for (const [command, args] of await pythonCandidates(["-c", script], "ocr")) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      const result = JSON.parse(stdout.trim() || "{}");
      const status = {
        available: result.available === true,
        backend: result.backend || null,
        version: result.version || null,
        pythonCommand: command,
        pythonExecutable: result.pythonExecutable || null,
        pythonArgs: args.slice(0, args.length - 2)
      };
      if (status.available) return status;
      unavailable ||= status;
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }

  return unavailable || {
    available: false,
    backend: null,
    version: null,
    pythonCommand: null,
    pythonArgs: [],
    error: errors.join(" | ")
  };
}

export async function installRapidOcr({ optional = false } = {}) {
  if (process.env.CODEX_CANVAS_SKIP_OCR_INSTALL === "1") {
    return {
      installed: false,
      skipped: true,
      available: false,
      message: "Skipped because CODEX_CANVAS_SKIP_OCR_INSTALL=1."
    };
  }

  const existing = await checkRapidOcrAvailable();
  if (existing.available) {
    await rememberPythonRuntime(existing, "ocr");
    return {
      installed: false,
      skipped: true,
      available: true,
      backend: existing.backend,
      version: existing.version,
      pythonCommand: existing.pythonCommand,
      pythonExecutable: existing.pythonExecutable,
      message: `${existing.backend} is already installed.`
    };
  }

  const packageName = process.env.CODEX_CANVAS_OCR_PACKAGE || defaultPackageName;
  const errors = [];
  for (const [command, baseArgs] of await pythonCandidates([], "ocr")) {
    const args = [...baseArgs, "-m", "pip", "install", "--user", packageName];
    try {
      await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 1024 * 1024 * 12
      });
      const installed = await checkRapidOcrAvailable();
      if (installed.available) {
        await rememberPythonRuntime(installed, "ocr");
        return {
          installed: true,
          skipped: false,
          available: true,
          backend: installed.backend,
          version: installed.version,
          pythonCommand: installed.pythonCommand,
          pythonExecutable: installed.pythonExecutable,
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

export async function checkImageProcessingDepsAvailable() {
  const script = `
import json
import sys

result = {"available": True, "missing": [], "versions": {}, "pythonExecutable": sys.executable}
for module_name, package_name in (("PIL", "Pillow"), ("numpy", "numpy")):
    try:
        module = __import__(module_name)
        result["versions"][package_name] = getattr(module, "__version__", None)
    except Exception:
        result["available"] = False
        result["missing"].append(package_name)
print(json.dumps(result))
`;

  const errors = [];
  let unavailable;
  for (const [command, args] of await pythonCandidates(["-c", script], "image-processing")) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      });
      const result = JSON.parse(stdout.trim() || "{}");
      const status = {
        available: result.available === true,
        missing: Array.isArray(result.missing) ? result.missing : [],
        versions: result.versions || {},
        pythonCommand: command,
        pythonExecutable: result.pythonExecutable || null,
        pythonArgs: args.slice(0, args.length - 2)
      };
      if (status.available) return status;
      unavailable ||= status;
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }

  return unavailable || {
    available: false,
    missing: imageProcessingPackages,
    versions: {},
    pythonCommand: null,
    pythonArgs: [],
    error: errors.join(" | ")
  };
}

export async function installImageProcessingDeps({ optional = false } = {}) {
  if (process.env.CODEX_CANVAS_SKIP_IMAGE_DEPS_INSTALL === "1") {
    return {
      installed: false,
      skipped: true,
      available: false,
      message: "Skipped because CODEX_CANVAS_SKIP_IMAGE_DEPS_INSTALL=1."
    };
  }

  const existing = await checkImageProcessingDepsAvailable();
  if (existing.available) {
    await rememberPythonRuntime(existing, "image-processing");
    return {
      installed: false,
      skipped: true,
      available: true,
      versions: existing.versions,
      pythonCommand: existing.pythonCommand,
      pythonExecutable: existing.pythonExecutable,
      message: "Pillow and numpy are already installed."
    };
  }

  const packages = String(process.env.CODEX_CANVAS_IMAGE_DEPS_PACKAGES || imageProcessingPackages.join(" "))
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const errors = [];
  for (const [command, baseArgs] of await pythonCandidates([], "image-processing")) {
    const args = [...baseArgs, "-m", "pip", "install", "--user", ...packages];
    try {
      await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 1024 * 1024 * 12
      });
      const installed = await checkImageProcessingDepsAvailable();
      if (installed.available) {
        await rememberPythonRuntime(installed, "image-processing");
        return {
          installed: true,
          skipped: false,
          available: true,
          versions: installed.versions,
          pythonCommand: installed.pythonCommand,
          pythonExecutable: installed.pythonExecutable,
          message: "Pillow and numpy installed successfully."
        };
      }
      errors.push(`${command}: pip completed but image processing dependencies were still unavailable`);
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }

  const message = `Image processing dependency install failed: ${errors.join(" | ")}`;
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

export async function installOptionalPythonDeps() {
  const ocr = await installRapidOcr({ optional: true });
  const imageProcessing = await installImageProcessingDeps({ optional: true });
  return {
    installed: Boolean(ocr.installed || imageProcessing.installed),
    skipped: Boolean(ocr.skipped && imageProcessing.skipped),
    available: Boolean(ocr.available && imageProcessing.available),
    ocr,
    imageProcessing,
    message: [
      `OCR: ${ocr.message}`,
      `Image deps: ${imageProcessing.message}`
    ].join("\n")
  };
}

export async function checkOptionalPythonDepsAvailable() {
  const ocr = await checkRapidOcrAvailable();
  const imageProcessing = await checkImageProcessingDepsAvailable();
  return {
    available: Boolean(ocr.available && imageProcessing.available),
    ocr,
    imageProcessing
  };
}
