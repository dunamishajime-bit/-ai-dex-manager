import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");

dotenv.config({ path: path.resolve(APP_DIR, ".env.local") });
dotenv.config();

const INTERVAL_MINUTES = Number(process.env.INJ_SPRING_INTERVAL_MINUTES || 60);
const OFFSET_MINUTES = Number(process.env.INJ_SPRING_OFFSET_MINUTES || 5);
const WORKER_TIMEOUT_MINUTES = Number(process.env.INJ_SPRING_WORKER_TIMEOUT_MINUTES || 20);
const WORKER_NODE_OPTIONS = process.env.INJ_SPRING_WORKER_NODE_OPTIONS || "--max-old-space-size=1200";
const TSX_BIN = path.resolve(
  APP_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

function log(message, extra) {
  const stamp = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[inj-spring-scheduler] ${stamp} ${message}`);
    return;
  }
  console.log(`[inj-spring-scheduler] ${stamp} ${message}`, extra);
}

function msUntilNextRun() {
  const now = new Date();
  const intervalMs = Math.max(1, INTERVAL_MINUTES) * 60_000;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  let candidate = dayStart.getTime() + (Math.max(0, OFFSET_MINUTES) * 60_000);
  while (candidate <= now.getTime()) {
    candidate += intervalMs;
  }

  return Math.max(5_000, candidate - now.getTime());
}

async function runOnce() {
  await new Promise((resolve, reject) => {
    log("worker started", { script: "scripts/run-inj-spring-once.ts", timeoutMinutes: WORKER_TIMEOUT_MINUTES });
    const child = spawn(TSX_BIN, ["scripts/run-inj-spring-once.ts"], {
      cwd: APP_DIR,
      env: {
        ...process.env,
        NODE_OPTIONS: [process.env.NODE_OPTIONS, WORKER_NODE_OPTIONS].filter(Boolean).join(" "),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`worker timed out after ${WORKER_TIMEOUT_MINUTES} minutes`));
    }, Math.max(1, WORKER_TIMEOUT_MINUTES) * 60_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stdout.trim()) log("worker output", stdout.trim().slice(-4000));
      if (stderr.trim()) log("worker stderr", stderr.trim().slice(-4000));
      if (code === 0) {
        resolve(null);
      } else {
        reject(new Error(`worker exited with code ${code}`));
      }
    });
  });
}

async function loop() {
  const waitMs = msUntilNextRun();
  log(`next run scheduled in ${(waitMs / 60000).toFixed(2)} minutes`);
  setTimeout(async () => {
    try {
      await runOnce();
    } catch (error) {
      log("run failed", error instanceof Error ? error.message : String(error));
    } finally {
      await loop();
    }
  }, waitMs);
}

loop().catch((error) => {
  log("fatal loop error", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
