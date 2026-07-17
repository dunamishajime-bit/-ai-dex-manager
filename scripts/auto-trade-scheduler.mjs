import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(SCRIPT_DIR, "..");

dotenv.config({ path: path.resolve(APP_DIR, ".env.local") });
dotenv.config();

const CACHE_PATH = path.resolve(APP_DIR, "data", "live-decision-cache.json");
const MONITOR_STATE_PATH = path.resolve(APP_DIR, "data", "auto-trade-monitor-state.json");
const RUN_LOCK_PATH = path.resolve(APP_DIR, "data", "auto-trade-run.lock");
const RUNTIME_CONTROL_PATH = path.resolve(APP_DIR, "data", "auto-trade-runtime-control.json");
const WORKER_TIMEOUT_MINUTES = Number(process.env.AUTO_TRADE_WORKER_TIMEOUT_MINUTES || 90);
const WORKER_NODE_OPTIONS = process.env.AUTO_TRADE_WORKER_NODE_OPTIONS || "--max-old-space-size=1536";
const STALE_RECOVERY_MINUTES = Number(process.env.AUTO_TRADE_STALE_RECOVERY_MINUTES || 780);
const ALERT_COOLDOWN_MINUTES = Number(process.env.AUTO_TRADE_ALERT_COOLDOWN_MINUTES || 60);
const STALE_MONITOR_INTERVAL_MINUTES = Number(process.env.AUTO_TRADE_STALE_MONITOR_INTERVAL_MINUTES || 15);
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const TSX_BIN = path.resolve(
  APP_DIR,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx",
);

let staleRecoveryRunning = false;

function log(message, extra) {
  const stamp = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[auto-trade-scheduler] ${stamp} ${message}`);
    return;
  }
  console.log(`[auto-trade-scheduler] ${stamp} ${message}`, extra);
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

function removeOrphanRunLock() {
  const lock = readJsonFile(RUN_LOCK_PATH, null);
  const pid = Number(lock?.pid || 0);
  if (!pid) return;
  try {
    process.kill(pid, 0);
  } catch {
    try {
      fs.unlinkSync(RUN_LOCK_PATH);
      log("removed orphan worker lock", { pid });
    } catch (error) {
      log("failed to remove orphan worker lock", error instanceof Error ? error.message : String(error));
    }
  }
}

function loadRuntimeControl() {
  return readJsonFile(RUNTIME_CONTROL_PATH, {});
}

function isCombinedStrategyActive() {
  const runtime = loadRuntimeControl();
  return runtime?.activeStrategy === "combined_live" || runtime?.activeStrategy === "combined_dry_run";
}

function schedulerIntervalMinutes() {
  if (process.env.AUTO_TRADE_INTERVAL_MINUTES) {
    return Number(process.env.AUTO_TRADE_INTERVAL_MINUTES);
  }
  return isCombinedStrategyActive() ? 1 : 720;
}

function schedulerOffsetMinutes() {
  if (process.env.AUTO_TRADE_OFFSET_MINUTES) {
    return Number(process.env.AUTO_TRADE_OFFSET_MINUTES);
  }
  return isCombinedStrategyActive() ? 0 : 30;
}

function liveDecisionCacheAgeMinutes() {
  const cache = readJsonFile(CACHE_PATH, null);
  const cachedAt = Number(cache?.cachedAt || 0);
  if (!cachedAt) return Infinity;
  return (Date.now() - cachedAt) / 60000;
}

function latestLiveDecisionCache() {
  return readJsonFile(CACHE_PATH, null);
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

async function notifyStaleLiveDecision(cacheAge) {
  const state = readJsonFile(MONITOR_STATE_PATH, {});
  const now = Date.now();
  const lastAlertAt = Number(state.lastAlertAt || 0);
  if (now - lastAlertAt < ALERT_COOLDOWN_MINUTES * 60_000) return;

  const cache = latestLiveDecisionCache();
  const ageLabel = Number.isFinite(cacheAge) ? `${cacheAge.toFixed(1)}分` : "履歴なし";
  const cachedAt = cache?.cachedAt ? new Date(Number(cache.cachedAt)).toISOString() : "なし";
  const decisionTime = cache?.details?.decision?.isoTime || "なし";
  const desired = cache?.details?.decision?.desiredSymbol || "なし";
  const current = cache?.walletDecision?.currentSymbol || "なし";

  await sendTelegramAlert([
    "DisDEX 12H判定キャッシュの遅延を検知しました。",
    `最新キャッシュ: ${cachedAt}`,
    `12H判定時刻: ${decisionTime}`,
    `経過: ${ageLabel}`,
    `候補: ${desired}`,
    `現在保有: ${current}`,
    "復旧用12Hワーカーを起動します。",
  ].join("\n"));

  writeJsonFile(MONITOR_STATE_PATH, {
    ...state,
    lastAlertAt: now,
    lastAlertReason: "stale_12h_live_decision",
    latestCachedAt: cachedAt,
    latestDecisionTime: decisionTime,
  });
}

function msUntilNextRun() {
  const now = new Date();
  const offset = Math.max(0, schedulerOffsetMinutes());
  const intervalMs = Math.max(1, schedulerIntervalMinutes()) * 60_000;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  let candidate = dayStart.getTime() + (offset * 60_000);
  while (candidate <= now.getTime()) {
    candidate += intervalMs;
  }

  return Math.max(5_000, candidate - now.getTime());
}

async function runOnce() {
  removeOrphanRunLock();
  await new Promise((resolve, reject) => {
    log("worker started", { script: "scripts/run-active-autotrade-once.ts", timeoutMinutes: WORKER_TIMEOUT_MINUTES });
    const child = spawn(TSX_BIN, ["scripts/run-active-autotrade-once.ts"], {
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
      removeOrphanRunLock();
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

async function recoverStaleLiveDecision(reason) {
  const cacheAge = liveDecisionCacheAgeMinutes();
  if (cacheAge < STALE_RECOVERY_MINUTES) return false;
  if (staleRecoveryRunning) {
    log("stale recovery skipped because a recovery worker is already running", { reason });
    return false;
  }

  staleRecoveryRunning = true;
  log("live decision cache is stale; running recovery worker", {
    reason,
    ageMinutes: Number.isFinite(cacheAge) ? cacheAge.toFixed(1) : "unknown",
  });
  try {
    await notifyStaleLiveDecision(cacheAge);
    await runOnce();
    return true;
  } catch (error) {
    log("stale recovery run failed", error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    staleRecoveryRunning = false;
  }
}

async function loop() {
  await recoverStaleLiveDecision("scheduler_loop");

  const waitMs = msUntilNextRun();
  const waitMinutes = (waitMs / 60000).toFixed(2);
  log(`next run scheduled in ${waitMinutes} minutes`);
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
  intervalMinutes: schedulerIntervalMinutes(),
  offsetMinutes: schedulerOffsetMinutes(),
  workerNodeOptions: WORKER_NODE_OPTIONS,
  timeoutMinutes: WORKER_TIMEOUT_MINUTES,
  staleRecoveryMinutes: STALE_RECOVERY_MINUTES,
  alertCooldownMinutes: ALERT_COOLDOWN_MINUTES,
  staleMonitorIntervalMinutes: STALE_MONITOR_INTERVAL_MINUTES,
  mode: "worker",
});

setInterval(() => {
  recoverStaleLiveDecision("periodic_monitor").catch((error) => {
    log("periodic stale monitor failed", error instanceof Error ? error.message : String(error));
  });
}, Math.max(1, STALE_MONITOR_INTERVAL_MINUTES) * 60_000);

await loop();
