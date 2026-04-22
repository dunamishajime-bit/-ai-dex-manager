import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

const APP_URL = process.env.AUTO_TRADE_RUN_URL?.trim() || "http://127.0.0.1:3000";
const RUN_SECRET = process.env.AUTO_TRADE_RUN_SECRET?.trim() || "";
const INTERVAL_MINUTES = Number(process.env.AUTO_TRADE_INTERVAL_MINUTES || 720);
const OFFSET_MINUTES = Number(process.env.AUTO_TRADE_OFFSET_MINUTES || 30);

function log(message, extra) {
  const stamp = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[auto-trade-scheduler] ${stamp} ${message}`);
    return;
  }
  console.log(`[auto-trade-scheduler] ${stamp} ${message}`, extra);
}

function msUntilNextRun() {
  const now = new Date();
  const next = new Date(now);
  next.setSeconds(0, 0);

  const offset = Math.max(0, OFFSET_MINUTES);
  const intervalMs = Math.max(1, INTERVAL_MINUTES) * 60_000;
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  let candidate = dayStart.getTime() + (offset * 60_000);
  while (candidate <= now.getTime()) {
    candidate += intervalMs;
  }

  next.setTime(candidate);

  return Math.max(5_000, next.getTime() - now.getTime());
}

async function runOnce() {
  const headers = { "Content-Type": "application/json" };
  if (RUN_SECRET) {
    headers.Authorization = `Bearer ${RUN_SECRET}`;
  }

  const response = await fetch(`${APP_URL}/api/system/auto-trade/run`, {
    method: "POST",
    headers,
  });

  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`run failed (${response.status}): ${JSON.stringify(data)}`);
  }

  log("run completed", data?.summary || data);
}

async function loop() {
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
  appUrl: APP_URL,
  intervalMinutes: INTERVAL_MINUTES,
  offsetMinutes: OFFSET_MINUTES,
  hasSecret: Boolean(RUN_SECRET),
});

await loop();
