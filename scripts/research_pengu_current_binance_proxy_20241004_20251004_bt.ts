import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { PENGU_DUAL_LS_V2 } from "../config/penguDualLsV2Runtime";
import { PENGU_RECOVERY_V8 } from "../config/penguRecoveryV8";
import {
  buildPenguDualLsV2EvaluationSeries,
  cooldownHoursForPenguExit,
  evaluatePenguDualLsV2PositionBar,
  isPenguV8V64DynamicLongSignal,
  penguV8V64RequestedLongGross,
  selectPenguRecoveryV8Entry,
  targetGrossForAtr,
  type PenguDualLsV2EvaluationRow,
  type PenguDualLsV2Features,
  type PenguDualLsV2History,
  type PenguDualLsV2Position,
} from "../lib/pengu-dual-ls-v2";
import { createPenguShortV20State } from "../lib/pengu-short-v20";
import { evaluateRecoveryV8PositionBar, type RecoveryV8FeatureRow } from "../lib/pengu-recovery-v8";
import {
  createPenguRiskOverlayState,
  evaluatePenguNewEntryGate,
  recordPenguClosedTrade,
  recordPenguHardStop,
  routeForPenguEntryVersion,
  type PenguRiskOverlayState,
  type PenguRiskRoute,
} from "../lib/pengu-route-quarantine-dd-governor";
import type { DisDexV35Candle } from "../lib/disdex-v35-signal-engine";

const HOUR = 3_600_000;
const SOURCE_SHA = "53eeff5417636369d4709fddfd47d7916ddcf3b1";
const WARM_START = Date.parse("2024-09-01T00:00:00Z");
const EVAL_START = Date.parse("2024-10-04T00:00:00Z");
const EVAL_END = Date.parse("2025-10-04T00:00:00Z");
const BASE_URL = "https://fapi.binance.com";
const NORMAL_FEE_PER_SIDE = 0.0006;
const STRESS_EXTRA_PER_SIDE = 0.0035;
const OUT = process.env.PENGU_CURRENT_BT_OUT || ".research-state/pengu-current-binance-proxy-20241004-20251004-bt.json";

type Mode = "normal" | "stress";
type Funding = { fundingTime: number; fundingRate: number };
type EntryVersion = "LONG_V2_FINAL" | "SHORT_V20" | "RECOVERY_V8";

type Trade = {
  route: PenguRiskRoute;
  entryVersion: EntryVersion;
  side: "LONG" | "SHORT";
  signalTs: number;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  requestedGross: number;
  exitReason: string;
  rawUnitReturn: number;
  fundingUnitReturn: number;
  costUnitReturn: number;
  accountReturn: number;
  counterwind?: boolean;
  partialDefense?: { gross: number; exitTs: number; exitPrice: number; accountReturn: number };
  entryFeatures: PenguDualLsV2Features;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchAny(url: URL) {
  let last: unknown;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "DisDex-PENGU-current-window-BinanceProxy-BT/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      return await response.json();
    } catch (error) {
      last = error;
      await sleep(600 * (attempt + 1));
    }
  }
  throw new Error(`ASTER_FETCH_FAILED:${last instanceof Error ? last.message : String(last)}`);
}

async function downloadCandles(symbol: string) {
  const rows: DisDexV35Candle[] = [];
  let cursor = WARM_START;
  while (cursor < EVAL_END) {
    const url = new URL("/fapi/v1/klines", BASE_URL);
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", "1h");
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(EVAL_END - 1));
    url.searchParams.set("limit", "1500");
    const batch = await fetchAny(url) as unknown[][];
    if (!Array.isArray(batch) || !batch.length) break;
    for (const raw of batch) {
      const openTime = Number(raw[0]);
      const row: DisDexV35Candle = {
        openTime,
        open: Number(raw[1]), high: Number(raw[2]), low: Number(raw[3]), close: Number(raw[4]), volume: Number(raw[5]),
        closeTime: Number(raw[6] ?? openTime + HOUR - 1),
      };
      if (openTime >= WARM_START && openTime < EVAL_END && [row.open, row.high, row.low, row.close, row.volume, row.closeTime].every(Number.isFinite)) rows.push(row);
    }
    const next = Number(batch.at(-1)?.[0]) + HOUR;
    if (!(next > cursor)) throw new Error(`${symbol}_PAGINATION_STALLED`);
    cursor = next;
    await sleep(80);
  }
  return [...new Map(rows.map((r) => [r.openTime, r])).values()].sort((a, b) => a.openTime - b.openTime);
}

