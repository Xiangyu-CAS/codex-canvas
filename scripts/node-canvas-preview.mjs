// Isolated preview: synthetic assets and a local mock Codex executable only.
import path from "node:path";
import { nodeFixture } from "./node-canvas-fixture.mjs";
import { createServer } from "../src/server.mjs";
import { createImageJob, getImageJob } from "../src/jobs.mjs";
import { updateObject, updateProjectMeta } from "../src/store.mjs";

const fixture = await nodeFixture();
process.env.CODEX_CANVAS_CODEX_CLI = fixture.executable;
const [red, blue] = fixture.images;
const input = { action: "reference-generate", objectId: red.id, referenceObjectIds: [red.id, blue.id], ratio: "16:9", prompt: "将参考 1 和参考 2 的角色放在同一幅画面中，保持各自的服装与人物特征。" };
async function generate(spec) {
  const job = await createImageJob(fixture.projectDir, spec);
  for (let i = 0; i < 150; i++) {
    const result = getImageJob(job.id);
    if (result.status === "done") return result.imported[0];
    if (result.status === "failed") throw new Error(result.error);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Local fixture generation timed out");
}
const combined = await generate(input);
await updateObject(fixture.projectDir, combined.id, { name: "Composition · 模拟结果" });
const next = await generate({ ...input, objectId: combined.id, referenceObjectIds: [combined.id], ratio: "1:1", prompt: "继续迭代：将画面改为方形构图。" });
await updateObject(fixture.projectDir, next.id, { name: "Iteration · 模拟结果" });
await updateObject(fixture.projectDir, red.id, { generationDraft: { ...input, count: 1 } });
await updateProjectMeta(fixture.projectDir, { title: "节点画布 · 本地模拟演示" });
const { server, url } = await createServer({ projectDir: fixture.projectDir, port: 0, autoCollect: false, persistentRegistryPath: path.join(fixture.root, "registry.json") });
console.log(JSON.stringify({ url, projectDir: fixture.projectDir, mode: "MOCK: synthetic images; generation never calls external services", stop: "Ctrl+C" }, null, 2));
process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
