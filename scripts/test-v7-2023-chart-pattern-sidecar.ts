import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { Candle1h, EquityPoint } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2023-chart-pattern-sidecar");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2023, 0, 1);
const END_TS = Date.UTC(2023, 11, 31, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

type SymbolKey = "DOGE" | "AVAX";
type PatternMode = "downtrend_break" | "halfback_rebreak";
type Signal = {
  symbol: SymbolKey;
  mode: PatternMode;
  ts: number;
  price: number;
  score: number;
  reason: string;
};
type Trade = Signal & {
  exitTs: number;
  exitPrice: number;
  netReturnPct: number;
  netPnl: number;
  notionalUsd: number;
  exitReason: string;
  basePosition: string;
};
type Params = {
  key: string;
  symbols: SymbolKey[];
  capitalMode: "cash_only" | "equity_theoretical";
  cashFraction: number;
  minCashRatio: number;
  minVolumeRatio: number;
  minImpulsePct: number;
  trendLookback: number;
  trailActivationPct: number;
  trailRetracePct: number;
  hardStopPct: number;
  maxHoldHours: number;
};

const PARAMS: Params[] = [
  {
    key: "doge_avax_cash25_balanced",
    symbols: ["DOGE", "AVAX"],
    capitalMode: "cash_only",
    cashFraction: 0.25,
    minCashRatio: 0.05,
    minVolumeRatio: 1.02,
    minImpulsePct: 0.18,
    trendLookback: 96,
    trailActivationPct: 0.18,
    trailRetracePct: 0.08,
    hardStopPct: 0.09,
    maxHoldHours: 24 * 14,
  },
  {
    key: "doge_avax_cash50_balanced",
    symbols: ["DOGE", "AVAX"],
    capitalMode: "cash_only",
    cashFraction: 0.5,
    minCashRatio: 0.05,
    minVolumeRatio: 1.02,
    minImpulsePct: 0.18,
    trendLookback: 96,
    trailActivationPct: 0.18,
    trailRetracePct: 0.08,
    hardStopPct: 0.09,
    maxHoldHours: 24 * 14,
  },
  {
    key: "doge_avax_cash25_strict",
    symbols: ["DOGE", "AVAX"],
    capitalMode: "cash_only",
    cashFraction: 0.25,
    minCashRatio: 0.05,
    minVolumeRatio: 1.15,
    minImpulsePct: 0.25,
    trendLookback: 120,
    trailActivationPct: 0.22,
    trailRetracePct: 0.1,
    hardStopPct: 0.08,
    maxHoldHours: 24 * 18,
  },
  {
    key: "doge_avax_cash50_strict",
    symbols: ["DOGE", "AVAX"],
    capitalMode: "cash_only",
    cashFraction: 0.5,
    minCashRatio: 0.05,
    minVolumeRatio: 1.15,
    minImpulsePct: 0.25,
    trendLookback: 120,
    trailActivationPct: 0.22,
    trailRetracePct: 0.1,
    hardStopPct: 0.08,
    maxHoldHours: 24 * 18,
  },
  {
    key: "doge_avax_equity25_theoretical",
    symbols: ["DOGE", "AVAX"],
    capitalMode: "equity_theoretical",
    cashFraction: 0.25,
    minCashRatio: 0,
    minVolumeRatio: 1.02,
    minImpulsePct: 0.18,
    trendLookback: 96,
    trailActivationPct: 0.18,
    trailRetracePct: 0.08,
    hardStopPct: 0.09,
    maxHoldHours: 24 * 14,
  },
  {
    key: "doge_avax_equity50_theoretical",
    symbols: ["DOGE", "AVAX"],
    capitalMode: "equity_theoretical",
    cashFraction: 0.5,
    minCashRatio: 0,
    minVolumeRatio: 1.02,
    minImpulsePct: 0.18,
    trendLookback: 96,
    trailActivationPct: 0.18,
    trailRetracePct: 0.08,
    hardStopPct: 0.09,
    maxHoldHours: 24 * 14,
  },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function iso(ts: number) {
  return new Date(ts).toISOString();
}

function regression(values: number[]) {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = average(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  const slope = denominator > 0 ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  return { slope, intercept, projected: intercept + slope * n };
}

function buildIndicators(candles: Candle1h[]) {
  const closes = candles.map((bar) => bar.close);
  const highs = candles.map((bar) => bar.high);
  const lows = candles.map((bar) => bar.low);
  const volumes = candles.map((bar) => bar.volume);
  return candles.map((bar, index) => {
    const sma20 = index >= 19 ? average(closes.slice(index - 19, index + 1)) : 0;
    const sma40 = index >= 39 ? average(closes.slice(index - 39, index + 1)) : 0;
    const sma120 = index >= 119 ? average(closes.slice(index - 119, index + 1)) : 0;
    const volAvg20 = index >= 19 ? average(volumes.slice(index - 19, index + 1)) : 0;
    const mom20 = index >= 20 ? bar.close / candles[index - 20].close - 1 : 0;
    const priorHigh12 = index >= 12 ? Math.max(...highs.slice(index - 12, index)) : 0;
    const low40 = index >= 40 ? Math.min(...lows.slice(index - 40, index + 1)) : 0;
    const high80 = index >= 80 ? Math.max(...highs.slice(index - 80, index + 1)) : 0;
    return { ...bar, sma20, sma40, sma120, volAvg20, mom20, priorHigh12, low40, high80 };
  });
}

function trendlineBreakSignal(symbol: SymbolKey, candles: Candle1h[], indicators: ReturnType<typeof buildIndicators>, index: number, params: Params): Signal | null {
  if (index < params.trendLookback + 20) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prev = candles[index - 1];
  const prevInd = indicators[index - 1];
  const highs = candles.slice(index - params.trendLookback, index).map((item) => item.high);
  const reg = regression(highs);
  const prevProjected = reg.intercept + reg.slope * (params.trendLookback - 1);
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const lineSlopePct = reg.slope / Math.max(0.0000001, average(highs));
  const breakPct = reg.projected > 0 ? bar.close / reg.projected - 1 : 0;

  if (lineSlopePct > -0.0007) return null;
  if (prev.close > prevProjected) return null;
  if (breakPct < 0.006) return null;
  if (bar.close <= ind.sma40) return null;
  if (ind.mom20 < 0.015) return null;
  if (volumeRatio < params.minVolumeRatio) return null;

  const score = breakPct * 220 + ind.mom20 * 120 + Math.min(3, volumeRatio) * 5 + Math.abs(lineSlopePct) * 1000;
  return {
    symbol,
    mode: "downtrend_break",
    ts: bar.ts,
    price: bar.close,
    score,
    reason: `downtrend line break ${round(breakPct * 100, 2)}%, volume ${round(volumeRatio, 2)}x`,
  };
}

function halfbackRebreakSignal(symbol: SymbolKey, candles: Candle1h[], indicators: ReturnType<typeof buildIndicators>, index: number, params: Params): Signal | null {
  if (index < 140) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  if (bar.close <= ind.priorHigh12) return null;
  if (bar.close <= ind.sma20 || ind.sma20 <= ind.sma40) return null;
  if (volumeRatio < params.minVolumeRatio) return null;

  const window = candles.slice(index - 120, index + 1);
  let lowIdx = 0;
  for (let i = 1; i < window.length; i += 1) {
    if (window[i].low < window[lowIdx].low) lowIdx = i;
  }
  if (lowIdx > 75) return null;
  let highIdx = lowIdx;
  for (let i = lowIdx + 1; i < window.length; i += 1) {
    if (window[i].high > window[highIdx].high) highIdx = i;
  }
  if (highIdx <= lowIdx + 8 || highIdx > window.length - 8) return null;
  const impulseLow = window[lowIdx].low;
  const impulseHigh = window[highIdx].high;
  const impulsePct = impulseHigh / impulseLow - 1;
  if (impulsePct < params.minImpulsePct) return null;
  const pullbackLow = Math.min(...window.slice(highIdx, window.length).map((item) => item.low));
  const retrace = (impulseHigh - pullbackLow) / Math.max(0.0000001, impulseHigh - impulseLow);
  if (retrace < 0.32 || retrace > 0.68) return null;
  if (bar.close < impulseLow + (impulseHigh - impulseLow) * 0.5) return null;

  const score = impulsePct * 80 + (1 - Math.abs(retrace - 0.5)) * 25 + volumeRatio * 4 + ind.mom20 * 100;
  return {
    symbol,
    mode: "halfback_rebreak",
    ts: bar.ts,
    price: bar.close,
    score,
    reason: `halfback rebreak impulse ${round(impulsePct * 100, 1)}%, retrace ${round(retrace * 100, 1)}%`,
  };
}

function detectSignals(symbol: SymbolKey, candles: Candle1h[], params: Params) {
  const indicators = buildIndicators(candles);
  const signals: Signal[] = [];
  let lastSignalTs = 0;
  for (let i = 0; i < candles.length; i += 1) {
    if (candles[i].ts < START_TS || candles[i].ts > END_TS) continue;
    if (candles[i].ts - lastSignalTs < 48 * HOUR_MS) continue;
    const halfback = halfbackRebreakSignal(symbol, candles, indicators, i, params);
    const trendBreak = trendlineBreakSignal(symbol, candles, indicators, i, params);
    const chosen = [halfback, trendBreak]
      .filter(Boolean)
      .sort((left, right) => (right as Signal).score - (left as Signal).score)[0] as Signal | undefined;
    if (chosen) {
      signals.push(chosen);
      lastSignalTs = chosen.ts;
    }
  }
  return signals;
}

function pointAtOrBefore(points: EquityPoint[], ts: number) {
  let lo = 0;
  let hi = points.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (points[mid].ts <= ts) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? points[best] : null;
}

function simulateTrade(signal: Signal, candles: Candle1h[], params: Params, notionalUsd: number, basePosition: string): Trade | null {
  const entryIndex = candles.findIndex((bar) => bar.ts >= signal.ts);
  if (entryIndex < 0 || entryIndex >= candles.length - 2) return null;
  const entryPrice = candles[entryIndex].close;
  let peak = entryPrice;
  let exit = candles[Math.min(candles.length - 1, entryIndex + params.maxHoldHours)];
  let exitReason = "max-hold";
  for (let i = entryIndex + 1; i < candles.length && i <= entryIndex + params.maxHoldHours; i += 1) {
    const bar = candles[i];
    peak = Math.max(peak, bar.high);
    if (bar.low <= entryPrice * (1 - params.hardStopPct)) {
      exit = { ...bar, close: entryPrice * (1 - params.hardStopPct) };
      exitReason = "hard-stop";
      break;
    }
    if (peak >= entryPrice * (1 + params.trailActivationPct) && bar.close <= peak * (1 - params.trailRetracePct)) {
      exit = bar;
      exitReason = "profit-trail";
      break;
    }
  }
  const grossReturn = exit.close / entryPrice - 1;
  const netReturn = grossReturn - (FEE_RATE * 2);
  return {
    ...signal,
    exitTs: exit.ts,
    exitPrice: exit.close,
    netReturnPct: netReturn * 100,
    netPnl: notionalUsd * netReturn,
    notionalUsd,
    exitReason,
    basePosition,
  };
}

function simulate(params: Params, equityPoints: EquityPoint[], candlesBySymbol: Record<SymbolKey, Candle1h[]>) {
  const allSignals = params.symbols
    .flatMap((symbol) => detectSignals(symbol, candlesBySymbol[symbol], params))
    .sort((left, right) => left.ts - right.ts || right.score - left.score);
  const trades: Trade[] = [];
  let busyUntil = 0;
  for (const signal of allSignals) {
    if (signal.ts < busyUntil) continue;
    const point = pointAtOrBefore(equityPoints, signal.ts);
    if (!point) continue;
    if (
      params.capitalMode === "cash_only" &&
      (point.cash < 25 || point.cash / Math.max(1, point.equity) < params.minCashRatio)
    ) {
      continue;
    }
    const baseCapital = params.capitalMode === "cash_only" ? point.cash : point.equity;
    const notionalUsd = baseCapital * params.cashFraction;
    const trade = simulateTrade(signal, candlesBySymbol[signal.symbol], params, notionalUsd, point.position_symbol);
    if (!trade) continue;
    trades.push(trade);
    busyUntil = trade.exitTs;
  }
  const addedPnl = trades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const wins = trades.filter((trade) => trade.netPnl > 0).length;
  const losses = trades.length - wins;
  return {
    params,
    signals: allSignals.length,
    trades,
    addedPnl,
    wins,
    losses,
    winPct: trades.length ? wins / trades.length * 100 : 0,
  };
}

function toMarkdown(baseEndEquity: number, rows: ReturnType<typeof simulate>[]) {
  const table = rows
    .sort((left, right) => right.addedPnl - left.addedPnl)
    .map((row) => `| ${row.params.key} | ${row.signals} | ${row.trades.length} | ${round(row.winPct, 1)}% | ${round(row.addedPnl, 2).toLocaleString()} | ${round(baseEndEquity + row.addedPnl, 2).toLocaleString()} |`)
    .join("\n");
  const best = [...rows].sort((left, right) => right.addedPnl - left.addedPnl)[0];
  const tradeLines = best.trades
    .map((trade, index) => `| ${index + 1} | ${trade.symbol} | ${trade.mode} | ${iso(trade.ts)} | ${iso(trade.exitTs)} | ${round(trade.price, 6)} | ${round(trade.exitPrice, 6)} | ${round(trade.netReturnPct, 2)}% | ${round(trade.netPnl, 2).toLocaleString()} | ${trade.exitReason} | ${trade.basePosition} | ${trade.reason} |`)
    .join("\n");
  return [
    "# V7 2023 Chart Pattern Sidecar Test",
    "",
    "- Scope: 2023 only",
    "- Symbols: DOGE / AVAX",
    "- Entry ideas: downtrend line break, halfback rebreak continuation",
    "- Constraint: only uses V7 cash/USDT sleeve, so this is a conservative first test.",
    "",
    `Baseline End Equity: ${round(baseEndEquity, 2).toLocaleString()}`,
    "",
    "## Results",
    "",
    "| variant | detected signals | executed trades | win | added PnL | end equity |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    table,
    "",
    "## Best Variant Trades",
    "",
    `Best: ${best.params.key}`,
    "",
    "| # | symbol | mode | entry | exit | entry price | exit price | net return | net pnl | exit | base position | reason |",
    "| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |",
    tradeLines || "| - | - | - | - | - | - | - | - | - | - | - | - |",
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const options: HybridVariantOptions = {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_2023_chart_pattern_base",
  };
  const base = await runHybridBacktest("RETQ22", options);
  const equityPoints = [...base.equity_curve].sort((left, right) => left.ts - right.ts);
  const [doge, avax] = await Promise.all([
    loadHistoricalCandles({ symbol: "DOGEUSDT", interval: "1h", startMs: START_TS - 160 * 24 * HOUR_MS, endMs: END_TS, cacheRoot: CACHE_ROOT }),
    loadHistoricalCandles({ symbol: "AVAXUSDT", interval: "1h", startMs: START_TS - 160 * 24 * HOUR_MS, endMs: END_TS, cacheRoot: CACHE_ROOT }),
  ]);
  const rows = PARAMS.map((params) => simulate(params, equityPoints, { DOGE: doge, AVAX: avax }));
  const markdown = toMarkdown(base.summary.end_equity, rows);
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ baseline: base.summary, rows }, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