async function downloadFunding() {
  const rows: Funding[] = [];
  let cursor = WARM_START;
  while (cursor < EVAL_END) {
    const url = new URL("/fapi/v1/fundingRate", BASE_URL);
    url.searchParams.set("symbol", "PENGUUSDT");
    url.searchParams.set("startTime", String(cursor));
    url.searchParams.set("endTime", String(EVAL_END - 1));
    url.searchParams.set("limit", "1000");
    const batch = await fetchAny(url) as Array<{ fundingTime?: unknown; fundingRate?: unknown }>;
    if (!Array.isArray(batch) || !batch.length) break;
    for (const raw of batch) {
      const fundingTime = Number(raw.fundingTime), fundingRate = Number(raw.fundingRate);
      if (fundingTime >= WARM_START && fundingTime < EVAL_END && Number.isFinite(fundingRate)) rows.push({ fundingTime, fundingRate });
    }
    const next = Number(batch.at(-1)?.fundingTime) + 1;
    if (!(next > cursor)) throw new Error("FUNDING_PAGINATION_STALLED");
    cursor = next;
    await sleep(80);
  }
  return [...new Map(rows.map((r) => [r.fundingTime, r])).values()].sort((a, b) => a.fundingTime - b.fundingTime);
}

function fundingBetween(points: Funding[], entryTs: number, exitTs: number) {
  return points.filter((p) => p.fundingTime > entryTs && p.fundingTime <= exitTs).reduce((s, p) => s + p.fundingRate, 0);
}

function metrics(trades: Trade[]) {
  let equity = 1, peak = 1, maxDd = 0, gp = 0, gl = 0;
  for (const t of trades) {
    equity *= 1 + t.accountReturn;
    peak = Math.max(peak, equity);
    maxDd = Math.min(maxDd, equity / peak - 1);
    if (t.accountReturn > 0) gp += t.accountReturn; else gl -= t.accountReturn;
  }
  return {
    trades: trades.length,
    returnPct: (equity - 1) * 100,
    profitFactor: gl > 0 ? gp / gl : null,
    maxDrawdownPct: maxDd * 100,
    winRatePct: trades.length ? trades.filter((t) => t.accountReturn > 0).length / trades.length * 100 : null,
    longTrades: trades.filter((t) => t.side === "LONG").length,
    shortTrades: trades.filter((t) => t.side === "SHORT").length,
    shortV20Trades: trades.filter((t) => t.entryVersion === "SHORT_V20").length,
    recoveryV8Trades: trades.filter((t) => t.entryVersion === "RECOVERY_V8").length,
    hardStops: trades.filter((t) => t.exitReason.includes("HARD_STOP")).length,
  };
}

function cohort(trades: Trade[]) {
  const m = metrics(trades);
  return {
    ...m,
    avgReturnPct: trades.length ? trades.reduce((s, t) => s + t.accountReturn, 0) / trades.length * 100 : null,
    medianReturnPct: trades.length ? [...trades].sort((a,b)=>a.accountReturn-b.accountReturn)[Math.floor(trades.length/2)].accountReturn*100 : null,
  };
}

function recoveryRowForLive(row: PenguDualLsV2EvaluationRow, v64Long: boolean): RecoveryV8FeatureRow | undefined {
  return row.recoveryV8 ? { ...row.recoveryV8, ordinaryLongEligible: v64Long, baseLongSignal: v64Long } : undefined;
}

function isHard(reason: string) {
  return reason === "LONG_HARD_STOP" || reason === "SHORT_HARD_STOP" || reason === "RECOVERY_V8_HARD_STOP";
}

