import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const executableNames = process.platform === "win32" ? ["codex.exe", "codex.cmd", "codex"] : ["codex"];

export async function resolveCodexExecutable() {
  const configured = process.env.AGENT_CANVAS_CODEX_CLI;
  const candidates = [
    configured,
    ...platformBundledCandidates(),
    ...pathCandidates()
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  const error = new Error("Codex CLI was not found. Open or install Codex App, or set AGENT_CANVAS_CODEX_CLI.");
  error.statusCode = 503;
  throw error;
}

export async function startCodexImageJob({ projectDir, action, imagePath, outputDir, logPath, prompt: userPrompt }) {
  const executable = await resolveCodexExecutable();
  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(path.dirname(logPath), { recursive: true });

  const prompt = promptForAction({ action, outputDir, userPrompt });
  const model = process.env.AGENT_CANVAS_CODEX_MODEL;
  const requestedReasoningEffort = process.env.AGENT_CANVAS_CODEX_REASONING_EFFORT || "low";
  const reasoningEffort = requestedReasoningEffort === "minimal" ? "low" : requestedReasoningEffort;
  const imagePaths = (Array.isArray(imagePath) ? imagePath : [imagePath]).filter(Boolean);
  const args = [
    "exec",
    "--ephemeral",
    "--color", "never",
    "-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    "--cd", projectDir,
    "--sandbox", "danger-full-access"
  ];
  for (const attachedImagePath of imagePaths) {
    args.push("--image", attachedImagePath);
  }
  args.push("--", prompt);
  if (model) args.splice(4, 0, "--model", model);

  const child = spawnCodexProcess(executable, args, {
    cwd: projectDir,
    env: {
      ...process.env,
      AGENT_CANVAS_JOB_OUTPUT_DIR: outputDir,
      NO_COLOR: "1"
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });

  const done = new Promise((resolve, reject) => {
    const output = [];
    const collect = (chunk) => {
      const text = chunk.toString();
      output.push(text);
      fs.appendFile(logPath, text).catch(() => {});
    };

    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const log = output.join("");
      if (code === 0) {
        resolve({ executable, code, signal, log });
        return;
      }
      const error = new Error(`Codex image job failed with ${signal || `exit code ${code}`}.`);
      error.code = code;
      error.signal = signal;
      error.log = log;
      reject(error);
    });
  });

  return { child, done, executable };
}

export function spawnCodexProcess(executable, args, options = {}) {
  return spawn(executable, args, {
    ...options,
    shell: options.shell ?? shouldUseShellForCommandScript(executable)
  });
}

export async function runCodexImageJob(options) {
  const job = await startCodexImageJob(options);
  return job.done;
}

function platformBundledCandidates() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Codex.app/Contents/Resources/codex",
      path.join(os.homedir(), "Applications", "Codex.app", "Contents", "Resources", "codex")
    ];
  }

  if (process.platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Codex"),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Codex"),
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Codex"),
      process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Codex")
    ].filter(Boolean);
    return roots.flatMap((root) => [
      path.join(root, "resources", "codex.exe"),
      path.join(root, "resources", "codex.cmd"),
      path.join(root, "codex.exe"),
      path.join(root, "codex.cmd")
    ]);
  }

  return [];
}

function pathCandidates() {
  return String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((entry) => executableNames.map((name) => path.join(entry, name)));
}

async function isExecutable(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shouldUseShellForCommandScript(filePath) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(filePath);
}

