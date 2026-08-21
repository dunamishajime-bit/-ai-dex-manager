import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

import { V12_X1_ALL, resolveV12X1AllRuntime } from "@/config/v12X1AllRuntime";
import { AsterV3Client } from "@/lib/aster-v3-client";
import { V12AsterMarketDataProvider } from "@/lib/v12-aster-market-data-provider";
import { buildV12Signals, computeV12Regime, evaluateV12Candidate } from "@/lib/v12-x1-all";
import type { V12X1AllRunnerState } from "@/lib/v12-x1-all-runner-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readJson<T>(path: string): Promise<T | null> {
  try { return JSON.parse(await readFile(resolve(path), "utf8")) as T; } catch { return null; }
}

export async function GET() {
  const runtime = resolveV12X1AllRuntime();
  const state = await readJson<V12X1AllRunnerState>(runtime.statePath);
  const risk = await readJson<Record<string, unknown>>(runtime.riskPath);
  const riskSourceComplete = risk?.sourceComplete === true;
  const riskTripped = risk?.tripped === true;
  const riskUpdatedAt = risk?.updatedAt || risk?.asOf || null;
  const riskHealthy = Boolean(risk && riskSourceComplete && !riskTripped && Number(riskUpdatedAt) > 0);
  const base = {
    ok: true,
    generatedAt: new Date().toISOString(),
    strategyId: V12_X1_ALL.strategyId,
    mode: runtime.mode,
    enabled: runtime.enabled,
    liveTradingEnabled: runtime.liveTradingEnabled,
    liveExecutionEnabled: runtime.liveExecutionEnabled,
    caps: { v12Aggregate: runtime.aggregateEntryGrossCap, v12PerPosition: runtime.perPositionEntryGrossCap, maximumPositions: runtime.maximumPositions, crypto: 1.5, portfolio: 2.5 },
    state: { activePositions: state?.activePositions || (state?.active ? [state.active] : []), pending: state?.pending || null, killSwitch: state?.killSwitch || null, manualReview: state?.manualReview || null },
    risk: risk ? {
      ok: riskHealthy,
      reason: riskHealthy ? null : (riskTripped ? "SHARED_CRYPTO_DAILY_LOSS_TRIPPED" : riskSourceComplete ? "RISK_STATE_INVALID" : "RISK_STATE_INCOMPLETE"),
      updatedAt: riskUpdatedAt,
      lossPct: Number(risk.lossPct || 0),
      maximumLossPct: Number(risk.maximumLossPct || 0),
      tripped: riskTripped,
      sourceComplete: riskSourceComplete,
      netDailyPnl: Number(risk.netDailyPnl || 0),
    } : { ok: false, reason: "RISK_STATE_UNAVAILABLE", updatedAt: null, lossPct: null, maximumLossPct: null, tripped: null, sourceComplete: false, netDailyPnl: null },
  };
  try {
    const client = new AsterV3Client({ baseUrl: process.env.ASTER_FUTURES_BASE_URL, userAgent: "DisDex-HP-V12-Status/1.0" });
    const data = await new V12AsterMarketDataProvider(client, { hourlyLimit: Number(process.env.V12_X1_ALL_HOURLY_LIMIT || 500) }).load();
    const lengths = Object.values(data).map((bars) => bars.length);
    const index = Math.min(...lengths) - 1;
    const btc = data.BTC;
    const regime = computeV12Regime(btc, index);
    const candidates = V12_X1_ALL.universe.filter((symbol) => symbol !== "BTC").map((symbol) => evaluateV12Candidate(symbol, data[symbol], index, regime));
    const signals = buildV12Signals(data, index).map((signal, rank) => ({ symbol: signal.symbol, side: signal.side, score: signal.score, rank: rank + 1, entryTs: signal.entryTs, referenceTs: signal.referenceTs }));
    return NextResponse.json({ ...base, market: { source: "ASTER_FUTURES_V3_PUBLIC_KLINES", index, referenceTs: btc[index]?.endTs || null, regime, candidates, signals } });
  } catch (error) {
    return NextResponse.json({ ...base, market: { source: "ASTER_FUTURES_V3_PUBLIC_KLINES", unavailable: true, reason: error instanceof Error ? error.message : String(error), candidates: [], signals: [] } });
  }
}
