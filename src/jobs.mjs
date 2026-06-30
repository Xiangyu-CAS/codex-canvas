import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { collectRecentImages } from "./collector.mjs";
import { jobsDirFor, pluginRoot } from "./paths.mjs";
import { addJobPlaceholder, deleteObject, readState, transformState, updateObject } from "./store.mjs";
import { startCodexImageJob } from "./codex-runner.mjs";
import { recognizeTextLocal } from "./local-ocr.mjs";

const execFileAsync = promisify(execFile);
const jobs = new Map();
const textRecognitionJobs = new Map();
const supportedActions = new Set(["remove-bg", "quick-edit", "expand", "edit-elements"]);
const ignoredGeneratedImagePaths = new Map();
const globalIgnoredGeneratedImageScope = "__global__";
const outputPollMs = 1000;
const jobTimeoutMs = 5 * 60_000;
const backgroundCompletionTimeoutMs = 5 * 60_000;
const chromaKeyColor = "#ff00ff";
const quickEditAnnotationPromptSuffix = [
  "",
  "The attached image may include temporary user annotations drawn or typed on top of the source image.",
  "Use those annotations as edit guidance and region references together with the user's request.",
  "Treat annotation text as explicit edit instructions for the nearby marked region, not as text to preserve in the final image.",
  "Do not keep annotation strokes, boxes, or label text in the final image. Remove the temporary marks and restore the edited areas naturally."
].join("\n");

function normalizeCanvasId(value) {
  const canvasId = typeof value === "string" ? value.trim() : "";
  return canvasId || null;
}

