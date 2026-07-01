import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ocrTimeoutMs = 25_000;

export async function recognizeTextLocal(imagePath, { outputPath = null } = {}) {
  if (process.env.CODEX_CANVAS_LOCAL_OCR === "0") {
    return { backend: "disabled", items: [], error: "Local OCR is disabled." };
  }

  const startedAt = Date.now();
  const result = await runRapidOcr(imagePath);
  const items = result.items.map(normalizeItem).filter((item) => item.text);
  const payload = {
    backend: result.backend,
    durationMs: Date.now() - startedAt,
    items,
    error: result.error || null
  };
  if (outputPath && items.length > 0) {
    await fs.writeFile(outputPath, `${JSON.stringify({ items }, null, 2)}\n`);
  }
  return payload;
}

async function runRapidOcr(imagePath) {
  const script = `
import json
import sys

image_path = sys.argv[1]

def confidence_label(score):
    try:
        value = float(score)
    except Exception:
        return "medium"
    if value >= 0.8:
        return "high"
    if value >= 0.55:
        return "medium"
    return "low"

def bbox_label(box):
    try:
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        return "bbox %.0f,%.0f %.0fx%.0f" % (min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys))
    except Exception:
        return ""

def normalize(result):
    items = []
    if isinstance(result, tuple) and result:
        result = result[0]

    if hasattr(result, "txts"):
        txts = list(getattr(result, "txts") or [])
        scores = list(getattr(result, "scores", []) or [])
        boxes = list(getattr(result, "boxes", []) or [])
        for index, text in enumerate(txts):
            items.append({
                "text": str(text).strip(),
                "location": bbox_label(boxes[index]) if index < len(boxes) else "",
                "style": "",
                "confidence": confidence_label(scores[index] if index < len(scores) else None),
            })
        return items

    if isinstance(result, dict):
        candidates = result.get("data") or result.get("results") or result.get("items") or []
    else:
        candidates = result or []

    for entry in candidates:
        text = ""
        score = None
        box = None
        if isinstance(entry, dict):
            text = entry.get("text") or entry.get("rec_text") or entry.get("txt") or ""
            score = entry.get("score") or entry.get("confidence") or entry.get("rec_score")
            box = entry.get("box") or entry.get("dt_box") or entry.get("points")
        elif isinstance(entry, (list, tuple)):
            if len(entry) >= 3:
                box, text, score = entry[0], entry[1], entry[2]
            elif len(entry) >= 2:
                box, text = entry[0], entry[1]
            elif len(entry) == 1:
                text = entry[0]
        text = str(text).strip()
        if text:
            items.append({
                "text": text,
                "location": bbox_label(box) if box is not None else "",
                "style": "",
                "confidence": confidence_label(score),
            })
    return items

backend = None
try:
    from rapidocr_onnxruntime import RapidOCR
    backend = "rapidocr_onnxruntime"
except Exception:
    try:
        from rapidocr import RapidOCR
        backend = "rapidocr"
    except Exception as exc:
        print(json.dumps({"backend": "none", "items": [], "error": "RapidOCR is not installed: %s" % exc}, ensure_ascii=False))
        sys.exit(0)

try:
    engine = RapidOCR()
    result = engine(image_path)
    print(json.dumps({"backend": backend, "items": normalize(result)}, ensure_ascii=False))
except Exception as exc:
    print(json.dumps({"backend": backend or "rapidocr", "items": [], "error": str(exc)}, ensure_ascii=False))
`;

  const errors = [];
  for (const [command, args] of pythonCandidates(["-c", script, imagePath])) {
    try {
      const { stdout } = await execFileAsync(command, args, {
        windowsHide: true,
        timeout: ocrTimeoutMs,
        maxBuffer: 1024 * 1024
      });
      const parsed = JSON.parse(stdout.trim() || "{}");
      return {
        backend: parsed.backend || command,
        items: Array.isArray(parsed.items) ? parsed.items : [],
        error: parsed.error || null
      };
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }
  return { backend: "none", items: [], error: errors.join(" | ") };
}

function pythonCandidates(args) {
  return process.platform === "win32"
    ? [["py", ["-3", ...args]], ["python", args], ["python3", args]]
    : [["python3", args], ["python", args]];
}

function normalizeItem(item) {
  return {
    text: String(item?.text || "").trim(),
    location: String(item?.location || "").trim(),
    style: String(item?.style || "").trim(),
    confidence: String(item?.confidence || "medium").trim() || "medium"
  };
}
