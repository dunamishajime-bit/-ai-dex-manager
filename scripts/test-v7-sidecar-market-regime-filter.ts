import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE } from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-sidecar-market-regime-filter");
const IDLE_WINDOW_SOURCE = path.join(process.cwd(), "reports", "v7-idle-candidates-fresh", "result.json");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const CAP_USD = 300;

const TRADE_SYMBOLS = ["BIO", "DUSK", "ZBT", "PENDLE", "DEXE"] as const;
const REGIME_SYMBOLS = ["BTC", "BNB", "CAKE", "THE", "BIO", "DUSK", "ZBT", "PENDLE", "DEXE"] as const;
const QUOTE_LOSS_PCT: Record<string, number> = {
  BIO: 0.6979,
  DUSK: 0.6026,
  ZBT: 0.7178,
  PENDLE: 0.7495,
  DEXE: 0.5161,
};

const PERIODS = [
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999), v7End: 74613.95 },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999), v7End: 9229.35 },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: END_TS, v7End: 14533.79 },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: END_TS, v7End: 399600.13 },
  { key: "2024-2026", startTs: START_TS, endTs: END_TS, v7End: 284213.08 },
] as const;

const VARIANTS = {
  fast24: { key: "rank_fast_24h", maxHoldHours: 24, lookback: 8, breakoutPct: 0.012, minVolRatio: 1.12, minMom6: 0.025, minMom24: 0.04, minFourHourMom: 0.025, minScore: 11, maxOneHourJump: 0.28, minCloseLocation: 0.45, trailActivationPct: 0.12, trailRetracePct: 0.06, hardStopPct: 0.08, weakExitMinHours: 6 },
  runner72: { key: "rank_runner_72h", maxHoldHours: 72, lookback: 12, breakoutPct: 0.018, minVolRatio: 1.22, minMom6: 0.04, minMom24: 0.08, minFourHourMom: 0.055, minScore: 18, maxOneHourJump: 0.24, minCloseLocation: 0.48, trailActivationPct: 0.28, trailRetracePct: 0.14, hardStopPct: 0.12, weakExitMinHours: 12 },
} as const;

const STRATEGY = {
  key: "ranking_window_regime_bio_zbt",
  rules: [
    { minWindowHours: 12, maxWindowHours: 72, symbols: ["BIO", "ZBT"] as const, variant: VARIANTS.fast24 },
    { minWindowHours: 48, maxWindowHours: 336, symbols: ["BIO", "ZBT"] as const, variant: VARIANTS.runner72 },
    { minWindowHours: 336, maxWindowHours: Infinity, symbols: ["BIO", "ZBT"] as const, variant: VARIANTS.runner72 },
  ],
} as const;

const FILTERS = [
  { key: "none" },
  { key: "bnb_guard", minBnb24: -0.03, minBtc24: -0.04 },
  { key: "bnb_cake_positive", minBnb24: 0, minCake24: 0, minBtc24: -0.03 },
  { key: "bnbchain_breadth_40", minBnb24: -0.02, minCake24: -0.01, minBtc24: -0.03, minBreadth24: 0.4 },
  { key: "bnbchain_breadth_60", minBnb24: 0, minCake24: 0, minBtc24: -0.02, minBreadth24: 0.6 },
  { key: "strong_bnbchain_only", minBnb24: 0.015, minCake24: 0.01, minBtc24: 0, minBreadth24: 0.5 },
] as const;

type Variant = typeof VARIANTS[keyof typeof VARIANTS];
type Window = { startTs: number; endTs: number };
type Signal = { symbol: string; ts: number; close: number; score: number; variant: Variant; windowHours: number };
type Trade = { symbol: string; variant: string; filter: string; entryTs: number; exitTs: number; entryPrice: number; exitPrice: number; netReturnPct: number; score: number; windowHours: number; exitReason: string };

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

