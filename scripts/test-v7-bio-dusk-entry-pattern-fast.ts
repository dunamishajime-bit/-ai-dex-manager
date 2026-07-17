import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-bio-dusk-entry-pattern-fast");
const IDLE_WINDOW_SOURCE = path.join(process.cwd(), "reports", "v7-idle-candidates-fresh", "result.json");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const CAP_USD = 300;
const SYMBOLS = ["BIO", "DUSK"] as const;
const QUOTE_LOSS_PCT: Record<string, number> = { BIO: 0.6979, DUSK: 0.6026 };
const ACTIVE_FROM: Record<string, number> = { BIO: Date.UTC(2025, 6, 1), DUSK: Date.UTC(2026, 0, 1) };

const PERIODS = [
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999), v7End: 9229.35 },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: END_TS, v7End: 14533.79 },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: END_TS, v7End: 399600.13 },
  { key: "2024-2026", startTs: START_TS, endTs: END_TS, v7End: 284213.08 },
] as const;

const VARIANT = {
  key: "confirmed48",
  maxHoldHours: 48,
  lookback: 10,
  breakoutPct: 0.016,
  minVolRatio: 1.22,
  minMom6: 0.045,
  minMom24: 0.075,
  minFourHourMom: 0.05,
  minScore: 32,
  maxOneHourJump: 0.2,
  minCloseLocation: 0.6,
  trailActivationPct: 0.18,
  trailRetracePct: 0.085,
  hardStopPct: 0.08,
  weakExitMinHours: 8,
} as const;

const FILTERS = [
  { key: "production_like" },
  { key: "no_extended_22_92", maxJump1h: 0.14, maxDistFromSma20: 0.22, maxCloseLocation: 0.92 },
  { key: "no_extended_18_92", maxJump1h: 0.14, maxDistFromSma20: 0.18, maxCloseLocation: 0.92 },
  { key: "no_extended_16_90", maxJump1h: 0.13, maxDistFromSma20: 0.16, maxCloseLocation: 0.9 },
  { key: "abort_only", earlyAbortHours: 3, earlyAbortPct: -0.035 },
  { key: "no_extended_18_92_abort", maxJump1h: 0.14, maxDistFromSma20: 0.18, maxCloseLocation: 0.92, earlyAbortHours: 3, earlyAbortPct: -0.035 },
] as const;

type Filter = typeof FILTERS[number];
type Window = { startTs: number; endTs: number };
type Signal = { symbol: string; ts: number; close: number; score: number };
type Trade = { period: string; filter: string; symbol: string; entryTs: number; exitTs: number; entryPrice: number; exitPrice: number; netReturnPct: number; score: number; exitReason: string };

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function readIdleWindows() {
  const parsed = JSON.parse(await fs.readFile(IDLE_WINDOW_SOURCE, "utf8")) as { idleWindows: Window[] };
  return parsed.idleWindows.map((window) => ({ startTs: Math.max(window.startTs, START_TS), endTs: Math.min(window.endTs, END_TS) })).filter((window) => window.endTs > window.startTs).sort((a, b) => a.startTs - b.startTs);
}

function clipWindows(windows: readonly Window[], startTs: number, endTs: number) {
  return windows.map((window) => ({ startTs: Math.max(window.startTs, startTs), endTs: Math.min(window.endTs, endTs) })).filter((window) => window.endTs > window.startTs);
}

function windowAt(ts: number, windows: readonly Window[], startIndex: number) {
  let index = startIndex;
  while (index < windows.length && ts > windows[index].endTs) index += 1;
  const window = windows[index];
  return { index, window: window && ts >= window.startTs && ts <= window.endTs ? window : null };
}

function buildIndex(candles: Candle1h[]) {
  const out = new Map<number, number>();
  candles.forEach((bar, index) => out.set(bar.ts, index));
  return out;
}

async function loadAllCandles() {
  const out = new Map<string, Candle1h[]>();
  for (const symbol of SYMBOLS) {
    const candles = await loadHistoricalCandles({ symbol: `${symbol}USDT`, cacheRoot: CACHE_ROOT, startMs: START_TS - 420 * HOUR_MS, endMs: END_TS, interval: "1h" });
    out.set(symbol, candles);
  }
  return out;
}

function patternPass(candles: Candle1h[], index: number, filter: Filter) {
  const bar = candles[index];
  const prev = candles[index - 1];
  const oneHourJump = prev?.close > 0 ? bar.close / prev.close - 1 : 0;
  const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
  const distFromSma20 = sma20 > 0 ? bar.close / sma20 - 1 : 0;
  const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 1;
  if ("maxJump1h" in filter && oneHourJump > filter.maxJump1h) return false;
  if ("maxDistFromSma20" in filter && distFromSma20 > filter.maxDistFromSma20) return false;
  if ("maxCloseLocation" in filter && closeLocation > filter.maxCloseLocation) return false;
  return true;
}

