import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  RECLAIM_HYBRID_SLIPPAGE_BPS,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { buildIndicatorBars, resampleTo12h } from "../lib/backtest/indicators";
import type { Candle1h, EquityPoint, IndicatorBar } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-twt12-sleeve-filter-grid");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2022, 0, 1);
const END_TS = Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

type TWTFilter = {
  key: string;
  sleeveFraction: number;
  minMom20: number;
  minBreakoutPct: number;
  minVolumeRatio: number;
  minEfficiency: number;
  minAdx14: number;
  maxOverheatPct: number | null;
  maxHoldHours: number;
  hardStopPct: number;
  trailActivationPct: number;
  trailRetracePct: number;
  weakExitMinHours: number;
};

type Signal = {
  ts: number;
  close: number;
  score: number;
  barIndex: number;
};

type Trade = {
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  notionalUsd: number;
  netPnl: number;
  netReturnPct: number;
  exitReason: string;
  mainSymbolAtEntry: string;
};

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

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_twt12_sleeve_filter_grid_base",
  };
}

function findPointAtOrBefore(points: EquityPoint[], ts: number) {
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

function pathEfficiency(candles: Candle1h[], index: number, lookback: number) {
  if (index < lookback) return 0;
  const start = candles[index - lookback].close;
  const end = candles[index].close;
  const path = candles.slice(index - lookback + 1, index + 1)
    .reduce((sum, bar, offset) => {
      const prev = candles[index - lookback + offset].close;
      return sum + Math.abs(bar.close / prev - 1);
    }, 0);
  return path > 0 ? Math.abs(end / start - 1) / path : 0;
}

function slippageRate(symbol: string) {
  return (RECLAIM_HYBRID_SLIPPAGE_BPS[`${symbol}_USDT`] ?? 100) / 10000;
}

function signalFor(candles: Candle1h[], indicators: IndicatorBar[], index: number, filter: TWTFilter): Signal | null {
  const lookback = 8;
  if (index < 90) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prevHigh = Math.max(...candles.slice(index - lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const efficiency = pathEfficiency(candles, index, lookback);
  if (!ind.ready) return null;
  if (bar.close <= ind.sma40) return null;
  if (ind.mom20 < filter.minMom20) return null;
  if (breakoutPct < filter.minBreakoutPct) return null;
  if (volumeRatio < filter.minVolumeRatio) return null;
  if (ind.momAccel < 0.0005) return null;
  if (efficiency < filter.minEfficiency) return null;
  if (ind.adx14 < filter.minAdx14) return null;
  if (filter.maxOverheatPct != null && ind.overheatPct > filter.maxOverheatPct) return null;
  const score = ind.mom20 * 100 + ind.momAccel * 180 + breakoutPct * 150 + Math.min(4, volumeRatio) * 4 + efficiency * 18 + ind.adx14 * 0.15;
  return { ts: bar.ts, close: bar.close, score, barIndex: index };
}

function buildFilters() {
  const out: TWTFilter[] = [];
  const fractions = [0.5, 0.75];
  const minMom20Values = [0, 0.03, 0.06, 0.09, 0.12];
  const minBreakoutValues = [0.012, 0.018, 0.024, 0.032];
  const minVolumeValues = [1.01, 1.08, 1.15, 1.25];
  const minEfficiencyValues = [0.17, 0.22, 0.28, 0.35];
  const minAdxValues = [0, 18, 22, 26];
  const maxOverheatValues: Array<number | null> = [null, 0.28, 0.2];
  for (const sleeveFraction of fractions) {
    for (const minMom20 of minMom20Values) {
      for (const minBreakoutPct of minBreakoutValues) {
        for (const minVolumeRatio of minVolumeValues) {
          for (const minEfficiency of minEfficiencyValues) {
            for (const minAdx14 of minAdxValues) {
              for (const maxOverheatPct of maxOverheatValues) {
                out.push({
                  key: [
                    `alloc${Math.round(sleeveFraction * 100)}`,
                    `mom${Math.round(minMom20 * 100)}`,
                    `bo${Math.round(minBreakoutPct * 1000)}`,
                    `vol${Math.round(minVolumeRatio * 100)}`,
                    `eff${Math.round(minEfficiency * 100)}`,
                    `adx${minAdx14}`,
                    maxOverheatPct == null ? "ohAny" : `oh${Math.round(maxOverheatPct * 100)}`,
                  ].join("_"),
                  sleeveFraction,
                  minMom20,
                  minBreakoutPct,
                  minVolumeRatio,
                  minEfficiency,
                  minAdx14,
                  maxOverheatPct,
                  maxHoldHours: 240,
                  hardStopPct: 0.08,
                  trailActivationPct: 0.15,
                  trailRetracePct: 0.08,
                  weakExitMinHours: 24,
                });
              }
            }
          }
        }
      }
    }
  }
  return out;
}

function simulate(input: {
  filter: TWTFilter;
  equityPoints: EquityPoint[];
  candles: Candle1h[];
  indicators: IndicatorBar[];
}) {
  const { filter, equityPoints, candles, indicators } = input;
  const indexByTs = new Map<number, number>();
  const signals = new Map<number, Signal>();
  candles.forEach((bar, index) => {
    indexByTs.set(bar.ts, index);
    if (bar.ts < START_TS || bar.ts > END_TS) return;
    const signal = signalFor(candles, indicators, index, filter);
    if (signal) signals.set(bar.ts, signal);
  });

  const trades: Trade[] = [];
  let realizedPnl = 0;
  let open: (Signal & { notionalUsd: number; peakPrice: number; mainSymbolAtEntry: string }) | null = null;
  const curve: Array<{ ts: number; equity: number }> = [];

  for (const bar of candles) {
    if (bar.ts < START_TS || bar.ts > END_TS) continue;
    const point = findPointAtOrBefore(equityPoints, bar.ts);
    if (!point) continue;

    if (open) {
      open.peakPrice = Math.max(open.peakPrice, bar.high);
      const ind = indicators[indexByTs.get(bar.ts) ?? -1];
      const holdingHours = (bar.ts - open.ts) / HOUR_MS;
      const grossReturn = bar.close / open.close - 1;
      const retraceFromPeak = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
      const roundTripCost = FEE_RATE * 2 + slippageRate("TWT") * 2;
      let exitReason: string | null = null;
      if (grossReturn <= -filter.hardStopPct) exitReason = "hard-stop";
      if (!exitReason && grossReturn >= filter.trailActivationPct && retraceFromPeak <= -filter.trailRetracePct) exitReason = "profit-trail";
      if (!exitReason && holdingHours >= filter.weakExitMinHours && ind && bar.close < ind.sma40 && ind.mom20 < 0) exitReason = "weak-exit";
      if (!exitReason && holdingHours >= filter.maxHoldHours) exitReason = "max-hold";

      if (exitReason) {
        const netReturnPct = grossReturn - roundTripCost;
        const netPnl = open.notionalUsd * netReturnPct;
        realizedPnl += netPnl;
        trades.push({
          entryTs: open.ts,
          exitTs: bar.ts,
          entryPrice: open.close,
          exitPrice: bar.close,
          notionalUsd: open.notionalUsd,
          netPnl,
          netReturnPct: netReturnPct * 100,
          exitReason,
          mainSymbolAtEntry: open.mainSymbolAtEntry,
        });
        open = null;
      }
    }

    const unrealized = open ? open.notionalUsd * (bar.close / open.close - 1 - FEE_RATE - slippageRate("TWT")) : 0;
    curve.push({ ts: bar.ts, equity: point.equity + realizedPnl + unrealized });

    if (open) continue;
    if (point.cash < 25 || point.cash / Math.max(1, point.equity) < 0.05) continue;
    if (point.position_symbol.toUpperCase() === "TWT") continue;
    const signal = signals.get(bar.ts);
    if (!signal) continue;
    const notionalUsd = point.cash * filter.sleeveFraction;
    if (notionalUsd < 25) continue;
    open = { ...signal, notionalUsd, peakPrice: signal.close, mainSymbolAtEntry: point.position_symbol };
  }

  const gains = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const losses = trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);
  let peak = curve[0]?.equity ?? equityPoints.at(-1)?.equity ?? 0;
  let maxDd = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    maxDd = Math.min(maxDd, point.equity / peak - 1);
  }

  return {
    filter,
    trades,
    addedPnl: realizedPnl,
    endEquity: (equityPoints.at(-1)?.equity ?? 0) + realizedPnl,
    maxDdPct: maxDd * 100,
    pf: losses > 0 ? gains / losses : gains > 0 ? 999 : 0,
    winPct: trades.filter((trade) => trade.netPnl > 0).length / Math.max(1, trades.length) * 100,
  };
}

async function main() {
  process.env.BT_USE_FRAME_SNAPSHOT ??= "1";
  await fs.mkdir(REPORT_DIR, { recursive: true });
  console.log(`[baseline] ${iso(START_TS)} - ${iso(END_TS)}`);
  const baseline = await runHybridBacktest("RETQ22", baseOptions());
  const equityPoints = [...baseline.equity_curve].sort((left, right) => left.ts - right.ts);
  console.log(`[baseline] end=${round(baseline.summary.end_equity)} dd=${round(baseline.summary.max_drawdown_pct)} pf=${round(baseline.summary.profit_factor, 3)}`);

  const raw = await loadHistoricalCandles({
    symbol: "TWTUSDT",
    cacheRoot: CACHE_ROOT,
    startMs: START_TS - 140 * 24 * HOUR_MS,
    endMs: END_TS,
    interval: "1h",
  });
  const candles = resampleTo12h(raw).filter((bar) => bar.ts >= START_TS - 120 * 24 * HOUR_MS && bar.ts <= END_TS);
  const indicators = buildIndicatorBars(candles);
  const filters = buildFilters();
  console.log(`[grid] filters=${filters.length}`);

  const rows = filters.map((filter) => simulate({ filter, equityPoints, candles, indicators }))
    .filter((row) => row.trades.length >= 2)
    .sort((left, right) => {
      const leftScore = (left.endEquity - baseline.summary.end_equity) - Math.max(0, Math.abs(left.maxDdPct) - Math.abs(baseline.summary.max_drawdown_pct)) * 750000;
      const rightScore = (right.endEquity - baseline.summary.end_equity) - Math.max(0, Math.abs(right.maxDdPct) - Math.abs(baseline.summary.max_drawdown_pct)) * 750000;
      return rightScore - leftScore;
    });

  const bestProfit = [...rows].sort((left, right) => right.endEquity - left.endEquity).slice(0, 20);
  const bestBalanced = rows.slice(0, 30);
  const bestWin = [...rows]
    .filter((row) => row.addedPnl > 0)
    .sort((left, right) => right.winPct - left.winPct || right.endEquity - left.endEquity)
    .slice(0, 20);

  const line = (row: typeof rows[number]) => `| ${row.filter.key} | ${round(row.endEquity, 2)} | ${round(row.endEquity - baseline.summary.end_equity, 2)} | ${round(row.maxDdPct, 2)}% | ${round(row.pf, 3)} | ${round(row.winPct, 1)} | ${row.trades.length} | ${round(row.filter.sleeveFraction * 100)}% | ${row.filter.minMom20} | ${row.filter.minBreakoutPct} | ${row.filter.minVolumeRatio} | ${row.filter.minEfficiency} | ${row.filter.minAdx14} | ${row.filter.maxOverheatPct ?? "any"} |`;
  const table = (title: string, list: typeof rows) => [
    `## ${title}`,
    "",
    "| key | End Equity | vs baseline | MaxDD | PF | win % | trades | alloc | mom20 | breakout | volume | efficiency | adx | maxOverheat |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...list.map(line),
    "",
  ].join("\n");

  const md = [
    "# V7 TWT12 USDT Sleeve Filter Grid",
    "",
    `- period: ${iso(START_TS)} - ${iso(END_TS)}`,
    "- baseline: current V7 live-equivalent engine-direct",
    "- test: keep the main V7 position unchanged and trade TWT 12H using only the remaining USDT sleeve",
    "- filters: no year-specific rule; only momentum, breakout, volume, efficiency, ADX and overheat gates",
    "",
    `Baseline End Equity: ${round(baseline.summary.end_equity, 2)}`,
    `Baseline MaxDD: ${round(baseline.summary.max_drawdown_pct, 2)}%`,
    `Baseline PF: ${round(baseline.summary.profit_factor, 3)}`,
    "",
    table("Best Balanced", bestBalanced),
    table("Best Profit", bestProfit),
    table("Best Win Rate With Positive PnL", bestWin),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ baseline: baseline.summary, rows }, null, 2), "utf8");
  console.log(`[done] ${path.join(REPORT_DIR, "summary.md")}`);
  for (const row of bestBalanced.slice(0, 10)) {
    console.log(`${row.filter.key}: end=${round(row.endEquity)} diff=${round(row.endEquity - baseline.summary.end_equity)} dd=${round(row.maxDdPct)} win=${round(row.winPct, 1)} trades=${row.trades.length} pf=${round(row.pf, 3)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
