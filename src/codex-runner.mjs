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
  const args = [
    "exec",
    "--ephemeral",
    "--color", "never",
    "-c", `model_reasoning_effort=${JSON.stringify(reasoningEffort)}`,
    "--cd", projectDir,
    "--sandbox", "danger-full-access",
    "--image", imagePath,
    "--",
    prompt
  ];
  if (model) args.splice(4, 0, "--model", model);

  const child = spawn(executable, args, {
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
