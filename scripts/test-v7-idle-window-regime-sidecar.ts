import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE, buildReclaimHybridVariantOptions } from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-window-regime-sidecar");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const CAP_USD = 300;

const SYMBOLS = ["BIO", "DUSK", "ZBT", "PENDLE", "DEXE"] as const;
const QUOTE_LOSS_PCT: Record<string, number> = {
  BIO: 0.6979,
  DUSK: 0.6026,
  ZBT: 0.7178,
  PENDLE: 0.7495,
  DEXE: 0.5161,
};

const PERIODS = [
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: END_TS },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: END_TS },
  { key: "2024-2026", startTs: START_TS, endTs: END_TS },
] as const;

const VARIANTS = {
  zbtEarly: {
    key: "zbt_early_24h",
    maxHoldHours: 24,
    lookback: 8,
    breakoutPct: 0.012,
    minVolRatio: 1.12,
    minMom6: 0.025,
    minMom24: 0.04,
    minFourHourMom: 0.025,
    minScore: 11,
    maxOneHourJump: 0.28,
    minCloseLocation: 0.45,
    trailActivationPct: 0.12,
    trailRetracePct: 0.06,
    hardStopPct: 0.08,
    weakExitMinHours: 6,
  },
  confirmed48: {
    key: "confirmed_48h",
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
  },
  pendle48: {
    key: "pendle_confirmed_48h",
    maxHoldHours: 48,
    lookback: 10,
    breakoutPct: 0.015,
    minVolRatio: 1.18,
    minMom6: 0.035,
    minMom24: 0.065,
    minFourHourMom: 0.04,
    minScore: 15,
    maxOneHourJump: 0.25,
    minCloseLocation: 0.48,
    trailActivationPct: 0.2,
    trailRetracePct: 0.1,
    hardStopPct: 0.1,
    weakExitMinHours: 10,
  },
  dexeSlow: {
    key: "dexe_slow_240h",
    maxHoldHours: 240,
    lookback: 36,
    breakoutPct: 0.012,
    minVolRatio: 0.8,
    minMom6: -0.02,
    minMom24: 0.02,
    minFourHourMom: 0.02,
    minScore: 9,
    maxOneHourJump: 0.18,
    minCloseLocation: 0.42,
    trailActivationPct: 0.28,
    trailRetracePct: 0.14,
    hardStopPct: 0.16,
    weakExitMinHours: 36,
  },
} as const;

const STRATEGIES = [
  {
    key: "current_bio_dusk_confirmed",
    rules: [
      { symbols: ["BIO", "DUSK"] as const, variant: VARIANTS.confirmed48, minWindowHours: 0, maxWindowHours: Infinity },
    ],
  },
  {
    key: "window_regime_conservative",
    rules: [
      { symbols: ["ZBT"] as const, variant: VARIANTS.zbtEarly, minWindowHours: 12, maxWindowHours: 72 },
      { symbols: ["BIO", "DUSK"] as const, variant: VARIANTS.confirmed48, minWindowHours: 48, maxWindowHours: 336 },
      { symbols: ["PENDLE"] as const, variant: VARIANTS.pendle48, minWindowHours: 336, maxWindowHours: Infinity },
    ],
  },
  {
    key: "window_regime_with_dexe_long",
    rules: [
      { symbols: ["ZBT"] as const, variant: VARIANTS.zbtEarly, minWindowHours: 12, maxWindowHours: 72 },
      { symbols: ["BIO", "DUSK"] as const, variant: VARIANTS.confirmed48, minWindowHours: 48, maxWindowHours: 336 },
      { symbols: ["DEXE", "PENDLE"] as const, variant: VARIANTS.dexeSlow, minWindowHours: 336, maxWindowHours: Infinity },
    ],
  },
] as const;

type Window = { startTs: number; endTs: number };
type Variant = typeof VARIANTS[keyof typeof VARIANTS];
type Signal = { symbol: string; ts: number; close: number; score: number; variant: Variant };
type Trade = {
  symbol: string;
  variant: string;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  netReturnPct: number;
  exitReason: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function baseOptions(period: { startTs: number; endTs: number }): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: period.startTs,
    backtestEndTs: period.endTs,
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const points = result.equity_curve.sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of points) {
    if (point.position_side === "cash") {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) {
      windows.push({ startTs: start, endTs: prev + STEP_MS });
      start = null;
      prev = null;
    }
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS });
  return windows.filter((window) => window.endTs - window.startTs >= HOUR_MS);
}

function windowFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs) ?? null;
}

function buildIndex(candles: Candle1h[]) {
  const index = new Map<number, number>();
  candles.forEach((bar, offset) => index.set(bar.ts, offset));
  return index;
}

