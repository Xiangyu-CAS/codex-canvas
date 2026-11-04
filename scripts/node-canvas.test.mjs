import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { nodeFixture } from "./node-canvas-fixture.mjs";
import { addImage, readState as readStateRaw, updateObject as updateObjectRaw, deleteObject as deleteObjectRaw, restoreObjects as restoreObjectsRaw, updateViewport as updateViewportRaw } from "../src/store.mjs";
import { createImageJob as createImageJobRaw, getImageJob } from "../src/jobs.mjs";
import { jobsDirFor } from "../src/paths.mjs";

const readState = (dir, options = { canvasId: "primary" }) => readStateRaw(dir, options);
const updateObject = (dir, id, patch) => updateObjectRaw(dir, id, patch, { canvasId: "primary" });
const deleteObject = (dir, id) => deleteObjectRaw(dir, id, { canvasId: "primary" });
const restoreObjects = (dir, objects) => restoreObjectsRaw(dir, objects, { canvasId: "primary" });
const updateViewport = (dir, viewport) => updateViewportRaw(dir, viewport, { canvasId: "primary" });
const createImageJob = (dir, input) => createImageJobRaw(dir, input, { canvasId: "primary" });

async function finished(id) {
  for (let i = 0; i < 200; i++) {
    const job = getImageJob(id);
    if (["done", "failed"].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Job ${id} timed out`);
}

test("reference jobs preserve ordered inputs, scope, iterations, failure retry and deletion", async () => {
  const fixture = await nodeFixture(undefined, { canvasId: "primary" });
  const { projectDir, images: [a, b] } = fixture;
  const previous = process.env.CODEX_CANVAS_CODEX_CLI;
  process.env.CODEX_CANVAS_CODEX_CLI = fixture.executable;
  try {
    const input = { action: "reference-generate", objectId: a.id, referenceObjectIds: [a.id, b.id], prompt: "Combine reference 1 and reference 2", ratio: "16:9" };
    for (const patch of [{ referenceObjectIds: [] }, { prompt: " " }, { ratio: "bad" }, { referenceObjectIds: [a.id, "missing"] }]) {
      await assert.rejects(createImageJob(projectDir, { ...input, ...patch }));
    }
    assert.equal((await readState(projectDir)).objects.length, 2);
    const foreign = await addImage(projectDir, { path: a.assetPath }, { canvasId: "other" });
    await assert.rejects(createImageJob(projectDir, { ...input, referenceObjectIds: [a.id, foreign.id] }));
    const draft = { prompt: "Persist this draft", ratio: "9:16", referenceObjectIds: [a.id, b.id], count: 2 };
    await updateObject(projectDir, a.id, { generationDraft: draft, x: 140, y: 80 });
    await updateViewport(projectDir, { x: 81, y: 32, zoom: .8 });
    let state = await readState(projectDir);
    assert.deepEqual(state.objects.find(x => x.id === a.id).generationDraft, draft);
    assert.equal(state.viewport.zoom, .8);
    const first = await createImageJob(projectDir, { ...input, prompt: "slow composition" });
    const second = await createImageJob(projectDir, input);
    // Users can move running placeholders while other jobs shift sibling nodes.
    await updateObject(projectDir, first.placeholderId, { x: 900, y: 120 });
    const results = await Promise.all([finished(first.id), finished(second.id)]);
    for (const result of results) {
      assert.equal(result.status, "done", result.error);
      assert.equal(result.imported.length, 1);
      assert.deepEqual(result.imported[0].referenceObjectIds, [a.id, b.id]);
      const capture = JSON.parse(await fs.readFile(path.join(jobsDirFor(projectDir, "primary"), result.id, "capture.json"), "utf8"));
      assert.deepEqual(capture.images, [a.assetPath, b.assetPath]);
      assert.match(capture.prompt, /16:9/);
      assert.match(capture.prompt, /canvas-generate/);
    }
    assert.equal(results[0].imported[0].x, 900);
    assert.notEqual(results[0].imported[0].id, results[1].imported[0].id);
    const identicalOne = await finished((await createImageJob(projectDir, { ...input, prompt: "identical" })).id);
    const identicalTwo = await finished((await createImageJob(projectDir, { ...input, prompt: "identical" })).id);
    assert.equal(identicalOne.status, "done");
    assert.equal(identicalTwo.status, "done", "Repeating an identical output must create a distinct result node");
    assert.notEqual(identicalOne.imported[0].id, identicalTwo.imported[0].id);
    assert.deepEqual(await fs.readFile(identicalOne.imported[0].assetPath), await fs.readFile(identicalTwo.imported[0].assetPath));
    const output = results[0].imported[0];
    const iteration = await createImageJob(projectDir, { ...input, objectId: output.id, referenceObjectIds: [output.id], ratio: "1:1" });
    const iterated = await finished(iteration.id);
    assert.deepEqual(iterated.imported[0].referenceObjectIds, [output.id]);
    assert.equal(iterated.imported[0].width, iterated.imported[0].height);
    const failed = await finished((await createImageJob(projectDir, { ...input, prompt: "fail once" })).id);
    assert.equal(failed.status, "failed");
    state = await readState(projectDir);
    const failedNode = state.objects.find(x => x.id === failed.placeholderId);
    assert.equal(failedNode.status, "failed");
    assert.deepEqual(failedNode.generationDraft.referenceObjectIds, [a.id, b.id]);
    const retry = await finished((await createImageJob(projectDir, { ...input, ...failedNode.generationDraft })).id);
    assert.equal(retry.status, "done", retry.error);
    const cancelled = await createImageJob(projectDir, { ...input, prompt: "slow discard" });
    await deleteObject(projectDir, cancelled.placeholderId);
    const discarded = await finished(cancelled.id);
    assert.equal(discarded.imported.length, 0);
    const beforeDelete = await readState(projectDir);
    await deleteObject(projectDir, b.id);
    assert.deepEqual((await readState(projectDir)).objects.find(x => x.id === output.id).referenceObjectIds, [a.id, b.id]);
    await restoreObjects(projectDir, [beforeDelete.objects.find(x => x.id === b.id)]);
    state = await readState(projectDir);
    assert(state.objects.some(x => x.id === b.id));
    assert.equal((await readState(projectDir, { canvasId: "other" })).objects.length, 1);
    console.log(`Node backend fixture: ${fixture.root}`);
  } finally {
    if (previous === undefined) delete process.env.CODEX_CANVAS_CODEX_CLI;
    else process.env.CODEX_CANVAS_CODEX_CLI = previous;
  }
});
