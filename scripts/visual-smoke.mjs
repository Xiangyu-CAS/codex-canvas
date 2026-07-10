import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addImage, updateObject } from "../src/store.mjs";
import { createServer as createAgentCanvasServer } from "../src/server.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pngTwo = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGO8Y6D6n4GBgYEJRIAwACHvAjSDKprFAAAAAElFTkSuQmCC";
const expectedSingleImageActions = [
  "quick-edit",
  "remove-bg",
  "expand",
  "crop",
  "edit-elements",
  "edit-text",
  "send-to-chat",
  "copy-file-mention",
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
    await runUploadPartialFailureSmoke(browser);
    results.push("upload-partial-failure");
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
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-canvas-visual-registry-"));
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
  const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), `codex-canvas-visual-${viewport.name}-`));
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
    dataUrl: `data:image/png;base64,${pngTwo}`,
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
    if (viewport.name === "desktop") {
      await assertCanvasInputInteractions(page, image.id);
      await assertDockAnnotationTool(page, image.id);
    }
    await activateCanvasTool(page, "select");

    await page.locator(`.canvas-object[data-id="${image.id}"]`).click();
    await waitForVisible(page, "#selectionToolbar", "selection toolbar should be visible after image selection");
    await assertLocatorClassContains(page, `.canvas-object[data-id="${image.id}"]`, "selected");
    if (viewport.name === "desktop") {
      await assertObjectMoveUndoRedo(page, image.id);
    }

    await assertSingleImageActionToolbar(page);
    await assertQuickEditAnnotationWorkflow(page, image.id, viewport);
    await assertExpandComposer(page, viewport);
    const croppedImageId = await assertCropWorkflow(page, image.id);
    await assertDeleteUndoShortcut(page, croppedImageId);
    await assertVisibleControlsDoNotOverlap(page, viewport);
    await assertDiscoveryVersionBrowser(page, [version.id, nextVersion.id, croppedImageId]);
    assertDeepEqual(consoleErrors.filter((message) => !/favicon/i.test(message)), [], "visual smoke should not emit console errors");
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function assertCanvasInputInteractions(page, imageId) {
  const initialTool = await page.evaluate((imageId) => ({
    handActive: document.querySelector('[data-tool="hand"]')?.classList.contains("active") || false,
    selectActive: document.querySelector('[data-tool="select"]')?.classList.contains("active") || false,
    handCursor: document.querySelector("#board")?.classList.contains("tool-hand") || false,
    objectCursor: getComputedStyle(document.querySelector(`.canvas-object[data-id="${imageId}"]`)).cursor
  }), imageId);
  assert(!initialTool.handActive, "Hand should remain available without being the default tool");
  assert(initialTool.selectActive, "Select should be the default canvas tool");
  assert(!initialTool.handCursor, "default Select should not set the board hand cursor state");
  assertEqual(initialTool.objectCursor, "default", "default Select should expose the normal object cursor");

  await activateCanvasTool(page, "hand");
  const handObjectCursor = await page.locator(`.canvas-object[data-id="${imageId}"]`).evaluate((element) => getComputedStyle(element).cursor);
  assertEqual(handObjectCursor, "pointer", "Hand should advertise that canvas objects remain clickable");

  const blank = await canvasBlankPoint(page);
  let before = await canvasInputSnapshot(page, imageId);
  await dragMouse(page, blank, { x: 54, y: 32 });
  let after = await canvasInputSnapshot(page, imageId);
  assertNear(after.viewportX - before.viewportX, 54, 0.5, "Hand drag on blank canvas should pan horizontally");
  assertNear(after.viewportY - before.viewportY, 32, 0.5, "Hand drag on blank canvas should pan vertically");
  assertNear(after.objectX, before.objectX, 0.01, "Hand drag should not change object x");
  assertNear(after.objectY, before.objectY, 0.01, "Hand drag should not change object y");

  const objectRect = await page.locator(`.canvas-object[data-id="${imageId}"]`).boundingBox();
  assertRectVisible(objectRect, "image before Hand drag over object");
  before = await canvasInputSnapshot(page, imageId);
  await dragMouse(page, {
    x: objectRect.x + objectRect.width / 2,
    y: objectRect.y + objectRect.height / 2
  }, { x: 38, y: 24 });
  after = await canvasInputSnapshot(page, imageId);
  assertNear(after.viewportX - before.viewportX, 38, 0.5, "Hand drag over an object should pan horizontally");
  assertNear(after.viewportY - before.viewportY, 24, 0.5, "Hand drag over an object should pan vertically");
  assertNear(after.objectX, before.objectX, 0.01, "Hand drag over an object should not move the object x");
  assertNear(after.objectY, before.objectY, 0.01, "Hand drag over an object should not move the object y");

  await resetCanvasViewport(page);
  const clickableObjectRect = await page.locator(`.canvas-object[data-id="${imageId}"]`).boundingBox();
  assertRectVisible(clickableObjectRect, "image before smart Hand selection");
  await page.mouse.click(
    clickableObjectRect.x + clickableObjectRect.width / 2,
    clickableObjectRect.y + clickableObjectRect.height / 2
  );
  await waitForVisible(page, "#selectionToolbar", "Hand click should reveal the selected image toolbar");
  const smartHandSelection = await page.evaluate((imageId) => ({
    handActive: document.querySelector('[data-tool="hand"]')?.classList.contains("active") || false,
    selected: document.querySelector(`.canvas-object[data-id="${imageId}"]`)?.classList.contains("selected") || false
  }), imageId);
  assert(smartHandSelection.handActive, "click-selecting an object should keep Hand as the active navigation tool");
  assert(smartHandSelection.selected, "clicking an object with Hand should select it");
  await page.mouse.click(blank.x, blank.y);
  await waitForHidden(page, "#selectionToolbar", "Hand click on blank canvas should clear the selection");

  await resetCanvasViewport(page);
  await activateCanvasTool(page, "select");
  before = await canvasInputSnapshot(page, imageId);
  await dragMouse(page, blank, { x: 31, y: -19 }, "middle");
  after = await canvasInputSnapshot(page, imageId);
  assertNear(after.viewportX - before.viewportX, 31, 0.5, "middle-button drag should pan in Select mode");
  assertNear(after.viewportY - before.viewportY, -19, 0.5, "middle-button drag should preserve vertical pointer movement");
  assertNear(after.objectX, before.objectX, 0.01, "middle-button drag should not move objects");

  await resetCanvasViewport(page);
  await page.locator("#board").focus();
  await page.keyboard.down("Space");
  try {
    const spacePan = await page.locator("#board").evaluate((element) => element.classList.contains("space-pan"));
    assert(spacePan, "holding Space should enable temporary pan mode");
    before = await canvasInputSnapshot(page, imageId);
    await dragMouse(page, blank, { x: -27, y: 21 });
    after = await canvasInputSnapshot(page, imageId);
    assertNear(after.viewportX - before.viewportX, -27, 0.5, "Space plus primary drag should pan horizontally");
    assertNear(after.viewportY - before.viewportY, 21, 0.5, "Space plus primary drag should pan vertically");
    assertNear(after.objectX, before.objectX, 0.01, "Space pan should not move objects");
  } finally {
    await page.keyboard.up("Space");
  }
  const spaceReleased = await page.locator("#board").evaluate((element) => !element.classList.contains("space-pan"));
  assert(spaceReleased, "releasing Space should leave temporary pan mode");

  await resetCanvasViewport(page);
  await activateCanvasTool(page, "hand");
  await page.evaluate(() => {
    const board = document.querySelector("#board");
    board.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      pointerId: 77,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      clientX: 40,
      clientY: 160
    }));
    board.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 77,
      pointerType: "mouse",
      isPrimary: true,
      buttons: 1,
      clientX: 62,
      clientY: 181
    }));
    board.dispatchEvent(new PointerEvent("pointercancel", {
      bubbles: true,
      pointerId: 77,
      pointerType: "mouse",
      isPrimary: true
    }));
  });
  const cancelledPan = await page.locator("#board").evaluate((element) => !element.classList.contains("dragging"));
  assert(cancelledPan, "pointercancel should fully clean up an active pan");

  await resetCanvasViewport(page);
  const boardRect = await page.locator("#board").boundingBox();
  assertRectVisible(boardRect, "board before wheel input checks");
  const wheelPoint = {
    x: boardRect.x + Math.min(420, boardRect.width * 0.42),
    y: boardRect.y + Math.min(310, boardRect.height * 0.42)
  };

  before = await canvasInputSnapshot(page, imageId);
  let wheelResult = await dispatchCanvasWheel(page, wheelPoint, { deltaX: 13, deltaY: -17 });
  after = await canvasInputSnapshot(page, imageId);
  assert(wheelResult.defaultPrevented, "canvas two-axis wheel pan should prevent native page scrolling");
  assertNear(after.viewportX - before.viewportX, -13, 0.5, "unmodified wheel should pan horizontally");
  assertNear(after.viewportY - before.viewportY, 17, 0.5, "unmodified wheel should pan vertically");
  assertNear(after.zoom, before.zoom, 0.0001, "unmodified wheel should not zoom");

  before = after;
  wheelResult = await dispatchCanvasWheel(page, wheelPoint, { deltaX: 5, deltaY: 7, metaKey: true });
  after = await canvasInputSnapshot(page, imageId);
  assert(wheelResult.defaultPrevented, "Command-modified wheel should still be handled as canvas pan");
  assertNear(after.viewportX - before.viewportX, -5, 0.5, "metaKey should not misclassify horizontal wheel input as zoom");
  assertNear(after.viewportY - before.viewportY, -7, 0.5, "metaKey should not misclassify vertical wheel input as zoom");
  assertNear(after.zoom, before.zoom, 0.0001, "metaKey alone should not zoom the canvas");

  before = after;
  await dispatchCanvasWheel(page, wheelPoint, { deltaX: 1, deltaY: 2, deltaMode: 1 });
  after = await canvasInputSnapshot(page, imageId);
  assertNear(after.viewportX - before.viewportX, -16, 0.5, "line-mode wheel x should normalize to pixels");
  assertNear(after.viewportY - before.viewportY, -32, 0.5, "line-mode wheel y should normalize to pixels");

  before = after;
  const localPointer = { x: wheelPoint.x - boardRect.x, y: wheelPoint.y - boardRect.y };
  const anchoredWorldPoint = {
    x: (localPointer.x - before.viewportX) / before.zoom,
    y: (localPointer.y - before.viewportY) / before.zoom
  };
  await dispatchCanvasWheel(page, wheelPoint, { deltaY: -42, ctrlKey: true });
  after = await canvasInputSnapshot(page, imageId);
  assert(after.zoom > before.zoom, "ctrlKey pinch-style wheel should zoom in");
  assertNear(after.viewportX + anchoredWorldPoint.x * after.zoom, localPointer.x, 0.05, "pinch zoom should preserve the horizontal cursor anchor");
  assertNear(after.viewportY + anchoredWorldPoint.y * after.zoom, localPointer.y, 0.05, "pinch zoom should preserve the vertical cursor anchor");

  before = after;
  const nativeWheel = await page.evaluate(() => {
    const textarea = document.createElement("textarea");
    textarea.value = "scrollable\n".repeat(20);
    document.querySelector("#board").append(textarea);
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 28
    });
    textarea.dispatchEvent(event);
    textarea.remove();
    return { defaultPrevented: event.defaultPrevented };
  });
  after = await canvasInputSnapshot(page, imageId);
  assert(!nativeWheel.defaultPrevented, "wheel over an input should retain native scrolling");
  assertNear(after.viewportX, before.viewportX, 0.01, "wheel over an input should not pan canvas x");
  assertNear(after.viewportY, before.viewportY, 0.01, "wheel over an input should not pan canvas y");
  assertNear(after.zoom, before.zoom, 0.0001, "wheel over an input should not zoom the canvas");

  await resetCanvasViewport(page);
  await activateCanvasTool(page, "select");
  await page.locator(`.canvas-object[data-id="${imageId}"]`).click();
  await activateCanvasTool(page, "hand");
  await dragMouse(page, blank, { x: 22, y: 18 });
  const selectionAfterPan = await page.evaluate((imageId) => ({
    selected: document.querySelector(`.canvas-object[data-id="${imageId}"]`)?.classList.contains("selected") || false,
    toolbarVisible: !document.querySelector("#selectionToolbar")?.hidden
  }), imageId);
  assert(selectionAfterPan.selected, "Hand pan should preserve the current object selection");
  assert(selectionAfterPan.toolbarVisible, "Hand pan should not dismiss the selected object toolbar");

  await resetCanvasViewport(page);
  await activateCanvasTool(page, "select");

  for (const tool of ["annotation", "pencil", "text"]) {
    await activateCanvasTool(page, tool);
    await waitForVisible(page, "#colorPalette", `${tool} should show the dock color palette`);
    const button = page.locator(`[data-tool="${tool}"]`);
    await button.hover();
    const tooltip = await button.evaluate((element) => {
      const style = getComputedStyle(element, "::after");
      return {
        display: style.display,
        bottom: Number.parseFloat(style.bottom),
        paletteRaised: element.closest(".tool-dock")?.classList.contains("has-visible-color-palette") || false
      };
    });
    assert(tooltip.paletteRaised, `${tool} should raise dock tooltips while its color palette is visible`);
    assertEqual(tooltip.display, "block", `${tool} hover tooltip should remain visible with the color palette open`);
    assert(tooltip.bottom >= 80, `${tool} hover tooltip should render above the color palette instead of behind it`);
  }
  await activateCanvasTool(page, "select");
  await waitForHidden(page, "#colorPalette", "leaving drawing tools should hide the dock color palette");
}

