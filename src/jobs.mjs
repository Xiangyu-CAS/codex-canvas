import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { collectRecentImages } from "./collector.mjs";
import { jobsDirFor } from "./paths.mjs";
import { addJobPlaceholder, deleteObject, readState, updateObject } from "./store.mjs";
import { startCodexImageJob } from "./codex-runner.mjs";
import { recognizeTextLocal } from "./local-ocr.mjs";

const execFileAsync = promisify(execFile);
const jobs = new Map();
const textRecognitionJobs = new Map();
const supportedActions = new Set(["remove-bg", "quick-edit", "edit-text"]);
const ignoredGeneratedImagePaths = new Set();
const outputPollMs = 1000;
const jobTimeoutMs = 5 * 60_000;
const chromaKeyColor = "#ff00ff";

export async function createImageJob(projectDir, input) {
  const action = String(input.action || "");
  if (!supportedActions.has(action)) {
    const error = new Error(`Unsupported image job action: ${action || "(missing)"}`);
    error.statusCode = 400;
    throw error;
  }

  const object = await requireImageObject(projectDir, input.objectId);

  const imagePath = object.assetPath || object.sourcePath;
  if (!imagePath) {
    const error = new Error("The selected image must be a local canvas asset before running image jobs.");
    error.statusCode = 400;
    throw error;
  }

  const id = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const jobDir = path.join(jobsDirFor(projectDir), id);
  const outputDir = path.join(jobDir, "outputs");
  const logPath = path.join(jobDir, "codex.log");
  const startedAtMs = Date.now();
  const job = {
    id,
    action,
    status: "queued",
    objectId: object.id,
    sourceObjectId: object.id,
    imagePath,
    prompt: typeof input.prompt === "string" ? input.prompt.trim().slice(0, 4000) : "",
    outputDir,
    logPath,
    textInventoryPath: null,
    createdAt: new Date(startedAtMs).toISOString(),
    startedAt: null,
    completedAt: null,
    durationMs: null,
    outputDetectedAt: null,
    detectedOutputPath: null,
    codexSessionId: null,
    imported: [],
    placeholder: null,
    placeholderId: null,
    error: null
  };
  const placeholder = await addJobPlaceholder(projectDir, {
    id: `${id}_placeholder`,
    action,
    status: "running",
    name: actionLabel(action),
    sourceObjectId: object.id,
    width: object.width,
    height: object.height
  });
  job.placeholder = placeholder;
  job.placeholderId = placeholder.id;
  jobs.set(id, job);

  runJob(projectDir, job, startedAtMs).catch((error) => {
    markFailed(projectDir, job, error).catch(() => {});
  });

  return publicJob(job);
}

export async function createTextRecognitionJob(projectDir, input) {
  const object = await requireImageObject(projectDir, input.objectId);
  const imagePath = object.assetPath || object.sourcePath;
  if (!imagePath) {
    const error = new Error("The selected image must be a local canvas asset before recognizing text.");
    error.statusCode = 400;
    throw error;
  }

  const id = `text_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const jobDir = path.join(jobsDirFor(projectDir), id);
  const outputDir = path.join(jobDir, "outputs");
  const logPath = path.join(jobDir, "codex.log");
  const job = {
    id,
    action: "edit-text",
    stage: "recognizing",
    status: "queued",
    objectId: object.id,
    sourceObjectId: object.id,
    imagePath,
    outputDir,
    logPath,
    textInventoryPath: path.join(outputDir, "recognized-text.json"),
    editPlanPath: path.join(outputDir, "edit-plan.json"),
    createdAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    durationMs: null,
    outputDetectedAt: null,
    detectedOutputPath: null,
    codexSessionId: null,
    recognitionBackend: null,
    localOcrError: null,
    prompt: "",
    imported: [],
    placeholder: null,
    placeholderId: null,
    items: [],
    error: null
  };
  textRecognitionJobs.set(id, job);

  runTextRecognitionJob(projectDir, job, Date.now()).catch((error) => {
    markTextRecognitionFailed(job, error).catch(() => {});
  });

  return publicTextRecognitionJob(job);
}

export function getImageJob(id) {
  const job = jobs.get(id);
  if (!job) {
    const error = new Error(`Image job not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  return publicJob(job);
}

