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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-usdt-sleeve-sidecar");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Number(process.env.BT_START_TS ?? Date.UTC(2022, 0, 1));
const END_TS = Number(process.env.BT_END_TS ?? Date.UTC(2026, 3, 29, 23, 59, 59, 999));
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

type Candidate = "PENGU15" | "TWT15" | "TWT12";
type SleeveMode = "all_available_usdt" | "doge_only_usdt";
type SleeveVariant = {
  key: string;
  sleeveFraction: number;
  mode: SleeveMode;
  candidates: Candidate[];
};
type Signal = {
  candidate: Candidate;
  symbol: "PENGU" | "TWT";
  ts: number;
  close: number;
  score: number;
  barIndex: number;
};
type SidecarTrade = {
  candidate: Candidate;
  symbol: "PENGU" | "TWT";
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  notionalUsd: number;
  grossReturnPct: number;
  netReturnPct: number;
  netPnl: number;
  exitReason: string;
  mainSymbolAtEntry: string;
};

const VARIANTS: SleeveVariant[] = [
  { key: "pengu15_all_usdt_25pct", sleeveFraction: 0.25, mode: "all_available_usdt", candidates: ["PENGU15"] },
  { key: "pengu15_all_usdt_50pct", sleeveFraction: 0.5, mode: "all_available_usdt", candidates: ["PENGU15"] },
  { key: "pengu15_all_usdt_100pct", sleeveFraction: 1, mode: "all_available_usdt", candidates: ["PENGU15"] },
  { key: "twt12_all_usdt_25pct", sleeveFraction: 0.25, mode: "all_available_usdt", candidates: ["TWT12"] },
  { key: "twt12_all_usdt_50pct", sleeveFraction: 0.5, mode: "all_available_usdt", candidates: ["TWT12"] },
  { key: "twt12_all_usdt_75pct", sleeveFraction: 0.75, mode: "all_available_usdt", candidates: ["TWT12"] },
  { key: "twt12_all_usdt_100pct", sleeveFraction: 1, mode: "all_available_usdt", candidates: ["TWT12"] },
  { key: "twt15_all_usdt_25pct", sleeveFraction: 0.25, mode: "all_available_usdt", candidates: ["TWT15"] },
  { key: "twt15_all_usdt_50pct", sleeveFraction: 0.5, mode: "all_available_usdt", candidates: ["TWT15"] },
  { key: "twt15_all_usdt_75pct", sleeveFraction: 0.75, mode: "all_available_usdt", candidates: ["TWT15"] },
  { key: "twt15_all_usdt_100pct", sleeveFraction: 1, mode: "all_available_usdt", candidates: ["TWT15"] },
  { key: "pengu15_twt12_all_usdt_25pct", sleeveFraction: 0.25, mode: "all_available_usdt", candidates: ["PENGU15", "TWT12"] },
  { key: "pengu15_twt12_all_usdt_50pct", sleeveFraction: 0.5, mode: "all_available_usdt", candidates: ["PENGU15", "TWT12"] },
  { key: "pengu15_twt12_all_usdt_100pct", sleeveFraction: 1, mode: "all_available_usdt", candidates: ["PENGU15", "TWT12"] },
  { key: "doge_continues_pengu15_twt12_100pct", sleeveFraction: 1, mode: "doge_only_usdt", candidates: ["PENGU15", "TWT12"] },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function pct(value: number) {
  return `${round(value, 2)}%`;
}

function formatBreakdown(input: Record<string, { trades: number; pnl: number }>) {
  return JSON.stringify(Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, { trades: value.trades, pnl: round(value.pnl, 2) }]),
  ));
}

