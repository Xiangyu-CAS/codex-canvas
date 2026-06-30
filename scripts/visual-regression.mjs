import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { addImage } from "../src/store.mjs";
import { createServer as createAgentCanvasServer } from "../src/server.mjs";

const pngOne = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const baselineDir = path.join(process.cwd(), "scripts", "reference-screenshots");
const updateBaselines = process.argv.includes("--update");
const pixelThreshold = 0.012;
const channelTolerance = 10;
const viewports = [
  { name: "desktop", width: 1280, height: 800, deviceScaleFactor: 1 },
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
];
const screenshotCases = ["discovery", "selected", "compare", "text-edit"];
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
      for (const screenshotCase of screenshotCases) {
        const name = `${viewport.name}-${screenshotCase}`;
        const screenshot = await captureReferenceViewport(browser, viewport, screenshotCase);
        const baselinePath = path.join(baselineDir, `${name}.png`);
        if (updateBaselines) {
          await fsp.mkdir(baselineDir, { recursive: true });
          await fsp.writeFile(baselinePath, screenshot);
          results.push({ name, updated: true });
          continue;
        }

        const baseline = await readBaseline(baselinePath, name);
        const diff = await comparePngBuffers(browser, baseline, screenshot);
        if (diff.changedRatio > pixelThreshold) {
          const percent = (diff.changedRatio * 100).toFixed(2);
          throw new Error(`${name} visual regression exceeded ${(pixelThreshold * 100).toFixed(2)}% threshold: ${percent}% pixels changed`);
        }
        results.push({ name, changedRatio: Number(diff.changedRatio.toFixed(5)) });
      }
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, updated: updateBaselines, checks: results }, null, 2));
}

async function captureReferenceViewport(browser, viewport, screenshotCase) {
  const projectDir = await fsp.mkdtemp(path.join(os.tmpdir(), `agent-canvas-regression-${viewport.name}-`));
  const source = await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "reference-source.png",
    prompt: "Reference product source",
    x: viewport.name === "mobile" ? 108 : 360,
    y: viewport.name === "mobile" ? 260 : 236,
    width: viewport.name === "mobile" ? 220 : 320,
    height: viewport.name === "mobile" ? 180 : 240
  });
  await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "reference-version.png",
    prompt: "Reference product variant",
    sourceObjectId: source.id,
    batchId: "reference-batch",
    layoutMode: "canvas-row",
    x: viewport.name === "mobile" ? 148 : 720,
    y: viewport.name === "mobile" ? 500 : 260,
    width: viewport.name === "mobile" ? 180 : 220,
    height: viewport.name === "mobile" ? 140 : 160
  });
  await addImage(projectDir, {
    dataUrl: `data:image/png;base64,${pngOne}`,
    name: "reference-version-b.png",
    prompt: "Reference product variant B",
    sourceObjectId: source.id,
    batchId: "reference-batch",
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
    deviceScaleFactor: viewport.deviceScaleFactor
  });
  const page = await context.newPage();
  try {
    await installTextEditFixtureRoutes(page);
    await page.goto(url, { waitUntil: "networkidle" });
    await waitForVisible(page, "#board", "board should be visible");
    await waitForVisible(page, ".canvas-object img", "fixture image should be visible");
    await waitForImageDecoded(page, ".canvas-object img");

    if (screenshotCase === "selected") {
      await page.locator(`.canvas-object[data-id="${source.id}"]`).click();
      await waitForVisible(page, "#selectionToolbar", "selection toolbar should be visible");
    } else if (screenshotCase === "text-edit") {
      await page.locator(`.canvas-object[data-id="${source.id}"]`).click();
      await waitForVisible(page, "#selectionToolbar", "selection toolbar should be visible");
      await page.locator('[data-action="edit-text"]').click();
      await waitForVisible(page, ".quick-edit-composer.edit-text-mode", "Edit Text composer should be visible");
      await waitForVisible(page, ".edit-text-list input", "Edit Text recognized item input should be visible");
      await page.locator(".edit-text-list input").first().fill("Updated reference text");
    } else if (screenshotCase === "compare") {
      await page.locator(".prompt-history-button").click();
      await waitForVisible(page, ".prompt-history-panel:not([hidden])", "discovery panel should be visible");
      await page.locator("[data-discovery-mode='versions']").click();
      await waitForVisible(page, ".version-group-compare", "version comparison control should be visible");
      await page.locator(".version-group-compare").first().click();
      await waitForHidden(page, ".prompt-history-panel", "discovery panel should close after compare");
      await waitForSelectedCount(page, 2, "compare should select the grouped versions");
    } else {
      await page.locator(".prompt-history-button").click();
      await waitForVisible(page, ".prompt-history-panel:not([hidden])", "discovery panel should be visible");
      await page.locator("[data-discovery-mode='versions']").click();
      await page.locator(".version-group-select select").selectOption("prompt");
      await waitForVisible(page, ".version-group-thumb", "version thumbnails should be visible");
      await waitForText(page, ".version-group-title", "Reference product variant", "version group title should be deterministic");
      await waitForImageDecoded(page, ".version-group-thumb");
    }
    return await page.screenshot({ fullPage: false, animations: "disabled" });
  } finally {
    await context.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function installTextEditFixtureRoutes(page) {
  await page.route(/\/api\/text-recognition(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ id: "visual-text-recognition" })
    });
  });
  await page.route(/\/api\/text-recognition\/visual-text-recognition(?:\?.*)?$/, async (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "visual-text-recognition",
        stage: "ready",
        status: "running",
        items: [
          {
            index: 1,
            text: "Reference text",
            location: "center",
            style: "clean product label"
          }
        ]
      })
    });
  });
}

