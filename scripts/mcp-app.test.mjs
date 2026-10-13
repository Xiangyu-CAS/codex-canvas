import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMcpClient } from "./mcp-app-client.mjs";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test("MCP sidebar resources, isolated sessions, mutations and binary assets without HTTP", async () => {
  const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "canvas-app-"));
  const client = createMcpClient();
  const call = (name, args) => client.request("tools/call", { name, arguments: args });
  try {
    assert.ok((await client.request("initialize")).capabilities.resources);
    const { tools } = await client.request("tools/list");
    const opener = tools.find(t => t.name === "open_canvas");
    assert.equal(opener._meta["openai/ui"].entrypoints[0].type, "thread");
    assert.deepEqual(tools.find(t => t.name === "canvas_app_request")._meta.ui.visibility, ["app"]);
    const resource = (await client.request("resources/list")).resources[0];
    assert.equal(resource.uri, opener._meta.ui.resourceUri);
    const html = (await client.request("resources/read", { uri: resource.uri })).contents[0];
    assert.equal(html.mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(html._meta.ui.csp.connectDomains, []);
    assert.ok(html.text.includes("canvas_app_request"));
    assert.ok(!html.text.includes('src="/app.js"'));
    await assert.rejects(client.request("resources/read", { uri: "file:///etc/passwd" }));
    assert.equal((await call("open_canvas", {})).structuredContent.needsProject, true);
    await assert.rejects(fs.access(path.join(projectDir, "canvas")));
    const [a, repeat] = await Promise.all([1, 2].map(() => call("open_canvas", { projectDir, threadId: "thread-a" })));
    assert.equal(a._meta.canvasSession.sessionId, repeat._meta.canvasSession.sessionId);
    assert.equal(a._meta["openai/widgetSessionId"], repeat._meta["openai/widgetSessionId"]);
    assert.equal(a.structuredContent.url, undefined);
    const b = await call("open_canvas", { projectDir, threadId: "thread-b" });
    const request = async (session, route, method = "GET", body) => (await call("canvas_app_request", { sessionId: session._meta.canvasSession.sessionId, path: route, method, body })).structuredContent;
    const created = await request(a, "/api/images", "POST", { dataUrl: `data:image/png;base64,${png}`, name: "sidebar.png" });
    assert.equal(created.status, 201);
    const state = (await request(a, "/api/state")).body;
    assert.equal(state.objects.length, 1);
    assert.equal((await request(b, "/api/state")).body.objects.length, 0);
    const object = state.objects[0];
    const asset = await request(a, `/api/app-assets/${object.id}`);
    assert.equal(asset.encoding, "base64");
    assert.equal(asset.body, png);
    const patch = await request(a, `/api/objects/${object.id}`, "PATCH", { x: 250, y: 150 });
    assert.equal(patch.status, 200);
    assert.equal((await request(a, "/api/state")).body.objects[0].x, 250);
    assert.equal((await request(a, "/api/selection", "POST", { objectId: object.id })).status, 200);
    assert.equal((await request(a, `/api/objects/${object.id}`, "DELETE")).status, 200);
    assert.equal((await request(a, "/api/state")).body.objects.length, 0);
    for (const route of ["http://example.com", "//example.com/a", "/\\example.com", "/api/state?project=other", "/api/state?threadId=thread-b", "/api/chat-binding", "/api/shutdown", "/package.json", "/assets/../package.json"]) {
      await assert.rejects(request(a, route), undefined, route);
    }
    await assert.rejects(request(a, "/api/projects", "POST", { projectDir: os.tmpdir() }));
    await assert.rejects(call("canvas_app_request", { sessionId: "unknown", path: "/api/state" }));
    await assert.rejects(fs.access(path.join(projectDir, "canvas", ".codex-canvas-runtime.json")));
  } finally { await client.close(); await fs.rm(projectDir, { recursive: true, force: true }); }
});
