import fs from "fs/promises";
import path from "path";

import type { Candle1h } from "../lib/backtest/types";
import { loadPerpMarketData } from "../lib/research-lab/perp/data-store";
import { runPerpBacktest } from "../lib/research-lab/perp/engine";
import { normalBacktestSummary } from "../lib/research-lab/perp/latency-stress";
import type { PerpBar, PerpExecutionAssumptions, PerpMarketData, PerpSide, PerpStrategyGenome } from "../lib/research-lab/perp/types";

const HOUR = 60 * 60 * 1000;
const STARTING_EQUITY = 10_000;
const START = Date.UTC(2023, 6, 1);
const DEV_END = Date.UTC(2024, 6, 1);
const VAL_END = Date.UTC(2025, 6, 1);
const END = Date.UTC(2026, 6, 1);
const WARMUP_START = START - 180 * 24 * HOUR;
const TARGET_MONTHLY = 6;
const UNIVERSE = ["BTC", "ETH", "BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"];
const NORMAL: PerpExecutionAssumptions = { feeBpsPerSide: 5, slippageBpsPerSide: 0, adverseFundingBpsPer8h: 0, maintenanceMarginRate: 0.005 };

const V26: PerpStrategyGenome = {
  id: "v26-v9-resident-stop",
  generation: 20,
  parentIds: ["v26-v8-resident-exit"],
  createdBy: "quant-regime",
  family: "relative_strength",
  thesis: "Freeze V26 alpha and model Aster-compatible venue-resident STOP_MARKET protection. The last accepted stop remains live during control-plane interruption; only stop updates are delayed.",
  symbols: [...UNIVERSE],
  parameters: {
    timeframeHours: 2, leverage: 1, riskPerTradePct: 3.19, maxMarginUsagePct: 100,
    btcRegimeSmaBars: 53, btcRegimeMomentumBars: 52, regimeThresholdPct: 0.0377,
    momentumBars: 45, breakoutBars: 18, breakoutBufferPct: 0.0233, minimumMomentumPct: 0.0227,
    minimumVolumeRatio: 0.9845, minimumEdgeToCostRatio: 6.0879, volatilityLookbackBars: 15,
    volatilityPenalty: 2.3953, atrBars: 31, stopAtr: 2.477, takeProfitAtr: 3.1995, trailingAtr: 0.4,
    maxHoldBars: 23, rebalanceBars: 20, cooldownBars: 1, allowLong: true, allowShort: true,
    allowNeutralRegime: true, neutralScoreThreshold: 1.4649,
  },
};

type Prepared = {
  bySymbol: Record<string, PerpBar[]>;
  indexes: Record<string, Map<number, number>>;
  oneHourIndexes: Record<string, Map<number, number>>;
  timeline: number[];
};
type Candidate = { symbol: string; side: PerpSide; score: number; atr: number; signalTs: number };
type StopUpdate = { price: number; remainingBars: number };
type Position = {
  tradeId: string; symbol: string; side: PerpSide; decisionEntryTs: number; actualEntryTs: number; entryPrice: number;
  quantity: number; notional: number; effectiveLeverage: number; entryFee: number; fundingCost: number; lastFundingTs: number;
  initialStopPrice: number; residentStopPrice: number; takeProfitPrice: number; liquidationPrice: number;
  peakPrice: number; troughPrice: number; atrAtEntry: number; holdingBars: number; stopQueue: StopUpdate[];
};
type Trade = { symbol: string; side: PerpSide; netPnl: number; exitReason: string; liquidated: boolean; effectiveLeverage: number };
type RunMode = { label: string; entryDelayHours: 0 | 1; stopUpdateLagBars: 0 | 1; feeBpsPerSide: number; slippageBpsPerSide: number };

