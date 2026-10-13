import { spawn } from "node:child_process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
export function createMcpClient(root = new URL("../", import.meta.url)) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("src/mcp-server.mjs", root))], {
    env: { ...process.env, CODEX_THREAD_ID: "", CODEX_CANVAS_CODEX_THREAD_ID: "" }, stdio: ["pipe", "pipe", "inherit"]
  });
  let sequence = 0;
  const pending = new Map();
  const lines = readline.createInterface({ input: child.stdout });
  lines.on("line", line => {
    const message = JSON.parse(line);
    const p = pending.get(message.id);
    if (!p) return;
    pending.delete(message.id); clearTimeout(p.timer);
    if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
  });
  return {
    request(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 20000);
        pending.set(id, { resolve, reject, timer });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      });
    },
    async close() {
      child.stdin.end();
      await new Promise(resolve => {
        const timer = setTimeout(() => child.kill(), 1500);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
      lines.close();
    }
  };
}