export function getTextRecognitionJob(id) {
  const job = textRecognitionJobs.get(id);
  if (!job) {
    const error = new Error(`Text recognition job not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  return publicTextRecognitionJob(job);
}

export async function submitTextRecognitionEdit(projectDir, id, input = {}) {
  const job = textRecognitionJobs.get(id);
  if (!job) {
    const error = new Error(`Text recognition job not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  if (job.status !== "running" || job.stage !== "ready") {
    const error = new Error("Edit Text is not ready for generation yet.");
    error.statusCode = 409;
    throw error;
  }

  if (input.cancelled === true) {
    await fs.writeFile(job.editPlanPath, `${JSON.stringify({ cancelled: true, submittedAt: new Date().toISOString() }, null, 2)}\n`);
    job.stage = "cancelling";
    await appendJobLog(job, `Edit Text cancellation written: ${job.editPlanPath}`);
    return publicTextRecognitionJob(job);
  }

  const object = await requireImageObject(projectDir, job.sourceObjectId);
  if (!job.placeholderId) {
    const placeholder = await addJobPlaceholder(projectDir, {
      id: `${id}_placeholder`,
      action: "edit-text",
      status: "running",
      name: actionLabel("edit-text"),
      sourceObjectId: object.id,
      width: object.width,
      height: object.height
    });
    job.placeholder = placeholder;
    job.placeholderId = placeholder.id;
  }

  const plan = {
    prompt: typeof input.prompt === "string" ? input.prompt.trim().slice(0, 6000) : "",
    changes: Array.isArray(input.changes) ? input.changes : [],
    items: job.items,
    submittedAt: new Date().toISOString()
  };
  await fs.writeFile(job.editPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  job.stage = "generating";
  job.prompt = plan.prompt;
  await appendJobLog(job, `Edit Text plan written: ${job.editPlanPath}`);
  return publicTextRecognitionJob(job);
}

export function hasRunningImageJobs() {
  return Array.from(jobs.values()).some((job) => job.status === "queued" || job.status === "running")
    || Array.from(textRecognitionJobs.values()).some((job) => job.status === "running" && job.stage === "generating");
}

export function getActivePlaceholderIds() {
  return [
    ...Array.from(jobs.values()),
    ...Array.from(textRecognitionJobs.values())
  ]
    .filter((job) => job.status === "queued" || job.status === "running")
    .map((job) => job.placeholderId)
    .filter(Boolean);
}

export function getIgnoredGeneratedImagePaths() {
  return Array.from(ignoredGeneratedImagePaths);
}

async function runJob(projectDir, job, startedAtMs) {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  await fs.mkdir(job.outputDir, { recursive: true });
  await appendJobLog(job, `Agent-Canvas job started: ${job.action}`);

  const codexJob = await startCodexImageJob({
    projectDir,
    action: job.action,
    imagePath: job.imagePath,
    outputDir: job.outputDir,
    logPath: job.logPath,
    prompt: job.prompt
  });

  await appendJobLog(job, `Codex child started: ${codexJob.executable}`);
  const outputReady = waitForJobOutputImage(job, startedAtMs, jobTimeoutMs).then((imagePath) => ({ type: "output", imagePath }));
  const codexDone = codexJob.done.then(
    () => ({ type: "done" }),
    (error) => ({ type: "failed", error })
  );
  const timeout = timeoutAfter(jobTimeoutMs, () => stopChild(codexJob.child));
  const first = await Promise.race([outputReady, codexDone, timeout]);
  if (first.type === "timeout") throw new Error(`${actionLabel(job.action)} timed out after ${Math.round(jobTimeoutMs / 60_000)} minutes.`);
  if (first.type === "failed") throw first.error;
  if (first.type === "output" && first.imagePath) {
    job.outputDetectedAt = new Date().toISOString();
    job.detectedOutputPath = first.imagePath;
    await appendJobLog(job, `Output detected after ${formatDuration(Date.now() - startedAtMs)}: ${first.imagePath}`);
    await rememberGeneratedImages(startedAtMs);
    await collectAndPlaceResult(projectDir, job, startedAtMs, { final: false, detectedImagePath: first.imagePath });
  }
  if (job.status === "done") {
    stopChild(codexJob.child);
    return;
  }

  const final = first.type === "done" ? first : await Promise.race([codexDone, timeout]);
  if (final.type === "timeout") throw new Error(`${actionLabel(job.action)} timed out after ${Math.round(jobTimeoutMs / 60_000)} minutes.`);
  if (final.type === "failed") throw final.error;
  await appendJobLog(job, `Codex child finished before output collection after ${formatDuration(Date.now() - startedAtMs)}`);
  await rememberGeneratedImages(startedAtMs);
  await collectAndPlaceResult(projectDir, job, startedAtMs, { final: true });
}

async function runTextRecognitionJob(projectDir, job, startedAtMs) {
  job.status = "running";
  job.stage = "recognizing";
  job.startedAt = new Date().toISOString();
  await fs.mkdir(job.outputDir, { recursive: true });
  await appendJobLog(job, "Agent-Canvas edit text session started");

  const localOcr = await recognizeTextLocal(job.imagePath, { outputPath: job.textInventoryPath }).catch((error) => ({
    backend: "local-ocr",
    items: [],
    error: error?.message || String(error)
  }));
  job.recognitionBackend = localOcr.backend;
  job.localOcrError = localOcr.error || null;
  if (localOcr.items.length > 0) {
    job.items = localOcr.items;
    job.stage = "ready";
    await appendJobLog(job, `Local OCR ready after ${formatDuration(Date.now() - startedAtMs)} using ${localOcr.backend} with ${job.items.length} item(s).`);
    const editPlan = await Promise.race([
      waitForEditPlan(job),
      timeoutAfter(10 * 60_000)
    ]);
    if (editPlan.type === "timeout") throw new Error("Edit Text session timed out after 10 minutes.");
    if (editPlan.type === "failed") throw editPlan.error;
    await runStandaloneTextEditGeneration(projectDir, job, startedAtMs, editPlan);
    return;
  }
  await appendJobLog(job, `Local OCR unavailable or empty via ${localOcr.backend}: ${localOcr.error || "no text found"}. Falling back to Codex vision.`);

  const codexJob = await startCodexImageJob({
    projectDir,
    action: "edit-text-session",
    imagePath: job.imagePath,
    outputDir: job.outputDir,
    logPath: job.logPath,
    prompt: ""
  });

  await appendJobLog(job, `Codex child started: ${codexJob.executable}`);
  const codexDone = codexJob.done.then(
    () => ({ type: "done" }),
    (error) => ({ type: "failed", error })
  );
  const sessionTimeoutMs = 10 * 60_000;
  const sessionTimeout = timeoutAfter(sessionTimeoutMs, () => stopChild(codexJob.child));
  const recognized = await Promise.race([
    waitForTextInventory(job),
    codexDone,
    sessionTimeout
  ]);
  if (recognized.type === "timeout") throw new Error(`Edit Text session timed out after ${Math.round(sessionTimeoutMs / 60_000)} minutes.`);
  if (recognized.type === "failed") throw recognized.error;
  if (recognized.type === "done") throw new Error("Codex exited before text recognition completed.");

  const inventory = recognized.inventory;
  job.items = inventory.items;
  job.stage = "ready";
  await appendJobLog(job, `Text recognition ready after ${formatDuration(Date.now() - startedAtMs)} with ${job.items.length} item(s).`);

  const editPlan = await Promise.race([
    waitForEditPlan(job),
    codexDone,
    sessionTimeout
  ]);
  if (editPlan.type === "timeout") throw new Error(`Edit Text session timed out after ${Math.round(sessionTimeoutMs / 60_000)} minutes.`);
  if (editPlan.type === "failed") throw editPlan.error;
  if (editPlan.type === "done") throw new Error("Codex exited before the edit plan was submitted.");
  if (editPlan.plan.cancelled) {
    job.stage = "cancelled";
    job.status = "done";
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - startedAtMs;
    await appendJobLog(job, "Edit Text session cancelled.");
    return;
  }

  job.stage = "generating";
  job.prompt = editPlan.plan.prompt || "";
  const generationStartedAtMs = editPlan.submittedAtMs || Date.now();
  await appendJobLog(job, "Edit Text plan submitted; waiting for image output.");
  const outputReady = waitForJobOutputImage(job, generationStartedAtMs, jobTimeoutMs).then((imagePath) => ({ type: "output", imagePath }));
  const imageTimeout = timeoutAfter(jobTimeoutMs, () => stopChild(codexJob.child));
  const first = await Promise.race([outputReady, codexDone, imageTimeout]);
  if (first.type === "timeout") throw new Error(`${actionLabel(job.action)} timed out after ${Math.round(jobTimeoutMs / 60_000)} minutes.`);
  if (first.type === "failed") throw first.error;
  if (first.type === "output" && first.imagePath) {
    job.outputDetectedAt = new Date().toISOString();
    job.detectedOutputPath = first.imagePath;
    await appendJobLog(job, `Output detected after ${formatDuration(Date.now() - generationStartedAtMs)}: ${first.imagePath}`);
    await rememberGeneratedImages(generationStartedAtMs);
    await collectAndPlaceResult(projectDir, job, generationStartedAtMs, { final: false, detectedImagePath: first.imagePath });
  }
  if (job.status === "done") {
    stopChild(codexJob.child);
    return;
  }

  const final = first.type === "done" ? first : await Promise.race([codexDone, imageTimeout]);
  if (final.type === "timeout") throw new Error(`${actionLabel(job.action)} timed out after ${Math.round(jobTimeoutMs / 60_000)} minutes.`);
  if (final.type === "failed") throw final.error;
  await appendJobLog(job, `Codex child finished before output collection after ${formatDuration(Date.now() - generationStartedAtMs)}`);
  await rememberGeneratedImages(generationStartedAtMs);
  await collectAndPlaceResult(projectDir, job, generationStartedAtMs, { final: true });
}

async function runStandaloneTextEditGeneration(projectDir, job, startedAtMs, editPlan) {
  if (editPlan.plan.cancelled) {
    job.stage = "cancelled";
    job.status = "done";
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - startedAtMs;
    await appendJobLog(job, "Edit Text session cancelled.");
    return;
  }

  job.stage = "generating";
  job.prompt = editPlan.plan.prompt || "";
  const generationStartedAtMs = editPlan.submittedAtMs || Date.now();
  const codexJob = await startCodexImageJob({
    projectDir,
    action: "edit-text",
    imagePath: job.imagePath,
    outputDir: job.outputDir,
    logPath: job.logPath,
    prompt: job.prompt
  });

  await appendJobLog(job, `Codex generation child started after local OCR: ${codexJob.executable}`);
  const outputReady = waitForJobOutputImage(job, generationStartedAtMs, jobTimeoutMs).then((imagePath) => ({ type: "output", imagePath }));
  const codexDone = codexJob.done.then(
    () => ({ type: "done" }),
    (error) => ({ type: "failed", error })
  );
  const imageTimeout = timeoutAfter(jobTimeoutMs, () => stopChild(codexJob.child));
  const first = await Promise.race([outputReady, codexDone, imageTimeout]);
  if (first.type === "timeout") throw new Error(`${actionLabel(job.action)} timed out after ${Math.round(jobTimeoutMs / 60_000)} minutes.`);
  if (first.type === "failed") throw first.error;
  if (first.type === "output" && first.imagePath) {
    job.outputDetectedAt = new Date().toISOString();
    job.detectedOutputPath = first.imagePath;
    await appendJobLog(job, `Output detected after ${formatDuration(Date.now() - generationStartedAtMs)}: ${first.imagePath}`);
    await rememberGeneratedImages(generationStartedAtMs);
    await collectAndPlaceResult(projectDir, job, generationStartedAtMs, { final: false, detectedImagePath: first.imagePath });
  }
  if (job.status === "done") {
    stopChild(codexJob.child);
    return;
  }

  const final = first.type === "done" ? first : await Promise.race([codexDone, imageTimeout]);
  if (final.type === "timeout") throw new Error(`${actionLabel(job.action)} timed out after ${Math.round(jobTimeoutMs / 60_000)} minutes.`);
  if (final.type === "failed") throw final.error;
  await appendJobLog(job, `Codex child finished before output collection after ${formatDuration(Date.now() - generationStartedAtMs)}`);
  await rememberGeneratedImages(generationStartedAtMs);
  await collectAndPlaceResult(projectDir, job, generationStartedAtMs, { final: true });
}

async function waitForTextInventory(job) {
  while (job.status === "running") {
    const sessionId = job.codexSessionId || await readCodexSessionId(job.logPath);
    if (sessionId && sessionId !== job.codexSessionId) {
      job.codexSessionId = sessionId;
      await appendJobLog(job, `Codex session detected: ${sessionId}`);
    }
    try {
      if (await isStableFile(job.textInventoryPath)) {
        return { type: "recognized", inventory: await readTextInventory(job.textInventoryPath) };
      }
    } catch {
      // Keep polling until valid JSON is fully written.
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { type: "failed", error: new Error("Text recognition stopped before completion.") };
}

async function waitForEditPlan(job) {
  while (job.status === "running") {
    try {
      if (await isStableFile(job.editPlanPath)) {
        const plan = JSON.parse(await fs.readFile(job.editPlanPath, "utf8"));
        return { type: "edit-plan", plan, submittedAtMs: Date.now() };
      }
    } catch {
      // Keep polling until the edit plan is valid JSON.
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  return { type: "failed", error: new Error("Edit Text stopped before the edit plan was submitted.") };
}

async function readTextInventory(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Text recognition did not produce valid JSON: ${error.message}`);
  }
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return {
    ...parsed,
    items: items
      .map((item) => ({
        text: String(item?.text || "").trim(),
        location: String(item?.location || "").trim(),
        style: String(item?.style || "").trim(),
        confidence: String(item?.confidence || "medium").trim() || "medium"
      }))
      .filter((item) => item.text)
  };
}

function timeoutAfter(timeoutMs, onTimeout) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      resolve({ type: "timeout" });
    }, timeoutMs);
    timer.unref?.();
  });
}

async function collectAndPlaceResult(projectDir, job, startedAtMs, { final, detectedImagePath = null }) {
  if (job.status === "done") return true;

  const collectionImagePath = await prepareImageForCollection(job, startedAtMs, detectedImagePath);
  const roots = collectionImagePath ? [path.dirname(collectionImagePath)] : [job.outputDir];
  let result = await collectRecentImages(projectDir, {
    roots,
    sinceMs: startedAtMs - 1000,
    limit: 8,
    prompt: jobPrompt(job),
    sourceObjectId: job.sourceObjectId
  });

  if (result.imported.length === 0 && job.codexSessionId) {
    const sessionImagePath = await prepareImageForCollection(job, startedAtMs, null);
    result = await collectRecentImages(projectDir, {
      roots: [path.dirname(sessionImagePath || codexGeneratedSessionDir(job.codexSessionId))],
      sinceMs: startedAtMs - 1000,
      limit: 8,
      prompt: jobPrompt(job),
      sourceObjectId: job.sourceObjectId
    });
  }

  if (result.imported.length === 0) {
    result = await collectRecentImages(projectDir, {
      roots: [path.join(os.homedir(), ".codex", "generated_images")],
      sinceMs: startedAtMs - 1000,
      limit: 8,
      prompt: jobPrompt(job),
      sourceObjectId: job.sourceObjectId
    });
  }

  job.imported = result.imported;
  job.status = result.imported.length > 0 ? "done" : "failed";
  if (job.stage === "generating") job.stage = job.status;
  job.completedAt = new Date().toISOString();
  job.durationMs = Date.now() - startedAtMs;
  if (result.imported.length === 0) {
    if (final) {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.durationMs = Date.now() - startedAtMs;
      job.error = "Codex finished, but no generated image was found to collect.";
      await appendJobLog(job, `No image collected after ${formatDuration(job.durationMs)}.`);
      await updatePlaceholder(projectDir, job, "failed");
    }
    return false;
  }

  await placeImportedAtPlaceholder(projectDir, job);
  await appendJobLog(job, `Collected ${result.imported.length} image(s) after ${formatDuration(job.durationMs)}.`);
  return true;
}

async function prepareImageForCollection(job, startedAtMs, detectedImagePath) {
  const imagePath = detectedImagePath || await findFirstOutputImage([
    job.outputDir,
    job.codexSessionId ? codexGeneratedSessionDir(job.codexSessionId) : null,
    path.join(os.homedir(), ".codex", "generated_images")
  ], startedAtMs - 1000);
  if (!imagePath) return null;
  if (job.action !== "remove-bg") return imagePath;

  const alphaDir = path.join(job.outputDir, "alpha");
  const alphaPath = path.join(alphaDir, "remove-bg-alpha.png");
  await fs.mkdir(alphaDir, { recursive: true });
  if (!await isPngRgba(imagePath)) {
    await appendJobLog(job, `Converting Remove BG result to RGBA alpha PNG: ${imagePath}`);
    await removeChromaKey(imagePath, alphaPath);
  } else {
    await fs.copyFile(imagePath, alphaPath);
  }
  if (!await isPngRgba(alphaPath)) {
    throw new Error("Remove BG did not produce a four-channel RGBA PNG.");
  }
  await appendJobLog(job, `Remove BG alpha verified: ${alphaPath}`);
  return alphaPath;
}

async function waitForJobOutputImage(job, startedAtMs, timeoutMs) {
  const startedAt = Date.now();
  const sinceMs = startedAtMs - 1000;
  while (Date.now() - startedAt < timeoutMs) {
    const sessionId = job.codexSessionId || await readCodexSessionId(job.logPath);
    if (sessionId && sessionId !== job.codexSessionId) {
      job.codexSessionId = sessionId;
      await appendJobLog(job, `Codex session detected: ${sessionId}`);
    }

    const imagePath = await findFirstOutputImage([
      job.outputDir,
      job.codexSessionId ? codexGeneratedSessionDir(job.codexSessionId) : null
    ], sinceMs);
    if (imagePath && await isStableFile(imagePath)) return imagePath;
    await new Promise((resolve) => setTimeout(resolve, outputPollMs));
  }
  return null;
}

async function findFirstOutputImage(outputDirs, sinceMs) {
  for (const outputDir of outputDirs.filter(Boolean)) {
    const imagePath = await findOutputImage(outputDir, sinceMs);
    if (imagePath) return imagePath;
  }
  return null;
}

async function findOutputImage(outputDir, sinceMs) {
  let entries;
  try {
    entries = await fs.readdir(outputDir, { withFileTypes: true });
  } catch {
    return null;
  }
  const images = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].includes(path.extname(entry.name).toLowerCase())) continue;
    const imagePath = path.join(outputDir, entry.name);
    try {
      const stat = await fs.stat(imagePath);
      if (Number.isFinite(sinceMs) && stat.mtimeMs < sinceMs) continue;
      images.push({ path: imagePath, mtimeMs: stat.mtimeMs });
    } catch {
      // Ignore files that are still being moved into place.
    }
  }
  images.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return images[0]?.path || null;
}

async function readCodexSessionId(logPath) {
  try {
    const log = await fs.readFile(logPath, "utf8");
    return /^session id:\s*([^\s]+)\s*$/m.exec(log)?.[1] || null;
  } catch {
    return null;
  }
}

function codexGeneratedSessionDir(sessionId) {
  return path.join(os.homedir(), ".codex", "generated_images", sessionId);
}

async function isStableFile(filePath) {
  try {
    const first = await fs.stat(filePath);
    if (first.size <= 0) return false;
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await fs.stat(filePath);
    return first.size === second.size && second.size > 0;
  } catch {
    return false;
  }
}

async function isPngRgba(filePath) {
  try {
    const buffer = await fs.readFile(filePath);
    return buffer.length >= 26
      && buffer.toString("ascii", 1, 4) === "PNG"
      && buffer[25] === 6;
  } catch {
    return false;
  }
}

async function removeChromaKey(inputPath, outputPath) {
  const scriptPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "skills", ".system", "imagegen", "scripts", "remove_chroma_key.py");
  await fs.access(scriptPath);
  const args = [
    scriptPath,
    "--input", inputPath,
    "--out", outputPath,
    "--key-color", chromaKeyColor,
    "--auto-key", "border",
    "--soft-matte",
    "--transparent-threshold", "12",
    "--opaque-threshold", "220",
    "--despill",
    "--force"
  ];
  await runPython(args);
}

async function runPython(args) {
  const candidates = process.platform === "win32"
    ? [["py", ["-3", ...args]], ["python", args], ["python3", args]]
    : [["python3", args], ["python", args]];
  const errors = [];
  for (const [command, commandArgs] of candidates) {
    try {
      await execFileAsync(command, commandArgs, { windowsHide: true, maxBuffer: 1024 * 1024 });
      return;
    } catch (error) {
      errors.push(`${command}: ${error.message}`);
    }
  }
  throw new Error(`Python is required for Remove BG alpha post-processing. ${errors.join(" | ")}`);
}

function stopChild(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  child.kill();
}

async function rememberGeneratedImages(sinceMs) {
  const root = path.join(os.homedir(), ".codex", "generated_images");
  const paths = await recentImages(root, sinceMs - 1000);
  for (const imagePath of paths) ignoredGeneratedImagePaths.add(imagePath);
}

async function recentImages(currentPath, sinceMs) {
  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const paths = [];
  for (const entry of entries) {
    const childPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await recentImages(childPath, sinceMs));
      continue;
    }
    if (!entry.isFile()) continue;
    if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].includes(path.extname(entry.name).toLowerCase())) continue;
    try {
      const stat = await fs.stat(childPath);
      if (stat.mtimeMs >= sinceMs) paths.push(path.resolve(childPath));
    } catch {
      // Ignore files that disappear while Codex is still writing outputs.
    }
  }
  return paths;
}

async function markFailed(projectDir, job, error) {
  job.status = "failed";
  job.completedAt = new Date().toISOString();
  job.durationMs = Date.now() - Date.parse(job.createdAt);
  job.error = error?.message || String(error);
  await appendJobLog(job, `Job failed after ${formatDuration(job.durationMs)}: ${job.error}`);
  await updatePlaceholder(projectDir, job, "failed");
}

async function markTextRecognitionFailed(job, error) {
  job.status = "failed";
  job.completedAt = new Date().toISOString();
  job.durationMs = Date.now() - Date.parse(job.createdAt);
  job.error = error?.message || String(error);
  await appendJobLog(job, `Text recognition failed after ${formatDuration(job.durationMs)}: ${job.error}`);
}

function publicJob(job) {
  return {
    id: job.id,
    action: job.action,
    status: job.status,
    objectId: job.objectId,
    sourceObjectId: job.sourceObjectId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    outputDetectedAt: job.outputDetectedAt,
    detectedOutputPath: job.detectedOutputPath,
    textInventoryPath: job.textInventoryPath,
    codexSessionId: job.codexSessionId,
    imported: job.imported,
    placeholder: job.placeholder,
    placeholderId: job.placeholderId,
    error: job.error
  };
}

function publicTextRecognitionJob(job) {
  return {
    id: job.id,
    action: job.action,
    stage: job.stage,
    status: job.status,
    objectId: job.objectId,
    sourceObjectId: job.sourceObjectId,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    outputDetectedAt: job.outputDetectedAt,
    detectedOutputPath: job.detectedOutputPath,
    textInventoryPath: job.textInventoryPath,
    editPlanPath: job.editPlanPath,
    codexSessionId: job.codexSessionId,
    recognitionBackend: job.recognitionBackend,
    localOcrError: job.localOcrError,
    items: job.items,
    imported: job.imported,
    placeholder: job.placeholder,
    placeholderId: job.placeholderId,
    error: job.error
  };
}

async function requireImageObject(projectDir, objectId) {
  const state = await readState(projectDir);
  const object = state.objects.find((item) => item.id === objectId);
  if (!object) {
    const error = new Error(`Canvas object not found: ${objectId || "(missing)"}`);
    error.statusCode = 404;
    throw error;
  }
  if ((object.type || "image") !== "image") {
    const error = new Error("Image jobs require a selected image object.");
    error.statusCode = 400;
    throw error;
  }
  return object;
}

function jobPrompt(job) {
  if (job.action === "quick-edit") return `Canvas Quick Edit: ${job.prompt || "edited image"}`;
  if (job.action === "edit-text") return `Canvas Edit Text: ${job.prompt || "edited text"}`;
  if (job.action === "remove-bg") return "Canvas Remove BG result";
  return `Canvas ${job.action} result`;
}

function actionLabel(action) {
  if (action === "quick-edit") return "Quick Edit";
  if (action === "edit-text") return "Edit Text";
  if (action === "remove-bg") return "Remove BG";
  return "Image job";
}

async function updatePlaceholder(projectDir, job, status) {
  if (!job.placeholderId) return;
  try {
    const patch = { status };
    if (status === "failed" && job.error) patch.error = job.error;
    if (job.durationMs !== null) patch.durationMs = job.durationMs;
    job.placeholder = await updateObject(projectDir, job.placeholderId, patch);
  } catch {
    // The user may delete the placeholder while the background task is running.
  }
}

async function placeImportedAtPlaceholder(projectDir, job) {
  const [imported] = job.imported;
  if (!imported || !job.placeholder) return;
  const positioned = await updateObject(projectDir, imported.id, {
    x: job.placeholder.x,
    y: job.placeholder.y,
    width: job.placeholder.width,
    height: job.placeholder.height,
    layoutMode: "canvas-row",
    sourceObjectId: job.sourceObjectId
  });
  job.imported = [positioned, ...job.imported.slice(1)];
  if (job.placeholderId) {
    await deleteObject(projectDir, job.placeholderId).catch(() => {});
  }
}

async function appendJobLog(job, message) {
  try {
    await fs.appendFile(job.logPath, `[agent-canvas] ${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging should not affect image job completion.
  }
}

function formatDuration(durationMs) {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}
