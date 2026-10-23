import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile, fork } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "codex-canvas.mjs");

function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^path$/i.test(key) || key.startsWith("CODEX_CANVAS_PYTHON") || key.startsWith("CODEX_CANVAS_SKIP_")) delete env[key];
  }
  return { ...env, ...extra };
}
async function doctor(env) {
  const { stdout } = await exec(process.execPath, [cli, "doctor-image-deps", "--json"], { env });
  return JSON.parse(stdout);
}
async function setup(env) {
  const { stdout } = await exec(process.execPath, [cli, "setup-image-deps", "--json"], { env });
  return JSON.parse(stdout);
}

// Use the real post-processing path in a long-lived process; no image generation,
// pip downloads, personal configuration or existing canvas assets are involved.
test("setup repairs a running worker with an old PATH and survives restart", { timeout: 60000 }, async (t) => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "canvas python & spaces-")));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const config = path.join(tmp, "runtime");
  const env = cleanEnv({ PATH: process.env.PATH || process.env.Path, CODEX_CANVAS_PYTHON_CONFIG_DIR: config });
  const available = await doctor(env);
  assert.equal(available.available, true, "Regression tests require Pillow and numpy, as configured in CI");
  assert.equal(path.isAbsolute(available.pythonExecutable), true);
  await assert.rejects(fs.access(config), { code: "ENOENT" }, "doctor must not persist a runtime");

  const png = new PNG({ width: 40, height: 40 });
  for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) {
    png.data.set(x > 9 && x < 30 && y > 9 && y < 30 ? [0, 180, 60, 255] : [255, 0, 255, 255], (y * 40 + x) * 4);
  }
  const input = path.join(tmp, "input.png");
  await fs.writeFile(input, PNG.sync.write(png));
  const workerFile = path.join(tmp, "worker.mjs");
  await fs.writeFile(workerFile, `
import { prepareImageForCollectionForTest } from ${JSON.stringify(pathToFileURL(path.join(root, "src/jobs.mjs")).href)};
process.on("message", async ({ input, outputDir, logPath }) => {
  try {
    const output = await prepareImageForCollectionForTest({ action: "remove-bg", transparencyMode: "chroma-key", outputDir, logPath }, 0, input);
    process.send({ output, pid: process.pid });
  } catch (error) { process.send({ error: error.message, pid: process.pid }); }
});
process.send({ ready: true });
`);
  const empty = path.join(tmp, "empty-path");
  await fs.mkdir(empty);
  const workerEnv = cleanEnv({ PATH: empty, CODEX_CANVAS_PYTHON_CONFIG_DIR: config, CODEX_CANVAS_TEST_HELPERS: "1" });
  async function start() {
    const worker = fork(workerFile, [], { env: workerEnv, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    t.after(async () => {
      if (worker.exitCode === null && worker.signalCode === null) {
        const exited = once(worker, "exit");
        worker.kill();
        await exited;
      }
    });
    await once(worker, "message");
    return worker;
  }
  let sequence = 0;
  async function processImage(worker) {
    const result = once(worker, "message");
    worker.send({ input, outputDir: path.join(tmp, `output-${sequence++}`), logPath: path.join(tmp, "worker.log") });
    return (await result)[0];
  }
  const worker = await start();
  const before = await processImage(worker);
  assert.match(before.error, /Python is required.*ENOENT/s);
  const venv = path.join(tmp, "working python");
  await exec(available.pythonExecutable, ["-m", "venv", "--without-pip", "--system-site-packages", venv]);
  const selectedPython = path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const installed = await setup({ ...env, CODEX_CANVAS_PYTHON: selectedPython });
  assert.equal(installed.available, true);
  assert.equal(installed.installed, false, "already installed dependencies must not invoke pip");
  const saved = JSON.parse(await fs.readFile(path.join(config, "image-processing.json"), "utf8"));
  assert.equal(saved.executable, selectedPython);
  const after = await processImage(worker);
  assert.equal(after.error, undefined);
  assert.equal(after.pid, before.pid, "setup must repair the same process without refreshing its PATH");
  const output = PNG.sync.read(await fs.readFile(after.output));
  assert.equal(output.data[3], 0, "background is removed by the real Python script");
  assert.equal(output.data[(20 * 40 + 20) * 4 + 3], 255, "foreground is preserved");
  assert.equal((await doctor(workerEnv)).available, true, "doctor and jobs share the saved runtime");
  assert.equal((await processImage(await start())).error, undefined, "fresh processes also use the saved runtime");
});

test("runtime selection falls back safely and explicit overrides stay authoritative", { timeout: 60000 }, async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-python-selection-"));
  t.after(() => fs.rm(tmp, { recursive: true, force: true }));
  const env = cleanEnv({ PATH: process.env.PATH || process.env.Path, CODEX_CANVAS_PYTHON_CONFIG_DIR: tmp });
  const available = await doctor(env);
  assert.equal(available.available, true);
  const config = path.join(tmp, "image-processing.json");
  await fs.writeFile(config, "{malformed");
  assert.equal((await doctor(env)).available, true);
  await fs.writeFile(config, JSON.stringify({ executable: path.join(tmp, "removed-python") }));
  assert.equal((await doctor(env)).available, true);
  assert.equal((await doctor({ ...env, CODEX_CANVAS_PYTHON: path.join(tmp, "explicit-missing-python") })).available, false);

  // A valid first interpreter without dependencies must not hide a usable later one.
  const venv = path.join(tmp, "empty-venv");
  await exec(available.pythonExecutable, ["-m", "venv", "--without-pip", venv]);
  const bare = path.join(venv, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  assert.equal((await doctor({ ...env, CODEX_CANVAS_PYTHON: bare })).available, false);
  await fs.writeFile(config, JSON.stringify({ executable: bare }));
  const fallback = await doctor(env);
  assert.equal(fallback.available, true);
  assert.notEqual(fallback.pythonExecutable, bare);
  await setup(env);
  assert.equal(JSON.parse(await fs.readFile(config, "utf8")).executable, fallback.pythonExecutable);
  const before = await fs.readFile(config, "utf8");
  assert.equal((await setup({ ...env, CODEX_CANVAS_SKIP_IMAGE_DEPS_INSTALL: "1" })).skipped, true);
  assert.equal(await fs.readFile(config, "utf8"), before, "skipped setup must not change the saved runtime");
});
