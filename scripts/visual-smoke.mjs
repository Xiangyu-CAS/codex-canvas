import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addImage } from "../src/store.mjs";
import { createServer } from "../src/server.mjs";

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
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, viewports: results }, null, 2));
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
    x: viewport.name === "mobile" ? 110 : 360,
    y: viewport.name === "mobile" ? 260 : 240,
    width: viewport.name === "mobile" ? 220 : 320,
    height: viewport.name === "mobile" ? 180 : 240
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
    assertDeepEqual(consoleErrors.filter((message) => !/favicon/i.test(message)), [], "visual smoke should not emit console errors");
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