async function loadCandles(startTs: number, endTs: number) {
  const out = new Map<string, Candle1h[]>();
  for (const symbol of SYMBOLS) {
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

function signalFor(symbol: string, candles: Candle1h[], fourHourCandles: Candle1h[], index: number, variant: Variant): Signal | null {
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
  const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0
    ? fourHour!.close / fourHourCandles[fourHourIndex - 3].close - 1
    : 0;

  if (breakoutPct < variant.breakoutPct) return null;
  if (volRatio < variant.minVolRatio) return null;
  if (mom6 < variant.minMom6) return null;
  if (mom24 < variant.minMom24) return null;
  if (fourHourMom < variant.minFourHourMom) return null;
  if (oneHourJump > variant.maxOneHourJump) return null;
  if (closeLocation < variant.minCloseLocation) return null;

  const score = mom6 * 110 + mom24 * 90 + fourHourMom * 100 + breakoutPct * 170 + Math.min(3.5, volRatio) * 2 + closeLocation * 3;
  return score >= variant.minScore ? { symbol, ts: bar.ts, close: bar.close, score, variant } : null;
}

function simulate(candlesBySymbol: Map<string, Candle1h[]>, windows: readonly Window[], strategy: typeof STRATEGIES[number]) {
  const indexBySymbol = new Map<string, Map<number, number>>();
  const fourHourBySymbol = new Map<string, Candle1h[]>();
  const tsSet = new Set<number>();
  for (const symbol of SYMBOLS) {
    const candles = candlesBySymbol.get(symbol) ?? [];
    indexBySymbol.set(symbol, buildIndex(candles));
    fourHourBySymbol.set(symbol, resampleToHours(candles, 4));
    candles.forEach((bar) => {
      if (windowFor(bar.ts, windows)) tsSet.add(bar.ts);
    });
  }

  const trades: Trade[] = [];
  let open: null | (Trade & { peakPrice: number; maxExitTs: number; activeWindowEndTs: number; variantRef: Variant }) = null;

  for (const ts of [...tsSet].sort((left, right) => left - right)) {
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
      trades.push({
        symbol: open.symbol,
        variant: open.variant,
        entryTs: open.entryTs,
        exitTs: ts,
        entryPrice: open.entryPrice,
        exitPrice: bar.close,
        netReturnPct: bar.close / open.entryPrice - 1 - (quoteLossPct / 100) * 2 - FEE_RATE * 2,
        exitReason,
      });
      open = null;
      continue;
    }

    const window = windowFor(ts, windows);
    if (!window) continue;
    const windowHours = (window.endTs - window.startTs) / HOUR_MS;
    const signals: Signal[] = [];
    for (const rule of strategy.rules) {
      if (windowHours < rule.minWindowHours || windowHours > rule.maxWindowHours) continue;
      for (const symbol of rule.symbols) {
        const candles = candlesBySymbol.get(symbol) ?? [];
        const index = indexBySymbol.get(symbol)?.get(ts);
        if (index == null) continue;
        const signal = signalFor(symbol, candles, fourHourBySymbol.get(symbol) ?? [], index, rule.variant);
        if (signal) signals.push(signal);
      }
    }
    signals.sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    const maxExitTs = Math.min(ts + best.variant.maxHoldHours * HOUR_MS, window.endTs);
    if (maxExitTs <= ts) continue;
    open = {
      symbol: best.symbol,
      variant: best.variant.key,
      entryTs: ts,
      exitTs: ts,
      entryPrice: best.close,
      exitPrice: best.close,
      netReturnPct: 0,
      exitReason: "open",
      peakPrice: best.close,
      maxExitTs,
      activeWindowEndTs: window.endTs,
      variantRef: best.variant,
    };
  }
  return trades;
}

function summarizeTrades(trades: Trade[]) {
  const pnl = trades.reduce((sum, trade) => sum + trade.netReturnPct * CAP_USD, 0);
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const gains = wins.reduce((sum, trade) => sum + trade.netReturnPct * CAP_USD, 0);
  const losses = trades.filter((trade) => trade.netReturnPct < 0).reduce((sum, trade) => sum + Math.abs(trade.netReturnPct * CAP_USD), 0);
  const hours = trades.reduce((sum, trade) => sum + Math.max(0, trade.exitTs - trade.entryTs) / HOUR_MS, 0);
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pf: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : 0,
    cap300Pnl: round(pnl, 2),
    addedDays: round(hours / 24, 2),
    bySymbol: Object.fromEntries(SYMBOLS.map((symbol) => [
      symbol,
      {
        trades: trades.filter((trade) => trade.symbol === symbol).length,
        pnl: round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.netReturnPct * CAP_USD, 0), 2),
      },
    ]).filter(([, value]) => value.trades > 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  for (const period of PERIODS) {
    const baseline = await runHybridBacktest("RETQ22", { ...baseOptions(period), label: `v7_idle_window_regime_${period.key}` });
    const windows = cashWindowsFromBaseline(baseline);
    const v7CashPct = 100 - baseline.summary.exposure_pct;
    const periodHours = (period.endTs - period.startTs + 1) / HOUR_MS;
    const candles = await loadCandles(period.startTs, period.endTs);
    for (const strategy of STRATEGIES) {
      const trades = simulate(candles, windows, strategy);
      const summary = summarizeTrades(trades);
      const addedExposurePct = (summary.addedDays * 24 / periodHours) * 100;
      rows.push({
        period: period.key,
        strategy: strategy.key,
        v7End: round(baseline.summary.end_equity, 2),
        v7CashPct: round(v7CashPct, 2),
        estimatedCashPctAfter: round(Math.max(0, v7CashPct - addedExposurePct), 2),
        cashReductionPt: round(Math.min(v7CashPct, addedExposurePct), 3),
        ...summary,
      });
      console.log(`${period.key} ${strategy.key}: pnl=${summary.cap300Pnl}, trades=${summary.trades}, cash ${round(v7CashPct, 2)} -> ${round(Math.max(0, v7CashPct - addedExposurePct), 2)}`);
    }
  }

  const md = [
    "# V7 Idle Window Regime Sidecar",
    "",
    "- method: engine-direct V7 cash windows + window-length sidecar simulation",
    "- cap: 300 USDT",
    "- short windows: ZBT early_24h",
    "- medium windows: BIO/DUSK confirmed_48h",
    "- long windows: PENDLE confirmed_48h or DEXE slow_follow_240h depending on strategy",
    "",
    "| period | strategy | V7 USDT % | USDT after % | reduction pt | trades | win % | PF | cap300 PnL | added days | by symbol |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.period} | ${row.strategy} | ${row.v7CashPct} | ${row.estimatedCashPctAfter} | ${row.cashReductionPt} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.cap300Pnl} | ${row.addedDays} | ${JSON.stringify(row.bySymbol)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
