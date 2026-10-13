import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PNG } from "pngjs";
import { createMcpClient } from "./mcp-app-client.mjs";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-app-visual-"));
const client = createMcpClient();
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
    const page = await browser.newPage({ viewport: { width, height: 820 } });
    const errors = [];
    const network = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (!request.url().startsWith("blob:") && !request.url().startsWith("data:")) network.push(request.url()); });
    await page.exposeFunction("mcpRequest", params => client.request("tools/call", params));
    await page.setContent('<style>html,body{margin:0;height:100%}iframe{width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-downloads"></iframe>');
    await page.evaluate(({ html, opened }) => {
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
            hostCapabilities: { serverTools: {}, downloadFile: {}, message: {} },
            hostContext: { displayMode: "fullscreen", availableDisplayModes: ["fullscreen"], theme: "light" }
          };
          else if (message.method === "tools/call") result = await window.mcpRequest(message.params);
          else if (message.method === "ui/download-file") window.downloads.push(message.params);
          event.source.postMessage({ jsonrpc: "2.0", id: message.id, result }, "*");
        } catch (error) { event.source.postMessage({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error.message } }, "*"); }
      });
      document.querySelector("iframe").srcdoc = html.replace('<meta charset="utf-8" />', '<meta charset="utf-8" /><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src blob: data:; connect-src \'none\'">');
    }, { html, opened });
    const frame = page.frames()[1];
    await frame.waitForSelector("#objects img", { timeout: 15000, state: "attached" });
    await frame.waitForFunction(() => [...document.querySelectorAll("#objects img")].every(img => img.complete && img.naturalWidth > 0));
    const image = frame.locator("#objects img").first();
    await frame.locator("#objects .image-content").first().click();
    await frame.locator('[data-action="download"]').click();
    await page.waitForFunction(() => window.downloads.length === 1);
    assert.equal((await page.evaluate(() => window.downloads[0])).contents[0].resource.blob, png);
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
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    await page.close();
  }
  console.log("Native sidebar sandbox passed: render, images, drag, zoom, host download, panel reuse; no network requests.");
} finally { await browser.close(); await client.close(); await fs.rm(projectDir, { recursive: true, force: true }); }
