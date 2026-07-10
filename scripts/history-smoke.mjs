#!/usr/bin/env node

import assert from "node:assert/strict";
import { CanvasHistory } from "../public/canvas-history.js";

const tests = [
  ["undo and redo", testUndoAndRedo],
  ["pending commit undo ticket", testPendingCommitUndoTicket],
  ["failed pending commit undo ticket", testFailedPendingCommitUndoTicket],
  ["scope epoch invalidation", testScopeEpochInvalidation],
  ["running commit scope invalidation", testRunningCommitScopeInvalidation],
  ["clear invalidates running commit", testClearInvalidatesRunningCommit],
  ["busy covers the whole queue", testBusyCoversWholeQueue],
  ["observer errors are isolated", testObserverErrorsAreIsolated],
  ["actions are deep cloned", testActionsAreDeepCloned],
  ["failed undo restores its source action", testFailedUndoRestoresSourceAction]
];

const passed = [];
for (const [name, test] of tests) {
  await test();
  passed.push(name);
}

console.log(JSON.stringify({ ok: true, checks: passed }, null, 2));

async function testUndoAndRedo() {
  const applied = [];
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  await record(history, { type: "update", id: "first" });

  await history.undo(async (action, direction) => applied.push(`${direction}:${action.id}`));
  assert.deepEqual(applied, ["undo:first"]);
  assert.equal(history.status.undoCount, 0);
  assert.equal(history.status.redoCount, 1);

  await history.redo(async (action, direction) => applied.push(`${direction}:${action.id}`));
  assert.deepEqual(applied, ["undo:first", "redo:first"]);
  assert.equal(history.status.undoCount, 1);
  assert.equal(history.status.redoCount, 0);

  await history.undo(async () => {});
  await record(history, { type: "update", id: "second" });
  assert.equal(history.status.redoCount, 0, "a new commit should clear redo history");
}

async function testPendingCommitUndoTicket() {
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  await record(history, { type: "update", id: "prior" });

  const gate = deferred();
  const pendingCommit = history.commit(async () => {
    await gate.promise;
    return { action: { type: "update", id: "pending" } };
  });
  const applied = [];
  const pendingUndo = history.undo(async (action) => applied.push(action.id));

  gate.resolve();
  await Promise.all([pendingCommit, pendingUndo]);
  assert.deepEqual(applied, ["pending"], "undo should bind to the latest pending commit");
  assert.deepEqual(history.undoStack.map((action) => action.id), ["prior"]);
  assert.deepEqual(history.redoStack.map((action) => action.id), ["pending"]);
}

async function testFailedPendingCommitUndoTicket() {
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  await record(history, { type: "update", id: "prior" });

  const gate = deferred();
  const pendingCommit = history.commit(async () => {
    await gate.promise;
    throw new Error("commit failed");
  });
  let applyCalls = 0;
  const pendingUndo = history.undo(async () => {
    applyCalls += 1;
  });

  gate.resolve();
  await assert.rejects(pendingCommit, /commit failed/);
  assert.equal(await pendingUndo, null);
  assert.equal(applyCalls, 0, "a failed pending commit must not undo an older action");
  assert.deepEqual(history.undoStack.map((action) => action.id), ["prior"]);
  assert.equal(history.status.redoCount, 0);
}

async function testScopeEpochInvalidation() {
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  let operationCalls = 0;
  const pending = history.commit(async () => {
    operationCalls += 1;
    return { action: { type: "update", id: "stale" } };
  });

  history.setScope("canvas-b");
  history.setScope("canvas-a");
  await pending;
  assert.equal(operationCalls, 0, "A -> B -> A must still invalidate a queued operation");
  assert.equal(history.status.undoCount, 0);
}

async function testRunningCommitScopeInvalidation() {
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  const started = deferred();
  const gate = deferred();
  const pending = history.commit(async () => {
    started.resolve();
    await gate.promise;
    return { action: { type: "update", id: "old-scope" }, value: "completed" };
  });

  await started.promise;
  history.setScope("canvas-b");
  gate.resolve();
  assert.equal(await pending, "completed");
  assert.equal(history.scope, "canvas-b");
  assert.equal(history.status.undoCount, 0, "a mutation completed in an old scope must not enter the new history");
}

async function testClearInvalidatesRunningCommit() {
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  const started = deferred();
  const gate = deferred();
  const pending = history.commit(async () => {
    started.resolve();
    await gate.promise;
    return { action: { type: "update", id: "cleared" } };
  });

  await started.promise;
  history.clear();
  gate.resolve();
  await pending;
  assert.equal(history.status.undoCount, 0);
}

async function testBusyCoversWholeQueue() {
  const changes = [];
  const history = new CanvasHistory({ onChange: (status) => changes.push(status.busy) });
  history.setScope("canvas-a");
  const firstGate = deferred();
  const secondGate = deferred();
  const secondStarted = deferred();
  const first = history.commit(async () => {
    await firstGate.promise;
    return { action: { type: "update", id: "first" } };
  });
  const second = history.commit(async () => {
    secondStarted.resolve();
    await secondGate.promise;
    return { action: { type: "update", id: "second" } };
  });

  assert.equal(history.busy, true, "busy should become true synchronously when work is enqueued");
  const changeStart = changes.length;
  firstGate.resolve();
  await secondStarted.promise;
  assert.equal(history.busy, true);
  assert.equal(changes.slice(changeStart).includes(false), false, "busy must not flicker false between queued tasks");
  secondGate.resolve();
  await Promise.all([first, second]);
  assert.equal(history.busy, false);
}

async function testObserverErrorsAreIsolated() {
  let operationCalls = 0;
  const history = new CanvasHistory({
    onChange() {
      throw new Error("observer failed");
    }
  });

  assert.doesNotThrow(() => history.setScope("canvas-a"));
  await history.commit(async () => {
    operationCalls += 1;
    return { action: { type: "update", id: "safe" } };
  });
  assert.equal(operationCalls, 1);
  assert.equal(history.busy, false);
  assert.equal(history.status.undoCount, 1);
}

async function testActionsAreDeepCloned() {
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  const action = {
    type: "update",
    id: "object-a",
    before: { position: { x: 10, y: 20 } },
    entries: [{ object: { text: "before" } }]
  };
  await record(history, action);
  action.before.position.x = 999;
  action.entries[0].object.text = "mutated";

  let applied = null;
  await history.undo(async (storedAction) => {
    applied = storedAction;
  });
  assert.equal(applied.before.position.x, 10);
  assert.equal(applied.entries[0].object.text, "before");
}

async function testFailedUndoRestoresSourceAction() {
  const history = new CanvasHistory();
  history.setScope("canvas-a");
  await record(history, { type: "delete", id: "object-a" });

  await assert.rejects(history.undo(async () => {
    throw new Error("apply failed");
  }), /apply failed/);
  assert.deepEqual(history.undoStack.map((action) => action.id), ["object-a"]);
  assert.equal(history.status.redoCount, 0);
}

async function record(history, action, value = undefined) {
  return history.commit(async () => ({ action, value }));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
