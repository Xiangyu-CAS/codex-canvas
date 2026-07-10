import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const initialFetch = globalThis.fetch;
const curlStatusMarker = "\n__CODEX_CANVAS_HTTP_STATUS__:";
const curlMaxBuffer = 4 * 1024 * 1024;

export async function fetchTextResponse(url, options = {}) {
  const fetchImpl = globalThis.fetch;
  if (!shouldUseProxyAwareCurl(url) || fetchImpl !== initialFetch) {
    return fetchImpl(url, options);
  }

  try {
    return await fetchWithCurl(url, options);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return fetchImpl(url, options);
  }
}

async function fetchWithCurl(url, options) {
  const method = String(options.method || "GET").toUpperCase();
  if (method !== "GET") throw new Error(`Proxy-aware HTTP transport does not support ${method} requests.`);

  const command = process.platform === "win32" ? "curl.exe" : "curl";
  const args = [
    "--location",
    "--silent",
    "--show-error",
    "--proto", "=https",
    "--proto-redir", "=https",
    "--max-time", "30",
    "--request", method
  ];
  for (const [name, value] of headerEntries(options.headers)) {
    args.push("--header", `${name}: ${value}`);
  }
  args.push("--write-out", `${curlStatusMarker}%{http_code}`, String(url));

  let stdout;
  try {
    ({ stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      maxBuffer: curlMaxBuffer,
      signal: options.signal,
      timeout: 31_000,
      windowsHide: true
    }));
  } catch (error) {
    if (error?.code === "ENOENT" || error?.name === "AbortError" || error?.code === "ABORT_ERR") throw error;
    const detail = sanitizeTransportError(error?.stderr || error?.message || String(error));
    const transportError = new Error(`Proxy-aware curl request failed${detail ? `: ${detail}` : "."}`);
    transportError.code = error?.code;
    throw transportError;
  }

  const markerIndex = stdout.lastIndexOf(curlStatusMarker);
  const statusText = markerIndex >= 0 ? stdout.slice(markerIndex + curlStatusMarker.length).trim() : "";
  if (!/^\d{3}$/.test(statusText)) {
    throw new Error("Proxy-aware curl request did not return an HTTP status code.");
  }
  const status = Number(statusText);
  const body = stdout.slice(0, markerIndex);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return JSON.parse(body);
    },
    async text() {
      return body;
    }
  };
}

function shouldUseProxyAwareCurl(url) {
  let protocol;
  try {
    protocol = new URL(url).protocol;
  } catch {
    return false;
  }
  const names = protocol === "https:"
    ? ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
    : ["HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  return names.some((name) => typeof process.env[name] === "string" && process.env[name].trim());
}

function headerEntries(headers) {
  if (!headers) return [];
  if (typeof headers.entries === "function") return [...headers.entries()];
  if (Array.isArray(headers)) return headers;
  return Object.entries(headers);
}

function sanitizeTransportError(value) {
  return String(value || "")
    .trim()
    .replace(/https?:\/\/[^@\s]+@/gi, "https://***@")
    .slice(0, 300);
}