function mean(values: number[]) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function std(values: number[]) {
  if (values.length < 2) return 0;
  const m = mean(values); return Math.sqrt(Math.max(0, values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1)));
}
function resample(candles: Candle1h[], hours: number): PerpBar[] {
  const bucketMs = hours * HOUR; const buckets = new Map<number, PerpBar>();
  for (const c of candles) {
    const ts = Math.floor(c.ts / bucketMs) * bucketMs; const e = buckets.get(ts);
    if (!e) buckets.set(ts, { ...c, ts });
    else { e.high = Math.max(e.high, c.high); e.low = Math.min(e.low, c.low); e.close = c.close; e.volume += c.volume; }
  }
  return [...buckets.values()].sort((a, b) => a.ts - b.ts);
}
function prepare(data: PerpMarketData): Prepared {
  const bySymbol: Record<string, PerpBar[]> = {}; const indexes: Record<string, Map<number, number>> = {};
  const oneHourIndexes: Record<string, Map<number, number>> = {};
  for (const [symbol, candles] of Object.entries(data.bySymbol)) {
    const bars = resample(candles, 2); bySymbol[symbol] = bars; indexes[symbol] = new Map(bars.map((b, i) => [b.ts, i]));
    oneHourIndexes[symbol] = new Map(candles.map((b, i) => [b.ts, i]));
  }
  return { bySymbol, indexes, oneHourIndexes, timeline: (bySymbol.BTC ?? []).map((b) => b.ts) };
}
function sma(bars: PerpBar[], i: number, n: number) { if (i - n + 1 < 0) return null; return mean(bars.slice(i - n + 1, i + 1).map((b) => b.close)); }
function momentum(bars: PerpBar[], i: number, n: number) { const p = bars[i - n], c = bars[i]; return !p || !c || p.close <= 0 ? null : c.close / p.close - 1; }
function atr(bars: PerpBar[], i: number, n: number) {
  if (i - n < 0) return null; const r: number[] = [];
  for (let j = i - n + 1; j <= i; j += 1) { const b = bars[j], p = bars[j - 1]; if (!b || !p) return null; r.push(Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close))); }
  return mean(r);
}
function vol(bars: PerpBar[], i: number, n: number) {
  if (i - n < 0) return null; const r: number[] = [];
  for (let j = i - n + 1; j <= i; j += 1) { const b = bars[j], p = bars[j - 1]; if (!b || !p || b.close <= 0 || p.close <= 0) return null; r.push(Math.log(b.close / p.close)); }
  return std(r);
}
function volumeRatio(bars: PerpBar[], i: number, n = 20) { if (i - n < 0) return null; const base = mean(bars.slice(i - n, i).map((b) => b.volume)); return base > 0 ? bars[i]!.volume / base : null; }
function priorHL(bars: PerpBar[], i: number, n: number) { if (i - n < 0) return null; const x = bars.slice(i - n, i); return { high: Math.max(...x.map((b) => b.high)), low: Math.min(...x.map((b) => b.low)) }; }
function signal(prepared: Prepared, ts: number): Candidate | null {
  const p = V26.parameters, btc = prepared.bySymbol.BTC, bi = prepared.indexes.BTC?.get(ts); if (!btc || bi == null) return null;
  const bs = sma(btc, bi, p.btcRegimeSmaBars), bm = momentum(btc, bi, p.btcRegimeMomentumBars), bb = btc[bi]; if (!bb || bs == null || bm == null || bs <= 0) return null;
  const dist = bb.close / bs - 1, longReg = dist >= p.regimeThresholdPct && bm > 0, shortReg = dist <= -p.regimeThresholdPct && bm < 0, neutral = !longReg && !shortReg;
  const expectedCost = ((NORMAL.feeBpsPerSide + NORMAL.slippageBpsPerSide) * 2) / 10_000; const minMove = expectedCost * p.minimumEdgeToCostRatio; const out: Candidate[] = [];
  for (const symbol of V26.symbols) {
    const bars = prepared.bySymbol[symbol], i = prepared.indexes[symbol]?.get(ts); if (!bars || i == null) continue;
    const b = bars[i], m = momentum(bars, i, p.momentumBars), v = vol(bars, i, p.volatilityLookbackBars), a = atr(bars, i, p.atrBars), vr = volumeRatio(bars, i), hl = priorHL(bars, i, p.breakoutBars);
    if (!b || m == null || v == null || a == null || vr == null || !hl || b.close <= 0 || vr < p.minimumVolumeRatio || Math.abs(m) < minMove) continue;
    const scale = Math.max(0.0001, v * Math.sqrt(p.momentumBars)); const raw = m / scale; const score = raw / (1 + p.volatilityPenalty * v * 100);
    const longOk = p.allowLong && m >= p.minimumMomentumPct; const shortOk = p.allowShort && m <= -p.minimumMomentumPct;
    if (longOk && (longReg || (neutral && p.allowNeutralRegime && score >= p.neutralScoreThreshold))) out.push({ symbol, side: "long", score, atr: a, signalTs: ts });
    if (shortOk && (shortReg || (neutral && p.allowNeutralRegime && -score >= p.neutralScoreThreshold))) out.push({ symbol, side: "short", score: -score, atr: a, signalTs: ts });
  }
  return out.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))[0] ?? null;
}
function firstFundingAfter(points: { ts: number; rate: number }[], ts: number) { let lo = 0, hi = points.length; while (lo < hi) { const m = Math.floor((lo + hi) / 2); if ((points[m]?.ts ?? Infinity) <= ts) lo = m + 1; else hi = m; } return lo; }
function fundingBetween(points: { ts: number; rate: number }[], from: number, to: number) { let i = firstFundingAfter(points, from), total = 0; while (i < points.length) { const x = points[i]; if (!x || x.ts > to) break; total += x.rate; i += 1; } return total; }
function pf(pnls: number[]) { const gp = pnls.filter((x) => x > 0).reduce((a, b) => a + b, 0), gl = Math.abs(pnls.filter((x) => x < 0).reduce((a, b) => a + b, 0)); return gl > 0 ? gp / gl : gp > 0 ? 99 : 0; }
function pfWithoutBest(pnls: number[]) { const x = [...pnls]; if (x.length) x.splice(x.indexOf(Math.max(...x)), 1); return pf(x); }

