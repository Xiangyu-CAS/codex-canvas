import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addImage, updateObject } from "../src/store.mjs";
import { createServer as createAgentCanvasServer } from "../src/server.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const expectedSingleImageActions = [
  "quick-edit",
  "remove-bg",
  "edit-elements",
  "edit-text",
  "send-to-chat",
  "download"
];
const viewports = [
  { name: "desktop", width: 1280, height: 800 },
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true }
];
let visualProjectRegistryPath = null;

async function main() {
  const playwright = await loadPlaywright();
  if (!playwright && !process.argv.includes("--runner")) {
    await runWithNpmPlaywright();
    return;
  }
  if (!playwright) {
    throw new Error("Playwright is not available. Install it locally or run through npm exec.");
  }

  const browser = await launchChromium(playwright);
  const results = [];
  try {
    for (const viewport of viewports) {
      await runViewportSmoke(browser, viewport);
      results.push(viewport.name);
    }
    await runEditElementsLayerSmoke(browser);
    results.push("edit-elements-layers");
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, checks: results }, null, 2));
}

async function runWithNpmPlaywright() {
  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand(), [
      "exec",
      "--yes",
      "--package",
      "playwright",
      "--",
      process.execPath,
      path.join(process.cwd(), "scripts", "visual-smoke.mjs"),
      "--runner"
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`visual smoke runner exited with status ${code}`));
    });
  });
}

async function createServer(options = {}) {
  return createAgentCanvasServer({
    persistentRegistryPath: await persistentRegistryPathForVisualSmoke(),
    ...options
  });
}

async function persistentRegistryPathForVisualSmoke() {
  if (!visualProjectRegistryPath) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-canvas-visual-registry-"));
    visualProjectRegistryPath = path.join(tmp, "projects.json");
  }
  return visualProjectRegistryPath;
}

async function launchChromium(playwright) {
  try {
    return await playwright.chromium.launch();
  } catch (error) {
    if (!/Executable doesn't exist|Please run.+playwright install/is.test(String(error?.message || error))) {
      throw error;
    }
    await installPlaywrightChromium();
    return playwright.chromium.launch();
  }
}

async function installPlaywrightChromium() {
  await new Promise((resolve, reject) => {
    const child = spawn(npmCommand(), [
      "exec",
      "--yes",
      "--package",
      "playwright",
      "--",
      "playwright",
      "install",
      "chromium"
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`playwright install chromium exited with status ${code}`));
    });
  });
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    return importPlaywrightFromNpmExecPath();
  }
}

async function importPlaywrightFromNpmExecPath() {
  const binName = process.platform === "win32" ? "playwright.cmd" : "playwright";
  for (const entry of (process.env.PATH || "").split(path.delimiter)) {
    const binPath = path.join(entry, binName);
    if (!fs.existsSync(binPath)) continue;
    const nodeModules = path.resolve(entry, "..");
    const modulePath = path.join(nodeModules, "playwright", "index.mjs");
    if (fs.existsSync(modulePath)) return import(pathToFileURL(modulePath).href);
  }
  return null;
}