async function readIdleWindows() {
  const parsed = JSON.parse(await fs.readFile(IDLE_WINDOW_SOURCE, "utf8")) as { idleWindows: Window[] };
  return parsed.idleWindows
    .map((window) => ({ startTs: Math.max(window.startTs, START_TS), endTs: Math.min(window.endTs, END_TS) }))
    .filter((window) => window.endTs > window.startTs)
    .sort((left, right) => left.startTs - right.startTs);
}

function clipWindows(windows: readonly Window[], startTs: number, endTs: number) {
  return windows
    .map((window) => ({ startTs: Math.max(window.startTs, startTs), endTs: Math.min(window.endTs, endTs) }))
    .filter((window) => window.endTs > window.startTs);
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

async function loadCandles(symbols: readonly string[], startTs: number, endTs: number) {
  const out = new Map<string, Candle1h[]>();
  for (const symbol of symbols) {
    const candles = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      cacheRoot: CACHE_ROOT,
      startMs: Math.max(START_TS, startTs - 420 * HOUR_MS),
      endMs: endTs,
      interval: "1h",
    }).catch(() => []);
    out.set(symbol, candles.filter((bar) => bar.ts >= startTs - 420 * HOUR_MS && bar.ts <= endTs));
  }
  return out;
}

function momentum(candles: Candle1h[] | undefined, indexByTs: Map<number, number> | undefined, ts: number, hours: number) {
  if (!candles || !indexByTs) return null;
  const index = indexByTs.get(ts);
  if (index == null || index < hours) return null;
  const prev = candles[index - hours];
  const bar = candles[index];
  return prev?.close > 0 ? bar.close / prev.close - 1 : null;
}

function passFilter(filter: typeof FILTERS[number], ts: number, candles: Map<string, Candle1h[]>, indexes: Map<string, Map<number, number>>) {
  const btc24 = momentum(candles.get("BTC"), indexes.get("BTC"), ts, 24);
  const bnb24 = momentum(candles.get("BNB"), indexes.get("BNB"), ts, 24);
  const cake24 = momentum(candles.get("CAKE"), indexes.get("CAKE"), ts, 24);
  const breadthSymbols = ["BIO", "DUSK", "ZBT", "PENDLE", "DEXE"];
  const breadthValues = breadthSymbols
    .map((symbol) => momentum(candles.get(symbol), indexes.get(symbol), ts, 24))
    .filter((value): value is number => value != null);
  const breadth24 = breadthValues.length ? breadthValues.filter((value) => value > 0).length / breadthValues.length : 0;

  if ("minBtc24" in filter && (btc24 == null || btc24 < filter.minBtc24)) return false;
  if ("minBnb24" in filter && (bnb24 == null || bnb24 < filter.minBnb24)) return false;
  if ("minCake24" in filter && (cake24 == null || cake24 < filter.minCake24)) return false;
  if ("minBreadth24" in filter && breadth24 < filter.minBreadth24) return false;
  return true;
}

function signalFor(symbol: string, candles: Candle1h[], fourHourCandles: Candle1h[], index: number, variant: Variant, windowHours: number): Signal | null {
  if (index < Math.max(40, variant.lookback + 1)) return null;
  const bar = candles[index];
  const prevHigh = Math.max(...candles.slice(index - variant.lookback, index).map((item) => item.high));
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
  if (breakoutPct < variant.breakoutPct || volRatio < variant.minVolRatio || mom6 < variant.minMom6 || mom24 < variant.minMom24 || fourHourMom < variant.minFourHourMom || oneHourJump > variant.maxOneHourJump || closeLocation < variant.minCloseLocation) return null;
  const score = mom6 * 120 + mom24 * 85 + fourHourMom * 105 + breakoutPct * 180 + Math.min(3.5, volRatio) * 2 + closeLocation * 4;
  return score >= variant.minScore ? { symbol, ts: bar.ts, close: bar.close, score, variant, windowHours } : null;
}