function replay(rows: PenguDualLsV2EvaluationRow[], funding: Funding[], mode: Mode) {
  const costPerSide = NORMAL_FEE_PER_SIDE + (mode === "stress" ? STRESS_EXTRA_PER_SIDE : 0);
  let risk: PenguRiskOverlayState = createPenguRiskOverlayState();
  let position: PenguDualLsV2Position | undefined;
  let route: PenguRiskRoute | undefined;
  let entryFeatures: PenguDualLsV2Features | undefined;
  let signalTs = 0;
  let partial: Trade["partialDefense"] | undefined;
  let cooldownUntilTs = 0;
  const trades: Trade[] = [];
  const blocked = { cooldown: 0, routeQuarantine: 0, ddHold: 0, noData: 0 };

  const closeTrade = (input: {
    row: PenguDualLsV2EvaluationRow;
    exitPrice: number;
    exitReason: string;
    positionBefore: PenguDualLsV2Position;
  }) => {
    assert(route && entryFeatures);
    const p = input.positionBefore;
    const exitTs = input.row.candle.openTime;
    const side = p.side > 0 ? "LONG" as const : "SHORT" as const;
    let accountReturn = 0, rawUnitReturn = 0, fundingUnitReturn = 0, costUnitReturn = 0;

    if (p.entryVersion === "RECOVERY_V8" && partial) {
      const remainingGross = PENGU_RECOVERY_V8.partial.remainingGross;
      const rawRemaining = input.exitPrice / p.entryPrice - 1;
      const fundRemaining = -fundingBetween(funding, p.entryTs, exitTs);
      const costRemaining = -2 * costPerSide;
      const remainingReturn = remainingGross * (rawRemaining + fundRemaining + costRemaining);
      accountReturn = partial.accountReturn + remainingReturn;
      rawUnitReturn = (partial.gross * (partial.exitPrice / p.entryPrice - 1) + remainingGross * rawRemaining) / PENGU_RECOVERY_V8.initialGross;
      fundingUnitReturn = (partial.gross * (-fundingBetween(funding, p.entryTs, partial.exitTs)) + remainingGross * fundRemaining) / PENGU_RECOVERY_V8.initialGross;
      costUnitReturn = -2 * costPerSide;
    } else {
      rawUnitReturn = side === "LONG" ? input.exitPrice / p.entryPrice - 1 : p.entryPrice / input.exitPrice - 1;
      const fundingRate = fundingBetween(funding, p.entryTs, exitTs);
      fundingUnitReturn = side === "LONG" ? -fundingRate : fundingRate;
      costUnitReturn = -2 * costPerSide;
      accountReturn = p.gross * (rawUnitReturn + fundingUnitReturn + costUnitReturn);
    }

    const trade: Trade = {
      route,
      entryVersion: (p.entryVersion === "LEGACY_V2" ? "LONG_V2_FINAL" : p.entryVersion) as EntryVersion,
      side,
      signalTs,
      entryTs: p.entryTs,
      exitTs,
      entryPrice: p.entryPrice,
      exitPrice: input.exitPrice,
      requestedGross: p.gross,
      exitReason: input.exitReason,
      rawUnitReturn,
      fundingUnitReturn,
      costUnitReturn,
      accountReturn,
      counterwind: p.shortV20?.counterwind,
      partialDefense: partial,
      entryFeatures,
    };
    if (trade.entryTs >= EVAL_START && trade.entryTs < EVAL_END) trades.push(trade);

    risk = recordPenguClosedTrade(risk, route, accountReturn, exitTs);
    if (isHard(input.exitReason)) risk = recordPenguHardStop(risk, route, exitTs);
    cooldownUntilTs = input.row.candle.openTime + cooldownHoursForPenguExit(input.exitReason as any) * HOUR;
    position = undefined; route = undefined; entryFeatures = undefined; partial = undefined; signalTs = 0;
  };

  for (let i = 180; i < rows.length - 1; i += 1) {
    const row = rows[i];
    const f = row.features;
    if (!f) { blocked.noData += 1; continue; }
    const v64Long = isPenguV8V64DynamicLongSignal(rows, i);
    const recoveryRow = recoveryRowForLive(row, v64Long);

    if (position) {
      if (position.entryVersion === "RECOVERY_V8" && position.recoveryV8 && recoveryRow) {
        const before = position;
        const ev = evaluateRecoveryV8PositionBar(position.recoveryV8, recoveryRow);
        if (ev.events.includes("PARTIAL_DEFENSE") && !partial && ev.triggerPrice) {
          const gross = PENGU_RECOVERY_V8.partial.gross;
          const exitTs = row.candle.openTime;
          const raw = ev.triggerPrice / before.entryPrice - 1;
          const fund = -fundingBetween(funding, before.entryTs, exitTs);
          const cost = -2 * costPerSide;
          partial = { gross, exitTs, exitPrice: ev.triggerPrice, accountReturn: gross * (raw + fund + cost) };
        }
        position = { ...position, quantity: ev.updatedPosition.quantity, recoveryV8: { ...position.recoveryV8, ...ev.updatedPosition } };
        if (ev.kind === "HARD_STOP" || ev.kind === "TRAILING_STOP" || ev.kind === "MAX_HOLD" || ev.kind === "YIELD_BASE_LONG") {
          closeTrade({
            row,
            exitPrice: ev.stopPrice ?? row.candle.close,
            exitReason: ev.kind === "HARD_STOP" ? "RECOVERY_V8_HARD_STOP"
              : ev.kind === "TRAILING_STOP" ? "RECOVERY_V8_TRAILING_STOP"
              : ev.kind === "MAX_HOLD" ? "RECOVERY_V8_MAX_HOLD" : "RECOVERY_V8_YIELD_BASE_LONG",
            positionBefore: before,
          });
        }
        continue;
      }

      const before = position;
      const ev = evaluatePenguDualLsV2PositionBar(position, f);
      position = ev.updatedPosition;
      if (ev.exit) closeTrade({ row, exitPrice: ev.exit.stopPrice ?? row.candle.close, exitReason: ev.exit.reason, positionBefore: before });
      continue;
    }

    if (f.referenceTs < cooldownUntilTs) { blocked.cooldown += 1; continue; }

    let entryVersion: EntryVersion | undefined;
    let side: 1 | -1 | undefined;
    let targetGross = 0;

    if (row.shortSignal) {
      entryVersion = "SHORT_V20"; side = -1; targetGross = targetGrossForAtr(f.atr24Ratio);
    } else if (v64Long) {
      entryVersion = "LONG_V2_FINAL"; side = 1; targetGross = penguV8V64RequestedLongGross(f);
    } else if (recoveryRow) {
      const rec = selectPenguRecoveryV8Entry(recoveryRow, true);
      if (rec?.kind === "RECOVERY_V8") {
        entryVersion = "RECOVERY_V8"; side = 1; targetGross = rec.gross;
      }
    }
    if (!entryVersion || !side || !(targetGross > 0)) continue;

    const candidateRoute = routeForPenguEntryVersion(entryVersion);
    const gate = evaluatePenguNewEntryGate(risk, candidateRoute, f.referenceTs);
    if (!gate.allowed) {
      if (gate.reason === "PENGU_ROUTE_QUARANTINED") blocked.routeQuarantine += 1;
      else if (gate.reason === "PENGU_REALIZED_DD_HOLD") blocked.ddHold += 1;
      continue;
    }

    const entry = rows[i + 1].candle;
    if (!(entry.openTime < EVAL_END)) continue;
    signalTs = f.referenceTs;
    entryFeatures = { ...f };
    route = candidateRoute;
    if (entryVersion === "RECOVERY_V8") {
      position = {
        side: 1, entryTs: entry.openTime, entryPrice: entry.open, quantity: 1, gross: targetGross,
        highWaterMark: entry.open, lowWaterMark: entry.open, entryVersion,
        recoveryV8: {
          version: "RECOVERY_V8", side: 1, entryTs: entry.openTime, entryPrice: entry.open,
          quantity: 1, originalQuantity: 1, originalGross: PENGU_RECOVERY_V8.initialGross,
          remainingGross: PENGU_RECOVERY_V8.initialGross, partialDefenseTriggered: false,
          highWaterMark: entry.open, logicalEntryPrice: entry.open, recoveryExecutionPrice: entry.open,
          protectionLifecycle: "FULL_HARD_STOP",
        },
      };
    } else {
      position = {
        side, entryTs: entry.openTime, entryPrice: entry.open, quantity: 1, gross: targetGross,
        highWaterMark: entry.open, lowWaterMark: entry.open, entryVersion,
        shortV20: entryVersion === "SHORT_V20" ? createPenguShortV20State({
          entryPrice: entry.open, requestedGross: targetGross, entryAtr24Ratio: f.atr24Ratio,
          btcEma168Distance: f.btcEma168Distance, btcReturn24h: f.btcReturn24h,
        }) : undefined,
      };
    }
  }

  return { trades, metrics: metrics(trades), blocked, endingRisk: risk };
}