async function runViewportSmoke(browser, viewport) {
  const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), `agent-canvas-visual-${viewport.name}-`));
  const image = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: `${viewport.name}-visual.png`,
    prompt: `${viewport.name} product source`,
    x: viewport.name === "mobile" ? 110 : 360,
    y: viewport.name === "mobile" ? 260 : 240,
    width: viewport.name === "mobile" ? 220 : 320,
    height: viewport.name === "mobile" ? 180 : 240
  });
  const version = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: `${viewport.name}-visual-version.png`,
    prompt: `${viewport.name} product variant`,
    sourceObjectId: image.id,
    batchId: `${viewport.name}-batch`,
    layoutMode: "canvas-row",
    x: viewport.name === "mobile" ? 150 : 720,
    y: viewport.name === "mobile" ? 500 : 260,
    width: viewport.name === "mobile" ? 180 : 220,
    height: viewport.name === "mobile" ? 140 : 160
  });
  const nextVersion = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: `${viewport.name}-visual-version-b.png`,
    prompt: `${viewport.name} product variant B`,
    sourceObjectId: image.id,
    batchId: `${viewport.name}-batch`,
    layoutMode: "canvas-row",
    x: viewport.name === "mobile" ? 170 : 980,
    y: viewport.name === "mobile" ? 660 : 280,
    width: viewport.name === "mobile" ? 160 : 200,
    height: viewport.name === "mobile" ? 120 : 140
  });
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    isMobile: Boolean(viewport.isMobile),
    hasTouch: Boolean(viewport.hasTouch),
    deviceScaleFactor: viewport.isMobile ? 2 : 1
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForVisible(page, "#board", "board should be visible");
    await waitForVisible(page, `.canvas-object[data-id="${image.id}"]`, "test image object should be visible");
    await waitForImageDecoded(page, `.canvas-object[data-id="${image.id}"] img`);

    await assertCanvasIsNotBlank(page, viewport);

    await page.locator(`.canvas-object[data-id="${image.id}"]`).click();
    await waitForVisible(page, "#selectionToolbar", "selection toolbar should be visible after image selection");
    await assertLocatorClassContains(page, `.canvas-object[data-id="${image.id}"]`, "selected");

    await assertSingleImageActionToolbar(page);
    await assertVisibleControlsDoNotOverlap(page, viewport);
    await assertDiscoveryVersionBrowser(page, [version.id, nextVersion.id]);
    assertDeepEqual(consoleErrors.filter((message) => !/favicon/i.test(message)), [], "visual smoke should not emit console errors");
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function assertDiscoveryVersionBrowser(page, versionIds) {
  await page.locator(".prompt-history-button").click();
  await waitForVisible(page, ".prompt-history-panel:not([hidden])", "discovery panel should open");
  await page.locator("[data-discovery-mode='versions']").click();
  await waitForVisible(page, ".version-group", "version groups should render in discovery panel");
  await waitForVisible(page, ".version-group-thumb", "version group thumbnails should render");
  const thumbnailCount = await page.locator(".version-group-thumb").count();
  assert(thumbnailCount >= versionIds.length, "version browser should show thumbnails for grouped image versions");
  await waitForImageDecoded(page, ".version-group-thumb");
  await page.locator(".version-group-compare").first().click();
  await waitForHidden(page, ".prompt-history-panel", "discovery panel should close after comparing a version group");
  for (const versionId of versionIds) {
    await assertLocatorClassContains(page, `.canvas-object[data-id="${versionId}"]`, "selected");
  }
}

async function runEditElementsLayerSmoke(browser) {
  const viewport = { name: "edit-elements", width: 1280, height: 800 };
  const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-canvas-visual-elements-"));
  const groupId = "layer_group_visual_edit_elements";
  const background = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "visual-elements-background.png",
    x: 360,
    y: 250,
    width: 260,
    height: 180
  });
  const foreground = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "visual-elements-object.png",
    x: 430,
    y: 300,
    width: 92,
    height: 70
  });
  await updateObject(projectDir, background.id, {
    layerGroupId: groupId,
    layerGroupName: "Edit Elements Visual Fixture",
    layerGroupSourceObjectId: "source-fixture",
    layerGroupIndex: 0,
    layerGroupKind: "background",
    layerGroupLocked: true,
    layerGroupOriginalX: 360,
    layerGroupOriginalY: 250,
    layerGroupOriginalWidth: 260,
    layerGroupOriginalHeight: 180,
    layerGroupRelativeX: 0,
    layerGroupRelativeY: 0,
    layerGroupOriginalLayerWidth: 260,
    layerGroupOriginalLayerHeight: 180
  });
  await updateObject(projectDir, foreground.id, {
    layerGroupId: groupId,
    layerGroupName: "Edit Elements Visual Fixture",
    layerGroupSourceObjectId: "source-fixture",
    layerGroupIndex: 2,
    layerGroupKind: "object",
    layerGroupLocked: true,
    layerGroupOriginalX: 360,
    layerGroupOriginalY: 250,
    layerGroupOriginalWidth: 260,
    layerGroupOriginalHeight: 180,
    layerGroupRelativeX: 70,
    layerGroupRelativeY: 50,
    layerGroupOriginalLayerWidth: 92,
    layerGroupOriginalLayerHeight: 70
  });

  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForVisible(page, `.canvas-object[data-id="${background.id}"]`, "Edit Elements background layer should render");
    await waitForVisible(page, `.canvas-object[data-id="${foreground.id}"]`, "Edit Elements object layer should render");
    await waitForImageDecoded(page, `.canvas-object[data-id="${background.id}"] img`);
    await waitForImageDecoded(page, `.canvas-object[data-id="${foreground.id}"] img`);

    await assertEditElementsLayerStack(page, {
      backgroundId: background.id,
      foregroundId: foreground.id,
      groupId
    });

    await page.locator(`.canvas-object[data-id="${foreground.id}"]`).click();
    await waitForVisible(page, `.layer-group-selection[data-layer-group-id="${groupId}"]`, "Edit Elements layer group overlay should render after selecting a locked layer");
    await assertEditElementsLayerSelection(page, {
      backgroundId: background.id,
      foregroundId: foreground.id,
      groupId
    });
    await assertVisibleControlsDoNotOverlap(page, viewport);
    assertDeepEqual(consoleErrors.filter((message) => !/favicon/i.test(message)), [], "Edit Elements visual smoke should not emit console errors");
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function assertCanvasIsNotBlank(page, viewport) {
  const snapshot = await page.evaluate(() => {
    const rectSnapshot = (rect) => rect && ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    });
    const board = document.querySelector("#board");
    const object = document.querySelector(".canvas-object");
    const image = document.querySelector(".canvas-object img");
    const boardStyle = board ? getComputedStyle(board) : null;
    return {
      boardRect: rectSnapshot(board?.getBoundingClientRect()),
      objectRect: rectSnapshot(object?.getBoundingClientRect()),
      imageRect: rectSnapshot(image?.getBoundingClientRect()),
      boardBackground: boardStyle?.backgroundColor || "",
      imageComplete: Boolean(image?.complete),
      imageNaturalWidth: image?.naturalWidth || 0,
      imageNaturalHeight: image?.naturalHeight || 0
    };
  });

  assertRectCoversViewport(snapshot.boardRect, viewport, "#board");
  assertRectVisible(snapshot.objectRect, ".canvas-object");
  assertRectVisible(snapshot.imageRect, ".canvas-object img");
  assert(snapshot.boardBackground !== "rgba(0, 0, 0, 0)", "#board should paint a visible background");
  assert(snapshot.imageComplete, "canvas image should finish loading");
  assert(snapshot.imageNaturalWidth > 0, "canvas image should have decoded width");
  assert(snapshot.imageNaturalHeight > 0, "canvas image should have decoded height");
  assert(
    intersectionArea(snapshot.objectRect, viewportRect(viewport)) > 4000,
    "canvas object should be visibly present in the viewport"
  );
}

