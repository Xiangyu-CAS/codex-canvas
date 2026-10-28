import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { collectRecentImages } from "../src/collector.mjs";
import { addImage, readState } from "../src/store.mjs";

test("collection waits for a complete PNG and imports the complete bytes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-partial-"));
  try {
    const project = path.join(root, "project");
    const generated = path.join(root, "generated");
    await fs.mkdir(project);
    await fs.mkdir(generated);
    const source = path.join(generated, "generated.png");
    const png = PNG.sync.write(new PNG({ width: 40, height: 30 }));
    await fs.writeFile(source, png.subarray(0, 33));
    const first = await collectRecentImages(project, { roots: [generated] });
    assert.equal(first.imported.length, 0);
    assert.deepEqual(first.pendingPaths, [source]);
    await fs.writeFile(source, png);
    // A coarse filesystem timestamp or a concurrent scan can put the finished
    // file behind the watermark; pending sources must still be retried.
    const second = await collectRecentImages(project, { roots: [generated], sinceMs: Date.now() + 60000, pendingPaths: first.pendingPaths });
    assert.equal(second.imported.length, 1);
    assert.deepEqual(second.pendingPaths, []);
    assert.deepEqual(await fs.readFile(second.imported[0].assetPath), png);
    assert.equal(second.imported[0].sourcePath, source);
    assert.equal((await collectRecentImages(project, { roots: [generated] })).imported.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("auto collection repairs only proven truncated thread PNGs, preserving the canvas object", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-repair-"));
  try {
    const project = path.join(root, "project");
    const generated = path.join(root, "generated");
    const thread = path.join(generated, "thread-a");
    await fs.mkdir(project);
    await fs.mkdir(thread, { recursive: true });
    const png = new PNG({ width: 40, height: 30 });
    png.data.fill(123);
    const full = PNG.sync.write(png);
    const source = path.join(thread, "original.png");
    await fs.writeFile(source, full.subarray(0, 33));
    const broken = await addImage(project, { path: source, layoutMode: "session-column", x: 234, y: 345 }, { canvasId: "thread-canvas" });
    await fs.writeFile(source, full);

    const other = new PNG({ width: 41, height: 30 });
    other.data.fill(99);
    const different = PNG.sync.write(other);
    const unrelated = path.join(thread, "unrelated.png");
    await fs.writeFile(unrelated, different.subarray(0, 40));
    const modified = await addImage(project, { path: unrelated, layoutMode: "session-column" }, { canvasId: "thread-canvas" });
    await fs.writeFile(unrelated, full);

    const outside = path.join(root, "outside.png");
    await fs.writeFile(outside, full.subarray(0, 33));
    const outsideObject = await addImage(project, { path: outside, layoutMode: "session-column", allowDuplicate: true }, { canvasId: "thread-canvas" });
    await fs.writeFile(outside, full);

    const result = await collectRecentImages(project, { threadId: "thread-a", generatedImagesRoot: generated, canvasId: "thread-canvas", repairTruncated: true });
    assert.equal(result.repaired, 1);
    assert.deepEqual(await fs.readFile(broken.assetPath), full);
    assert.deepEqual(await fs.readFile(modified.assetPath), different.subarray(0, 40));
    assert.deepEqual(await fs.readFile(outsideObject.assetPath), full.subarray(0, 33));
    const state = await readState(project, { canvasId: "thread-canvas" });
    const restored = state.objects.find((object) => object.id === broken.id);
    assert.equal(restored.x, 234);
    assert.equal(restored.y, 345);
    assert.ok(restored.assetVersion > 0);
    assert.equal((await collectRecentImages(project, { threadId: "thread-a", generatedImagesRoot: generated, canvasId: "thread-canvas", repairTruncated: true })).repaired, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("candidates beyond the per-pass limit remain eligible after the watermark moves", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-backlog-"));
  try {
    const project = path.join(root, "project");
    const generated = path.join(root, "generated");
    await fs.mkdir(project);
    await fs.mkdir(generated);
    for (let index = 0; index < 3; index++) {
      const png = new PNG({ width: 4, height: 4 });
      png.data.fill(index + 1);
      await fs.writeFile(path.join(generated, `${index}.png`), PNG.sync.write(png));
    }
    const first = await collectRecentImages(project, { roots: [generated], limit: 1 });
    assert.equal(first.imported.length, 1);
    assert.equal(first.pendingPaths.length, 2);
    const second = await collectRecentImages(project, { roots: [generated], limit: 2, sinceMs: Date.now() + 60000, pendingPaths: first.pendingPaths });
    assert.equal(second.imported.length, 2);
    assert.equal(second.pendingPaths.length, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("repair does not replace a symlinked canvas asset", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-repair-link-"));
  try {
    const project = path.join(root, "project");
    const generated = path.join(root, "generated");
    const thread = path.join(generated, "thread-a");
    await fs.mkdir(project);
    await fs.mkdir(thread, { recursive: true });
    const png = PNG.sync.write(new PNG({ width: 10, height: 10 }));
    const source = path.join(thread, "source.png");
    const outside = path.join(root, "outside.png");
    await fs.writeFile(source, png.subarray(0, 33));
    const object = await addImage(project, { path: source, layoutMode: "session-column" }, { canvasId: "thread-canvas" });
    await fs.writeFile(source, png);
    await fs.writeFile(outside, png.subarray(0, 33));
    await fs.unlink(object.assetPath);
    try { await fs.symlink(outside, object.assetPath); } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error.code)) return t.skip("symlinks unavailable");
      throw error;
    }
    const result = await collectRecentImages(project, { threadId: "thread-a", generatedImagesRoot: generated, canvasId: "thread-canvas", repairTruncated: true });
    assert.equal(result.repaired, 0);
    assert.ok((await fs.lstat(object.assetPath)).isSymbolicLink());
    assert.deepEqual(await fs.readFile(outside), png.subarray(0, 33));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