async function main() {
  assert.equal(PENGU_DUAL_LS_V2.id, "PENGU_DUAL_LS_V2_FINAL");
  assert.equal(PENGU_DUAL_LS_V2.logicProfile, "COMBINED_FILTERED_Q60_DD17_H72");
  assert.equal(PENGU_RECOVERY_V8.rule, "R_BTC3");
  assert.equal(PENGU_RECOVERY_V8.priority, "SHORT_FIRST");

  const [penguRaw, btcRaw, funding] = await Promise.all([downloadCandles("PENGUUSDT"), downloadCandles("BTCUSDT"), downloadFunding()]);
  const btcTs = new Set(btcRaw.map((r) => r.openTime));
  const pengu = penguRaw.filter((r) => btcTs.has(r.openTime));
  const penguTs = new Set(pengu.map((r) => r.openTime));
  const btc = btcRaw.filter((r) => penguTs.has(r.openTime));
  assert.equal(pengu.length, btc.length);
  assert.ok(pengu.length >= 250, `Insufficient common PENGU/BTC rows: ${pengu.length}`);

  const history: PenguDualLsV2History = { pengu1h: pengu, btc1h: btc, penguFunding: funding };
  const rows = buildPenguDualLsV2EvaluationSeries(history, EVAL_END + HOUR);
  const normal = replay(rows, funding, "normal");
  const stress = replay(rows, funding, "stress");

  const currentPattern = (t: Trade) => t.entryVersion === "SHORT_V20"
    && t.entryFeatures.btcEma168Distance >= 0
    && t.entryFeatures.btcReturn24h < 0;
  const counterwind = (t: Trade) => t.entryVersion === "SHORT_V20" && t.counterwind === true;
  const nonCounterwind = (t: Trade) => t.entryVersion === "SHORT_V20" && t.counterwind === false;

  const payload = {
    schema: "pengu-current-production-binance-proxy-window-bt/v1",
    productionSourceSha: SOURCE_SHA,
    strategyId: PENGU_DUAL_LS_V2.id,
    logicProfile: PENGU_DUAL_LS_V2.logicProfile,
    period: { startInclusive: new Date(EVAL_START).toISOString(), endExclusive: new Date(EVAL_END).toISOString() },
    data: {
      requestedWarmStart: new Date(WARM_START).toISOString(),
      availableStart: new Date(pengu[0].openTime).toISOString(),
      availableEndExclusive: new Date(pengu.at(-1)!.openTime + HOUR).toISOString(),
      commonH1Rows: pengu.length,
      fundingRows: funding.length,
      note: "SUPPLEMENTARY_PROXY_ONLY: No pre-listing data is synthesized; only common Binance USDM PENGU/BTC H1 rows are replayed. Production logic remains SHA 53eeff54 but venue data is not Aster.",
    },
    productionContract: {
      recoveryV8Enabled: true,
      v64DynamicLongEnabled: true,
      recoveryRule: PENGU_RECOVERY_V8.rule,
      recoveryPriority: PENGU_RECOVERY_V8.priority,
      recoveryInitialGross: PENGU_RECOVERY_V8.initialGross,
      routeQuarantineHours: PENGU_DUAL_LS_V2.routeHardStopQuarantineHours,
      realizedDdThresholdPct: PENGU_DUAL_LS_V2.realizedDrawdownThresholdPct,
      realizedDdHoldHours: PENGU_DUAL_LS_V2.realizedDrawdownHoldHours,
      shortHardStopPct: PENGU_DUAL_LS_V2.short.hardStopPct,
      shortMaxHoldHours: PENGU_DUAL_LS_V2.short.maxHoldHours,
    },
    costs: {
      normalFeeBpsPerSide: NORMAL_FEE_PER_SIDE * 10_000,
      stressAdditionalAdverseBpsPerSide: STRESS_EXTRA_PER_SIDE * 10_000,
      actualFunding: true,
    },
    normal: {
      metrics: normal.metrics,
      blocked: normal.blocked,
      routes: {
        shortV20: cohort(normal.trades.filter((t) => t.entryVersion === "SHORT_V20")),
        longV64: cohort(normal.trades.filter((t) => t.entryVersion === "LONG_V2_FINAL")),
        recoveryV8: cohort(normal.trades.filter((t) => t.entryVersion === "RECOVERY_V8")),
      },
      shortDiagnostics: {
        counterwind: cohort(normal.trades.filter(counterwind)),
        nonCounterwind: cohort(normal.trades.filter(nonCounterwind)),
        currentPattern_btcAboveEma_btc24Negative: cohort(normal.trades.filter(currentPattern)),
      },
      trades: normal.trades,
    },
    stress: {
      metrics: stress.metrics,
      blocked: stress.blocked,
      routes: {
        shortV20: cohort(stress.trades.filter((t) => t.entryVersion === "SHORT_V20")),
        longV64: cohort(stress.trades.filter((t) => t.entryVersion === "LONG_V2_FINAL")),
        recoveryV8: cohort(stress.trades.filter((t) => t.entryVersion === "RECOVERY_V8")),
      },
    },
    safety: { researchOnly: true, ordersSent: false, liveChanged: false, vpsChanged: false, productionChanged: false },
  };

  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log("PENGU_BINANCE_PROXY_WINDOW_BT=" + JSON.stringify({
    period: payload.period, data: payload.data, normal: payload.normal.metrics, stress: payload.stress.metrics,
    routes: payload.normal.routes, shortDiagnostics: payload.normal.shortDiagnostics, blocked: payload.normal.blocked,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
