import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import vm from "node:vm";

const source = (await fs.readFile(new URL("../ui/canvas-app.js", import.meta.url), "utf8"))
  .replace(/^import .*;\n/gm, "").split("\ntry {\n  await app.connect")[0];
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const object = { id: "one", src: "/assets/one.png" };
const result = () => ({ structuredContent: { status: 200, headers: { "content-type": "image/png" }, encoding: "base64", body: png } });
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

function harness() {
  const readers = [], calls = [], warnings = [], revoked = [], links = [], timers = new Map(), listeners = new Map();
  let hold = false, fail = false, request = async () => result(), download;
  class Reader {
    readAsDataURL(blob) {
      this.blob = blob; this.active = true; readers.push(this);
      if (!hold) this.complete();
    }
    async complete() {
      const bytes = await this.blob.arrayBuffer();
      if (!this.active) return;
      this.active = false; this.blob = null;
      if (fail) { fail = false; this.error = new Error("synthetic conversion failure"); this.onerror?.(); }
      else { this.result = `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`; this.onload?.(); }
    }
    abort() { this.active = false; this.blob = null; this.aborted = true; this.onabort?.(); }
  }
  class App {
    callServerTool(params, options) { calls.push({ params, options }); return request(params, options); }
    getHostCapabilities() { return download ? { downloadFile: {} } : {}; }
    downloadFile(params) { return download(params); }
  }
  const context = vm.createContext({ App, Response, Blob, Uint8Array, atob, AbortController, FileReader: Reader,
    URL: { createObjectURL: () => `blob:download-${links.length}`, revokeObjectURL: url => revoked.push(url) },
    setTimeout: callback => { const id = timers.size + 1; timers.set(id, callback); return id; }, clearTimeout: id => timers.delete(id),
    console: { warn: (...args) => warnings.push(args) }, window: {},
    document: { hidden: false, body: { append() {} },
      createElement: tag => { const el = { style: {}, replaceChildren() {}, append() {}, remove() {}, click() { links.push(el); } }; return el; },
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  });
  vm.runInContext(source, context);
  const bind = (id = "a") => vm.runInContext(`acceptSession({_meta:{canvasSession:{projectId:${JSON.stringify(id)},sessionId:${JSON.stringify(id)}}},structuredContent:{threadId:${JSON.stringify(id)}}})`, context);
  bind();
  return { api: context.window.codexCanvasApp, bind, readers, calls, warnings, revoked, links, timers, listeners,
    status: () => vm.runInContext("status", context), cache: () => vm.runInContext("assets", context), close: () => vm.runInContext("app.onteardown()", context),
    hold: value => { hold = value; }, fail: () => { fail = true; }, request: fn => { request = fn; }, download: fn => { download = fn; } };
}

test("inline image caches one representation and identical refreshes do not refetch", async () => {
  const h = harness(); await h.api.prepareAssets([object]); await h.api.prepareAssets([object]);
  assert.equal(h.api.assetUrl(object.src, object), `data:image/png;base64,${png}`);
  assert.equal(h.calls.length, 1);
  const entry = [...h.cache().values()][0]; assert.equal(entry.blob, undefined); assert.equal(entry.pending, null); assert.equal(entry.controller, null);
  await h.close(); assert.equal(h.cache().size, 0);
});

test("failed transport, HTTP status, malformed base64 and conversion remain retryable", async () => {
  for (const failure of [() => { throw new Error("transport"); }, () => ({ isError: true }), () => ({ structuredContent: { ...result().structuredContent, status: 404 } }), () => ({ structuredContent: { ...result().structuredContent, body: "???" } }), null]) {
    const h = harness(); if (failure) h.request(failure); else h.fail();
    await h.api.prepareAssets([object]); assert.equal(h.cache().size, 0); assert.equal(h.warnings.length, 1);
    h.request(async () => result()); await h.api.prepareAssets([object]); assert.equal(h.api.assetUrl(object.src, object), `data:image/png;base64,${png}`);
    await h.close();
  }
});

test("same session rebind during conversion preserves the pending image", async () => {
  const h = harness(); h.hold(true); const pending = h.api.prepareAssets([object]); await tick(); h.bind();
  assert.equal(h.readers[0].aborted, undefined); await h.readers[0].complete(); await pending;
  assert.equal(h.cache().size, 1); assert.match(h.api.assetUrl(object.src, object), /^data:image\/png/); await h.close();
});

test("scope change and teardown abort conversions and release handlers", async () => {
  for (const close of [false, true]) {
    const h = harness(); h.hold(true); const pending = h.api.prepareAssets([object]); await tick();
    if (close) await h.close(); else h.bind("b"); await pending;
    assert.equal(h.readers[0].aborted, true); assert.equal(h.readers[0].onload, null); assert.equal(h.cache().size, 0); assert.equal(h.warnings.length, 0);
    if (!close) { h.hold(false); await h.api.prepareAssets([object]); assert.equal(h.cache().size, 1); await h.close(); }
  }
});

test("removing an image while converting aborts and releases it", async () => {
  const h = harness(); h.hold(true); const pending = h.api.prepareAssets([object]); await tick();
  await h.api.prepareAssets([]); await pending; assert.equal(h.cache().size, 0); assert.equal(h.readers[0].aborted, true); await h.close();
});

test("old request failure cannot delete a newer scope's entry at the same key", async () => {
  const h = harness(), old = deferred(); h.request(() => old.promise);
  const pending = h.api.prepareAssets([object]); await tick(); h.bind("b");
  assert.equal(h.calls[0].options.signal.aborted, true);
  h.request(async () => result()); await h.api.prepareAssets([object]);
  old.reject(new Error("old failure")); await pending;
  assert.equal(h.api.assetUrl(object.src, object), `data:image/png;base64,${png}`); assert.equal(h.cache().size, 1); await h.close();
});

test("late successful request from previous scope never converts or overwrites", async () => {
  const h = harness(), old = deferred(); h.request(() => old.promise);
  const pending = h.api.prepareAssets([object]); await tick(); h.bind("b");
  h.request(async () => result()); await h.api.prepareAssets([object]); old.resolve(result()); await pending;
  assert.equal(h.readers.length, 1); assert.equal(h.cache().size, 1); await h.close();
});

test("concurrent preparation shares an in-flight entry", async () => {
  const h = harness(); h.hold(true); const a = h.api.prepareAssets([object]); await tick(); const b = h.api.prepareAssets([object]);
  await h.readers[0].complete(); await Promise.all([a,b]); assert.equal(h.calls.length, 1); await h.close();
});

test("decode failures evict the failed image so the next refresh retries", async () => {
  const h = harness(); await h.api.prepareAssets([object]);
  h.listeners.get("error")({ target: { tagName: "IMG", src: h.api.assetUrl(object.src, object) } });
  assert.equal(h.cache().size, 0); await h.api.prepareAssets([object]); assert.equal(h.calls.length, 2); await h.close();
});

test("many batches and asset versions retain only current URLs, with no cached Blobs or readers", async () => {
  const h = harness();
  for (let batch = 0; batch < 5; batch++) {
    const objects = Array.from({ length: 40 }, (_, i) => ({ id: `${i}`, src: `/assets/${i}.png`, assetVersion: batch }));
    await h.api.prepareAssets(objects); assert.equal(h.cache().size, 40);
    for (const entry of h.cache().values()) { assert.equal(entry.blob, undefined); assert.equal(entry.controller, null); assert.equal(entry.pending, null); }
  }
  await h.api.prepareAssets([]); assert.equal(h.cache().size, 0); assert.equal(h.readers.filter(r => r.active).length, 0); await h.close();
});

test("host download preserves exact bytes after the cached Blob is released", async () => {
  const h = harness(); let downloaded; h.download(async params => { downloaded = params; return {}; });
  await h.api.prepareAssets([object]); await h.api.download(h.api.assetUrl(object.src, object), "image.png");
  assert.equal(downloaded.contents[0].resource.blob, png); assert.equal(h.revoked.length, 0); await h.close();
});

test("fallback download uses a temporary Blob URL, released by timeout or teardown", async () => {
  for (const close of [false,true]) {
    const h = harness(); await h.api.prepareAssets([object]); await h.api.download(h.api.assetUrl(object.src, object), "image.png");
    assert.equal(h.links[0].download, "image.png"); assert.match(h.links[0].href, /^blob:/); assert.equal(h.timers.size, 1);
    if (close) await h.close(); else { for (const fn of [...h.timers.values()]) fn(); await h.close(); }
    assert.equal(h.revoked.length, 1);
  }
});


test("teardown cancels a host download conversion before delivery", async () => {
  const h = harness(); let sent = false; h.download(async () => { sent = true; return {}; });
  await h.api.prepareAssets([object]); h.hold(true);
  const pending = h.api.download(h.api.assetUrl(object.src, object), "image.png");
  const rejected = assert.rejects(pending, /cancelled/);
  await tick(); await h.close(); await rejected;
  assert.equal(sent, false); assert.equal(h.readers.at(-1).aborted, true);
  await assert.rejects(h.api.download("data:image/png;base64," + png, "closed.png"), /closed/);
});

test("teardown after conversion resolves still prevents late host delivery", async () => {
  const h = harness(); let sent = false; h.download(async () => { sent = true; return {}; });
  await h.api.prepareAssets([object]); h.hold(true);
  const pending = h.api.download(h.api.assetUrl(object.src, object), "image.png");
  const rejected = assert.rejects(pending, /closed/);
  await tick();
  const reader = h.readers.at(-1); reader.result = `data:image/png;base64,${png}`; reader.onload();
  await h.close(); await rejected; assert.equal(sent, false);
});


test("a superseded scope callback cannot cover the newest canvas with an error", async () => {
  const h = harness(), old = deferred();
  h.api.onScopeChange = () => old.promise; h.bind("b");
  h.api.onScopeChange = async () => {}; h.bind("c");
  old.reject(new Error("superseded state request")); await tick();
  assert.equal(h.api.scope.sessionId, "c"); assert.equal(h.status().style.display, "none");
  await h.close();
});