async function assertEditElementsLayerStack(page, { backgroundId, foregroundId, groupId }) {
  const stack = await page.evaluate(({ backgroundId, foregroundId, groupId }) => {
    const objectElements = [...document.querySelectorAll(".canvas-object")];
    const objectOrder = objectElements.map((element) => element.dataset.id);
    const background = document.querySelector(`.canvas-object[data-id="${backgroundId}"]`);
    const foreground = document.querySelector(`.canvas-object[data-id="${foregroundId}"]`);
    const rectSnapshot = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    return {
      backgroundBeforeForeground: objectOrder.indexOf(backgroundId) < objectOrder.indexOf(foregroundId),
      groupOverlayPresentBeforeSelection: Boolean(document.querySelector(`.layer-group-selection[data-layer-group-id="${groupId}"]`)),
      backgroundRect: background ? rectSnapshot(background) : null,
      foregroundRect: foreground ? rectSnapshot(foreground) : null
    };
  }, { backgroundId, foregroundId, groupId });

  assert(stack.backgroundBeforeForeground, "Edit Elements visual fixture should render background below foreground in DOM order");
  assert(stack.groupOverlayPresentBeforeSelection === false, "Edit Elements layer group overlay should not render before user selection");
  assertRectVisible(stack.backgroundRect, "Edit Elements background layer");
  assertRectVisible(stack.foregroundRect, "Edit Elements object layer");
  assert(stack.foregroundRect.left > stack.backgroundRect.left, "Edit Elements object layer should be offset inside the group");
  assert(stack.foregroundRect.top > stack.backgroundRect.top, "Edit Elements object layer should be vertically offset inside the group");
}

async function assertEditElementsLayerSelection(page, { backgroundId, foregroundId, groupId }) {
  const selection = await page.evaluate(({ backgroundId, foregroundId, groupId }) => {
    const background = document.querySelector(`.canvas-object[data-id="${backgroundId}"]`);
    const foreground = document.querySelector(`.canvas-object[data-id="${foregroundId}"]`);
    const overlay = document.querySelector(`.layer-group-selection[data-layer-group-id="${groupId}"]`);
    const label = overlay?.querySelector(".layer-group-label");
    const visibleActions = [...document.querySelectorAll("#selectionToolbar [data-action]")]
      .filter((button) => !button.hidden && getComputedStyle(button).display !== "none")
      .map((button) => button.dataset.action);
    const rectSnapshot = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    return {
      backgroundSelected: background?.classList.contains("layer-group-member-selected") || false,
      foregroundSelected: foreground?.classList.contains("layer-group-member-selected") || false,
      overlayRect: overlay ? rectSnapshot(overlay) : null,
      labelText: label?.textContent || "",
      visibleActions
    };
  }, { backgroundId, foregroundId, groupId });

  assert(selection.backgroundSelected, "Edit Elements group selection should mark the background layer");
  assert(selection.foregroundSelected, "Edit Elements group selection should mark the foreground layer");
  assertRectVisible(selection.overlayRect, "Edit Elements layer group overlay");
  assert(selection.labelText === "Edit Elements Visual Fixture · 2 layers", "Edit Elements layer group overlay should show the group label and layer count");
  assertDeepEqual(
    selection.visibleActions,
    ["reset-layer-group", "group-layer-group"],
    "Edit Elements group selection should expose only group actions"
  );
}