function simulate(candlesBySymbol: Map<string, Candle1h[]>, windows: readonly Window[], filter: typeof FILTERS[number]) {
  const indexBySymbol = new Map<string, Map<number, number>>();
  const fourHourBySymbol = new Map<string, Candle1h[]>();
  const tsSet = new Set<number>();
  for (const symbol of REGIME_SYMBOLS) {
    const candles = candlesBySymbol.get(symbol) ?? [];
    indexBySymbol.set(symbol, buildIndex(candles));
    if ((TRADE_SYMBOLS as readonly string[]).includes(symbol)) fourHourBySymbol.set(symbol, resampleToHours(candles, 4));
    for (const bar of candles) tsSet.add(bar.ts);
  }

  const trades: Trade[] = [];
  let open: null | (Trade & { peakPrice: number; maxExitTs: number; activeWindowEndTs: number; variantRef: Variant }) = null;
  let windowIndex = 0;

  for (const ts of [...tsSet].sort((left, right) => left - right)) {
    const current = windowAt(ts, windows, windowIndex);
    windowIndex = current.index;
    const window = current.window;
    if (!window) continue;

    if (open) {
      const candles = candlesBySymbol.get(open.symbol) ?? [];
      const index = indexBySymbol.get(open.symbol)?.get(ts);
      if (index == null) continue;
      const bar = candles[index];
      const variant = open.variantRef;
      open.peakPrice = Math.max(open.peakPrice, bar.high);
      const holdingHours = (ts - open.entryTs) / HOUR_MS;
      const profitFromEntry = bar.close / open.entryPrice - 1;
      const drawdownFromEntry = bar.low / open.entryPrice - 1;
      const retraceFromPeak = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
      const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
      const mom6 = index >= 6 ? bar.close / candles[index - 6].close - 1 : 0;
      let exitReason: string | null = null;
      if (drawdownFromEntry <= -variant.hardStopPct) exitReason = "hard-stop";
      if (!exitReason && profitFromEntry >= variant.trailActivationPct && retraceFromPeak <= -variant.trailRetracePct) exitReason = "profit-trail";
      if (!exitReason && holdingHours >= variant.weakExitMinHours && bar.close < sma20 && mom6 < 0) exitReason = "weak-exit";
      if (!exitReason && (ts >= open.maxExitTs || ts >= open.activeWindowEndTs)) exitReason = "max-hold-or-window-end";
      if (!exitReason) continue;
      const quoteLossPct = Math.max(0, QUOTE_LOSS_PCT[open.symbol] ?? 1);
      trades.push({ symbol: open.symbol, variant: open.variant, filter: open.filter, entryTs: open.entryTs, exitTs: ts, entryPrice: open.entryPrice, exitPrice: bar.close, netReturnPct: bar.close / open.entryPrice - 1 - (quoteLossPct / 100) * 2 - FEE_RATE * 2, score: open.score, windowHours: open.windowHours, exitReason });
      open = null;
      continue;
    }

    if (!passFilter(filter, ts, candlesBySymbol, indexBySymbol)) continue;
    const windowHours = (window.endTs - window.startTs) / HOUR_MS;
    const signals: Signal[] = [];
    for (const rule of STRATEGY.rules) {
      if (windowHours < rule.minWindowHours || windowHours > rule.maxWindowHours) continue;
      for (const symbol of rule.symbols) {
        const candles = candlesBySymbol.get(symbol) ?? [];
        const index = indexBySymbol.get(symbol)?.get(ts);
        if (index == null) continue;
        const signal = signalFor(symbol, candles, fourHourBySymbol.get(symbol) ?? [], index, rule.variant, windowHours);
        if (signal) signals.push(signal);
      }
    }
    signals.sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    const maxExitTs = Math.min(ts + best.variant.maxHoldHours * HOUR_MS, window.endTs);
    if (maxExitTs <= ts) continue;
    open = { symbol: best.symbol, variant: best.variant.key, filter: filter.key, entryTs: ts, exitTs: ts, entryPrice: best.close, exitPrice: best.close, netReturnPct: 0, score: best.score, windowHours: best.windowHours, exitReason: "open", peakPrice: best.close, maxExitTs, activeWindowEndTs: window.endTs, variantRef: best.variant };
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
    cap300End: round(v7End + pnl),
    addedDays: round(addedDays, 2),
    cashAfterPct: round(Math.max(0, cashPct - reductionPt), 2),
    cashReductionPt: round(reductionPt, 3),
    bySymbol: Object.fromEntries(TRADE_SYMBOLS.map((symbol) => {
      const rows = trades.filter((trade) => trade.symbol === symbol);
      return [symbol, { trades: rows.length, cap300Pnl: round(rows.reduce((sum, trade) => sum + CAP_USD * trade.netReturnPct, 0)) }];
    }).filter(([, value]) => (value as { trades: number }).trades > 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const allWindows = await readIdleWindows();
  const candles = await loadCandles(REGIME_SYMBOLS, START_TS, END_TS);
  const rows = [];
  const tradeRows: Array<{ period: string } & Trade> = [];

  for (const period of PERIODS) {
    const windows = clipWindows(allWindows, period.startTs, period.endTs);
    const cashHours = windows.reduce((sum, window) => sum + (window.endTs - window.startTs) / HOUR_MS, 0);
    const periodHours = (period.endTs - period.startTs + 1) / HOUR_MS;
    const cashPct = (cashHours / periodHours) * 100;
    const periodCandles = new Map<string, Candle1h[]>();
    for (const [symbol, symbolCandles] of candles) {
      periodCandles.set(symbol, symbolCandles.filter((bar) => bar.ts >= period.startTs - 420 * HOUR_MS && bar.ts <= period.endTs));
    }
    for (const filter of FILTERS) {
      const trades = simulate(periodCandles, windows, filter);
      const summary = summarize(trades, period.v7End, periodHours, cashPct);
      rows.push({ period: period.key, filter: filter.key, v7End: period.v7End, v7CashPct: round(cashPct, 2), cashWindows: windows.length, ...summary });
      tradeRows.push(...trades.map((trade) => ({ period: period.key, ...trade })));
      console.log(`${period.key} ${filter.key}: trades=${summary.trades} cap300=${summary.cap300Pnl} cash ${round(cashPct, 2)} -> ${summary.cashAfterPct}`);
    }
  }

  const sortedRows = [...rows].sort((left, right) => String(left.period).localeCompare(String(right.period)) || right.cap300Pnl - left.cap300Pnl);
  const md = [
    "# V7 Sidecar Market Regime Filter",
    "",
    "- method: cached engine-direct V7 USDT windows + BIO/ZBT ranking sidecar + market regime filters",
    "- purpose: distinguish dangerous USDT windows from BNB-chain risk-on windows",
    "- cap: 300 USDT",
    "",
    "| period | filter | V7 USDT % | USDT after % | reduction pt | trades | win % | PF | avg net % | cap300 PnL | cap300 End | added days | by symbol |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...sortedRows.map((row) => `| ${row.period} | ${row.filter} | ${row.v7CashPct} | ${row.cashAfterPct} | ${row.cashReductionPt} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.avgNetPct} | ${row.cap300Pnl} | ${row.cap300End} | ${row.addedDays} | ${JSON.stringify(row.bySymbol)} |`),
    "",
    "## Best By Period",
    "",
    ...PERIODS.map((period) => {
      const best = rows.filter((row) => row.period === period.key).sort((left, right) => right.cap300Pnl - left.cap300Pnl)[0];
      return `- ${period.key}: ${best?.filter ?? "-"} cap300 PnL ${best?.cap300Pnl ?? 0}, trades ${best?.trades ?? 0}, USDT ${best?.v7CashPct ?? 0}% -> ${best?.cashAfterPct ?? 0}%`;
    }),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(sortedRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