async function readBaseline(baselinePath, name) {
  try {
    return await fsp.readFile(baselinePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Missing ${name} visual baseline at ${baselinePath}. Run npm run visual:regression -- --update.`);
    }
    throw error;
  }
}

async function comparePngBuffers(browser, baseline, current) {
  const page = await browser.newPage();
  try {
    return await page.evaluate(async ({ baselineDataUrl, currentDataUrl, channelTolerance }) => {
      async function loadImage(dataUrl) {
        return new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = () => reject(new Error("Could not decode screenshot PNG."));
          image.src = dataUrl;
        });
      }

      const baselineImage = await loadImage(baselineDataUrl);
      const currentImage = await loadImage(currentDataUrl);
      if (baselineImage.naturalWidth !== currentImage.naturalWidth || baselineImage.naturalHeight !== currentImage.naturalHeight) {
        return { changedRatio: 1, dimensionsChanged: true };
      }

      const canvas = document.createElement("canvas");
      canvas.width = baselineImage.naturalWidth;
      canvas.height = baselineImage.naturalHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(baselineImage, 0, 0);
      const baselinePixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(currentImage, 0, 0);
      const currentPixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

      let changed = 0;
      const total = baselinePixels.length / 4;
      for (let index = 0; index < baselinePixels.length; index += 4) {
        const delta = Math.max(
          Math.abs(baselinePixels[index] - currentPixels[index]),
          Math.abs(baselinePixels[index + 1] - currentPixels[index + 1]),
          Math.abs(baselinePixels[index + 2] - currentPixels[index + 2]),
          Math.abs(baselinePixels[index + 3] - currentPixels[index + 3])
        );
        if (delta > channelTolerance) changed += 1;
      }
      return { changedRatio: changed / total, dimensionsChanged: false };
    }, {
      baselineDataUrl: `data:image/png;base64,${baseline.toString("base64")}`,
      currentDataUrl: `data:image/png;base64,${current.toString("base64")}`,
      channelTolerance
    });
  } finally {
    await page.close();
  }
}

async function createServer(options = {}) {
  return createAgentCanvasServer({
    persistentRegistryPath: await persistentRegistryPathForVisualRegression(),
    ...options
  });
}

async function persistentRegistryPathForVisualRegression() {
  if (!visualProjectRegistryPath) {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "agent-canvas-regression-registry-"));
    visualProjectRegistryPath = path.join(tmp, "projects.json");
  }
  return visualProjectRegistryPath;
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
      path.join(process.cwd(), "scripts", "visual-regression.mjs"),
      "--runner",
      ...(updateBaselines ? ["--update"] : [])
    ], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`visual regression runner exited with status ${code}`));
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

async function waitForText(page, selector, expected, message) {
  await page.waitForFunction(({ selector, expected }) => {
    return [...document.querySelectorAll(selector)].some((element) => element.textContent?.includes(expected));
  }, { selector, expected }, { timeout: 5000 }).catch((error) => {
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

async function waitForSelectedCount(page, count, message) {
  await page.waitForFunction((count) => {
    return document.querySelectorAll(".canvas-object.selected").length === count;
  }, count, { timeout: 5000 }).catch((error) => {
    throw new Error(`${message}: ${error.message}`);
  });
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