async function assertSingleImageActionToolbar(page) {
  const actions = await page.locator("#selectionToolbar [data-action]:visible").evaluateAll((buttons) => (
    buttons.map((button) => button.dataset.action)
  ));
  assertDeepEqual(actions, expectedSingleImageActions, "single selected image should expose the stable action toolbar");

  const buttonRects = await page.locator("#selectionToolbar [data-action]:visible").evaluateAll((buttons) => (
    buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        name: button.dataset.action,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      };
    })
  ));
  for (const rect of buttonRects) assertRectVisible(rect, `toolbar action ${rect.name}`);
  assertNoPairwiseOverlap(buttonRects, "toolbar action buttons");
}

async function assertVisibleControlsDoNotOverlap(page, viewport) {
  const controls = await page.evaluate(() => {
    const rectSnapshot = (rect) => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    });
    const selectors = [
      ["project header", ".project-header"],
      ["settings button", "#settingsButton"],
      ["tool dock", ".tool-dock"],
      ["selection toolbar", "#selectionToolbar"],
      ["quick edit composer", "#quickEditComposer"],
      ["settings menu", "#settingsMenu"],
      ["project menu", "#projectMenu"],
      ["color palette", "#colorPalette"]
    ];
    return selectors.flatMap(([name, selector]) => {
      const element = document.querySelector(selector);
      if (!element || element.hidden || getComputedStyle(element).display === "none") return [];
      return [{ name, ...rectSnapshot(element.getBoundingClientRect()) }];
    });
  });

  for (const control of controls) {
    assertRectVisible(control, control.name);
    assertRectInsideViewport(control, viewport, control.name);
  }
  assertNoPairwiseOverlap(controls, "visible controls");
}

async function waitForVisible(page, selector, message) {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    if (!element || element.hidden) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }, selector, { timeout: 5000 }).catch((error) => {
    throw new Error(`${message}: ${error.message}`);
  });
}

async function waitForHidden(page, selector, message) {
  await page.waitForFunction((target) => {
    const element = document.querySelector(target);
    if (!element || element.hidden) return true;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0;
  }, selector, { timeout: 5000 }).catch((error) => {
    throw new Error(`${message}: ${error.message}`);
  });
}

async function waitForImageDecoded(page, selector) {
  await page.waitForFunction((target) => {
    const image = document.querySelector(target);
    return Boolean(image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
  }, selector, { timeout: 5000 });
}

async function assertLocatorClassContains(page, selector, className) {
  const classes = await page.locator(selector).getAttribute("class");
  assert((classes || "").split(/\s+/).includes(className), `${selector} should include class ${className}`);
}

function assertNoPairwiseOverlap(rects, label) {
  for (let index = 0; index < rects.length; index += 1) {
    for (let next = index + 1; next < rects.length; next += 1) {
      const first = rects[index];
      const second = rects[next];
      assert(
        intersectionArea(first, second) === 0,
        `${label} should not overlap: ${first.name} intersects ${second.name}`
      );
    }
  }
}

function assertRectCoversViewport(rect, viewport, label) {
  assertRectVisible(rect, label);
  assert(rect.width >= viewport.width, `${label} should cover viewport width`);
  assert(rect.height >= viewport.height, `${label} should cover viewport height`);
}

function assertRectInsideViewport(rect, viewport, label) {
  const tolerance = 1;
  assert(rect.left >= -tolerance, `${label} should stay inside the left viewport edge`);
  assert(rect.top >= -tolerance, `${label} should stay inside the top viewport edge`);
  assert(rect.right <= viewport.width + tolerance, `${label} should stay inside the right viewport edge`);
  assert(rect.bottom <= viewport.height + tolerance, `${label} should stay inside the bottom viewport edge`);
}

function assertRectVisible(rect, label) {
  assert(Boolean(rect), `${label} should have a bounding box`);
  assert(rect.width > 0, `${label} should have visible width`);
  assert(rect.height > 0, `${label} should have visible height`);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${message}. Expected ${expectedJson}, got ${actualJson}.`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function intersectionArea(first, second) {
  const left = Math.max(first.left, second.left);
  const top = Math.max(first.top, second.top);
  const right = Math.min(first.right, second.right);
  const bottom = Math.min(first.bottom, second.bottom);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function viewportRect(viewport) {
  return {
    left: 0,
    top: 0,
    right: viewport.width,
    bottom: viewport.height,
    width: viewport.width,
    height: viewport.height
  };
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
