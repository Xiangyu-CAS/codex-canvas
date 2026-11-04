import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { PNG } from "pngjs";
import { addImage, updateViewport } from "../src/store.mjs";

export async function nodeFixture(destination, storeOptions = {}) {
  const root = destination || await fs.mkdtemp(path.join(os.tmpdir(), "canvas-node-test-"));
  await fs.mkdir(root, { recursive: true });
  const projectDir = path.join(root, "project");
  await fs.mkdir(projectDir, { recursive: true });
  const pngModule = createRequire(import.meta.url).resolve("pngjs");
  const worker = path.join(root, "fixture-codex.cjs");
  // Exercise the real job/collector/store pipeline without contacting imagegen.
  await fs.writeFile(worker, `#!/usr/bin/env node
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { PNG } = require(${JSON.stringify(pngModule)});
let prompt = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', x => prompt += x);
process.stdin.on('end', () => {
 const out = process.env.CODEX_CANVAS_JOB_OUTPUT_DIR;
 const images = process.argv.flatMap((x,i,a) => x === '--image' ? [a[i+1]] : []);
 fs.mkdirSync(out, {recursive:true});
 fs.writeFileSync(path.join(path.dirname(out),'capture.json'), JSON.stringify({images,prompt}));
 const marker = path.join(process.cwd(),'.fixture-failed');
 setTimeout(() => {
  if (prompt.includes('fail once') && !fs.existsSync(marker)) { fs.writeFileSync(marker,'1'); console.error('Simulated generation failure'); process.exit(1); }
  const ratio = /Requested aspect ratio: ([0-9]+):([0-9]+)/.exec(prompt);
  const width = 320, height = ratio ? Math.round(width * Number(ratio[2]) / Number(ratio[1])) : 220;
  const png = new PNG({width,height}), seed = prompt.includes("identical") ? Buffer.from([1,2,3]) : crypto.randomBytes(3);
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
   const i=(y*width+x)*4, disk = Math.hypot(x-width*.35,y-height*.4)<height*.22;
   png.data[i]=disk ? 224 : 35 + Math.round(40*x/width); png.data[i+1]=disk ? 174 : 60 + Math.round(50*y/height);
   png.data[i+2]=disk ? 116 : 100; png.data[i+3]=255;
  }
  png.data[0]=seed[0];png.data[1]=seed[1];png.data[2]=seed[2];
  fs.writeFileSync(path.join(out,'fixture-result.png'), PNG.sync.write(png));
 }, prompt.includes('slow') ? 1800 : 400);
});
`, { mode: 0o755 });
  let executable = worker;
  if (process.platform === "win32") {
    executable = path.join(root, "fixture-codex.cmd");
    await fs.writeFile(executable, `@echo off\r\n"${process.execPath}" "${worker}" %*\r\n`);
  }
  const images = [];
  for (let n = 0; n < 2; n++) {
    const png = new PNG({ width: 200, height: 240 });
    for (let y = 0; y < 240; y++) for (let x = 0; x < 200; x++) {
      const i = (y * 200 + x) * 4;
      const head = Math.hypot(x - 100, y - 78) < 32;
      const body = y > 112 && y < 220 && Math.abs(x - 100) < (y - 85) * .36;
      const color = head ? [229, 187, 150] : body ? (n ? [95, 155, 196] : [188, 72, 82]) : [225 - n * 12, 222, 213];
      png.data.set([...color, 255], i);
    }
    const file = path.join(root, `reference-${n + 1}.png`);
    await fs.writeFile(file, PNG.sync.write(png));
    images.push(await addImage(projectDir, { path: file, name: n ? "Reference 2 · Blue" : "Reference 1 · Red", x: 100, y: 90 + n * 300, width: 160, height: 192 }, storeOptions));
  }
  await updateViewport(projectDir, { x: 40, y: 0, zoom: .9 }, storeOptions);
  return { root, projectDir, images, executable };
}