async function assertDockAnnotationTool(page, imageId) {
  await activateCanvasTool(page, "select");
  await page.locator(`.canvas-object[data-id="${imageId}"]`).click();
  const imageRect = await page.locator(`.canvas-object[data-id="${imageId}"]`).boundingBox();
  const boardRect = await page.locator("#board").boundingBox();
  assertRectVisible(imageRect, "image before standalone Arrow Note");
  assertRectVisible(boardRect, "board before standalone Arrow Note");
  const start = imageRect.x - boardRect.x > 58
    ? { x: imageRect.x - 42, y: imageRect.y + imageRect.height * 0.42 }
    : { x: imageRect.x + imageRect.width + 42, y: imageRect.y + imageRect.height * 0.42 };
  const end = { x: imageRect.x + imageRect.width * 0.56, y: imageRect.y + imageRect.height * 0.48 };

  await activateCanvasTool(page, "annotation");
  await waitForVisible(page, "#colorPalette", "standalone Arrow Note should expose the dock color palette");
  await dragMouse(page, start, { x: end.x - start.x, y: end.y - start.y });
  const label = page.locator('.annotation-object .annotation-label[contenteditable="true"]').last();
  await label.waitFor({ state: "visible" });
  await label.fill("底部箭头");
  await label.press("Enter");

  const createdHandle = await page.waitForFunction(({ imageId }) => fetch(`/api/state${window.location.search}`)
    .then((response) => response.json())
    .then((state) => state.objects.find((object) => object.type === "annotation"
      && object.annotationTargetId === imageId
      && object.label === "底部箭头") || null), { imageId }, { timeout: 5000 });
  const created = await createdHandle.jsonValue();
  assert(created?.id, "standalone Arrow Note should create a persisted annotation");
  assertEqual(created.annotationTargetId, imageId, "standalone Arrow Note should associate with the selected image");

  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForVisible(page, `.canvas-object[data-id="${created.id}"] .annotation-label`, "persisted Arrow Note label should remain visible after reload");
  await activateCanvasTool(page, "select");
  const persistedLabel = page.locator(`.canvas-object[data-id="${created.id}"] .annotation-label`);
  await persistedLabel.dblclick();
  await page.waitForFunction((id) => document.querySelector(`.canvas-object[data-id="${id}"] .annotation-label`)?.contentEditable === "true", created.id);
  await persistedLabel.fill("底部箭头已修改");
  await persistedLabel.press("Enter");
  const editedHandle = await page.waitForFunction(({ id }) => fetch(`/api/state${window.location.search}`)
    .then((response) => response.json())
    .then((state) => state.objects.find((object) => object.id === id && object.label === "底部箭头已修改") || null), { id: created.id }, { timeout: 5000 });
  const edited = await editedHandle.jsonValue();
  assertEqual(edited?.label, "底部箭头已修改", "persisted Arrow Note text should remain editable after reload");

  await page.reload({ waitUntil: "domcontentloaded" });
  await activateCanvasTool(page, "select");
  const selectedLabel = page.locator(`.canvas-object[data-id="${created.id}"] .annotation-label`);
  await selectedLabel.click();
  await page.keyboard.press("Enter");
  await page.waitForFunction((id) => document.querySelector(`.canvas-object[data-id="${id}"] .annotation-label`)?.contentEditable === "true", created.id);
  await page.keyboard.press("Escape");

  await page.evaluate(async (id) => {
    await fetch(`/api/objects${window.location.search}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [id] })
    });
  }, created.id);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForVisible(page, `.canvas-object[data-id="${imageId}"]`, "source image should remain after standalone Arrow Note cleanup");
}

async function activateCanvasTool(page, tool) {
  await page.locator(`[data-tool="${tool}"]`).click();
  await page.waitForFunction((tool) => (
    document.querySelector(`[data-tool="${tool}"]`)?.classList.contains("active") || false
  ), tool);
}

async function canvasBlankPoint(page) {
  const rect = await page.locator("#board").boundingBox();
  assertRectVisible(rect, "board before blank-canvas input");
  return {
    x: rect.x + 42,
    y: rect.y + Math.max(120, rect.height - 118)
  };
}

async function dragMouse(page, start, delta, button = "left") {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(start.x + delta.x, start.y + delta.y, { steps: 4 });
  await page.mouse.up({ button });
}

async function resetCanvasViewport(page) {
  await page.locator('.tool-dock [data-view-action="reset"]').click();
}

async function canvasInputSnapshot(page, imageId) {
  return page.evaluate((imageId) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector("#world")).transform);
    const object = document.querySelector(`.canvas-object[data-id="${imageId}"]`);
    return {
      viewportX: matrix.e,
      viewportY: matrix.f,
      zoom: matrix.a,
      objectX: Number.parseFloat(object?.style.left || "0"),
      objectY: Number.parseFloat(object?.style.top || "0")
    };
  }, imageId);
}

async function dispatchCanvasWheel(page, point, options) {
  return page.evaluate(({ point, options }) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      ...options
    });
    document.querySelector("#board").dispatchEvent(event);
    return { defaultPrevented: event.defaultPrevented };
  }, { point, options });
}

async function assertDiscoveryVersionBrowser(page, versionIds) {
  await page.locator(".prompt-history-button").click();
  await waitForVisible(page, ".prompt-history-panel:not([hidden])", "discovery panel should open");
  await page.locator("[data-discovery-mode='versions']").click();
  await waitForVisible(page, ".version-group", "version groups should render in discovery panel");
  await waitForVisible(page, ".version-group-thumb", "version group thumbnails should render");
  await assertVersionPanelFits(page);
  const thumbnailCount = await page.locator(".version-group-thumb").count();
  assert(thumbnailCount >= versionIds.length, "version browser should show thumbnails for grouped image versions");
  await waitForImageDecoded(page, ".version-group-thumb");
  await page.locator(".version-group-overlay").first().click();
  await waitForHidden(page, ".prompt-history-panel", "discovery panel should close after annotating a version group");
  await waitForVisible(page, ".version-diff-overlay", "version annotation overlay should render");
  await waitForVersionDiffHeatmap(page);
  await assertVersionDiffOverlay(page, versionIds);
  await assertVersionDiffOverlayFollowsDrag(page, versionIds);
  await clearVersionDiffOverlay(page);

  await page.locator(".prompt-history-button").click();
  await waitForVisible(page, ".prompt-history-panel:not([hidden])", "discovery panel should reopen after annotation");
  await page.locator("[data-discovery-mode='versions']").click();
  await waitForVisible(page, ".version-group-compare", "version comparison control should render after reopening");
  await page.locator(".version-group-compare").first().click();
  await waitForHidden(page, ".prompt-history-panel", "discovery panel should close after comparing a version group");
  for (const versionId of versionIds) {
    await assertLocatorClassContains(page, `.canvas-object[data-id="${versionId}"]`, "selected");
  }
  await assertMultiSelectionDragMovesEverySelectedObject(page, versionIds);
}

async function assertVersionDiffOverlay(page, versionIds) {
  const snapshot = await page.evaluate((ids) => {
    const overlay = document.querySelector(".version-diff-overlay");
    const boxes = [...document.querySelectorAll(".version-diff-box")];
    const heatmaps = [...document.querySelectorAll(".version-diff-heatmap")];
    const lines = [...document.querySelectorAll(".version-diff-connector line")];
    const selected = ids.map((id) => document.querySelector(`.canvas-object[data-id="${id}"]`)?.classList.contains("selected") || false);
    const rectSnapshot = (element) => {
      const rect = element?.getBoundingClientRect();
      if (!rect) return null;
      return {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    };
    return {
      overlayRect: rectSnapshot(overlay),
      boxRects: boxes.map(rectSnapshot),
      heatmapCount: heatmaps.length,
      visibleHeatmapCount: heatmaps.filter((canvas) => !canvas.hidden && Number(canvas.dataset.changedPixels || 0) > 0).length,
      connectorLineCount: lines.length,
      overlayIds: (overlay?.dataset.versionDiffIds || "").split(",").filter(Boolean),
      labelText: overlay?.querySelector(".version-diff-label")?.textContent || "",
      selected
    };
  }, versionIds);

  assertRectVisible(snapshot.overlayRect, "version annotation overlay");
  assertDeepEqual([...snapshot.overlayIds].sort(), [...versionIds].sort(), "version annotation overlay should track the compared version ids");
  assert(snapshot.boxRects.length === versionIds.length, "version annotation overlay should draw one box for each compared version");
  assert(snapshot.heatmapCount === versionIds.length - 1, "version annotation overlay should create a heatmap for each target version");
  assert(snapshot.visibleHeatmapCount >= 1, "version annotation overlay should render at least one visible pixel-diff heatmap");
  assert(snapshot.connectorLineCount === versionIds.length - 1, "version annotation overlay should connect adjacent compared versions");
  for (const rect of snapshot.boxRects) {
    assertRectVisible(rect, "version annotation box");
  }
  assert(snapshot.labelText.includes("Pixel diff"), "version annotation overlay should include a pixel diff label");
  assert(snapshot.selected.every(Boolean), "version annotation overlay should keep all compared versions selected");
}

async function waitForVersionDiffHeatmap(page) {
  await page.waitForFunction(() => {
    return [...document.querySelectorAll(".version-diff-heatmap")]
      .some((canvas) => !canvas.hidden && Number(canvas.dataset.changedPixels || 0) > 0);
  }, null, { timeout: 5000 }).catch((error) => {
    throw new Error(`version pixel-diff heatmap should render changed pixels: ${error.message}`);
  });
}

async function assertVersionDiffOverlayFollowsDrag(page, versionIds) {
  const before = await page.locator(".version-diff-overlay").boundingBox();
  assertRectVisible(before, "version annotation overlay before drag");
  await assertMultiSelectionDragMovesEverySelectedObject(page, versionIds);

  await page.waitForFunction((before) => {
    const overlay = document.querySelector(".version-diff-overlay");
    if (!overlay) return false;
    const rect = overlay.getBoundingClientRect();
    return Math.abs(rect.left - before.x) > 8 || Math.abs(rect.top - before.y) > 8;
  }, before, { timeout: 5000 });
  await waitForVersionDiffHeatmap(page);
  await assertVersionDiffOverlay(page, versionIds);
}

async function clearVersionDiffOverlay(page) {
  const board = await page.locator("#board").boundingBox();
  assertRectVisible(board, "#board before clearing version annotation overlay");
  await page.mouse.click(board.x + 24, board.y + 24);
  await waitForHidden(page, ".version-diff-overlay", "version annotation overlay should clear after clicking blank canvas");
}

async function assertVersionPanelFits(page) {
  const overflow = await page.evaluate(() => {
    const targets = [...document.querySelectorAll(".version-group-header, .version-group-actions, .version-group-action")];
    return targets
      .filter((element) => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1)
      .map((element) => element.className || element.tagName);
  });
  assertDeepEqual(overflow, [], "version browser controls should fit without internal overflow");
}

async function assertMultiSelectionDragMovesEverySelectedObject(page, versionIds) {
  const before = await canvasObjectRects(page, versionIds);
  const first = before[versionIds[0]];
  await page.mouse.move(first.left + first.width / 2, first.top + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.left + first.width / 2 + 42, first.top + first.height / 2 + 28, { steps: 4 });
  await page.mouse.up();

  await page.waitForFunction(({ ids, before }) => {
    return ids.every((id) => {
      const element = document.querySelector(`.canvas-object[data-id="${id}"]`);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return Math.abs(rect.left - before[id].left) > 10 && Math.abs(rect.top - before[id].top) > 6;
    });
  }, { ids: versionIds, before }, { timeout: 5000 });
}

async function canvasObjectRects(page, ids) {
  return page.evaluate((ids) => Object.fromEntries(ids.map((id) => {
    const element = document.querySelector(`.canvas-object[data-id="${id}"]`);
    if (!element) return [id, null];
    const rect = element.getBoundingClientRect();
    return [id, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    }];
  })), ids);
}

async function runEditElementsLayerSmoke(browser) {
  const viewport = { name: "edit-elements", width: 1280, height: 800 };
  const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-canvas-visual-elements-"));
  const groupId = "layer_group_visual_edit_elements";
  const background = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "visual-elements-background.png",
    x: 360,
    y: 250,
    width: 260,
    height: 180
  });
  const unrelated = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngTwo}`,
    name: "visual-elements-unrelated.png",
    x: 760,
    y: 250,
    width: 82,
    height: 64
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
    layerGroupLocked: false,
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
    layerGroupLocked: false,
    layerGroupOriginalX: 360,
    layerGroupOriginalY: 250,
    layerGroupOriginalWidth: 260,
    layerGroupOriginalHeight: 180,
    layerGroupRelativeX: 70,
    layerGroupRelativeY: 50,
    layerGroupOriginalLayerWidth: 92,
    layerGroupOriginalLayerHeight: 70
  });
  await updateObject(projectDir, unrelated.id, {
    layerGroupId: groupId,
    layerGroupName: "Edit Elements Visual Fixture",
    layerGroupSourceObjectId: "source-fixture",
    layerGroupIndex: 1,
    layerGroupKind: "object",
    layerGroupLocked: false,
    layerGroupOriginalX: 360,
    layerGroupOriginalY: 250,
    layerGroupOriginalWidth: 260,
    layerGroupOriginalHeight: 180,
    layerGroupRelativeX: 400,
    layerGroupRelativeY: 0,
    layerGroupOriginalLayerWidth: 82,
    layerGroupOriginalLayerHeight: 64
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
    await waitForVisible(page, `.canvas-object[data-id="${unrelated.id}"]`, "Edit Elements unrelated middle layer should render");
    await waitForImageDecoded(page, `.canvas-object[data-id="${background.id}"] img`);
    await waitForImageDecoded(page, `.canvas-object[data-id="${foreground.id}"] img`);
    await activateCanvasTool(page, "select");

    await assertEditElementsLayerStack(page, {
      backgroundId: background.id,
      foregroundId: foreground.id,
      groupId
    });

    await page.locator(`.canvas-object[data-id="${foreground.id}"]`).click();
    await waitForVisible(page, "#selectionToolbar", "Edit Elements layer toolbar should render after selecting an unlocked layer");
    await assertEditElementsLayerSelection(page, {
      backgroundId: background.id,
      foregroundId: foreground.id,
      groupId
    });
    await assertExactLayerReorderHistory(page, {
      backgroundId: background.id,
      unrelatedId: unrelated.id,
      foregroundId: foreground.id
    });
    await assertEditElementsLayerSelectionClears(page);
    await assertVisibleControlsDoNotOverlap(page, viewport);
    assertDeepEqual(consoleErrors.filter((message) => !/favicon/i.test(message)), [], "Edit Elements visual smoke should not emit console errors");
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function runUploadPartialFailureSmoke(browser) {
  const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-canvas-visual-upload-"));
  const { server, url } = await createServer({ projectDir, port: 0, autoCollect: false });
  const context = await browser.newContext({
    viewport: { width: 900, height: 620 }
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForVisible(page, "#board", "board should be visible before upload");
    await page.evaluate(() => {
      window.__codexCanvasUploadSeen = [];
      document.querySelector("#imageUploadInput")?.addEventListener("change", (event) => {
        window.__codexCanvasUploadSeen = [...event.target.files].map((file) => ({
          name: file.name,
          type: file.type,
          size: file.size
        }));
      }, { capture: true, once: true });
    });
    await page.locator("#imageUploadInput").setInputFiles([
      {
        name: "valid-upload.png",
        mimeType: "image/png",
        buffer: Buffer.from(pngOne, "base64")
      },
      {
        name: "fake-upload.png",
        mimeType: "image/png",
        buffer: Buffer.from("not a real png")
      }
    ]);
    await page.waitForFunction(() => {
      return fetch(`/api/state${window.location.search}`)
        .then((response) => response.json())
        .then((state) => state.objects.length === 1);
    }, null, { timeout: 5000 }).catch(async (error) => {
      const debug = await page.evaluate(() => ({
        seen: window.__codexCanvasUploadSeen || [],
        toast: document.querySelector("#toast")?.textContent || ""
      }));
      throw new Error(`partial upload should persist one valid image before refreshing UI: ${error.message}; debug=${JSON.stringify(debug)}`);
    });
    await waitForVisible(page, ".canvas-object", "valid upload should render even when a later file fails").catch(async (error) => {
      const debug = await page.evaluate(() => ({
        seen: window.__codexCanvasUploadSeen || [],
        toast: document.querySelector("#toast")?.textContent || "",
        domObjects: document.querySelectorAll(".canvas-object").length,
        objectLayerHtml: document.querySelector("#objects")?.innerHTML || "",
        stateObjects: window.state?.objects?.length ?? null,
        selectedId: window.selectedId ?? null
      }));
      throw new Error(`${error.message}; debug=${JSON.stringify(debug)}`);
    });
    await waitForImageDecoded(page, ".canvas-object img");
    const upload = await page.evaluate(() => {
      const objects = [...document.querySelectorAll(".canvas-object")];
      return fetch(`/api/state${window.location.search}`)
        .then((response) => response.json())
        .then((state) => ({
          domObjects: objects.length,
          storedObjects: state.objects.length,
          selectedCount: objects.filter((element) => element.classList.contains("selected")).length,
          toast: document.querySelector("#toast")?.textContent || ""
        }));
    });
    assert(upload.domObjects === 1, "partial upload failure should still render the successful image");
    assert(upload.storedObjects === 1, "partial upload failure should persist only the supported image");
    assert(upload.selectedCount === 1, "partial upload failure should select the successful image");
    assert(upload.toast.includes("supported image data"), "partial upload failure should show the rejected image error");
    assertDeepEqual(
      consoleErrors.filter((message) => !/favicon/i.test(message) && !/400 \(Bad Request\)/i.test(message)),
      [],
      "upload partial failure smoke should not emit unexpected console errors"
    );
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

async function assertEditElementsLayerSelectionClears(page) {
  const boardRect = await page.locator("#board").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  });
  await page.mouse.click(boardRect.left + 40, boardRect.top + 240);
  await waitForHidden(page, "#selectionToolbar", "Edit Elements layer toolbar should hide after clicking blank canvas");
  const toolbarState = await page.evaluate(() => {
    const toolbar = document.querySelector("#selectionToolbar");
    return {
      hidden: toolbar?.hidden || false,
      hasLayerGroupActions: toolbar?.classList.contains("has-layer-group-actions") || false,
      visibleGroupActions: [...document.querySelectorAll("#selectionToolbar [data-action]")]
        .filter((button) => ["reset-layer-group", "layer-down", "layer-up", "group-layer-group"].includes(button.dataset.action))
        .filter((button) => !button.hidden && getComputedStyle(button).display !== "none")
        .map((button) => button.dataset.action)
    };
  });
  assert(toolbarState.hidden, "Edit Elements toolbar should be hidden after clearing selection");
  assert(toolbarState.hasLayerGroupActions === false, "Edit Elements toolbar should clear special layer-group layout state");
  assertDeepEqual(toolbarState.visibleGroupActions, [], "Edit Elements group-only actions should be hidden after clearing selection");
}

async function assertExactLayerReorderHistory(page, { backgroundId, unrelatedId, foregroundId }) {
  const originalOrder = [backgroundId, unrelatedId, foregroundId];
  const movedOrder = [foregroundId, backgroundId, unrelatedId];
  await waitForCanvasObjectOrder(page, originalOrder, "Edit Elements fixture should start in its indexed layer order");

  await page.waitForFunction((foregroundId) => (
    document.querySelector(`.canvas-object[data-id="${foregroundId}"]`)?.classList.contains("selected") || false
  ), foregroundId, { timeout: 5_000 });
  await waitForVisible(page, '#selectionToolbar [data-action="layer-down"]', "Layer down should be available for exact history coverage");
  await page.waitForFunction(() => !document.querySelector('#selectionToolbar [data-action="layer-down"]')?.disabled, null, { timeout: 5_000 });
  await page.locator('#selectionToolbar [data-action="layer-down"]').click();
  await waitForCanvasObjectOrder(page, movedOrder, "Layer down should skip the non-overlapping middle layer");
  await waitForHistoryButton(page, "undo");

  await page.locator('[data-history-action="undo"]').click();
  await waitForCanvasObjectOrder(page, originalOrder, "Undo should restore the exact original layer order");
  await waitForHistoryButton(page, "redo");

  await page.locator('[data-history-action="redo"]').click();
  await waitForCanvasObjectOrder(page, movedOrder, "Redo should restore the exact moved layer order");
  await waitForHistoryButton(page, "undo");

  await page.locator('[data-history-action="undo"]').click();
  await waitForCanvasObjectOrder(page, originalOrder, "final Undo should leave the fixture in its original layer order");
}

async function waitForCanvasObjectOrder(page, expectedOrder, message) {
  await page.waitForFunction((expected) => {
    const expectedIds = new Set(expected);
    const actual = [...document.querySelectorAll(".canvas-object")]
      .map((element) => element.dataset.id)
      .filter((id) => expectedIds.has(id));
    return actual.join(",") === expected.join(",");
  }, expectedOrder, { timeout: 5_000 }).catch((error) => {
    throw new Error(`${message}: ${error.message}`);
  });
}

async function waitForHistoryButton(page, action) {
  await page.waitForFunction((action) => {
    const button = document.querySelector(`[data-history-action="${action}"]`);
    return Boolean(button && !button.disabled);
  }, action, { timeout: 5_000 });
}

async function assertEditElementsLayerSelection(page, { backgroundId, foregroundId, groupId }) {
  const selection = await page.evaluate(({ backgroundId, foregroundId, groupId }) => {
    const background = document.querySelector(`.canvas-object[data-id="${backgroundId}"]`);
    const foreground = document.querySelector(`.canvas-object[data-id="${foregroundId}"]`);
    const overlay = document.querySelector(`.layer-group-selection[data-layer-group-id="${groupId}"]`);
    const label = overlay?.querySelector(".layer-group-label");
    const toolbar = document.querySelector("#selectionToolbar");
    const visibleButtons = [...document.querySelectorAll("#selectionToolbar [data-action]")]
      .filter((button) => !button.hidden && getComputedStyle(button).display !== "none");
    const visibleActions = visibleButtons.map((button) => button.dataset.action);
    const actionText = Object.fromEntries(visibleButtons.map((button) => [button.dataset.action, button.textContent.trim()]));
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
    const actionRects = Object.fromEntries(visibleButtons.map((button) => [button.dataset.action, rectSnapshot(button)]));
    return {
      backgroundSelected: background?.classList.contains("selected") || background?.classList.contains("layer-group-member-selected") || false,
      foregroundSelected: foreground?.classList.contains("selected") || foreground?.classList.contains("layer-group-member-selected") || false,
      overlayRect: overlay ? rectSnapshot(overlay) : null,
      labelText: label?.textContent || "",
      toolbarRect: toolbar ? rectSnapshot(toolbar) : null,
      visibleActions,
      actionText,
      actionRects
    };
  }, { backgroundId, foregroundId, groupId });

  assert(!selection.backgroundSelected, "Edit Elements unlocked selection should not select the background layer");
  assert(selection.foregroundSelected, "Edit Elements unlocked selection should mark only the clicked layer");
  assert(selection.overlayRect === null, "Edit Elements unlocked selection should not render a group overlay");
  assert(selection.labelText === "", "Edit Elements unlocked selection should not show a group overlay label");
  assertDeepEqual(
    selection.visibleActions,
    ["quick-edit", "remove-bg", "expand", "crop", "edit-elements", "reset-layer-group", "layer-down", "layer-up", "group-layer-group", "edit-text", "send-to-chat", "copy-file-mention", "download"],
    "Edit Elements unlocked layer selection should expose image actions plus group actions"
  );
  assert(
    selection.actionRects["reset-layer-group"].top > selection.actionRects["quick-edit"].top + 20,
    "Edit Elements group actions should render on a second toolbar row"
  );
  assert(
    selection.actionRects.download.top === selection.actionRects["reset-layer-group"].top,
    "Edit Elements PSD download should render with the group actions row"
  );
  assert(selection.actionText["layer-down"].includes("Layer down"), "Layer down should render text in the toolbar");
  assert(selection.actionText["layer-up"].includes("Layer up"), "Layer up should render text in the toolbar");
  assert(
    selection.toolbarRect.width < 760,
    "Edit Elements two-row toolbar should stay compact instead of stretching across the viewport"
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

async function assertQuickEditAnnotationWorkflow(page, imageId, viewport) {
  await page.locator('[data-action="quick-edit"]').click();
  await waitForVisible(page, ".quick-edit-composer.quick-edit-mode", "Quick Edit composer should be visible");
  const initial = await page.evaluate(() => ({
    annotationToolActive: document.querySelector('[data-quick-edit-tool="annotation"]')?.classList.contains("active") || false,
    annotationPressed: document.querySelector('[data-quick-edit-tool="annotation"]')?.getAttribute("aria-pressed"),
    runDisabled: document.querySelector("#quickEditRun")?.disabled ?? false,
    hint: document.querySelector("#quickEditHint")?.textContent?.trim() || "",
    swatchColors: [...document.querySelectorAll("#quickEditColorPalette .color-swatch")]
      .map((swatch) => getComputedStyle(swatch).backgroundColor)
  }));
  assert(initial.annotationToolActive, "Quick Edit should default to the arrow-note tool");
  assertEqual(initial.annotationPressed, "true", "Quick Edit arrow-note tool should expose pressed state");
  assert(initial.runDisabled, "Quick Edit should require a prompt or annotation before running");
  assert(Boolean(initial.hint), "Quick Edit should explain the arrow-note gesture");
  assert(/tail|箭尾/i.test(initial.hint), "Quick Edit should explain that text stays at the arrow tail");
  assertEqual(new Set(initial.swatchColors).size, 7, "Quick Edit should render every markup color without requiring composer focus");

  const imageRect = await page.locator(`.canvas-object[data-id="${imageId}"]`).boundingBox();
  const boardRect = await page.locator("#board").boundingBox();
  assertRectVisible(imageRect, "Quick Edit source image");
  assertRectVisible(boardRect, "Quick Edit board");
  const canEndLeft = imageRect.x - boardRect.x > 58;
  const start = {
    x: imageRect.x + imageRect.width * 0.42,
    y: imageRect.y + imageRect.height * 0.45
  };
  const end = {
    x: canEndLeft ? imageRect.x - 42 : imageRect.x + imageRect.width + 42,
    y: imageRect.y + imageRect.height * 0.48
  };
  await dragMouse(page, start, { x: end.x - start.x, y: end.y - start.y });
  const label = page.locator('.annotation-object .annotation-label[contenteditable="true"]').last();
  await label.waitFor({ state: "visible" });
  await label.fill("移除这个细节");
  await label.press("Enter");
  await page.waitForFunction(() => {
    const run = document.querySelector("#quickEditRun");
    const label = document.querySelector(".annotation-object .annotation-label");
    return Boolean(run && !run.disabled && label?.textContent?.includes("移除这个细节"));
  });

  const state = await page.evaluate(async (imageId) => {
    const response = await fetch("/api/state");
    const payload = await response.json();
    const annotation = payload.objects.find((object) => object.type === "annotation" && object.annotationTargetId === imageId);
    const arrow = document.querySelector(".annotation-object .annotation-arrow > path");
    const arrowhead = document.querySelector(".annotation-object .annotation-arrow marker path");
    const marker = document.querySelector(".annotation-object .annotation-arrow marker");
    const labelElement = document.querySelector(".annotation-object .annotation-label");
    const labelRect = labelElement?.getBoundingClientRect();
    const renderedStartPoint = arrow?.getPointAtLength(0);
    const renderedStart = renderedStartPoint && arrow?.getScreenCTM()
      ? renderedStartPoint.matrixTransform(arrow.getScreenCTM())
      : null;
    const renderedTipPoint = arrow?.getPointAtLength(arrow.getTotalLength());
    const renderedTip = renderedTipPoint && arrow?.getScreenCTM()
      ? renderedTipPoint.matrixTransform(arrow.getScreenCTM())
      : null;
    return {
      sourceExists: payload.objects.some((object) => object.id === imageId),
      annotation,
      composerRect: document.querySelector("#quickEditComposer")?.getBoundingClientRect().toJSON?.() || null,
      arrowPath: arrow?.getAttribute("d") || "",
      arrowheadFill: arrowhead?.getAttribute("fill") || "",
      markerUnits: marker?.getAttribute("markerUnits") || "",
      renderedStart: renderedStart ? { x: renderedStart.x, y: renderedStart.y } : null,
      renderedTip: renderedTip ? { x: renderedTip.x, y: renderedTip.y } : null,
      labelRect: labelRect ? { left: labelRect.left, right: labelRect.right, bottom: labelRect.bottom, width: labelRect.width } : null,
      labelMinWidth: labelElement ? getComputedStyle(labelElement).minWidth : ""
    };
  }, imageId);
  assert(state.sourceExists, "creating a Quick Edit annotation should preserve the source image");
  assert(state.annotation, "Quick Edit arrow note should persist as a structured annotation object");
  assertEqual(state.annotation.label, "移除这个细节", "Quick Edit should persist a Chinese inline arrow label");
  assertEqual(state.annotation.annotationTargetId, imageId, "Quick Edit annotation should explicitly target the selected image");
  assert(state.annotation.targetAnchorX >= 0 && state.annotation.targetAnchorX <= 1, "Quick Edit annotation x anchor should be normalized");
  assert(state.annotation.targetAnchorY >= 0 && state.annotation.targetAnchorY <= 1, "Quick Edit annotation y anchor should be normalized");
  assert(state.arrowPath.includes(" C "), "Quick Edit annotation should use a gentle cubic leader curve");
  assertEqual(state.arrowheadFill, "none", "Quick Edit annotation should use an open arrowhead instead of a rigid filled wedge");
  assertEqual(state.markerUnits, "userSpaceOnUse", "Quick Edit arrowhead size should stay independent from stroke width");
  assertNear(state.renderedStart?.x, end.x, 1.5, "Quick Edit arrow tail should stay at the outside endpoint horizontally");
  assertNear(state.renderedStart?.y, end.y, 1.5, "Quick Edit arrow tail should stay at the outside endpoint vertically");
  assertNear(state.renderedTip?.x, start.x, 1.5, "Quick Edit arrowhead should point to the horizontal image target");
  assertNear(state.renderedTip?.y, start.y, 1.5, "Quick Edit arrowhead should point to the vertical image target");
  assertNear((state.labelRect?.left + state.labelRect?.right) / 2, end.x, 1.5, "Quick Edit label should stay beside the outside arrow tail");
  assert(state.labelRect?.bottom < end.y, "Quick Edit label should sit just above the arrow tail without covering it");
  assertEqual(state.labelMinWidth, "72px", "Quick Edit labels should retain the original text bubble sizing");
  if (state.composerRect) assertRectInsideViewport(state.composerRect, viewport, "Quick Edit composer");

  await page.locator("#quickEditCancel").click();
  await waitForHidden(page, "#quickEditComposer", "Quick Edit composer should close after cancel");
  await activateCanvasTool(page, "select");
  await page.locator(`.canvas-object[data-id="${imageId}"]`).click();
  await waitForVisible(page, "#selectionToolbar", "source toolbar should return after Quick Edit closes");
}

async function assertExpandComposer(page, viewport) {
  await page.locator('[data-action="expand"]').click();
  await waitForVisible(page, ".quick-edit-composer.expand-mode", "Expand composer should be visible");
  const snapshot = await page.evaluate(() => {
    const composer = document.querySelector("#quickEditComposer");
    const textarea = document.querySelector("#quickEditPrompt");
    const rect = composer?.getBoundingClientRect();
    return {
      rect: rect ? {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: Math.round(rect.right),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      } : null,
      placeholder: textarea?.placeholder || "",
      activeAction: document.querySelector("#quickEditComposer")?.classList.contains("expand-mode") || false
    };
  });
  assertRectVisible(snapshot.rect, "Expand composer");
  assertRectInsideViewport(snapshot.rect, viewport, "Expand composer");
  assert(snapshot.placeholder.includes("extend"), "Expand composer should show expansion-specific placeholder text");
  assert(snapshot.activeAction, "Expand composer should use the expand controls mode");
  await page.locator("#quickEditCancel").click();
  await waitForHidden(page, "#quickEditComposer", "Expand composer should close after cancel");
}

async function assertCropWorkflow(page, imageId) {
  await page.locator(`.canvas-object[data-id="${imageId}"]`).click();
  await waitForVisible(page, "#selectionToolbar", "selection toolbar should be visible before Crop");
  const before = await page.evaluate((imageId) => {
    return fetch(`/api/state${window.location.search}`)
      .then((response) => response.json())
      .then((state) => {
        const source = state.objects.find((object) => object.id === imageId);
        return {
          count: state.objects.length,
          sourceX: source?.x || 0,
          sourceWidth: source?.width || 0
        };
      });
  }, imageId);
  await page.locator('[data-action="crop"]').click();
  await waitForVisible(page, ".crop-overlay", "Crop overlay should be visible");
  await waitForHidden(page, "#selectionToolbar", "selection toolbar should hide while cropping");

  const handle = await page.locator(".crop-se").boundingBox();
  assertRectVisible(handle, "Crop southeast handle");
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - 34, handle.y + handle.height / 2 - 24, { steps: 4 });
  await page.mouse.up();
  await page.locator(".crop-actions button:not(.secondary-action)").click();
  await waitForHidden(page, ".crop-overlay", "Crop overlay should close after applying");

  const result = await page.waitForFunction(({ imageId, before }) => {
    return fetch(`/api/state${window.location.search}`)
      .then((response) => response.json())
      .then((state) => {
        const source = state.objects.find((object) => object.id === imageId);
        const cropped = state.objects.find((object) => object.sourceObjectId === imageId && /-crop\.png$/i.test(object.name || ""));
        if (!source || !cropped || state.objects.length <= before.count) return null;
        return { source, cropped };
      });
  }, { imageId, before }, { timeout: 5000 });
  const { source, cropped } = await result.jsonValue();
  assert(!source.crop, "Crop workflow should leave the original image uncropped");
  assert(cropped.width < before.sourceWidth, "Crop workflow should create a smaller derived image");
  assert(cropped.x >= before.sourceX + before.sourceWidth, "Crop workflow should place the derived image to the right of the source");
  return cropped.id;
}

async function assertDeleteUndoShortcut(page, objectId) {
  await page.locator(`.canvas-object[data-id="${objectId}"]`).click();
  await waitForVisible(page, "#selectionToolbar", "selection toolbar should be visible before Delete");
  await page.keyboard.press("Delete");
  await waitForHidden(page, `.canvas-object[data-id="${objectId}"]`, "deleted object should leave the canvas before undo");
  await page.waitForFunction((objectId) => (
    fetch(`/api/state${window.location.search}`)
      .then((response) => response.json())
      .then((state) => !state.objects.some((object) => object.id === objectId))
  ), objectId, { timeout: 5000 });

  await page.keyboard.press("Control+Z");
  await waitForVisible(page, `.canvas-object[data-id="${objectId}"]`, "Ctrl+Z should restore the deleted object");
  const restored = await page.evaluate((objectId) => (
    fetch(`/api/state${window.location.search}`)
      .then((response) => response.json())
      .then((state) => {
        const object = state.objects.find((item) => item.id === objectId);
        return {
          exists: Boolean(object),
          selected: state.selection === objectId
        };
      })
  ), objectId);
  assert(restored.exists, "Ctrl+Z undo should restore the deleted object in persisted state");
  assert(restored.selected, "Ctrl+Z undo should restore selection to the deleted object");

  await page.keyboard.press("Control+Shift+Z");
  await waitForHidden(page, `.canvas-object[data-id="${objectId}"]`, "Ctrl+Shift+Z redo should delete the restored object again");
  await page.keyboard.press("Control+Z");
  await waitForVisible(page, `.canvas-object[data-id="${objectId}"]`, "Ctrl+Z should undo the shortcut redo");
  await page.keyboard.press("Control+Y");
  await waitForHidden(page, `.canvas-object[data-id="${objectId}"]`, "Ctrl+Y redo should delete the restored object on Windows-style shortcuts");
  await page.keyboard.press("Control+Z");
  await waitForVisible(page, `.canvas-object[data-id="${objectId}"]`, "final undo should leave the deleted object restored for later checks");
}

async function assertObjectMoveUndoRedo(page, objectId) {
  const before = await persistedObjectPosition(page, objectId);
  const rect = await page.locator(`.canvas-object[data-id="${objectId}"]`).boundingBox();
  assertRectVisible(rect, "selected object before move history check");
  await dragMouse(page, {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2
  }, { x: 36, y: 20 });
  const moved = await waitForPersistedObjectPosition(page, objectId, before, { different: true });

  await page.keyboard.press("Control+Z");
  await waitForPersistedObjectPosition(page, objectId, before);
  await page.keyboard.press("Control+Shift+Z");
  await waitForPersistedObjectPosition(page, objectId, moved);
  await page.keyboard.press("Control+Z");
  await waitForPersistedObjectPosition(page, objectId, before);
}

async function persistedObjectPosition(page, objectId) {
  return page.evaluate((objectId) => fetch(`/api/state${window.location.search}`)
    .then((response) => response.json())
    .then((state) => {
      const object = state.objects.find((item) => item.id === objectId);
      return { x: object?.x, y: object?.y };
    }), objectId);
}

async function waitForPersistedObjectPosition(page, objectId, expected, { different = false } = {}) {
  const handle = await page.waitForFunction(({ objectId, expected, different }) => fetch(`/api/state${window.location.search}`)
    .then((response) => response.json())
    .then((state) => {
      const object = state.objects.find((item) => item.id === objectId);
      if (!object) return null;
      const position = { x: object.x, y: object.y };
      const matches = different
        ? position.x !== expected.x || position.y !== expected.y
        : position.x === expected.x && position.y === expected.y;
      return matches ? position : null;
    }), { objectId, expected, different }, { timeout: 5000 });
  return handle.jsonValue();
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
    const images = [...document.querySelectorAll(target)];
    return images.length > 0 && images.every((image) => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0);
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

function assertNear(actual, expected, tolerance, message) {
  assert(Math.abs(actual - expected) <= tolerance, `${message}. Expected ${expected} ± ${tolerance}, got ${actual}.`);
}

function assertDeepEqual(actual, expected, message) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(actualJson === expectedJson, `${message}. Expected ${expectedJson}, got ${actualJson}.`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}.`);
  }
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