export async function createImageJob(projectDir, input, options = {}) {
  const canvasId = normalizeCanvasId(options.canvasId);
  const storeOptions = { canvasId };
  const action = String(input.action || "");
  if (action === "edit-text") {
    const error = new Error("Edit Text must be started with the text recognition workflow.");
    error.statusCode = 400;
    throw error;
  }
  if (!supportedActions.has(action)) {
    const error = new Error(`Unsupported image job action: ${action || "(missing)"}`);
    error.statusCode = 400;
    throw error;
  }

  const object = await requireImageObject(projectDir, input.objectId, storeOptions);

  const imagePath = object.assetPath || object.sourcePath;
  if (!imagePath) {
    const error = new Error("The selected image must be a local canvas asset before running image jobs.");
    error.statusCode = 400;
    throw error;
  }

  const quickEditAnnotations = action === "quick-edit"
    ? await collectQuickEditAnnotations(projectDir, object, storeOptions)
    : null;
  const expandOptions = action === "expand"
    ? normalizeExpandOptions(input.expand || input.options || {}, object)
    : null;

  const id = `job_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const jobDir = path.join(jobsDirFor(projectDir, canvasId), id);
  const outputDir = path.join(jobDir, "outputs");
  const logPath = path.join(jobDir, "codex.log");
  const startedAtMs = Date.now();
  const job = {
    id,
    action,
    projectDir,
    canvasId,
    status: "queued",
    objectId: object.id,
    sourceObjectId: object.id,
    sourceImagePath: imagePath,
    imagePath,
    expandOptions,
    expandInputPath: null,
    quickEditAnnotations,
    annotatedImagePath: null,
    annotationManifestPath: null,
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
    width: expandOptions?.targetWidth || object.width,
    height: expandOptions?.targetHeight || object.height
  }, storeOptions);
  job.placeholder = placeholder;
  job.placeholderId = placeholder.id;
  jobs.set(id, job);

  runJob(projectDir, job, startedAtMs).catch((error) => {
    markFailed(projectDir, job, error).catch(() => {});
  });

  return publicJob(job);
}

export async function createTextRecognitionJob(projectDir, input, options = {}) {
  const canvasId = normalizeCanvasId(options.canvasId);
  const storeOptions = { canvasId };
  const object = await requireImageObject(projectDir, input.objectId, storeOptions);
  const imagePath = object.assetPath || object.sourcePath;
  if (!imagePath) {
    const error = new Error("The selected image must be a local canvas asset before recognizing text.");
    error.statusCode = 400;
    throw error;
  }

  const id = `text_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const jobDir = path.join(jobsDirFor(projectDir, canvasId), id);
  const outputDir = path.join(jobDir, "outputs");
  const logPath = path.join(jobDir, "codex.log");
  const job = {
    id,
    action: "edit-text",
    projectDir,
    canvasId,
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

export function getImageJob(id, options = {}) {
  const job = jobs.get(id);
  if (!job || !jobMatchesScope(job, options)) {
    const error = new Error(`Image job not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  return publicJob(job);
}

export function getTextRecognitionJob(id, options = {}) {
  const job = textRecognitionJobs.get(id);
  if (!job || !jobMatchesScope(job, options)) {
    const error = new Error(`Text recognition job not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  return publicTextRecognitionJob(job);
}

export async function submitTextRecognitionEdit(projectDir, id, input = {}, options = {}) {
  const job = textRecognitionJobs.get(id);
  if (!job || !jobMatchesScope(job, { ...options, projectDir })) {
    const error = new Error(`Text recognition job not found: ${id}`);
    error.statusCode = 404;
    throw error;
  }
  if (input.cancelled === true) {
    if (job.status !== "queued" && job.status !== "running") {
      const error = new Error("Edit Text is not running.");
      error.statusCode = 409;
      throw error;
    }
    await fs.mkdir(path.dirname(job.editPlanPath), { recursive: true });
    await fs.writeFile(job.editPlanPath, `${JSON.stringify({ cancelled: true, submittedAt: new Date().toISOString() }, null, 2)}\n`);
    job.stage = "cancelling";
    await appendJobLog(job, `Edit Text cancellation written: ${job.editPlanPath}`);
    return publicTextRecognitionJob(job);
  }
  if (job.status !== "running" || job.stage !== "ready") {
    const error = new Error("Edit Text is not ready for generation yet.");
    error.statusCode = 409;
    throw error;
  }

  const storeOptions = { canvasId: normalizeCanvasId(job.canvasId || options.canvasId) };
  const object = await requireImageObject(projectDir, job.sourceObjectId, storeOptions);
  if (!job.placeholderId) {
    const placeholder = await addJobPlaceholder(projectDir, {
      id: `${id}_placeholder`,
      action: "edit-text",
      status: "running",
      name: actionLabel("edit-text"),
      sourceObjectId: object.id,
      width: object.width,
      height: object.height
    }, storeOptions);
    job.placeholder = placeholder;
    job.placeholderId = placeholder.id;
  }

  if (input.action !== "edit-text") {
    const error = new Error("Edit Text generation requires the stable edit-text action.");
    error.statusCode = 400;
    throw error;
  }

  const changes = sanitizeTextChanges(input.changes);
  if (changes.length === 0) {
    const error = new Error("Edit Text requires at least one text change.");
    error.statusCode = 400;
    throw error;
  }

  const plan = {
    action: "edit-text",
    prompt: buildEditTextPrompt(changes),
    changes,
    items: job.items,
    submittedAt: new Date().toISOString()
  };
  await fs.writeFile(job.editPlanPath, `${JSON.stringify(plan, null, 2)}\n`);
  job.stage = "generating";
  job.prompt = plan.prompt;
  await appendJobLog(job, `Edit Text plan written: ${job.editPlanPath}`);
  return publicTextRecognitionJob(job);
}

export function hasRunningImageJobs(options = {}) {
  return Array.from(jobs.values()).some((job) => jobMatchesScope(job, options) && (job.status === "queued" || job.status === "running"))
    || Array.from(textRecognitionJobs.values()).some((job) => jobMatchesScope(job, options) && job.status === "running" && job.stage === "generating");
}

export function getActivePlaceholderIds(options = {}) {
  return [
    ...Array.from(jobs.values()),
    ...Array.from(textRecognitionJobs.values())
  ]
    .filter((job) => jobMatchesScope(job, options) && (job.status === "queued" || job.status === "running"))
    .map((job) => job.placeholderId)
    .filter(Boolean);
}

export function getIgnoredGeneratedImagePaths(options = {}) {
  const key = ignoredImageScopeKey(options);
  const globalIgnored = ignoredGeneratedImagePaths.get(globalIgnoredGeneratedImageScope) || new Set();
  if (key) {
    return Array.from(new Set([
      ...globalIgnored,
      ...(ignoredGeneratedImagePaths.get(key) || [])
    ]));
  }
  return Array.from(new Set(Array.from(ignoredGeneratedImagePaths.values()).flatMap((paths) => Array.from(paths))));
}

function jobMatchesScope(job, options = {}) {
  if (Object.hasOwn(options, "projectDir") && typeof options.projectDir === "string" && options.projectDir.trim()) {
    if (!job.projectDir || path.resolve(job.projectDir) !== path.resolve(options.projectDir)) return false;
  }
  if (Object.hasOwn(options, "canvasId")) {
    if (normalizeCanvasId(job.canvasId) !== normalizeCanvasId(options.canvasId)) return false;
  }
  return true;
}

async function runJob(projectDir, job, startedAtMs) {
  job.status = "running";
  job.startedAt = new Date().toISOString();
  await fs.mkdir(job.outputDir, { recursive: true });
  await appendJobLog(job, `Agent-Canvas job started: ${job.action}`);
  const codexInput = await prepareCodexInputForJob(job);

  const codexJob = await startCodexImageJob({
    projectDir,
    action: job.action,
    imagePath: codexInput.imagePath,
    outputDir: job.outputDir,
    logPath: job.logPath,
    prompt: codexInput.prompt
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
    await rememberGeneratedImages(startedAtMs, job);
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
  await rememberGeneratedImages(startedAtMs, job);
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
    waitForEditPlan(job),
    codexDone,
    sessionTimeout
  ]);
  if (recognized.type === "timeout") throw new Error(`Edit Text session timed out after ${Math.round(sessionTimeoutMs / 60_000)} minutes.`);
  if (recognized.type === "failed") throw recognized.error;
  if (recognized.type === "done") throw new Error("Codex exited before text recognition completed.");
  if (recognized.type === "edit-plan") {
    if (recognized.plan.cancelled) {
      stopChild(codexJob.child);
      await markTextRecognitionCancelled(job, startedAtMs);
      return;
    }
    throw new Error("Edit Text plan was submitted before text recognition completed.");
  }

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
    await markTextRecognitionCancelled(job, startedAtMs);
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
    await rememberGeneratedImages(generationStartedAtMs, job);
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
  await rememberGeneratedImages(generationStartedAtMs, job);
  await collectAndPlaceResult(projectDir, job, generationStartedAtMs, { final: true });
}

async function runStandaloneTextEditGeneration(projectDir, job, startedAtMs, editPlan) {
  if (editPlan.plan.cancelled) {
    await markTextRecognitionCancelled(job, startedAtMs);
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
    await rememberGeneratedImages(generationStartedAtMs, job);
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
  await rememberGeneratedImages(generationStartedAtMs, job);
  await collectAndPlaceResult(projectDir, job, generationStartedAtMs, { final: true });
}

async function markTextRecognitionCancelled(job, startedAtMs) {
  job.stage = "cancelled";
  job.status = "done";
  job.completedAt = new Date().toISOString();
  job.durationMs = Date.now() - startedAtMs;
  if (job.projectDir && job.placeholderId) {
    await deleteObject(job.projectDir, job.placeholderId, { canvasId: job.canvasId || null }).catch(() => {});
    job.placeholder = null;
    job.placeholderId = null;
  }
  await appendJobLog(job, "Edit Text session cancelled.");
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

async function prepareCodexInputForJob(job) {
  if (job.action === "expand") {
    const inputsDir = path.join(path.dirname(job.outputDir), "inputs");
    const expandInputPath = path.join(inputsDir, "expand-padded-input.png");
    await fs.mkdir(inputsDir, { recursive: true });
    const scriptPath = path.join(pluginRoot, "scripts", "prepare_expand_canvas.py");
    await fs.access(scriptPath);
    const args = [
      scriptPath,
      "--source", job.sourceImagePath || job.imagePath,
      "--out", expandInputPath,
      "--ratio", job.expandOptions?.ratio || "original",
      "--scale", String(job.expandOptions?.scale || 1),
      "--force"
    ];
    if (Number.isFinite(job.expandOptions?.placement?.x)) {
      args.push("--source-left-ratio", String(job.expandOptions.placement.x));
    }
    if (Number.isFinite(job.expandOptions?.placement?.y)) {
      args.push("--source-top-ratio", String(job.expandOptions.placement.y));
    }
    await runPython(args);
    job.expandInputPath = expandInputPath;
    await appendJobLog(job, `Expand padded input prepared: ${expandInputPath}`);
    return {
      imagePath: expandInputPath,
      prompt: buildExpandPrompt(job)
    };
  }

  if (job.action !== "quick-edit" || !job.quickEditAnnotations?.items?.length) {
    return {
      imagePath: job.imagePath,
      prompt: job.prompt
    };
  }

  const annotationsDir = path.join(path.dirname(job.outputDir), "inputs");
  const manifestPath = path.join(annotationsDir, "quick-edit-annotations.json");
  const annotatedImagePath = path.join(annotationsDir, "quick-edit-annotated.png");
  await fs.mkdir(annotationsDir, { recursive: true });
  await fs.writeFile(manifestPath, `${JSON.stringify(job.quickEditAnnotations, null, 2)}\n`);

  const scriptPath = path.join(pluginRoot, "scripts", "compose_annotations.py");
  await fs.access(scriptPath);
  await runPython([
    scriptPath,
    "--source", job.sourceImagePath || job.imagePath,
    "--annotations", manifestPath,
    "--out", annotatedImagePath,
    "--force"
  ]);

  job.annotationManifestPath = manifestPath;
  job.annotatedImagePath = annotatedImagePath;
  await appendJobLog(job, `Quick Edit annotations composed: ${annotatedImagePath}`);
  return {
    imagePath: annotatedImagePath,
    prompt: appendQuickEditAnnotationSuffix(job.prompt, job.quickEditAnnotations)
  };
}

function normalizeExpandOptions(input, object) {
  const ratio = normalizeExpandRatio(input?.ratio);
  const preset = normalizeExpandPreset(input?.preset);
  const scale = normalizeExpandScale(input?.scale);
  const sourceWidth = Math.max(1, Math.round(Number.isFinite(object?.naturalWidth) ? object.naturalWidth : object?.width || 1));
  const sourceHeight = Math.max(1, Math.round(Number.isFinite(object?.naturalHeight) ? object.naturalHeight : object?.height || 1));
  const ratioValue = ratio === "original" ? sourceWidth / sourceHeight : ratioToNumber(ratio);
  const base = expandTargetSize(sourceWidth, sourceHeight, ratioValue, scale);
  const displayScale = Math.min(
    (Number.isFinite(object?.width) ? object.width : sourceWidth) / sourceWidth,
    (Number.isFinite(object?.height) ? object.height : sourceHeight) / sourceHeight
  );
  return {
    ratio,
    preset,
    scale,
    placement: normalizeExpandPlacement(input?.placement),
    sourceWidth,
    sourceHeight,
    targetWidth: Math.max(1, Math.round(base.width * displayScale)),
    targetHeight: Math.max(1, Math.round(base.height * displayScale)),
    naturalTargetWidth: base.width,
    naturalTargetHeight: base.height
  };
}

function normalizeExpandPlacement(value) {
  if (!value || typeof value !== "object") return null;
  const x = clampUnitNumber(value.x);
  const y = clampUnitNumber(value.y);
  const width = clampUnitNumber(value.width);
  const height = clampUnitNumber(value.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return {
    x: Math.min(x, Math.max(0, 1 - width)),
    y: Math.min(y, Math.max(0, 1 - height)),
    width,
    height
  };
}

function clampUnitNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return Math.min(1, Math.max(0, number));
}

function normalizeExpandRatio(value) {
  const ratio = String(value || "original").trim().toLowerCase();
  const allowed = new Set(["original", "1:1", "3:4", "2:3", "9:16", "4:3", "3:2", "16:9", "4:5", "5:4"]);
  return allowed.has(ratio) ? ratio : "original";
}

function normalizeExpandPreset(value) {
  const preset = String(value || "general").trim().toLowerCase();
  return ["general", "photo", "poster", "product"].includes(preset) ? preset : "general";
}

function normalizeExpandScale(value) {
  const normalized = String(value || "1").trim().toLowerCase().replace(/x$/, "");
  const scale = Number(normalized);
  if (!Number.isFinite(scale)) return 1;
  return Math.min(4, Math.max(1, scale));
}

function ratioToNumber(ratio) {
  const [left, right] = String(ratio).split(":").map(Number);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) return 1;
  return left / right;
}

function expandTargetSize(sourceWidth, sourceHeight, ratio, scale) {
  let width = sourceWidth;
  let height = sourceHeight;
  const currentRatio = width / Math.max(1, height);
  if (currentRatio < ratio) {
    width = height * ratio;
  } else if (currentRatio > ratio) {
    height = width / ratio;
  }
  return {
    width: Math.max(sourceWidth, Math.ceil(width * scale)),
    height: Math.max(sourceHeight, Math.ceil(height * scale))
  };
}

function buildExpandPrompt(job) {
  const options = job.expandOptions || {};
  const presetText = options.preset && options.preset !== "general"
    ? `Preset: ${options.preset}.`
    : "Preset: general.";
  const instruction = job.prompt || "Expand the image naturally beyond its current frame.";
  return [
    instruction,
    "",
    "The attached image is a padded outpaint input prepared by Agent-Canvas.",
    "The original source image is pasted inside the padded canvas at the user-chosen position and must remain visually unchanged.",
    "Fill and complete the padded surrounding area so the final image becomes one coherent full-frame image.",
    "Do not leave blurred padding, blank margins, checkerboards, or artificial borders in the final output.",
    "Preserve the original subject identity, visible text, perspective, lighting, colors, and design intent.",
    `Target ratio: ${options.ratio || "original"}. Scale: ${options.scale || 1}x. ${presetText}`,
    "",
    `Save the final expanded PNG at the requested output directory.`
  ].join("\n");
}

function appendQuickEditAnnotationSuffix(prompt, annotations = null) {
  const base = typeof prompt === "string" ? prompt.trim() : "";
  const textSummary = quickEditAnnotationTextSummary(annotations);
  return `${base || "Improve the image according to the user's selected Quick Edit request."}${quickEditAnnotationPromptSuffix}${textSummary}`;
}

function quickEditAnnotationTextSummary(annotations) {
  const items = Array.isArray(annotations?.items) ? annotations.items : [];
  const textItems = items
    .filter((item) => item?.type === "text" && typeof item.text === "string" && item.text.trim())
    .map((item) => item.text.trim())
    .slice(0, 8);
  if (!textItems.length) return "";

  return [
    "",
    "",
    "Text annotations captured by Agent-Canvas:",
    ...textItems.map((text, index) => `${index + 1}. ${text}`)
  ].join("\n");
}

async function collectQuickEditAnnotations(projectDir, imageObject, options = {}) {
  const state = await readState(projectDir, options);
  const imageRect = objectRect(imageObject);
  const sourceSize = sourceSizeForAnnotations(imageObject);
  const items = [];

  for (const object of state.objects) {
    if (!object || object.id === imageObject.id) continue;
    const type = object.type || "image";
    if (type !== "drawing" && type !== "text") continue;
    if (!rectsIntersect(imageRect, objectRect(object))) continue;

    if (type === "drawing") {
      const drawing = normalizeDrawingAnnotation(object, imageObject, sourceSize);
      if (drawing) items.push(drawing);
      continue;
    }

    const text = normalizeTextAnnotation(object, imageObject, sourceSize);
    if (text) items.push(text);
  }

  return items.length > 0
    ? {
      sourceObjectId: imageObject.id,
      sourceSize,
      items
    }
    : null;
}

function sourceSizeForAnnotations(object) {
  return {
    width: Math.max(1, Math.round(Number.isFinite(object.naturalWidth) ? object.naturalWidth : object.width || 1)),
    height: Math.max(1, Math.round(Number.isFinite(object.naturalHeight) ? object.naturalHeight : object.height || 1))
  };
}

function normalizeDrawingAnnotation(object, imageObject, sourceSize) {
  const points = Array.isArray(object.points)
    ? object.points
      .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
      .map((point) => canvasPointToSourcePoint({
        x: object.x + point.x,
        y: object.y + point.y
      }, imageObject, sourceSize))
    : [];
  const visiblePoints = points.filter((point) => point.x >= 0 && point.x <= sourceSize.width && point.y >= 0 && point.y <= sourceSize.height);
  if (points.length < 2 || visiblePoints.length === 0) return null;

  const scale = annotationScale(imageObject, sourceSize);
  return {
    id: object.id,
    type: "drawing",
    stroke: object.stroke || "#202124",
    strokeWidth: Math.max(1, Math.round((Number.isFinite(object.strokeWidth) ? object.strokeWidth : 4) * scale)),
    points
  };
}

function normalizeTextAnnotation(object, imageObject, sourceSize) {
  const text = String(object.text || "").trim();
  if (!text) return null;
  const topLeft = canvasPointToSourcePoint({ x: object.x, y: object.y }, imageObject, sourceSize);
  const bottomRight = canvasPointToSourcePoint({ x: object.x + object.width, y: object.y + object.height }, imageObject, sourceSize);
  const width = Math.max(1, Math.round(bottomRight.x - topLeft.x));
  const height = Math.max(1, Math.round(bottomRight.y - topLeft.y));
  const scale = annotationScale(imageObject, sourceSize);

  return {
    id: object.id,
    type: "text",
    text,
    x: Math.round(topLeft.x),
    y: Math.round(topLeft.y),
    width,
    height,
    fontSize: Math.max(6, Math.round((Number.isFinite(object.fontSize) ? object.fontSize : 28) * scale)),
    color: object.color || "#202124"
  };
}

function canvasPointToSourcePoint(point, imageObject, sourceSize) {
  const scaleX = sourceSize.width / Math.max(1, imageObject.width || 1);
  const scaleY = sourceSize.height / Math.max(1, imageObject.height || 1);
  return {
    x: Math.round((point.x - imageObject.x) * scaleX),
    y: Math.round((point.y - imageObject.y) * scaleY)
  };
}

function annotationScale(imageObject, sourceSize) {
  const scaleX = sourceSize.width / Math.max(1, imageObject.width || 1);
  const scaleY = sourceSize.height / Math.max(1, imageObject.height || 1);
  return (scaleX + scaleY) / 2;
}

function objectRect(object) {
  return {
    x: Number.isFinite(object.x) ? object.x : 0,
    y: Number.isFinite(object.y) ? object.y : 0,
    width: Number.isFinite(object.width) ? Math.max(1, object.width) : 1,
    height: Number.isFinite(object.height) ? Math.max(1, object.height) : 1
  };
}

function rectsIntersect(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

async function collectAndPlaceResult(projectDir, job, startedAtMs, { final, detectedImagePath = null }) {
  if (job.status === "done") return true;

  const collectionImagePath = await prepareImageForCollection(job, startedAtMs, detectedImagePath);
  const roots = collectionImagePath ? [path.dirname(collectionImagePath)] : [job.outputDir];
  const limit = job.action === "edit-elements" ? 32 : 8;
  let result = await collectRecentImages(projectDir, {
    roots,
    sinceMs: startedAtMs - 1000,
    limit,
    prompt: jobPrompt(job),
    sourceObjectId: job.sourceObjectId,
    canvasId: job.canvasId
  });

  if (result.imported.length === 0 && job.codexSessionId && job.action !== "edit-elements") {
    const sessionImagePath = await prepareImageForCollection(job, startedAtMs, null);
    result = await collectRecentImages(projectDir, {
      roots: [sessionImagePath ? path.dirname(sessionImagePath) : codexGeneratedSessionDir(job.codexSessionId)],
      sinceMs: startedAtMs - 1000,
      limit,
      prompt: jobPrompt(job),
      sourceObjectId: job.sourceObjectId,
      canvasId: job.canvasId
    });
  }

  if (result.imported.length === 0 && job.action !== "edit-elements") {
    await appendJobLog(job, `No scoped image collected after ${formatDuration(Date.now() - startedAtMs)}${final ? "." : "; waiting for Codex to finish."}`);
  }

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

  job.imported = result.imported;
  job.status = "done";
  if (job.stage === "generating") job.stage = job.status;
  job.completedAt = new Date().toISOString();
  job.durationMs = Date.now() - startedAtMs;
  await placeImportedAtPlaceholder(projectDir, job);
  await appendJobLog(job, `Collected ${result.imported.length} image(s) after ${formatDuration(job.durationMs)}.`);
  return true;
}

async function prepareImageForCollection(job, startedAtMs, detectedImagePath) {
  const imagePath = detectedImagePath || await findFirstOutputImage([
    job.outputDir,
    job.codexSessionId ? codexGeneratedSessionDir(job.codexSessionId) : null
  ], startedAtMs - 1000);
  if (!imagePath) return null;
  if (job.action === "edit-elements") {
    return splitElementLayers(job, imagePath);
  }
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

async function splitElementLayers(job, segmentationPath) {
  const layersDir = path.join(job.outputDir, "elements");
  const manifestPath = path.join(layersDir, "elements-manifest.json");
  await fs.mkdir(layersDir, { recursive: true });
  const existingLayer = await findOutputImage(layersDir, 0);
  if (existingLayer && await isStableFile(existingLayer)) return existingLayer;

  const scriptPath = path.join(pluginRoot, "scripts", "split_elements.py");
  await fs.access(scriptPath);
  await appendJobLog(job, `Splitting Edit Elements layers from segmentation map: ${segmentationPath}`);
  await runPython([
    scriptPath,
    "--source", job.imagePath,
    "--segmentation", segmentationPath,
    "--out-dir", layersDir,
    "--max-layers", "24",
    "--palette-size", "32",
    "--boundary-trim", "2",
    "--boundary-trim-margin", "16",
    "--boundary-flood", "8",
    "--boundary-flood-color-distance", "30",
    "--mask-grow", "6",
    "--mask-grow-color-distance", "8",
    "--force"
  ]);

  const manifest = await readJsonFile(manifestPath);
  const firstLayer = await findOutputImage(layersDir, 0);
  if (!firstLayer) throw new Error("Edit Elements did not produce any transparent PNG layers.");
  if (!await isPngRgba(firstLayer)) throw new Error("Edit Elements did not produce four-channel RGBA PNG layers.");
  await appendJobLog(job, `Edit Elements alpha layers verified: ${manifest?.exportedLayers || "unknown"} layer(s) in ${layersDir}; background completion will continue after placement.`);
  return firstLayer;
}

async function completeElementBackground(job, manifest, layersDir, backgroundObject) {
  const backgroundLayer = (manifest.layers || []).find((layer) => layer?.kind === "background" && layer.path);
  if (!backgroundLayer) {
    await appendJobLog(job, "Edit Elements did not produce a background layer to complete.");
    return manifest;
  }
  if (!backgroundObject?.assetPath) {
    await appendJobLog(job, "Edit Elements background object has no local asset path; skipping background completion replacement.");
    return manifest;
  }

  const backgroundPath = path.resolve(backgroundLayer.path);
  const completionDir = path.join(job.outputDir, "background-completion");
  const completionLogPath = path.join(path.dirname(job.logPath), "background-completion.log");
  const startedAtMs = Date.now();

  await fs.mkdir(completionDir, { recursive: true });
  await appendJobLog(job, `Completing Edit Elements background from residual layer: ${backgroundPath}`);
  const codexJob = await startCodexImageJob({
    projectDir: job.projectDir,
    action: "edit-elements-background",
    imagePath: [job.imagePath, backgroundPath],
    outputDir: completionDir,
    logPath: completionLogPath,
    prompt: ""
  });

  await appendJobLog(job, `Background completion child started: ${codexJob.executable}`);
  try {
    const outputReady = waitForStandaloneOutputImage({
      outputDir: completionDir,
      logPath: completionLogPath,
      sinceMs: startedAtMs - 1000,
      timeoutMs: backgroundCompletionTimeoutMs
    }).then((imagePath) => ({ type: "output", imagePath }));
    const codexDone = codexJob.done.then(
      () => ({ type: "done" }),
      (error) => ({ type: "failed", error })
    );
    const timeout = timeoutAfter(backgroundCompletionTimeoutMs, () => stopChild(codexJob.child));
    const first = await Promise.race([outputReady, codexDone, timeout]);
    if (first.type === "timeout") throw new Error(`Edit Elements background completion timed out after ${Math.round(backgroundCompletionTimeoutMs / 60_000)} minutes.`);
    if (first.type === "failed") throw first.error;

    let completedPath = first.imagePath;
    if (!completedPath) {
      const final = await Promise.race([outputReady, timeout]);
      if (final.type === "timeout") throw new Error(`Edit Elements background completion timed out after ${Math.round(backgroundCompletionTimeoutMs / 60_000)} minutes.`);
      completedPath = final.imagePath;
    }
    if (!completedPath) throw new Error("Edit Elements background completion did not produce an image.");

    await rememberGeneratedImages(startedAtMs, job);
    await prepareCompletedBackground(job.imagePath, completedPath, backgroundPath);
    if (!await isPngRgba(backgroundPath)) throw new Error("Completed Edit Elements background is not a four-channel RGBA PNG.");
    await fs.copyFile(backgroundPath, backgroundObject.assetPath);

    const width = Number(manifest?.sourceSize?.width) || 1;
    const height = Number(manifest?.sourceSize?.height) || 1;
    backgroundLayer.index = 0;
    backgroundLayer.kind = "background";
    backgroundLayer.path = backgroundPath;
    backgroundLayer.bbox = [0, 0, width, height];
    backgroundLayer.areaPixels = width * height;
    backgroundLayer.completedFrom = completedPath;
    manifest.backgroundCompleted = true;
    manifest.backgroundCompletionPath = completedPath;
    manifest.layers = [
      backgroundLayer,
      ...(manifest.layers || []).filter((layer) => layer !== backgroundLayer)
    ];
    await fs.writeFile(path.join(layersDir, "elements-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await updateObject(job.projectDir, backgroundObject.id, {
      assetVersion: Date.now(),
      layerGroupBackgroundStatus: "ready"
    }, { canvasId: job.canvasId || null });
    await appendJobLog(job, `Completed Edit Elements background integrated: ${backgroundPath}`);
    return manifest;
  } finally {
    stopChild(codexJob.child);
  }
}

async function waitForStandaloneOutputImage({ outputDir, logPath, sinceMs, timeoutMs }) {
  const startedAt = Date.now();
  let codexSessionId = null;
  while (Date.now() - startedAt < timeoutMs) {
    codexSessionId = codexSessionId || await readCodexSessionId(logPath);
    const imagePath = await findFirstOutputImage([
      outputDir,
      codexSessionId ? codexGeneratedSessionDir(codexSessionId) : null
    ], sinceMs);
    if (imagePath && await isStableFile(imagePath)) return imagePath;
    await new Promise((resolve) => setTimeout(resolve, outputPollMs));
  }
  return null;
}

async function prepareCompletedBackground(sourcePath, completedPath, outputPath) {
  const scriptPath = path.join(pluginRoot, "scripts", "prepare_completed_background.py");
  await fs.access(scriptPath);
  await runPython([
    scriptPath,
    "--source", sourcePath,
    "--completed", completedPath,
    "--out", outputPath,
    "--force"
  ]);
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

async function rememberGeneratedImages(sinceMs, options = {}) {
  const root = path.join(os.homedir(), ".codex", "generated_images");
  const paths = await recentImages(root, sinceMs - 1000);
  const globalIgnored = ignoredGeneratedImagePaths.get(globalIgnoredGeneratedImageScope) || new Set();
  for (const imagePath of paths) globalIgnored.add(imagePath);
  ignoredGeneratedImagePaths.set(globalIgnoredGeneratedImageScope, globalIgnored);

  const key = ignoredImageScopeKey(options);
  if (!key) return;
  const ignored = ignoredGeneratedImagePaths.get(key) || new Set();
  for (const imagePath of paths) ignored.add(imagePath);
  ignoredGeneratedImagePaths.set(key, ignored);
}

function ignoredImageScopeKey(options = {}) {
  if (!options.projectDir) return null;
  return `${path.resolve(options.projectDir)}\n${normalizeCanvasId(options.canvasId) || "default"}`;
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
  if (job.projectDir) {
    await updatePlaceholder(job.projectDir, job, "failed");
  }
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
    expandOptions: job.expandOptions || null,
    expandInputPath: job.expandInputPath || null,
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

async function requireImageObject(projectDir, objectId, options = {}) {
  const state = await readState(projectDir, options);
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
  if (job.action === "expand") return `Canvas Expand: ${job.prompt || "expanded image"}`;
  if (job.action === "edit-text") return "Canvas Edit Text result";
  if (job.action === "edit-elements") return "Canvas Edit Elements layer";
  if (job.action === "remove-bg") return "Canvas Remove BG result";
  return `Canvas ${job.action} result`;
}

function sanitizeTextChanges(changes) {
  if (!Array.isArray(changes)) return [];
  return changes
    .map((item, index) => ({
      index: Number.isFinite(Number(item?.index)) ? Number(item.index) : index + 1,
      from: String(item?.from || "").trim().slice(0, 500),
      to: String(item?.to || "").trim().slice(0, 500),
      location: String(item?.location || "").trim().slice(0, 300),
      style: String(item?.style || "").trim().slice(0, 300)
    }))
    .filter((item) => item.from && item.to && item.from !== item.to)
    .slice(0, 80);
}

function buildEditTextPrompt(changes) {
  const replacements = changes
    .map((item) => `${item.index}. Replace ${JSON.stringify(item.from)} with ${JSON.stringify(item.to)}${item.location ? ` (${item.location})` : ""}.`)
    .join("\n");
  return [
    "Edit only the user-modified text fields in the attached image.",
    "",
    "Apply these exact text replacements:",
    replacements,
    "",
    "Do not change any visible text that is not listed above.",
    "Preserve the original layout, typography style, colors, image content, and aspect ratio."
  ].join("\n");
}

function actionLabel(action) {
  if (action === "quick-edit") return "Quick Edit";
  if (action === "expand") return "Expand";
  if (action === "edit-text") return "Edit Text";
  if (action === "edit-elements") return "Edit Elements";
  if (action === "remove-bg") return "Remove BG";
  return "Image job";
}

async function updatePlaceholder(projectDir, job, status) {
  if (!job.placeholderId) return;
  try {
    const storeOptions = { canvasId: job.canvasId || null };
    const patch = { status };
    if (status === "failed" && job.error) patch.error = job.error;
    if (job.durationMs !== null) patch.durationMs = job.durationMs;
    job.placeholder = await updateObject(projectDir, job.placeholderId, patch, storeOptions);
  } catch {
    // The user may delete the placeholder while the background task is running.
  }
}

async function placeImportedAtPlaceholder(projectDir, job) {
  const storeOptions = { canvasId: job.canvasId || null };
  const [imported] = job.imported;
  if (!imported || !job.placeholder) return;
  if (job.action === "edit-elements") {
    await placeImportedElementLayers(projectDir, job);
    return;
  }

  const positioned = await updateObject(projectDir, imported.id, {
    x: job.placeholder.x,
    y: job.placeholder.y,
    width: job.placeholder.width,
    height: job.placeholder.height,
    layoutMode: "canvas-row",
    sourceObjectId: job.sourceObjectId
  }, storeOptions);
  job.imported = [positioned, ...job.imported.slice(1)];
  if (job.placeholderId) {
    await deleteObject(projectDir, job.placeholderId, storeOptions).catch(() => {});
  }
}

async function placeImportedElementLayers(projectDir, job) {
  const storeOptions = { canvasId: job.canvasId || null };
  const manifest = await readElementManifest(job);
  const sourceWidth = Number.isFinite(manifest?.sourceSize?.width) && manifest.sourceSize.width > 0
    ? manifest.sourceSize.width
    : job.placeholder.naturalWidth || job.placeholder.width;
  const sourceHeight = Number.isFinite(manifest?.sourceSize?.height) && manifest.sourceSize.height > 0
    ? manifest.sourceSize.height
    : job.placeholder.naturalHeight || job.placeholder.height;
  const scaleX = job.placeholder.width / Math.max(1, sourceWidth);
  const scaleY = job.placeholder.height / Math.max(1, sourceHeight);
  const layerByName = new Map(
    (manifest?.layers || [])
      .filter((layer) => Array.isArray(layer.bbox) && layer.bbox.length === 4 && layer.path)
      .map((layer) => [path.basename(layer.path), layer])
  );

  const groupId = `layer_group_${job.id}`;
  const groupName = `Edit Elements ${new Date().toLocaleTimeString("en-US", { hour12: false })}`;
  const positioned = [];
  for (const [order, imported] of job.imported.entries()) {
    const layer = layerByName.get(imported.name) || layerByName.get(path.basename(imported.sourcePath || ""));
    const bbox = layer?.bbox;
    const patch = {
      layoutMode: "canvas-stack",
      sourceObjectId: job.sourceObjectId,
      layerGroupId: groupId,
      layerGroupName: groupName,
      layerGroupSourceObjectId: job.sourceObjectId,
      layerGroupIndex: layerGroupIndexFor(layer, order),
      layerGroupKind: layer?.kind || "object",
      layerGroupLocked: false,
      layerGroupOriginalX: job.placeholder.x,
      layerGroupOriginalY: job.placeholder.y,
      layerGroupOriginalWidth: job.placeholder.width,
      layerGroupOriginalHeight: job.placeholder.height
    };
    if (bbox) {
      const [left, top, right, bottom] = bbox.map((value) => Number(value));
      if ([left, top, right, bottom].every(Number.isFinite)) {
        const relativeX = Math.round(left * scaleX);
        const relativeY = Math.round(top * scaleY);
        patch.x = Math.round(job.placeholder.x + relativeX);
        patch.y = Math.round(job.placeholder.y + relativeY);
        patch.width = Math.max(1, Math.round((right - left) * scaleX));
        patch.height = Math.max(1, Math.round((bottom - top) * scaleY));
        patch.layerGroupRelativeX = relativeX;
        patch.layerGroupRelativeY = relativeY;
        patch.layerGroupOriginalLayerWidth = patch.width;
        patch.layerGroupOriginalLayerHeight = patch.height;
      }
    }
    if (layer?.kind === "background") {
      patch.layerGroupBackgroundStatus = manifest?.backgroundCompleted ? "ready" : "filling";
    }
    positioned.push(await updateObject(projectDir, imported.id, patch, storeOptions));
  }

  job.imported = positioned;
  if (job.placeholderId) {
    await deleteObject(projectDir, job.placeholderId, storeOptions).catch(() => {});
  }
  await reorderLayerGroupObjects(projectDir, storeOptions, groupId);
  const backgroundObject = positioned.find((object) => object.layerGroupKind === "background");
  if (backgroundObject && !manifest?.backgroundCompleted) {
    startElementBackgroundCompletion(projectDir, job, manifest, backgroundObject);
  }
}

function layerGroupIndexFor(layer, importedOrder) {
  if (layer?.kind === "background") return 0;
  return Number.isFinite(layer?.index) && layer.index >= 1
    ? Math.round(layer.index)
    : importedOrder + 1;
}

function startElementBackgroundCompletion(projectDir, job, manifest, backgroundObject) {
  const layersDir = path.join(job.outputDir, "elements");
  completeElementBackground(job, manifest, layersDir, backgroundObject).catch(async (error) => {
    await appendJobLog(job, `Edit Elements background completion failed after layers were placed: ${error?.message || String(error)}`);
    await updateObject(projectDir, backgroundObject.id, {
      layerGroupBackgroundStatus: "failed"
    }, { canvasId: job.canvasId || null }).catch(() => {});
  });
}

export async function placeImportedElementLayersForTest(projectDir, job) {
  if (process.env.AGENT_CANVAS_TEST_HELPERS !== "1") {
    throw new Error("Edit Elements test helpers are disabled.");
  }
  return placeImportedElementLayers(projectDir, job);
}

export async function markTextRecognitionCancelledForTest(job, startedAtMs = Date.now()) {
  if (process.env.AGENT_CANVAS_TEST_HELPERS !== "1") {
    throw new Error("Text recognition test helpers are disabled.");
  }
  return markTextRecognitionCancelled(job, startedAtMs);
}

async function readElementManifest(job) {
  try {
    return JSON.parse(await fs.readFile(path.join(job.outputDir, "elements", "elements-manifest.json"), "utf8"));
  } catch {
    return null;
  }
}

async function reorderLayerGroupObjects(projectDir, storeOptions, groupId) {
  await transformState(projectDir, storeOptions, (state) => {
    const firstGroupIndex = state.objects.findIndex((object) => object.layerGroupId === groupId);
    if (firstGroupIndex < 0) return { write: false, value: state };

    const groupObjects = state.objects
      .filter((object) => object.layerGroupId === groupId)
      .sort((a, b) => (a.layerGroupIndex || 0) - (b.layerGroupIndex || 0));
    const otherObjects = state.objects.filter((object) => object.layerGroupId !== groupId);
    const insertIndex = Math.min(firstGroupIndex, otherObjects.length);
    return {
      ...state,
      objects: [
        ...otherObjects.slice(0, insertIndex),
        ...groupObjects,
        ...otherObjects.slice(insertIndex)
      ],
      selection: groupObjects.at(-1)?.id || state.selection
    };
  });
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
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
