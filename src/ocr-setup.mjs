import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

  const packageName = process.env.CODEX_CANVAS_OCR_PACKAGE || defaultPackageName;
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

export async function checkImageProcessingDepsAvailable() {
  const script = `
import json
import sys

result = {"available": True, "missing": [], "versions": {}}
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
        missing: Array.isArray(result.missing) ? result.missing : [],
        versions: result.versions || {},
        pythonCommand: command,
        pythonArgs: args.slice(0, args.length - 2)
      };
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }

  return {
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
    return {
      installed: false,
      skipped: true,
      available: true,
      versions: existing.versions,
      pythonCommand: existing.pythonCommand,
      message: "Pillow and numpy are already installed."
    };
  }

  const packages = String(process.env.CODEX_CANVAS_IMAGE_DEPS_PACKAGES || imageProcessingPackages.join(" "))
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const errors = [];
  for (const [command, baseArgs] of pythonCandidates([])) {
    const args = [...baseArgs, "-m", "pip", "install", "--user", ...packages];
    try {
      await execFileAsync(command, args, {
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 1024 * 1024 * 12
      });
      const installed = await checkImageProcessingDepsAvailable();
      if (installed.available) {
        return {
          installed: true,
          skipped: false,
          available: true,
          versions: installed.versions,
          pythonCommand: installed.pythonCommand,
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

function pythonCandidates(args) {
  return process.platform === "win32"
    ? [["py", ["-3", ...args]], ["python", args], ["python3", args]]
    : [["python3", args], ["python", args]];
}
