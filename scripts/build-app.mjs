import { build } from "esbuild";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = new URL("../", import.meta.url);
const output = await build({
  entryPoints: [fileURLToPath(new URL("ui/canvas-app.js", root))], bundle: true,
  format: "esm", platform: "browser", target: "es2022", minify: true,
  pure: ["console.debug"], legalComments: "inline", write: false
});
const html = await fs.readFile(new URL("public/index.html", root), "utf8");
const css = await fs.readFile(new URL("public/styles.css", root), "utf8");
const widget = html.replace(/\s*<link rel="icon"[^>]+>/, "")
  .replace('<link rel="stylesheet" href="/styles.css" />', () => `<style>${css}</style>`)
  .replace('<script src="/app.js" type="module"></script>', () => `<script type="module">${output.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script>`);
const destination = new URL("public/canvas-app.html", root);
if (process.argv.includes("--check")) {
  if (widget !== await fs.readFile(destination, "utf8")) throw new Error("Canvas App bundle is stale. Run npm run build:app.");
} else await fs.writeFile(destination, widget);
console.log(`Canvas App ${process.argv.includes("--check") ? "verified" : "built"}.`);