function iso(ts: number) {
  return new Date(ts).toISOString();
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_live_equivalent_usdt_sleeve_base",
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

function cashIsUsable(point: EquityPoint | null, variant: SleeveVariant) {
  if (!point) return false;
  if (point.cash < 25 || point.equity <= 0) return false;
  if (point.cash / point.equity < 0.05) return false;
  if (variant.mode === "doge_only_usdt") return point.position_symbol.toUpperCase() === "DOGE";
  return point.cash > 0;
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

function build15mIndicators(candles: Candle1h[]) {
  const closes = candles.map((bar) => bar.close);
  const volumes = candles.map((bar) => bar.volume);
  return candles.map((bar, index) => {
    const sma40 = index >= 39 ? average(closes.slice(index - 39, index + 1)) : 0;
    const mom20 = index >= 20 ? bar.close / candles[index - 20].close - 1 : 0;
    const mom20Prev = index >= 21 ? candles[index - 1].close / candles[index - 21].close - 1 : 0;
    const volAvg20 = index >= 19 ? average(volumes.slice(index - 19, index + 1)) : 0;
    return { ...bar, sma40, mom20, momAccel: mom20 - mom20Prev, volAvg20 };
  });
}

function pengu15Signal(candles: Candle1h[], indicators: ReturnType<typeof build15mIndicators>, index: number): Signal | null {
  const lookback = 16;
  if (index < 90) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prevHigh = Math.max(...candles.slice(index - lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const efficiency = pathEfficiency(candles, index, lookback);
  if (bar.close <= ind.sma40) return null;
  if (breakoutPct < 0.006) return null;
  if (volumeRatio < 1.15) return null;
  if (ind.momAccel < 0.0015) return null;
  if (efficiency < 0.18) return null;
  const score = ind.mom20 * 100 + ind.momAccel * 200 + breakoutPct * 160 + Math.min(4, volumeRatio) * 4 + efficiency * 20;
  return { candidate: "PENGU15", symbol: "PENGU", ts: bar.ts, close: bar.close, score, barIndex: index };
}

function twt12Signal(candles: Candle1h[], indicators: IndicatorBar[], index: number): Signal | null {
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
  if (ind.mom20 <= 0) return null;
  if (breakoutPct < 0.012) return null;
  if (volumeRatio < 1.01) return null;
  if (ind.momAccel < 0.0005) return null;
  if (efficiency < 0.17) return null;
  const score = ind.mom20 * 100 + ind.momAccel * 180 + breakoutPct * 150 + Math.min(4, volumeRatio) * 4 + efficiency * 18;
  return { candidate: "TWT12", symbol: "TWT", ts: bar.ts, close: bar.close, score, barIndex: index };
}

function twt15Signal(candles: Candle1h[], indicators: ReturnType<typeof build15mIndicators>, index: number): Signal | null {
  const lookback = 32;
  if (index < 120) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prevHigh = Math.max(...candles.slice(index - lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const efficiency = pathEfficiency(candles, index, lookback);
  const oneBarJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
  if (bar.close <= ind.sma40) return null;
  if (ind.mom20 <= 0.015) return null;
  if (breakoutPct < 0.008) return null;
  if (volumeRatio < 1.12) return null;
  if (ind.momAccel < 0.0005) return null;
  if (efficiency < 0.14) return null;
  if (oneBarJump > 0.045) return null;
  const score = ind.mom20 * 120 + ind.momAccel * 220 + breakoutPct * 180 + Math.min(4, volumeRatio) * 4 + efficiency * 18;
  return { candidate: "TWT15", symbol: "TWT", ts: bar.ts, close: bar.close, score, barIndex: index };
}

async function loadCandles(symbol: string, interval: "15m" | "1h") {
  return loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: START_TS - 120 * 24 * HOUR_MS,
    endMs: END_TS,
    interval,
  });
}

function slippageRate(symbol: string) {
  return (RECLAIM_HYBRID_SLIPPAGE_BPS[`${symbol}_USDT`] ?? 100) / 10000;
}

function simulateVariant(input: {
  variant: SleeveVariant;
  equityPoints: EquityPoint[];
  pengu15: Candle1h[];
  pengu15Indicators: ReturnType<typeof build15mIndicators>;
  twt12: Candle1h[];
  twt12Indicators: IndicatorBar[];
  twt15: Candle1h[];
  twt15Indicators: ReturnType<typeof build15mIndicators>;
}) {
  const { variant, equityPoints, pengu15, pengu15Indicators, twt12, twt12Indicators, twt15, twt15Indicators } = input;
  const signalByTs = new Map<number, Signal[]>();
  const timelineSet = new Set<number>();
  const priceBySymbolTs = new Map<string, Candle1h>();
  const penguIndexByTs = new Map<number, number>();
  const twtIndexByTs = new Map<number, number>();
  const twt15IndexByTs = new Map<number, number>();

  if (variant.candidates.includes("PENGU15")) {
    for (let index = 0; index < pengu15.length; index += 1) {
      const bar = pengu15[index];
      if (bar.ts < START_TS || bar.ts > END_TS) continue;
      priceBySymbolTs.set(`PENGU:${bar.ts}`, bar);
      penguIndexByTs.set(bar.ts, index);
      timelineSet.add(bar.ts);
      const signal = pengu15Signal(pengu15, pengu15Indicators, index);
      if (signal) signalByTs.set(bar.ts, [...(signalByTs.get(bar.ts) ?? []), signal]);
    }
  }
  if (variant.candidates.includes("TWT15")) {
    for (let index = 0; index < twt15.length; index += 1) {
      const bar = twt15[index];
      if (bar.ts < START_TS || bar.ts > END_TS) continue;
      priceBySymbolTs.set(`TWT:${bar.ts}`, bar);
      twt15IndexByTs.set(bar.ts, index);
      timelineSet.add(bar.ts);
      const signal = twt15Signal(twt15, twt15Indicators, index);
      if (signal) signalByTs.set(bar.ts, [...(signalByTs.get(bar.ts) ?? []), signal]);
    }
  }
  if (variant.candidates.includes("TWT12")) {
    for (let index = 0; index < twt12.length; index += 1) {
      const bar = twt12[index];
      if (bar.ts < START_TS || bar.ts > END_TS) continue;
      priceBySymbolTs.set(`TWT:${bar.ts}`, bar);
      twtIndexByTs.set(bar.ts, index);
      timelineSet.add(bar.ts);
      const signal = twt12Signal(twt12, twt12Indicators, index);
      if (signal) signalByTs.set(bar.ts, [...(signalByTs.get(bar.ts) ?? []), signal]);
    }
  }

  const timeline = [...timelineSet].sort((left, right) => left - right);
  const trades: SidecarTrade[] = [];
  let open: {
    signal: Signal;
    notionalUsd: number;
    mainSymbolAtEntry: string;
    peakPrice: number;
    entryIndicatorIndex: number;
  } | null = null;
  let realizedPnl = 0;
  const combinedCurve: { ts: number; equity: number }[] = [];

  for (const ts of timeline) {
    const point = findPointAtOrBefore(equityPoints, ts);
    if (!point) continue;

    if (open) {
      const bar = priceBySymbolTs.get(`${open.signal.symbol}:${ts}`);
      if (bar) {
        open.peakPrice = Math.max(open.peakPrice, bar.high);
        const holdingHours = (ts - open.signal.ts) / HOUR_MS;
        const grossReturn = bar.close / open.signal.close - 1;
        const retraceFromPeak = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
        const roundTripCost = FEE_RATE * 2 + slippageRate(open.signal.symbol) * 2;
        let exitReason: string | null = null;

        if (open.signal.candidate === "PENGU15") {
          const currentIndex = penguIndexByTs.get(ts) ?? -1;
          const ind = currentIndex >= 0 ? pengu15Indicators[currentIndex] : null;
          const tier = [
            { activationPct: 0.05, retracePct: 0.025 },
            { activationPct: 0.18, retracePct: 0.0475 },
            { activationPct: 0.21, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ].filter((item) => grossReturn >= item.activationPct).at(-1);
          if (tier && retraceFromPeak <= -tier.retracePct) exitReason = "pengu-tiered-trail";
          if (!exitReason && holdingHours >= 1 && ind && bar.close < ind.sma40 && ind.mom20 < 0.03 && ind.momAccel < -0.01) exitReason = "pengu-weak-exit";
          if (!exitReason && holdingHours >= 36) exitReason = "pengu-max-hold";
        } else if (open.signal.candidate === "TWT12") {
          const currentIndex = twtIndexByTs.get(ts) ?? -1;
          const ind = currentIndex >= 0 ? twt12Indicators[currentIndex] : null;
          if (grossReturn <= -0.08) exitReason = "twt-hard-stop";
          if (!exitReason && grossReturn >= 0.15 && retraceFromPeak <= -0.08) exitReason = "twt-profit-trail";
          if (!exitReason && holdingHours >= 24 && ind && bar.close < ind.sma40 && ind.mom20 < 0) exitReason = "twt-weak-exit";
          if (!exitReason && holdingHours >= 240) exitReason = "twt-max-hold";
        } else {
          const currentIndex = twt15IndexByTs.get(ts) ?? -1;
          const ind = currentIndex >= 0 ? twt15Indicators[currentIndex] : null;
          if (grossReturn <= -0.065) exitReason = "twt15-hard-stop";
          if (!exitReason && grossReturn >= 0.09 && retraceFromPeak <= -0.045) exitReason = "twt15-profit-trail";
          if (!exitReason && holdingHours >= 4 && ind && bar.close < ind.sma40 && ind.mom20 < 0.005) exitReason = "twt15-weak-exit";
          if (!exitReason && holdingHours >= 48) exitReason = "twt15-max-hold";
        }

        if (exitReason) {
          const netReturnPct = grossReturn - roundTripCost;
          const netPnl = open.notionalUsd * netReturnPct;
          realizedPnl += netPnl;
          trades.push({
            candidate: open.signal.candidate,
            symbol: open.signal.symbol,
            entryTs: open.signal.ts,
            exitTs: ts,
            entryPrice: open.signal.close,
            exitPrice: bar.close,
            notionalUsd: open.notionalUsd,
            grossReturnPct: grossReturn * 100,
            netReturnPct: netReturnPct * 100,
            netPnl,
            exitReason,
            mainSymbolAtEntry: open.mainSymbolAtEntry,
          });
          open = null;
        }
      }
    }

    const openUnrealized = open
      ? (() => {
        const bar = priceBySymbolTs.get(`${open.signal.symbol}:${ts}`);
        return bar ? open.notionalUsd * (bar.close / open.signal.close - 1 - FEE_RATE - slippageRate(open.signal.symbol)) : 0;
      })()
      : 0;
    combinedCurve.push({ ts, equity: point.equity + realizedPnl + openUnrealized });

    if (open || !cashIsUsable(point, variant)) continue;
    const signals = (signalByTs.get(ts) ?? [])
      .filter((signal) => variant.candidates.includes(signal.candidate))
      .sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    if (point.position_symbol.toUpperCase() === best.symbol) continue;
    const notionalUsd = Math.max(0, point.cash * variant.sleeveFraction);
    if (notionalUsd < 25) continue;
    open = {
      signal: best,
      notionalUsd,
      mainSymbolAtEntry: point.position_symbol,
      peakPrice: best.close,
      entryIndicatorIndex: best.barIndex,
    };
  }

  const lastPoint = equityPoints.at(-1);
  const endEquity = (lastPoint?.equity ?? 0) + realizedPnl;
  let peak = combinedCurve[0]?.equity ?? endEquity;
  let maxDd = 0;
  for (const point of combinedCurve) {
    peak = Math.max(peak, point.equity);
    maxDd = Math.min(maxDd, point.equity / peak - 1);
  }
  const gains = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const losses = trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);
  return {
    variant: variant.key,
    endEquity,
    addedPnl: realizedPnl,
    maxDdPct: maxDd * 100,
    trades,
    pf: losses > 0 ? gains / losses : gains > 0 ? 999 : 0,
    winPct: trades.filter((trade) => trade.netPnl > 0).length / Math.max(1, trades.length) * 100,
    bySymbol: Object.fromEntries(["PENGU", "TWT"].map((symbol) => [
      symbol,
      {
        trades: trades.filter((trade) => trade.symbol === symbol).length,
        pnl: trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.netPnl, 0),
      },
    ])),
    byMain: Object.fromEntries([...new Set(trades.map((trade) => trade.mainSymbolAtEntry))].sort().map((symbol) => [
      symbol,
      {
        trades: trades.filter((trade) => trade.mainSymbolAtEntry === symbol).length,
        pnl: trades.filter((trade) => trade.mainSymbolAtEntry === symbol).reduce((sum, trade) => sum + trade.netPnl, 0),
      },
    ])),
  };
}

async function main() {
  process.env.BT_USE_FRAME_SNAPSHOT ??= "1";
  await fs.mkdir(REPORT_DIR, { recursive: true });

  console.log(`[baseline] ${iso(START_TS)} - ${iso(END_TS)}`);
  const baseline = await runHybridBacktest("RETQ22", baseOptions());
  const equityPoints = [...baseline.equity_curve].sort((left, right) => left.ts - right.ts);
  const cashSleeveHours = equityPoints.filter((point) => point.cash / Math.max(1, point.equity) >= 0.05).length * 12;
  console.log(`[baseline] end=${round(baseline.summary.end_equity)} maxDD=${round(baseline.summary.max_drawdown_pct)} cashSleeveHours~${round(cashSleeveHours)}`);

  const [pengu15Raw, twt1hRaw, twt15Raw] = await Promise.all([
    loadCandles("PENGU", "15m"),
    loadCandles("TWT", "1h"),
    loadCandles("TWT", "15m"),
  ]);
  const pengu15 = pengu15Raw.filter((bar) => bar.ts >= START_TS - 30 * 24 * HOUR_MS && bar.ts <= END_TS);
  const pengu15Indicators = build15mIndicators(pengu15);
  const twt12 = resampleTo12h(twt1hRaw).filter((bar) => bar.ts >= START_TS - 120 * 24 * HOUR_MS && bar.ts <= END_TS);
  const twt12Indicators = buildIndicatorBars(twt12);
  const twt15 = twt15Raw.filter((bar) => bar.ts >= START_TS - 30 * 24 * HOUR_MS && bar.ts <= END_TS);
  const twt15Indicators = build15mIndicators(twt15);

  const rows = VARIANTS.map((variant) => simulateVariant({
    variant,
    equityPoints,
    pengu15,
    pengu15Indicators,
    twt12,
    twt12Indicators,
    twt15,
    twt15Indicators,
  })).sort((left, right) => right.endEquity - left.endEquity);

  const baselineEnd = baseline.summary.end_equity;
  const md = [
    "# V7 USDT Sleeve Sidecar Test",
    "",
    `- period: ${iso(START_TS)} - ${iso(END_TS)}`,
    "- baseline: current V7 live-equivalent engine-direct with cash rescue options",
    "- test: keep the main V7 position unchanged, and deploy only the remaining USDT/cash sleeve into PENGU 15m, TWT 15m, and/or TWT 12H sidecar trades",
    "- cost: entry+exit fee plus configured symbol slippage from `RECLAIM_HYBRID_SLIPPAGE_BPS`",
    "",
    `Baseline End Equity: ${round(baselineEnd, 2)}`,
    `Baseline MaxDD: ${round(baseline.summary.max_drawdown_pct, 2)}%`,
    "",
    "| variant | End Equity | vs baseline | MaxDD | PF | win % | trades | by symbol | by main holding |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |",
    ...rows.map((row) => `| ${row.variant} | ${round(row.endEquity, 2)} | ${round(row.endEquity - baselineEnd, 2)} | ${round(row.maxDdPct, 2)}% | ${round(row.pf, 3)} | ${round(row.winPct, 1)} | ${row.trades.length} | ${formatBreakdown(row.bySymbol)} | ${formatBreakdown(row.byMain)} |`),
    "",
    "## Top Trades",
    "",
    "| variant | symbol | main | entry | exit | notional | net % | pnl | reason |",
    "| --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows[0].trades
      .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl))
      .slice(0, 25)
      .map((trade) => `| ${rows[0].variant} | ${trade.symbol} | ${trade.mainSymbolAtEntry} | ${iso(trade.entryTs)} | ${iso(trade.exitTs)} | ${round(trade.notionalUsd, 2)} | ${pct(trade.netReturnPct)} | ${round(trade.netPnl, 2)} | ${trade.exitReason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: baseline.summary,
    rows,
  }, null, 2), "utf8");

  console.log(`[done] ${path.join(REPORT_DIR, "summary.md")}`);
  for (const row of rows.slice(0, 5)) {
    console.log(`${row.variant}: end=${round(row.endEquity)} diff=${round(row.endEquity - baselineEnd)} trades=${row.trades.length} pf=${round(row.pf, 3)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
