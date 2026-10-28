import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { collectRecentImages } from "../src/collector.mjs";

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
