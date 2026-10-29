import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { createMcpClient } from "./mcp-app-client.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-app-visual-"));
const generatedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-app-generated-"));
await fs.mkdir(path.join(generatedRoot, "visual-thread"));
process.env.CODEX_CANVAS_GENERATED_IMAGES_ROOT = generatedRoot;
const client = createMcpClient(process.env.CANVAS_PLUGIN_ROOT ? pathToFileURL(`${path.resolve(process.env.CANVAS_PLUGIN_ROOT)}${path.sep}`) : new URL("../", import.meta.url));
const browser = await chromium.launch(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {});
const call = (name, args) => client.request("tools/call", { name, arguments: args });
const fixture = new PNG({ width: 320, height: 220 });
for (let y = 0; y < 220; y++) for (let x = 0; x < 320; x++) {
  const i = (y * 320 + x) * 4;
  fixture.data.set([45 + Math.round(x / 2), 100 + Math.round(y / 2), 200, 255], i);
}
const png = PNG.sync.write(fixture).toString("base64");
try {
  const opened = await call("open_canvas", { projectDir, threadId: "visual-thread" });
  const added = await call("add_image", { projectDir, threadId: "visual-thread", dataUrl: `data:image/png;base64,${png}`, name: "Sidebar test image" });
  const resource = (await client.request("resources/list")).resources[0];
  const html = (await client.request("resources/read", { uri: resource.uri })).contents[0].text;
  for (const width of [1100, 440]) {
    // Exercise hosts that allow inline images but do not allow blob: images.
    const imageSources = width === 440 ? "data:" : "blob: data:";
    const hostDownload = width !== 440;
    const page = await browser.newPage({ viewport: { width, height: 820 } });
    const errors = [];
    const network = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (!request.url().startsWith("blob:") && !request.url().startsWith("data:")) network.push(request.url()); });
    await page.exposeFunction("mcpRequest", params => client.request("tools/call", params));
    await page.setContent('<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-downloads"></iframe>');
    await page.evaluate(({ html, opened, imageSources, hostDownload }) => {
      window.downloads = [];
      window.opened = opened;
      window.addEventListener("message", async event => {
        const message = event.data;
        if (message?.jsonrpc !== "2.0") return;
        if (message.method === "ui/notifications/initialized") {
          event.source.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: window.opened }, "*"); return;
        }
        if (message.id === undefined) return;
        try {
          let result = {};
          if (message.method === "ui/initialize") result = {
            protocolVersion: message.params.protocolVersion, hostInfo: { name: "Canvas test host", version: "1" },
            hostCapabilities: { serverTools: {}, ...(hostDownload ? { downloadFile: {} } : {}), message: {} },
            hostContext: { displayMode: "fullscreen", availableDisplayModes: ["fullscreen"], theme: "light" }
          };
          else if (message.method === "tools/call") {
            if (window.switchOnNextState && message.params.arguments?.path?.startsWith("/api/state")) {
              const next = window.switchOnNextState;
              window.switchOnNextState = null;
              event.source.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: next }, "*");
              await new Promise(resolve => setTimeout(resolve, 150));
            }
            if (window.repeatOnNextAsset && message.params.arguments?.path?.startsWith("/api/app-assets/")) {
              window.repeatOnNextAsset = false;
              event.source.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: window.opened }, "*");
              await new Promise(resolve => setTimeout(resolve, 150));
            }
            result = await window.mcpRequest(message.params);
          }
          else if (message.method === "ui/download-file") window.downloads.push(message.params);
          event.source.postMessage({ jsonrpc: "2.0", id: message.id, result }, "*");
        } catch (error) { event.source.postMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message } }, "*"); }
      });
      document.querySelector("iframe").srcdoc = html.replace('<meta charset="utf-8" />', '<meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src ' + imageSources + '; connect-src \'none\'">');
    }, { html, opened, imageSources, hostDownload });
    const frame = page.frames()[1];
    await frame.waitForSelector("#objects img", { timeout: 15000, state: "attached" });
    await frame.waitForFunction(() => [...document.querySelectorAll("#objects img")].every(img => img.complete && img.naturalWidth > 0));
    const image = frame.locator("#objects img").first();
    await frame.locator("#objects .image-content").first().click();
    if (hostDownload) {
      await frame.locator('[data-action="download"]').click();
      await page.waitForFunction(() => window.downloads.length === 1);
      assert.equal((await page.evaluate(() => window.downloads[0])).contents[0].resource.blob, png);
    } else {
      const downloaded = page.waitForEvent("download");
      await frame.locator('[data-action="download"]').click();
      const file = await downloaded;
      assert.equal(await file.failure(), null);
      assert.equal((await fs.readFile(await file.path())).toString("base64"), png);
      assert.equal(await page.evaluate(() => window.downloads.length), 0);
    }
    const box = await image.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 30, { steps: 5 }); await page.mouse.up();
    await new Promise(resolve => setTimeout(resolve, 350));
    const state = (await call("canvas_app_request", { sessionId: opened._meta.canvasSession.sessionId, path: "/api/state" })).structuredContent.body;
    assert.notEqual(state.objects[0].x, added.structuredContent.x);
    await page.mouse.wheel(0, -100);
    const reopened = await call("open_canvas", { projectDir, threadId: "visual-thread" });
    assert.equal(reopened._meta.canvasSession.sessionId, opened._meta.canvasSession.sessionId);
    await page.evaluate(opened => document.querySelector("iframe").contentWindow.postMessage({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: opened }, "*"), reopened);
    await fs.mkdir("dist", { recursive: true });
    await page.screenshot({ path: `dist/canvas-sidebar-${width}.png` });
    if (width === 440) {
      const output = path.join(generatedRoot, "visual-thread", "generated.png");
      const generated = new PNG({ width: 1024, height: 1024 });
      // Synthetic, poorly compressible pixels exercise a realistic MCP payload.
      let seed = 123456789;
      for (let i = 0; i < generated.data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        generated.data[i] = seed >>> 24;
      }
      const bytes = PNG.sync.write(generated);
      await fs.writeFile(output, bytes.subarray(0, 33));
      await new Promise(resolve => setTimeout(resolve, 900));
      const requestState = async () => (await call("canvas_app_request", { sessionId: opened._meta.canvasSession.sessionId, path: "/api/state" })).structuredContent.body;
      assert.equal((await requestState()).objects.length, 1, "partial PNG must not be imported");
      await page.evaluate(() => { window.repeatOnNextAsset = true; });
      await fs.writeFile(output, bytes);
      await frame.waitForFunction(() => [...document.querySelectorAll("#objects img")].some(img => img.naturalWidth === 1024), null, { timeout: 20000 });
      const collected = (await requestState()).objects.find(object => object.sourcePath === output);
      assert.ok(collected, "complete PNG should be automatically imported");
      assert.deepEqual(await fs.readFile(collected.assetPath), bytes);
      assert.equal(await page.evaluate(() => window.repeatOnNextAsset), false, "reopen must occur while an asset is loading");

      // Model an image that v0.4.2 already copied while its source was partial.
      const legacyOutput = path.join(generatedRoot, "visual-thread", "legacy.png");
      const legacy = new PNG({ width: 128, height: 86 });
      legacy.data.fill(200);
      const legacyBytes = PNG.sync.write(legacy);
      await fs.writeFile(legacyOutput, legacyBytes.subarray(0, 33));
      const legacyAdded = await call("add_image", { projectDir, threadId: "visual-thread", path: legacyOutput, layoutMode: "session-column" });
      const legacyObject = legacyAdded.structuredContent;
      await frame.waitForFunction(id => {
        const img = document.querySelector(`#objects img[data-object-id="${id}"]`);
        return img && img.complete && img.naturalWidth === 0;
      }, legacyObject.id, { timeout: 12000 });
      await fs.writeFile(legacyOutput, legacyBytes);
      await frame.waitForFunction(id => {
        const img = document.querySelector(`#objects img[data-object-id="${id}"]`);
        return img && img.complete && img.naturalWidth === 128;
      }, legacyObject.id, { timeout: 20000 });
      const restored = (await requestState()).objects.find(object => object.id === legacyObject.id);
      assert.ok(restored.assetVersion > 0, "repaired image should invalidate the sidebar asset cache");
      assert.deepEqual(await fs.readFile(restored.assetPath), legacyBytes);

      // Repeated allocation/removal must not retain earlier batches in the iframe.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("HeapProfiler.collectGarbage");
      const before = await cdp.send("Runtime.getHeapUsage");
      const samples = [];
      for (let batch = 0; batch < 3; batch++) {
        const ids = [];
        for (let i = 0; i < 16; i++) {
          const tile = new PNG({ width: 256, height: 256 });
          for (let j = 0; j < tile.data.length; j++) {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; tile.data[j] = seed >>> 24;
          }
          const item = await call("add_image", { projectDir, threadId: "visual-thread", dataUrl: `data:image/png;base64,${PNG.sync.write(tile).toString("base64")}`, name: `memory-${batch}-${i}.png` });
          ids.push(item.structuredContent.id);
        }
        await frame.waitForFunction(ids => ids.every(id => {
          const img = document.querySelector(`#objects img[data-object-id="${id}"]`);
          return img?.complete && img.naturalWidth === 256;
        }), ids, { timeout: 30000 });
        samples.push(await cdp.send("Runtime.getHeapUsage"));
        for (const id of ids) await call("canvas_app_request", { sessionId: opened._meta.canvasSession.sessionId, path: `/api/objects/${id}`, method: "DELETE" });
        await frame.waitForFunction(ids => ids.every(id => !document.querySelector(`#objects img[data-object-id="${id}"]`)), ids);
        await cdp.send("HeapProfiler.collectGarbage");
        samples.push(await cdp.send("Runtime.getHeapUsage"));
      }
      const after = samples.at(-1);
      assert.ok(after.usedSize < before.usedSize + 8 * 1024 * 1024, "removed image batches should not accumulate retained JS heap");
      console.log("IMAGE_HEAP_BYTES", JSON.stringify({ before, samples, after }));
      await cdp.detach();
    }
    // Switching scopes while the previous state RPC is pending must not leave
    // an error overlay or render the old canvas in the new scope.
    const nextThread = `switch-${width}`;
    const nextOpened = await call("open_canvas", { projectDir, threadId: nextThread });
    const nextImage = await call("add_image", { projectDir, threadId: nextThread, dataUrl: `data:image/png;base64,${png}`, name: "Switched image" });
    await page.evaluate(next => { window.switchOnNextState = next; }, nextOpened);
    await frame.waitForFunction(id => document.querySelector(`#objects img[data-object-id="${id}"]`)?.naturalWidth === 320, nextImage.structuredContent.id, { timeout: 15000 });
    assert.equal(await frame.locator("#canvasConnection").isVisible(), false);
    assert.equal(await frame.locator("#objects img").count(), 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    await page.close();
  }
  console.log("Native sidebar sandbox passed: render, images, drag, zoom, host download, panel reuse; no network requests.");
} finally { await browser.close(); await client.close(); await fs.rm(projectDir, { recursive: true, force: true }); await fs.rm(generatedRoot, { recursive: true, force: true }); }
