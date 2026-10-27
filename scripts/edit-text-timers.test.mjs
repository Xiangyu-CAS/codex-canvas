import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import vm from "node:vm";
import { posix as path } from "node:path";

// Run the actual jobs module against simulated I/O and a controlled clock.
// No real Codex, imagegen, network or personal files are accessed.
const source = await fs.readFile(process.env.CANVAS_JOBS_TEST_SOURCE || new URL("../src/jobs.mjs", import.meta.url), "utf8");
const minute = 60_000;
async function fixture({ local = false, inventory = true, collectionError = false, logError = false } = {}) {
  let now = 1_000_000;
  const timers = new Map();
  const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
  const clock = {
    setTimeout(fn, ms) { const handle = { unref() {} }; timers.set(handle, { at: now + ms, fn }); return handle; },
    clearTimeout(handle) { timers.delete(handle); },
    async advance(ms) {
      await flush();
      const target = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
      }
      now = target; await flush();
    }
  };
  const files = new Map();
  const job = {
    id: "text_test", action: "edit-text", projectDir: "/project", outputDir: "/outputs",
    imagePath: "/source.png", textInventoryPath: "/outputs/recognized-text.json",
    editPlanPath: "/outputs/edit-plan.json", logPath: "/job.log", sourceObjectId: "source",
    createdAt: new Date(now).toISOString(), items: [], imported: []
  };
  const write = (file, data) => files.set(file, { data, mtimeMs: now });
  const missing = () => { throw new Error("ENOENT"); };
  let resolveChild, rejectChild;
  const done = new Promise((resolve, reject) => { resolveChild = resolve; rejectChild = reject; });
  const child = { exitCode: null, signalCode: null };
  const stops = [];
  const fakeFs = {
    mkdir: async () => {}, writeFile: async (file, data) => write(file, data),
    appendFile: async (file, data) => {
      if (logError && data.includes("child started")) throw new Error("log write failed");
      write(file, (files.get(file)?.data || "") + data);
    },
    readFile: async (file) => files.get(file)?.data ?? missing(),
    stat: async (file) => files.has(file) ? { size: files.get(file).data.length, mtimeMs: files.get(file).mtimeMs } : missing(),
    readdir: async (dir) => [...files.keys()].filter((file) => path.dirname(file) === dir)
      .map((file) => ({ name: path.basename(file), isFile: () => true, isDirectory: () => false }))
  };
  const modules = {
    "node:child_process": { execFile() {} }, "node:fs/promises": { default: fakeFs },
    "node:os": { default: { homedir: () => "/fake-home" } }, "node:path": { default: path },
    "node:crypto": { default: {} }, "node:util": { promisify: () => () => {} },
    pngjs: { PNG: {} }, "./python-runtime.mjs": { pythonCandidates() {} },
    "./collector.mjs": { collectRecentImages: async () => {
      if (collectionError) throw new Error("collection failed");
      return { imported: [{ id: "result" }] };
    } },
    "./paths.mjs": { jobsDirFor() {}, pluginRoot: "/plugin" },
    "./store.mjs": {
      addJobPlaceholder: async () => ({ id: "placeholder", width: 20, height: 20 }),
      deleteObject: async () => {}, readState: async () => ({ objects: [{ id: "source", type: "image" }] }),
      transformState() {}, updateObject: async (_dir, id, patch) => ({ id, ...patch })
    },
    "./codex-runner.mjs": {
      startCodexImageJob: async () => {
        if (!local && inventory) write(job.textInventoryPath, JSON.stringify({ items: [{ text: "before" }] }));
        return { child, done, prompt: "test", executable: "mock" };
      },
      stopCodexProcess: async () => {
        stops.push(now); child.signalCode = "SIGTERM";
        rejectChild(new Error("mock child terminated")); return true;
      }
    },
    "./local-ocr.mjs": { recognizeTextLocal: async () => ({ backend: "mock-ocr", items: local ? [{ text: "before" }] : [] }) },
    "./operation-leases.mjs": { createOperationLease() {} }
  };
  const context = vm.createContext({
    ...clock, AbortController, process: { env: {} },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  });
  // Expose private entry points without replacing any production function.
  const module = new vm.SourceTextModule(source + "\nexport { runTextRecognitionJob, textRecognitionJobs };", { context });
  await module.link((name) => {
    assert.ok(modules[name], `Unexpected dependency: ${name}`);
    const values = modules[name];
    return new vm.SyntheticModule(Object.keys(values), function () {
      for (const [key, value] of Object.entries(values)) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  module.namespace.textRecognitionJobs.set(job.id, job);
  let outcome;
  module.namespace.runTextRecognitionJob("/project", job, now).then(
    () => { outcome = "done"; }, (error) => { outcome = error.message; job.status = "failed"; }
  );
  await flush();
  return {
    job, stops, timers, clock, get outcome() { return outcome; },
    submit: () => module.namespace.submitTextRecognitionEdit("/project", job.id, { action: "edit-text", changes: [{ from: "before", to: "after" }] }),
    cancel: () => module.namespace.submitTextRecognitionEdit("/project", job.id, { cancelled: true }),
    submitFile: () => write(job.editPlanPath, JSON.stringify({ prompt: "replace before with after" })),
    output: () => write("/outputs/result.png", "mock png"),
    exit: (error) => { child.exitCode = error ? 1 : 0; error ? rejectChild(error) : resolveChild(); }
  };
}

for (const local of [false, true]) {
  const backend = local ? "local OCR" : "Codex fallback";
  for (const submitAt of [minute, 9 * minute + 40_000, 10 * minute - 200]) {
    test(`${backend}: submit at ${submitAt / 1000}s gets a fresh generation budget`, async () => {
      const f = await fixture({ local });
      await f.clock.advance(submitAt);
      assert.equal(f.job.stage, "ready");
      await f.submit(); await f.clock.advance(2_000);
      assert.equal(f.job.stage, "generating");
      await f.clock.advance(40_000);
      assert.equal(f.stops.length, 0, "old session timeout must not kill the reused child");
      f.output(); await f.clock.advance(2_000);
      assert.equal(f.outcome, "done"); assert.equal(f.job.status, "done");
      assert.equal(f.stops.length, 1);
      assert.equal(f.timers.size, 0, "all deadlines and polling must be disposed on success");
      await f.clock.advance(20 * minute); assert.equal(f.stops.length, 1);
    });
  }
  test(`${backend}: generation retains its five-minute timeout`, async () => {
    const f = await fixture({ local });
    await f.clock.advance(9 * minute); await f.submit(); await f.clock.advance(2_000);
    await f.clock.advance(4 * minute); assert.equal(f.outcome, undefined);
    await f.clock.advance(minute);
    assert.match(f.outcome, /timed out after 5 minutes/);
    assert.equal(f.stops.length, 1); assert.equal(f.timers.size, 0);
  });
  for (const stage of ["recognizing", "ready", "generating"]) {
    if (local && stage === "recognizing") continue;
    test(`${backend}: cancellation during ${stage} cleans up`, async () => {
      const f = await fixture({ local, inventory: stage !== "recognizing" });
      if (stage !== "recognizing") await f.clock.advance(2_000);
      if (stage === "generating") { await f.submit(); await f.clock.advance(2_000); }
      await f.cancel(); await f.clock.advance(2_000);
      assert.equal(f.outcome, "done"); assert.equal(f.job.stage, "cancelled");
      assert.equal(f.timers.size, 0);
      assert.equal(f.stops.length, local && stage === "ready" ? 0 : 1);
    });
  }
  test(`${backend}: session still expires after ten minutes`, async () => {
    const f = await fixture({ local }); await f.clock.advance(10 * minute + 1);
    assert.match(f.outcome, /session timed out after 10 minutes/); assert.equal(f.timers.size, 0);
  });
  test(`${backend}: collection exception stops child and timers`, async () => {
    const f = await fixture({ local, collectionError: true });
    await f.clock.advance(2_000); await f.submit(); await f.clock.advance(2_000);
    f.output(); await f.clock.advance(2_000);
    assert.equal(f.outcome, "collection failed"); assert.equal(f.stops.length, 1); assert.equal(f.timers.size, 0);
  });
}
for (const stage of ["recognizing", "ready", "generating"]) {
  test(`Codex failure during ${stage} preserves error and disposes timers`, async () => {
    const f = await fixture({ inventory: stage !== "recognizing" });
    if (stage !== "recognizing") await f.clock.advance(2_000);
    if (stage === "generating") { await f.submit(); await f.clock.advance(2_000); }
    f.exit(new Error("mock Codex failure")); await f.clock.advance(2_000);
    assert.equal(f.outcome, "mock Codex failure"); assert.equal(f.timers.size, 0); assert.equal(f.stops.length, 0);
  });
}

for (const local of [false, true]) {
  test(`${local ? "local OCR" : "Codex fallback"}: logging failure remains best-effort and cancellation still cleans up`, async () => {
    const f = await fixture({ local, logError: true });
    if (local) { await f.clock.advance(2_000); await f.submit(); }
    await f.clock.advance(2_000);
    assert.equal(f.outcome, undefined);
    await f.cancel(); await f.clock.advance(2_000);
    assert.equal(f.outcome, "done");
    assert.equal(f.stops.length, 1); assert.equal(f.timers.size, 0);
  });
}
for (const stage of ["recognizing", "ready"]) {
  test(`Unexpected successful child exit during ${stage} remains an error`, async () => {
    const f = await fixture({ inventory: stage !== "recognizing" });
    if (stage === "ready") await f.clock.advance(2_000);
    f.exit(); await f.clock.advance(2_000);
    assert.match(f.outcome, /Codex exited before/); assert.equal(f.timers.size, 0);
  });
}

test("File-based edit plans still transition to generation", async () => {
  const f = await fixture();
  await f.clock.advance(9 * minute); f.submitFile(); await f.clock.advance(2_000);
  assert.equal(f.job.stage, "generating");
  await f.clock.advance(minute); assert.equal(f.stops.length, 0);
  f.output(); await f.clock.advance(2_000);
  assert.equal(f.outcome, "done"); assert.equal(f.timers.size, 0);
});
