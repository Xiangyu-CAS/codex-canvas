#!/usr/bin/env node

import fs from "node:fs/promises";
import { addObject, readState, transformState } from "../src/store.mjs";

const [mode, projectDir, startPath, value, countText] = process.argv.slice(2);
await waitForStart(startPath);

if (mode === "add") {
  const count = Math.max(1, Number(countText) || 1);
  for (let index = 0; index < count; index += 1) {
    await addObject(projectDir, {
      type: "text",
      text: `${value}-${index}`,
      x: index,
      y: index
    });
  }
  process.stdout.write(`${JSON.stringify({ ok: true, count })}\n`);
} else if (mode === "migrate") {
  const state = await readState(projectDir, { canvasId: value });
  process.stdout.write(`${JSON.stringify({ ok: true, objects: state.objects.length })}\n`);
} else if (mode === "hold-mutate") {
  const acquiredPath = value;
  const releasePath = countText;
  await transformState(projectDir, {}, async (state) => {
    await fs.writeFile(acquiredPath, "locked\n");
    await waitForStart(releasePath);
    return {
      ...state,
      objects: [
        ...state.objects,
        {
          id: `text_late_${process.pid}`,
          type: "text",
          name: "Late legacy write",
          text: "late-legacy-write",
          x: 24,
          y: 24,
          width: 220,
          height: 80,
          fontSize: 28,
          color: "#202124",
          createdAt: new Date().toISOString()
        }
      ]
    };
  });
  process.stdout.write(`${JSON.stringify({ ok: true })}\n`);
} else {
  throw new Error(`Unknown store worker mode: ${mode || "(missing)"}`);
}

async function waitForStart(filePath) {
  const startedAt = Date.now();
  for (;;) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      if (Date.now() - startedAt > 10_000) throw new Error("Store worker start barrier timed out.");
      await new Promise((resolve) => setTimeout(resolve, 8));
    }
  }
}