function signalFor(symbol: string, candles: Candle1h[], fourHourCandles: Candle1h[], index: number, filter: Filter): Signal | null {
  if (index < Math.max(40, VARIANT.lookback + 1)) return null;
  if (candles[index].ts < ACTIVE_FROM[symbol]) return null;
  if (!patternPass(candles, index, filter)) return null;
  const bar = candles[index];
  const prevHigh = Math.max(...candles.slice(index - VARIANT.lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
  const volRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
  const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
  const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
  const oneHourJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
  const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 1;
  const fourHour = [...fourHourCandles].reverse().find((item) => item.ts <= bar.ts);
  const fourHourIndex = fourHour ? fourHourCandles.findIndex((item) => item.ts === fourHour.ts) : -1;
  const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0 ? fourHour!.close / fourHourCandles[fourHourIndex - 3].close - 1 : 0;
  if (breakoutPct < VARIANT.breakoutPct || volRatio < VARIANT.minVolRatio || mom6 < VARIANT.minMom6 || mom24 < VARIANT.minMom24 || fourHourMom < VARIANT.minFourHourMom || oneHourJump > VARIANT.maxOneHourJump || closeLocation < VARIANT.minCloseLocation) return null;
  const score = mom6 * 120 + mom24 * 90 + fourHourMom * 120 + breakoutPct * 180 + Math.min(3.5, volRatio) * 2 + closeLocation * 4;
  return score >= VARIANT.minScore ? { symbol, ts: bar.ts, close: bar.close, score } : null;
}

function simulate(candlesBySymbol: Map<string, Candle1h[]>, windows: readonly Window[], filter: Filter, periodKey: string) {
  const indexes = new Map<string, Map<number, number>>();
  const fourHours = new Map<string, Candle1h[]>();
  const tsSet = new Set<number>();
  for (const symbol of SYMBOLS) {
    const candles = candlesBySymbol.get(symbol) ?? [];
    indexes.set(symbol, buildIndex(candles));
    fourHours.set(symbol, resampleToHours(candles, 4));
    for (const bar of candles) tsSet.add(bar.ts);
  }
  const trades: Trade[] = [];
  let open: null | (Trade & { peakPrice: number; maxExitTs: number; activeWindowEndTs: number; filterRef: Filter }) = null;
  let windowIndex = 0;
  for (const ts of [...tsSet].sort((a, b) => a - b)) {
    const current = windowAt(ts, windows, windowIndex);
    windowIndex = current.index;
    const window = current.window;
    if (!window) continue;
    if (open) {
      const candles = candlesBySymbol.get(open.symbol) ?? [];
      const index = indexes.get(open.symbol)?.get(ts);
      if (index == null) continue;
      const bar = candles[index];
      open.peakPrice = Math.max(open.peakPrice, bar.high);
      const holdingHours = (ts - open.entryTs) / HOUR_MS;
      const profitFromEntry = bar.close / open.entryPrice - 1;
      const drawdownFromEntry = bar.low / open.entryPrice - 1;
      const retraceFromPeak = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
      const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
      const mom6 = index >= 6 ? bar.close / candles[index - 6].close - 1 : 0;
      let exitReason: string | null = null;
      if ("earlyAbortHours" in open.filterRef && holdingHours <= open.filterRef.earlyAbortHours && profitFromEntry <= open.filterRef.earlyAbortPct) exitReason = "early-abort";
      if (!exitReason && drawdownFromEntry <= -VARIANT.hardStopPct) exitReason = "hard-stop";
      if (!exitReason && profitFromEntry >= VARIANT.trailActivationPct && retraceFromPeak <= -VARIANT.trailRetracePct) exitReason = "profit-trail";
      if (!exitReason && holdingHours >= VARIANT.weakExitMinHours && bar.close < sma20 && mom6 < 0) exitReason = "weak-exit";
      if (!exitReason && (ts >= open.maxExitTs || ts >= open.activeWindowEndTs)) exitReason = "max-hold-or-window-end";
      if (!exitReason) continue;
      const quoteLossPct = QUOTE_LOSS_PCT[open.symbol] ?? 1;
      trades.push({ period: periodKey, filter: open.filter, symbol: open.symbol, entryTs: open.entryTs, exitTs: ts, entryPrice: open.entryPrice, exitPrice: bar.close, netReturnPct: bar.close / open.entryPrice - 1 - (quoteLossPct / 100) * 2 - FEE_RATE * 2, score: open.score, exitReason });
      open = null;
      continue;
    }
    const signals: Signal[] = [];
    for (const symbol of SYMBOLS) {
      const candles = candlesBySymbol.get(symbol) ?? [];
      const index = indexes.get(symbol)?.get(ts);
      if (index == null) continue;
      const signal = signalFor(symbol, candles, fourHours.get(symbol) ?? [], index, filter);
      if (signal) signals.push(signal);
    }
    signals.sort((a, b) => b.score - a.score);
    const best = signals[0];
    if (!best) continue;
    const maxExitTs = Math.min(ts + VARIANT.maxHoldHours * HOUR_MS, window.endTs);
    if (maxExitTs <= ts) continue;
    open = { period: periodKey, filter: filter.key, symbol: best.symbol, entryTs: ts, exitTs: ts, entryPrice: best.close, exitPrice: best.close, netReturnPct: 0, score: best.score, exitReason: "open", peakPrice: best.close, maxExitTs, activeWindowEndTs: window.endTs, filterRef: filter };
  }
  return trades;
}

function summarize(trades: Trade[], v7End: number, periodHours: number, cashPct: number) {
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netReturnPct <= 0).reduce((sum, trade) => sum + trade.netReturnPct, 0));
  const pnl = trades.reduce((sum, trade) => sum + CAP_USD * trade.netReturnPct, 0);
  const addedDays = trades.reduce((sum, trade) => sum + Math.max(0, trade.exitTs - trade.entryTs) / HOUR_MS, 0) / 24;
  const reductionPt = Math.min(cashPct, (addedDays * 24 / periodHours) * 100);
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pf: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    avgNetPct: round(average(trades.map((trade) => trade.netReturnPct)) * 100, 3),
    cap300Pnl: round(pnl),
    cap500Pnl: round((pnl / CAP_USD) * 500),
    cap300End: round(v7End + pnl),
    addedDays: round(addedDays, 2),
    cashAfterPct: round(Math.max(0, cashPct - reductionPt), 2),
    cashReductionPt: round(reductionPt, 3),
    bySymbol: Object.fromEntries(SYMBOLS.map((symbol) => {
      const rows = trades.filter((trade) => trade.symbol === symbol);
      return [symbol, { trades: rows.length, cap300Pnl: round(rows.reduce((sum, trade) => sum + CAP_USD * trade.netReturnPct, 0)) }];
    }).filter(([, value]) => (value as { trades: number }).trades > 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const allWindows = await readIdleWindows();
  const allCandles = await loadAllCandles();
  const rows = [];
  const tradeRows: Trade[] = [];
  for (const period of PERIODS) {
    const windows = clipWindows(allWindows, period.startTs, period.endTs);
    const cashHours = windows.reduce((sum, window) => sum + (window.endTs - window.startTs) / HOUR_MS, 0);
    const periodHours = (period.endTs - period.startTs + 1) / HOUR_MS;
    const cashPct = (cashHours / periodHours) * 100;
    const periodCandles = new Map<string, Candle1h[]>();
    for (const [symbol, candles] of allCandles) periodCandles.set(symbol, candles.filter((bar) => bar.ts >= period.startTs - 420 * HOUR_MS && bar.ts <= period.endTs));
    for (const filter of FILTERS) {
      const trades = simulate(periodCandles, windows, filter, period.key);
      const summary = summarize(trades, period.v7End, periodHours, cashPct);
      rows.push({ period: period.key, filter: filter.key, v7End: period.v7End, v7CashPct: round(cashPct, 2), ...summary });
      tradeRows.push(...trades);
      console.log(`${period.key} ${filter.key}: trades=${summary.trades} cap300=${summary.cap300Pnl}`);
    }
  }
  const sortedRows = [...rows].sort((a, b) => String(a.period).localeCompare(String(b.period)) || b.cap300Pnl - a.cap300Pnl);
  const md = [
    "# V7 BIO/DUSK Entry Pattern Fast",
    "",
    "- method: cached engine-direct V7 USDT windows + BIO/DUSK confirmed48 sidecar",
    "- ZBT excluded",
    "- cap300 and cap500 shown",
    "",
    "| period | filter | V7 USDT % | USDT after % | reduction pt | trades | win % | PF | avg net % | cap300 PnL | cap500 PnL | cap300 End | added days | by symbol |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...sortedRows.map((row) => `| ${row.period} | ${row.filter} | ${row.v7CashPct} | ${row.cashAfterPct} | ${row.cashReductionPt} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.avgNetPct} | ${row.cap300Pnl} | ${row.cap500Pnl} | ${row.cap300End} | ${row.addedDays} | ${JSON.stringify(row.bySymbol)} |`),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(sortedRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
