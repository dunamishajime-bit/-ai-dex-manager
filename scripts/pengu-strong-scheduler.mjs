import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");

dotenv.config({ path: path.resolve(APP_DIR, ".env.local") });

const INTERVAL_MINUTES = Number(process.env.PENGU_STRONG_INTERVAL_MINUTES || 15);
const OFFSET_MINUTES = Number(process.env.PENGU_STRONG_OFFSET_MINUTES || 2);
const WORKER_TIMEOUT_MINUTES = Number(process.env.PENGU_STRONG_WORKER_TIMEOUT_MINUTES || 12);
const WORKER_NODE_OPTIONS = process.env.PENGU_STRONG_WORKER_NODE_OPTIONS || "--max-old-space-size=1536";
const LOCK_PATH = path.resolve(APP_DIR, "data", "pengu-strong-run.lock");
const HISTORY_PATH = path.resolve(APP_DIR, "data", "auto-trade-history.json");
const MONITOR_STATE_PATH = path.resolve(APP_DIR, "data", "pengu-strong-monitor-state.json");
const STALE_WARN_MINUTES = Number(process.env.PENGU_STRONG_STALE_WARN_MINUTES || 30);
const STALE_RECOVERY_MINUTES = Number(process.env.PENGU_STRONG_STALE_RECOVERY_MINUTES || 60);
const ALERT_COOLDOWN_MINUTES = Number(process.env.PENGU_STRONG_ALERT_COOLDOWN_MINUTES || 30);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const TSX_BIN = path.resolve(
  APP_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

function log(message, extra) {
  const stamp = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[pengu-strong-scheduler] ${stamp} ${message}`);
    return;
  }
  console.log(`[pengu-strong-scheduler] ${stamp} ${message}`, extra);
}

function cleanupWorkerLock(reason) {
  try {
    fs.unlinkSync(LOCK_PATH);
    log("worker lock cleaned", { reason, lockPath: LOCK_PATH });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      log("worker lock cleanup failed", error instanceof Error ? error.message : String(error));
    }
  }
}

function readJsonFile(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  } catch (error) {
    log("json write failed", { filePath, message: error instanceof Error ? error.message : String(error) });
  }
}

function latestPenguStrongRun() {
  const entries = readJsonFile(HISTORY_PATH, []);
  if (!Array.isArray(entries)) return null;
  return entries
    .filter((entry) => entry?.trigger === "pengu_15m" && entry?.executedAt)
    .sort((left, right) => new Date(right.executedAt).getTime() - new Date(left.executedAt).getTime())[0] || null;
}

function lockAgeMs() {
  try {
    const stat = fs.statSync(LOCK_PATH);
    return Date.now() - stat.mtimeMs;
  } catch {
    return null;
  }
}

function cleanupOrphanWorkerLock() {
  const lock = readJsonFile(LOCK_PATH, null);
  const pid = Number(lock?.pid || 0);
  if (!pid) return;
  try {
    process.kill(pid, 0);
  } catch {
    cleanupWorkerLock("orphan_pid");
  }
}

async function sendTelegramAlert(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log("telegram alert skipped", { reason: "missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID", message });
    return;
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        disable_web_page_preview: true,
      }),
    });
    if (!response.ok) {
      log("telegram alert failed", { status: response.status, body: await response.text().catch(() => "") });
    }
  } catch (error) {
    log("telegram alert failed", error instanceof Error ? error.message : String(error));
  }
}

async function monitorFreshness() {
  const latest = latestPenguStrongRun();
  const latestTime = latest?.executedAt ? new Date(latest.executedAt).getTime() : 0;
  const ageMs = latestTime > 0 ? Date.now() - latestTime : Infinity;
  const ageMinutes = Number.isFinite(ageMs) ? ageMs / 60000 : Infinity;
  const lockMs = lockAgeMs();
  const state = readJsonFile(MONITOR_STATE_PATH, {});
  const now = Date.now();
  const lastAlertAt = Number(state.lastAlertAt || 0);
  const alertReady = now - lastAlertAt >= ALERT_COOLDOWN_MINUTES * 60_000;

  if (ageMinutes < STALE_WARN_MINUTES) {
    if (state.lastAlertAt || state.lastRecoveryAt) {
      writeJsonFile(MONITOR_STATE_PATH, {
        lastHealthyAt: new Date().toISOString(),
        latestExecutedAt: latest?.executedAt || null,
      });
    }
    return false;
  }

  const ageLabel = Number.isFinite(ageMinutes) ? `${ageMinutes.toFixed(1)}分` : "履歴なし";
  if (alertReady) {
    await sendTelegramAlert([
      "DisDEX PENGU 15分判定の遅延を検知しました。",
      `最新実行: ${latest?.executedAt || "なし"}`,
      `経過: ${ageLabel}`,
      `ロック: ${lockMs == null ? "なし" : `${(lockMs / 60000).toFixed(1)}分`}`,
      `現在時刻: ${new Date().toISOString()}`,
    ].join("\n"));
    writeJsonFile(MONITOR_STATE_PATH, {
      ...state,
      lastAlertAt: now,
      lastAlertReason: "stale_pengu_15m",
      latestExecutedAt: latest?.executedAt || null,
    });
  }

  if (ageMinutes < STALE_RECOVERY_MINUTES) return false;

  const recoveryCooldownOk = now - Number(state.lastRecoveryAt || 0) >= STALE_RECOVERY_MINUTES * 60_000;
  if (!recoveryCooldownOk) return false;

  if (lockMs != null) cleanupWorkerLock("stale_monitor_recovery");
  writeJsonFile(MONITOR_STATE_PATH, {
    ...state,
    lastRecoveryAt: now,
    lastRecoveryReason: "stale_pengu_15m",
    latestExecutedAt: latest?.executedAt || null,
  });
  log("stale monitor requested immediate recovery run", { latestExecutedAt: latest?.executedAt || null, ageMinutes });
  return true;
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
  cleanupOrphanWorkerLock();
  await new Promise((resolve, reject) => {
    log("worker started", { script: "scripts/run-pengu-strong-once.ts", timeoutMinutes: WORKER_TIMEOUT_MINUTES });
    const child = spawn(TSX_BIN, ["scripts/run-pengu-strong-once.ts"], {
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
      cleanupWorkerLock("timeout");
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
        cleanupWorkerLock(`exit_${code}`);
        reject(new Error(`worker exited with code ${code}`));
      }
    });
  });
}

async function loop() {
  const shouldRecoverNow = await monitorFreshness();
  if (shouldRecoverNow) {
    try {
      await runOnce();
    } catch (error) {
      log("recovery run failed", error instanceof Error ? error.message : String(error));
    }
  }

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

log("scheduler started", {
  appDir: APP_DIR,
  intervalMinutes: INTERVAL_MINUTES,
  offsetMinutes: OFFSET_MINUTES,
  workerNodeOptions: WORKER_NODE_OPTIONS,
  mode: "worker",
});

cleanupOrphanWorkerLock();
await loop();