function runResident(data: PerpMarketData, prepared: Prepared, startTs: number, endTs: number, mode: RunMode) {
  const p = V26.parameters, feeRate = mode.feeBpsPerSide / 10_000, slipRate = mode.slippageBpsPerSide / 10_000;
  const timeline = prepared.timeline.filter((ts) => ts >= startTs && ts < endTs); const trades: Trade[] = []; const pnls: number[] = [];
  let balance = STARTING_EQUITY, position: Position | null = null, pendingEntry: Candidate | null = null, pendingExitReason: string | null = null, cooldownUntilTs = 0, seq = 0, maxLev = 0, liquidations = 0;
  let equityPeak = STARTING_EQUITY, maxDrawdownPct = 0;
  const close = (raw: number, reason: string, liquidated: boolean) => {
    if (!position) return; const x = position, exitPrice = x.side === "long" ? raw * (1 - slipRate) : raw * (1 + slipRate), dir = x.side === "long" ? 1 : -1;
    const gross = dir * x.quantity * (exitPrice - x.entryPrice), exitFee = x.quantity * exitPrice * feeRate; balance = Math.max(0, balance + gross - exitFee); const net = gross - x.entryFee - exitFee - x.fundingCost;
    trades.push({ symbol: x.symbol, side: x.side, netPnl: net, exitReason: reason, liquidated, effectiveLeverage: x.effectiveLeverage }); pnls.push(net); if (liquidated) liquidations += 1; position = null;
  };
  for (const ts of timeline) {
    if (pendingExitReason && position) { const i = prepared.indexes[position.symbol]?.get(ts), b = i == null ? null : prepared.bySymbol[position.symbol]?.[i]; if (b) close(b.open, pendingExitReason, false); pendingExitReason = null; }
    let enteredThisBar = false;
    if (pendingEntry && !position && ts >= cooldownUntilTs && balance > 0) {
      const twoI = prepared.indexes[pendingEntry.symbol]?.get(ts), two = twoI == null ? null : prepared.bySymbol[pendingEntry.symbol]?.[twoI];
      const actualTs = ts + mode.entryDelayHours * HOUR; const oneI = prepared.oneHourIndexes[pendingEntry.symbol]?.get(actualTs); const one = oneI == null ? null : data.bySymbol[pendingEntry.symbol]?.[oneI];
      const rawEntry = mode.entryDelayHours === 0 ? two?.open : one?.open;
      if (rawEntry && rawEntry > 0) {
        const entryPrice = pendingEntry.side === "long" ? rawEntry * (1 + slipRate) : rawEntry * (1 - slipRate); const stopDistance = Math.max(pendingEntry.atr * p.stopAtr, entryPrice * 0.005);
        const riskCapital = balance * p.riskPerTradePct / 100, riskNotional = riskCapital / Math.max(0.001, stopDistance / entryPrice), maxNotional = balance * p.leverage * p.maxMarginUsagePct / 100, notional = Math.min(riskNotional, maxNotional);
        const lev = notional / Math.max(1, balance), qty = notional / entryPrice, entryFee = notional * feeRate;
        if (Number.isFinite(qty) && qty > 0 && lev >= 0.1 && entryFee < balance * 0.1) {
          balance -= entryFee; const liqDist = Math.max(0.005, 1 / Math.max(0.1, lev) - NORMAL.maintenanceMarginRate); const rawStop = pendingEntry.side === "long" ? entryPrice - stopDistance : entryPrice + stopDistance;
          const liq = pendingEntry.side === "long" ? entryPrice * (1 - liqDist) : entryPrice * (1 + liqDist); const initial = pendingEntry.side === "long" ? Math.max(rawStop, liq * 1.01) : Math.min(rawStop, liq * 0.99);
          const tp = pendingEntry.side === "long" ? entryPrice + pendingEntry.atr * p.takeProfitAtr : entryPrice - pendingEntry.atr * p.takeProfitAtr; seq += 1; maxLev = Math.max(maxLev, lev);
          position = { tradeId: `v9-${seq}`, symbol: pendingEntry.symbol, side: pendingEntry.side, decisionEntryTs: ts, actualEntryTs: actualTs, entryPrice, quantity: qty, notional, effectiveLeverage: lev, entryFee, fundingCost: 0, lastFundingTs: actualTs, initialStopPrice: initial, residentStopPrice: initial, takeProfitPrice: tp, liquidationPrice: liq, peakPrice: entryPrice, troughPrice: entryPrice, atrAtEntry: pendingEntry.atr, holdingBars: 0, stopQueue: [] };
          enteredThisBar = true;
        }
      }
      pendingEntry = null;
    }
    if (position) {
      const pos = position; const i = prepared.indexes[pos.symbol]?.get(ts), full = i == null ? null : prepared.bySymbol[pos.symbol]?.[i]; let active: { high: number; low: number; close: number } | null = full;
      if (enteredThisBar && mode.entryDelayHours === 1) { const oi = prepared.oneHourIndexes[pos.symbol]?.get(ts + HOUR); const ob = oi == null ? null : data.bySymbol[pos.symbol]?.[oi]; active = ob ? { high: ob.high, low: ob.low, close: ob.close } : null; }
      if (active) {
        pos.holdingBars += 1;
        if (!enteredThisBar) { const points = data.fundingBySymbol[pos.symbol] ?? [], rate = fundingBetween(points, pos.lastFundingTs, ts); const charge = pos.notional * rate * (pos.side === "long" ? 1 : -1); pos.fundingCost += charge; pos.lastFundingTs = ts; balance = Math.max(0, balance - charge); }
        const stop = pos.residentStopPrice;
        if (pos.side === "long") { if (active.low <= pos.liquidationPrice) close(pos.liquidationPrice, "liquidation", true); else if (active.low <= stop) close(stop, stop > pos.initialStopPrice ? "trailing-stop" : "stop-loss", false); else if (active.high >= pos.takeProfitPrice) close(pos.takeProfitPrice, "take-profit", false); }
        else { if (active.high >= pos.liquidationPrice) close(pos.liquidationPrice, "liquidation", true); else if (active.high >= stop) close(stop, stop < pos.initialStopPrice ? "trailing-stop" : "stop-loss", false); else if (active.low <= pos.takeProfitPrice) close(pos.takeProfitPrice, "take-profit", false); }
        if (position) {
          position.peakPrice = Math.max(position.peakPrice, active.high); position.troughPrice = Math.min(position.troughPrice, active.low);
          if (mode.stopUpdateLagBars === 1) {
            for (const q of position.stopQueue) q.remainingBars -= 1;
            const ready = position.stopQueue.filter((q) => q.remainingBars <= 0); position.stopQueue = position.stopQueue.filter((q) => q.remainingBars > 0);
            for (const q of ready) position.residentStopPrice = position.side === "long" ? Math.max(position.residentStopPrice, q.price) : Math.min(position.residentStopPrice, q.price);
          }
          const candidate = position.side === "long" ? Math.max(position.initialStopPrice, position.peakPrice - position.atrAtEntry * p.trailingAtr) : Math.min(position.initialStopPrice, position.troughPrice + position.atrAtEntry * p.trailingAtr);
          if (mode.stopUpdateLagBars === 0) position.residentStopPrice = candidate; else position.stopQueue.push({ price: candidate, remainingBars: 1 });
        } else cooldownUntilTs = ts + p.cooldownBars * p.timeframeHours * HOUR;
      }
    }
    const btcI = prepared.indexes.BTC?.get(ts), btc = btcI == null ? null : prepared.bySymbol.BTC?.[btcI]; if (!btc) continue;
    if (position) {
      const pi = prepared.indexes[position.symbol]?.get(ts), full = pi == null ? null : prepared.bySymbol[position.symbol]?.[pi]; const mark = full?.close ?? btc.close, dir = position.side === "long" ? 1 : -1;
      const unreal = dir * position.quantity * (mark - position.entryPrice), reserve = position.quantity * mark * feeRate, eq = Math.max(0, balance + unreal - reserve); equityPeak = Math.max(equityPeak, eq); maxDrawdownPct = Math.max(maxDrawdownPct, equityPeak > 0 ? (equityPeak - eq) / equityPeak * 100 : 100);
    } else { equityPeak = Math.max(equityPeak, balance); maxDrawdownPct = Math.max(maxDrawdownPct, equityPeak > 0 ? (equityPeak - balance) / equityPeak * 100 : 100); }
    const next = signal(prepared, ts);
    if (position) { const maxHold = position.holdingBars >= p.maxHoldBars, reb = position.holdingBars >= p.rebalanceBars, changed = next && (next.symbol !== position.symbol || next.side !== position.side); if (maxHold) pendingExitReason = "max-hold"; else if (reb && changed) { pendingExitReason = "signal-rotation"; pendingEntry = next; } }
    else if (ts >= cooldownUntilTs && next) pendingEntry = next;
  }
  if (position) { const rows = data.bySymbol[position.symbol] ?? [], last = [...rows].reverse().find((b) => b.ts < endTs); if (last) close(last.close, "window-end", false); }
  const years = (endTs - startTs) / (365.25 * 24 * HOUR); const endingEquity = balance; const cagrPct = endingEquity > 0 ? (Math.pow(endingEquity / STARTING_EQUITY, 1 / years) - 1) * 100 : -100;
  return { label: mode.label, entryDelayHours: mode.entryDelayHours, stopUpdateLagBars: mode.stopUpdateLagBars, stopUpdateLagHours: mode.stopUpdateLagBars * 2, feeBpsPerSide: mode.feeBpsPerSide, slippageBpsPerSide: mode.slippageBpsPerSide, tradeCount: trades.length, endingEquity, returnPct: (endingEquity / STARTING_EQUITY - 1) * 100, cagrPct, maxDrawdownPct, profitFactor: pf(pnls), profitFactorWithoutBest: pfWithoutBest(pnls), winRatePct: trades.length ? trades.filter((t) => t.netPnl > 0).length / trades.length * 100 : 0, maximumEffectiveLeverage: maxLev, liquidationCount: liquidations, exitReasons: Object.fromEntries([...new Set(trades.map((t) => t.exitReason))].map((r) => [r, trades.filter((t) => t.exitReason === r).length])) };
}

