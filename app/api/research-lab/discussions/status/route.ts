import fs from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");
const lockPath = path.join(stateDir, ".manual-run.lock");
const logPath = path.join(stateDir, "manual-run.log");

async function readJson(file: string) {
  try { return JSON.parse(await fs.readFile(path.join(stateDir, file), "utf8")) as Record<string, unknown>; } catch { return null; }
}

export async function GET() {
  const lockStat = await fs.stat(lockPath).catch(() => null);
  const lock = Boolean(lockStat && Date.now() - lockStat.mtimeMs < 30 * 60 * 1000);
  if (lockStat && !lock) await fs.unlink(lockPath).catch(() => undefined);
  const error = await readJson("last-error.json");
  const index = await readJson("discussions/index.json");
  const items = Array.isArray(index?.items) ? index.items : [];
  const latest = items[0] && typeof items[0] === "object" ? items[0] as Record<string, unknown> : null;
  const latestCompletedAt = typeof latest?.completedAt === "string" ? Date.parse(latest.completedAt) : NaN;
  const failedAt = typeof error?.failedAt === "string" ? Date.parse(error.failedAt) : NaN;
  const activeError = error && (!Number.isFinite(latestCompletedAt) || !Number.isFinite(failedAt) || failedAt > latestCompletedAt)
    ? { failedAt: error.failedAt, message: error.message }
    : null;
  let log = "";
  try { log = (await fs.readFile(logPath, "utf8")).slice(-6000); } catch { /* no log yet */ }
  return NextResponse.json({
    running: lock,
    cycle: typeof latest?.cycle === "number" ? latest.cycle : null,
    latestDiscussion: latest ? {
      id: latest.id, completedAt: latest.completedAt, messageCount: latest.messageCount,
      summary: latest.summary, decision: latest.decision,
    } : null,
    error: activeError,
    log,
  }, { headers: { "Cache-Control": "no-store" } });
}
