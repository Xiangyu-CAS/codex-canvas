import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { nodeFixture } from "./node-canvas-fixture.mjs";
import { createServer } from "../src/server.mjs";
import { readState } from "../src/store.mjs";

const fixture = await nodeFixture();
process.env.CODEX_CANVAS_CODEX_CLI = fixture.executable;
const { server, url } = await createServer({ projectDir: fixture.projectDir, port: 0, autoCollect: false, persistentRegistryPath: path.join(fixture.root, "registry.json") });
const browser = await chromium.launch({ ...(process.env.NODE_CANVAS_BROWSER ? { channel: process.env.NODE_CANVAS_BROWSER } : {}) });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
page.on("pageerror", error => errors.push(error.message));
const [a, b] = fixture.images;
const object = id => page.locator(`.canvas-object[data-id="${id}"]`);
async function until(check, label) {
  for (let i = 0; i < 120; i++) { if (await check()) return; await page.waitForTimeout(100); }
  throw new Error(`Timed out: ${label}`);
}
const state = () => readState(fixture.projectDir);
try {
  await page.goto(url);
  await object(a.id).waitFor();
  await object(a.id).click({ position: { x: 45, y: 50 } });
  await page.locator("#nodeComposer").waitFor({ state: "visible" });
  await page.locator("#nodePrompt").fill("Compose reference 1 and reference 2 in a landscape");
  await page.locator("#nodeAddReference").click();
  await page.locator(`[data-reference-choice="${b.id}"]`).click();
  await page.locator("#nodeRatio").selectOption("16:9");
  await page.locator("#nodeCount").selectOption("2");
  await until(async () => (await state()).objects.find(x => x.id === a.id).generationDraft?.count === 2, "draft save");
  await page.reload();
  await object(a.id).click({ position: { x: 45, y: 50 } });
  assert.equal(await page.locator("#nodePrompt").inputValue(), "Compose reference 1 and reference 2 in a landscape");
  assert.equal(await page.locator(".node-reference").count(), 2);
  await page.locator("#nodeGenerate").click();
  await until(async () => (await state()).objects.filter(x => x.jobId && x.type === "image").length === 2, "two real pipeline mock outputs");
  await until(async () => await page.locator(".node-links path").count() === 4, "four reference edges");
  let outputs = (await state()).objects.filter(x => x.jobId && x.type === "image");
  const first = outputs[0];
  // Continue from an existing result; never accidentally reuse its upstream references.
  // Jobs can finish out of order; the selected result may sit behind the floating panel.
  await page.locator('#nodeComposer button[aria-label="Close / 关闭"]').click();
  await object(first.id).locator(".node-port-output").click();
  assert.equal(await page.locator(".node-reference").count(), 1);
  assert.equal(await page.locator(".node-reference").getAttribute("data-reference-id"), first.id);
  await page.locator("#nodePrompt").fill("Continue with a square scene");
  await page.locator("#nodeRatio").selectOption("1:1");
  await page.locator("#nodeGenerate").click();
  await until(async () => (await state()).objects.some(x => x.jobId && x.referenceObjectIds?.[0] === first.id), "iteration");
  // Close the panel so real drag coordinates remain unobstructed.
  await page.locator('#nodeComposer button[aria-label="Close / 关闭"]').click();
  const rect = await object(a.id).boundingBox();
  const old = (await state()).objects.find(x => x.id === a.id);
  const oldPath = await page.locator(`.node-links path[data-source="${a.id}"]`).first().getAttribute("d");
  await page.mouse.move(rect.x + 60, rect.y + 60); await page.mouse.down();
  await page.mouse.move(rect.x + 110, rect.y + 100, { steps: 8 }); await page.mouse.up();
  await until(async () => (await state()).objects.find(x => x.id === a.id).x !== old.x, "drag persistence");
  assert.notEqual(await page.locator(`.node-links path[data-source="${a.id}"]`).first().getAttribute("d"), oldPath);
  const beforeWheel = (await state()).viewport;
  await page.mouse.move(1080, 170); await page.mouse.wheel(75, 60);
  await until(async () => (await state()).viewport.x !== beforeWheel.x, "trackpad pan");
  const beforeZoom = (await state()).viewport.zoom;
  await page.keyboard.down("Control"); await page.mouse.wheel(0, -160); await page.keyboard.up("Control");
  await until(async () => (await state()).viewport.zoom !== beforeZoom, "zoom");
  const viewport = (await state()).viewport;
  await page.reload(); await object(a.id).waitFor();
  assert.deepEqual((await state()).viewport, viewport);
  // Reset framing through the persisted viewport endpoint for the next UI checks.
  const endpoint = new URL("/api/state", url); endpoint.search = new URL(url).search;
  await page.request.post(endpoint.href, { data: { viewport: { x: 40, y: 0, zoom: .9 } } });
  await page.reload(); await object(a.id).waitFor();
  await object(a.id).locator(".node-port-output").click();
  await page.locator("#nodePrompt").fill("fail once");
  await page.locator("#nodeGenerate").click();
  await until(async () => (await state()).objects.some(x => x.type === "job" && x.status === "failed"), "failure placeholder");
  const failed = (await state()).objects.find(x => x.type === "job" && x.status === "failed");
  await until(async () => await object(failed.id).count() === 1, "failed node visible");
  await page.reload();
  await object(failed.id).locator(".node-port-output").click();
  assert.equal(await page.locator("#nodePrompt").inputValue(), "fail once");
  await page.locator("#nodeGenerate").click();
  await until(async () => !(await state()).objects.some(x => x.id === failed.id), "retry removes failed placeholder after acceptance");
  await until(async () => !(await state()).objects.some(x => x.type === "job"), "retry completes");
  // Delete and undo retains references; the renderer hides dangling connectors.
  await object(b.id).click({ position: { x: 40, y: 40 } });
  await page.keyboard.press("Delete");
  await until(async () => !(await state()).objects.some(x => x.id === b.id), "delete");
  assert.equal(await page.locator(`.node-links path[data-source="${b.id}"]`).count(), 0);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await until(async () => (await state()).objects.some(x => x.id === b.id), "undo delete");
  await until(async () => await page.locator(`.node-links path[data-source="${b.id}"]`).count() === 2, "restored connectors");
  // Switching registered canvases must preserve drafts and graph data.
  const secondDir = path.join(fixture.root, "other-project"); await fs.mkdir(secondDir);
  const created = await page.request.post(new URL("/api/projects", url).href, { data: { projectDir: secondDir, autoCollect: false } });
  assert.equal(created.status(), 201);
  const payload = await created.json();
  const secondUrl = new URL(url); secondUrl.searchParams.set("project", payload.project.id);
  await page.goto(secondUrl.href);
  await until(async () => await page.locator(".canvas-object").count() === 0, "empty other canvas");
  assert.equal(await page.locator("#nodeComposer").isVisible(), false);
  await page.goto(url); await object(a.id).waitFor();
  await object(a.id).click({ position: { x: 40, y: 40 } });
  assert.equal(await page.locator("#nodePrompt").inputValue(), "fail once");
  await page.screenshot({ path: path.join(fixture.root, "nodes-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(fixture.root, "nodes-mobile.png") });
  const panelRect = await page.locator("#nodeComposer").boundingBox();
  assert(panelRect.x >= 0 && panelRect.x + panelRect.width <= 390);
  const toolbarRect = await page.locator("#selectionToolbar").boundingBox();
  assert(toolbarRect.x >= 0 && toolbarRect.x + toolbarRect.width <= 390, "toolbar follows viewport resize");
  await page.locator("#nodeModeToggle").click();
  assert.equal(await page.locator("#nodeComposer").isVisible(), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, evidence: fixture.root, checks: ["draft save/reload", "ordered multi-reference generation", "two outputs", "continuation", "drag", "pan", "zoom", "viewport restore", "failure/retry", "delete/undo", "canvas switch", "mobile bounds", "legacy mode"] }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(fixture.root, "failure.png") }).catch(() => {});
  console.error(`Failure evidence: ${fixture.root}`, errors);
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