const MODES: RunMode[] = [
  { label: "resident-normal", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 5, slippageBpsPerSide: 0 },
  { label: "resident-cost-stress", entryDelayHours: 0, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
  { label: "resident-entry-delay-1h", entryDelayHours: 1, stopUpdateLagBars: 0, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
  { label: "resident-stop-update-lag-2h", entryDelayHours: 0, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
  { label: "resident-combined-entry1h-stoplag2h", entryDelayHours: 1, stopUpdateLagBars: 1, feeBpsPerSide: 10, slippageBpsPerSide: 5 },
];
function robust(results: ReturnType<typeof runResident>[]) { return results.every((r) => r.returnPct > 0 && r.profitFactor > 1 && r.tradeCount >= 30) && results.at(-1)!.profitFactorWithoutBest >= 0.95 && results.at(-1)!.maxDrawdownPct <= 50; }
function closeEnough(a: number, b: number, tolerance: number) { return Math.abs(a - b) <= tolerance; }
async function evaluate(label: string, startTs: number, endTs: number, data: PerpMarketData, prepared: Prepared) {
  const control = runPerpBacktest({ genome: V26, data, window: { label, startTs, endTs }, execution: NORMAL, targetMonthlyReturnPct: TARGET_MONTHLY });
  const original = normalBacktestSummary(control); const results = MODES.map((m) => runResident(data, prepared, startTs, endTs, m)); const residentNormal = results[0]!;
  const parity = { tradeCount: residentNormal.tradeCount === original.tradeCount, endingEquity: closeEnough(residentNormal.endingEquity, original.endingEquity, Math.max(1e-6, original.endingEquity * 1e-8)), profitFactor: closeEnough(residentNormal.profitFactor, original.profitFactor, 1e-8), maximumEffectiveLeverage: closeEnough(residentNormal.maximumEffectiveLeverage, original.maximumEffectiveLeverage, 1e-8) };
  const parityPass = Object.values(parity).every(Boolean); if (!parityPass) throw new Error(`V9_ENGINE_PARITY_FAIL:${label}:${JSON.stringify({ parity, original, residentNormal })}`);
  return { original, parity, parityPass, modes: Object.fromEntries(results.map((r) => [r.label, r])), robust: robust(results.slice(1)) };
}
async function main() {
  if (UNIVERSE.length !== 14 || UNIVERSE.includes("PENGU") || V26.parameters.leverage !== 1) throw new Error("V9_BOUNDARY_FAIL");
  const data = await loadPerpMarketData({ symbols: UNIVERSE, startTs: WARMUP_START, endTs: END + 4 * HOUR }); const prepared = prepare(data);
  const development = await evaluate("development", START, DEV_END, data, prepared), validation = await evaluate("validation", DEV_END, VAL_END, data, prepared); const dvRobust = development.robust && validation.robust;
  const evaluation = dvRobust ? await evaluate("evaluation", VAL_END, END, data, prepared) : null; const combined3Y = dvRobust ? await evaluate("combined3y", START, END, data, prepared) : null;
  const combinedWorst = combined3Y?.modes["resident-combined-entry1h-stoplag2h"];
  const acceptance = combined3Y && combinedWorst ? { normal3YCagrAtLeast100: combined3Y.original.cagrPct >= 100, dvRobust, combinedResidentStressPositive: combinedWorst.returnPct > 0 && combinedWorst.profitFactor > 1, combinedResidentPfWithoutBestAtLeast095: combinedWorst.profitFactorWithoutBest >= 0.95, combinedResidentDdAtMost50: combinedWorst.maxDrawdownPct <= 50, maxLeverageAtMost1: combinedWorst.maximumEffectiveLeverage <= 1.000001, zeroLiquidations: combinedWorst.liquidationCount === 0, engineParityPass: development.parityPass && validation.parityPass && Boolean(evaluation?.parityPass) && combined3Y.parityPass } : null;
  const accepted = Boolean(acceptance && Object.values(acceptance).every(Boolean)); const diagnosis = !dvRobust ? "V9_RESIDENT_STOP_EXECUTION_FAILS_DV" : accepted ? "V9_ASTER_RESIDENT_STOP_EXECUTION_ACCEPTED" : "V9_DV_SURVIVES_BUT_3Y_GATE_FAILS";
  const out = { researchLine: "V26_LATENCY_AWARE_V9_ASTER_RESIDENT_STOP", researchOnly: true, productionChanged: false, vpsChanged: false, liveChanged: false, realTradingEnabled: false, liveEligible: false, penguExcluded: true, leverage: 1, universe: UNIVERSE, liveFeasibilityVerified: true, venue: "Aster Futures API V3", venueModel: { protectiveOrder: "STOP_MARKET", stopOwnership: "venue", signalTimeframeHours: 2, outageStress: "one complete 2H trailing-stop update is missed; prior accepted venue stop remains active", entryDelayStressHours: 1, feeStressBpsPerSide: 10, slippageStressBpsPerSide: 5, nativeTrailingNotUsed: "V26 uses fixed 0.4 ATR distance; Aster TRAILING_STOP_MARKET uses percentage callbackRate, so V9 avoids semantic substitution" }, governance: "No V26 signal/parameter search. Development and Validation must both pass before Evaluation/combined 3Y are read.", development, validation, dvRobust, evaluation, combined3Y, acceptance, diagnosis };
  const dir = process.env.RESEARCH_STATE_DIR || ".research-state"; await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, "v26-latency-aware-v9.json"), JSON.stringify(out, null, 2) + "\n", "utf8");
  console.log(JSON.stringify({ researchLine: out.researchLine, dvRobust, diagnosis, development, validation, evaluation, combined3Y, acceptance }, null, 2));
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
