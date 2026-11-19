import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const mode = process.argv[2] === "start" ? "start" : "dev";
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid local port.");
const token = randomBytes(32).toString("hex");
const root = fileURLToPath(new URL("..", import.meta.url));
// The production build uses Cloudflare D1 bindings; plain vinext start uses
// Node's loader and cannot run cloudflare:workers. Preview runs the built worker.
const cli = fileURLToPath(new URL(mode === "start" ? "../node_modules/vite/bin/vite.js" : "../node_modules/vinext/dist/cli.js", import.meta.url));
const args = mode === "start" ? ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"] : ["dev", "--hostname", "127.0.0.1", "--port", String(port)];
const server = spawn(process.execPath, [cli, ...args], {
  cwd: root, stdio: "inherit",
  env: { ...(mode === "start" ? loadEnv("production", root, "") : {}), ...process.env, CODEXLENS_SYNC_TOKEN: token, CLOUDFLARE_INCLUDE_PROCESS_ENV: "true", WRANGLER_LOG_PATH: ".wrangler/wrangler.log" },
});
let stopped = false; let timer; let inFlight = null;
async function tick() {
  if (stopped) return;
  inFlight = new AbortController();
  try {
    // The server owns scheduling, persistence and locking. No credentials are logged or sent in URLs.
    const response = await fetch(`http://127.0.0.1:${port}/api/auto-sync`, { method: "POST", headers: { "x-codexlens-sync-token": token }, signal: inFlight.signal });
    if (!response.ok && response.status !== 409) console.warn(`[codexlens] Sync worker returned HTTP ${response.status}; check Sync status in the app.`);
    await response.body?.cancel();
  } catch { /* Server starting, stopped, or temporarily unavailable. Next tick retries the scheduler, not membership writes. */ }
  finally { inFlight = null; if (!stopped) timer = setTimeout(tick, 30_000); }
}
function stop(signal = "SIGTERM") { stopped = true; clearTimeout(timer); inFlight?.abort(); server.kill(signal); }
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop());
server.on("error", (error) => { console.error(error.message); stop(); process.exitCode = 1; });
server.on("exit", (code) => { stopped = true; clearTimeout(timer); inFlight?.abort(); process.exitCode = code ?? 0; });
timer = setTimeout(tick, 5000);