function promptForAction({ action, outputDir, userPrompt }) {
  if (action === "recognize-text") {
    const textInventoryPath = path.join(outputDir, "recognized-text.json");
    return [
      "Use the canvas-edit-text skill to inspect the attached image.",
      "Do not call imagegen. Do not generate or edit an image.",
      "Optimize for latency: do not inspect unrelated repository files and do not run broad filesystem searches.",
      "",
      "Task: recognize every visible text fragment in the attached image.",
      "Write the formatted text inventory to this exact path:",
      textInventoryPath,
      "Use JSON with this shape: {\"items\":[{\"text\":\"...\",\"location\":\"...\",\"style\":\"...\",\"confidence\":\"high|medium|low\"}]}.",
      "Keep the item order natural for editing: top-to-bottom, left-to-right when possible.",
      "If there is no visible text, write {\"items\":[]}.",
      "Do not modify source files outside that output directory.",
      "",
      "Finish with a concise message containing only the text inventory path."
    ].join("\n");
  }

  if (action === "edit-text-session") {
    const textInventoryPath = path.join(outputDir, "recognized-text.json");
    const editPlanPath = path.join(outputDir, "edit-plan.json");
    return [
      "Use the canvas-edit-text skill and the imagegen skill for an Agent-Canvas Edit Text session.",
      "This is an interactive background session coordinated through files. Do not exit after recognition.",
      "Optimize for latency: do not inspect unrelated repository files and do not run broad filesystem searches.",
      "",
      "Step 1: recognize every visible text fragment in the attached image.",
      "Write the formatted text inventory to this exact path:",
      textInventoryPath,
      "Use JSON with this shape: {\"items\":[{\"text\":\"...\",\"location\":\"...\",\"style\":\"...\",\"confidence\":\"high|medium|low\"}]}.",
      "Keep the item order natural for editing: top-to-bottom, left-to-right when possible.",
      "If there is no visible text, write {\"items\":[]}.",
      "",
      "Step 2: wait for the frontend to write the user's edit plan to this exact path:",
      editPlanPath,
      "Poll for that file every 1 second for up to 10 minutes. Do not call imagegen before the file exists.",
      "If the edit plan contains {\"cancelled\":true}, finish without generating an image.",
      "",
      "Step 3: after the edit plan file exists, read it and call imagegen exactly once to create the revised image.",
      "Preserve non-text content, composition, aspect ratio, colors, perspective, typography style, and design intent.",
      "Only change text requested by the edit plan. Keep unchanged recognized text as-is.",
      "Treat this as an image edit, not a new unrelated generation.",
      "",
      `Save or copy the final image into this exact directory: ${outputDir}`,
      "Use a descriptive filename ending in .png, such as edit-text-result.png.",
      "As soon as the generated PNG exists, copy it into the output directory and finish.",
      "Do not modify source files outside that output directory.",
      "Do not ask follow-up questions.",
      "",
      "Finish with a concise message containing the saved output path."
    ].join("\n");
  }

  if (action === "quick-edit") {
    return [
      "Use the canvas-quick-edit skill and the imagegen skill to edit the attached image.",
      "Optimize for latency: do not inspect unrelated repository files, do not produce variants, and do not run broad filesystem searches before generation.",
      "",
      "Task: perform this user-described image edit:",
      userPrompt || "Improve the image according to the user's selected Quick Edit request.",
      "",
      "Preserve the source image's important subject identity, composition, aspect ratio, visible text, and design intent unless the edit explicitly says to change them.",
      "Treat this as an image edit, not a new unrelated generation.",
      "",
      `Save or copy the final image into this exact directory: ${outputDir}`,
      "Use a descriptive filename ending in .png, such as quick-edit-result.png.",
      "As soon as the generated PNG exists, copy it into the output directory and finish.",
      "Do not modify source files outside that output directory.",
      "Do not ask follow-up questions. Do not perform extra visual QA unless generation clearly failed.",
      "",
      "Finish with a concise message containing the saved output path."
    ].join("\n");
  }

  if (action === "expand") {
    return [
      "Use the canvas-expand skill and the imagegen skill to expand the attached image.",
      "Optimize for latency: do not inspect unrelated repository files, do not produce variants, and do not run broad filesystem searches before generation.",
      "",
      "Task: outpaint the selected image beyond its current edges according to this user instruction:",
      userPrompt || "Expand the image naturally beyond its current frame.",
      "",
      "Preserve the source subject identity, visible text, perspective, lighting, colors, and design intent.",
      "Extend the scene or design outside the current frame; do not crop, zoom in, replace the main subject, or redesign unrelated content.",
      "Keep the original image content centered or anchored as the visual source, with plausible new surrounding content.",
      "Use a wider or taller canvas only when the instruction implies that direction; otherwise create a balanced expansion with extra context around all sides.",
      "Treat this as an outpainting image edit, not a new unrelated generation.",
      "",
      `Save or copy the final expanded image into this exact directory: ${outputDir}`,
      "Use a descriptive filename ending in .png, such as expand-result.png.",
      "As soon as the generated PNG exists, copy it into the output directory and finish.",
      "Do not modify source files outside that output directory.",
      "Do not ask follow-up questions. Do not perform extra visual QA unless generation clearly failed.",
      "",
      "Finish with a concise message containing the saved output path."
    ].join("\n");
  }

  if (action === "edit-text") {
    return [
      "Use the canvas-edit-text skill and the imagegen skill to edit the attached image.",
      "Optimize for latency: do not inspect unrelated repository files, do not produce variants, and do not run broad filesystem searches before generation.",
      "",
      "Task: perform this user-confirmed text edit plan:",
      userPrompt || "Edit the visible text according to the user's selected Edit Text request.",
      "",
      "The frontend already ran text recognition and the user may have edited the recognized text fields.",
      "Do not run a separate recognition pass unless the edit plan is unusable.",
      "Call imagegen exactly once to create a revised image with the requested text changes.",
      "Preserve non-text content, composition, aspect ratio, colors, perspective, typography style, and design intent.",
      "Only change text requested by the edit instruction. Keep unchanged visible text as-is.",
      "Treat this as an image edit, not a new unrelated generation.",
      "",
      `Save or copy the final image into this exact directory: ${outputDir}`,
      "Use a descriptive filename ending in .png, such as edit-text-result.png.",
      "As soon as the generated PNG exists, copy it into the output directory and finish.",
      "Do not modify source files outside that output directory.",
      "Do not ask follow-up questions. Do not perform extra visual QA unless generation clearly failed.",
      "",
      "Finish with a concise message containing the saved output path."
    ].join("\n");
  }

  if (action === "edit-elements") {
    return [
      "Use the canvas-edit-elements skill and the imagegen skill to inspect the attached image.",
      "Optimize for latency: do not inspect unrelated repository files, do not produce variants, and do not run broad filesystem searches before generation.",
      "",
      "Task: create a hard-edged low-detail design-layer segmentation map for generic element separation.",
      "Use quality=low if the imagegen surface exposes a quality setting; otherwise make the prompt explicitly low-detail and mask-like.",
      "Call imagegen exactly once. Treat this as an image edit/reference task, not a new unrelated design.",
      "The output must match the source image aspect ratio and approximate the source's element boundaries.",
      "Default layer classes are: independently editable objects, logical text groups, and one single background.",
      "Default to object-level granularity, not part-level granularity.",
      "A complete object must stay one solid color region even if it contains internal texture, print, labels, fruit graphics, UI details, reflections, highlights, droplets, holes, or small attached details.",
      "Only split things that a designer would reasonably move or edit independently on a canvas.",
      "Render each independently editable object or logical text group as a hard-edged flat solid high-contrast color region.",
      "Render the entire background as one flat solid #000000 region. Do not split background panels, brush strokes, gradients, wall/table/floor fills, texture, shadows, or background decorative marks into separate regions.",
      "Use different non-black colors for product objects, badge/card objects, headline groups, logo groups, and foreground props.",
      "Prefer this fixed high-contrast palette for foreground layers, using each color at most once before choosing additional distinct saturated colors: #ff0066, #66ff00, #00ffff, #0066ff, #9933ff, #ff6600, #996633, #ffcc00, #00aa66, #cc33ff.",
      "Never reuse the same or a similar non-black color for unrelated objects or text groups.",
      "No labels, no legends, no readable words, no icons, no gradients, no shadows, no textures, no source artwork, and no antialias-like pictorial detail in the segmentation map.",
      "Represent text areas as one filled text-group silhouette or simple filled block per logical text group. Do not recreate individual readable characters unless the letters themselves are the object boundary needed for editing.",
      "Do not leave important source regions uncolored unless they are empty margin.",
      "",
      `Save or copy only the segmentation map into this exact directory: ${outputDir}`,
      "Use a descriptive filename ending in .png, such as edit-elements-segmentation.png.",
      "As soon as the generated PNG exists, copy it into the output directory and finish.",
      "Do not modify source files outside that output directory.",
      "Do not ask follow-up questions. Do not run the local splitting algorithm yourself; Agent-Canvas will do that after collection.",
      "",
      "Finish with a concise message containing the saved segmentation map path."
    ].join("\n");
  }

  if (action === "edit-elements-background") {
    return [
      "Use the canvas-edit-elements skill and the imagegen skill to complete an Agent-Canvas Edit Elements background layer.",
      "Optimize for latency: do not inspect unrelated repository files, do not produce variants, and do not run broad filesystem searches before generation.",
      "",
      "Attached image 1 is the original source image.",
      "Attached image 2 is the locally segmented background layer with transparent holes where foreground objects/text were removed.",
      "",
      "Task: create one complete clean background image for layer reconstruction.",
      "Use imagegen exactly once. Treat this as an image edit/inpainting task, not a new unrelated design.",
      "Fill only the transparent or missing regions from attached image 2 using visual context from attached image 1.",
      "Remove foreground objects and text from the filled background. Do not recreate products, badges, foreground props, or readable text that belong to separated object layers.",
      "Preserve the source image aspect ratio, canvas size, perspective, lighting, color palette, background style, and design intent.",
      "The result must be a full-frame background PNG with no transparency requirement and no extra border, labels, legend, mask colors, or side-by-side comparison.",
      "",
      `Save or copy only the completed background image into this exact directory: ${outputDir}`,
      "Use a descriptive filename ending in .png, such as edit-elements-background-completed.png.",
      "As soon as the generated PNG exists, copy it into the output directory and finish.",
      "Do not modify source files outside that output directory.",
      "Do not ask follow-up questions. Do not run the local splitting algorithm yourself; Agent-Canvas will integrate the completed background after collection.",
      "",
      "Finish with a concise message containing the saved completed background path."
    ].join("\n");
  }

  if (action !== "remove-bg") {
    throw new Error(`Unsupported Codex image action: ${action}`);
  }

  return [
    "Use the canvas-remove-bg skill and the imagegen skill to edit the attached image.",
    "Optimize for latency: do not inspect unrelated repository files, do not produce variants, and do not run broad filesystem searches before generation.",
    "",
    "Task: isolate the foreground subject for background removal.",
    "Preserve the foreground subject, its proportions, visible text, and visual quality as much as possible.",
    "Use the default built-in image generation/editing path.",
    "Generate the foreground subject on a perfectly flat solid #ff00ff chroma-key background.",
    "The background must be one uniform #ff00ff color with no shadows, gradients, texture, reflections, floor plane, or lighting variation.",
    "Do not use #ff00ff anywhere in the subject. Keep the subject fully separated from the background with crisp edges and generous padding.",
    "Agent-Canvas will remove the chroma key locally and verify the final PNG alpha channel before collecting it.",
    "",
    `Save or copy the final image into this exact directory: ${outputDir}`,
    "Use a descriptive filename ending in .png, such as remove-bg-chroma-source.png.",
    "As soon as the generated PNG exists, copy it into the output directory and finish.",
    "Do not modify source files outside that output directory.",
    "Do not ask follow-up questions. Do not perform extra visual QA unless generation clearly failed.",
    "",
    "Finish with a concise message containing the saved output path."
  ].join("\n");
}
