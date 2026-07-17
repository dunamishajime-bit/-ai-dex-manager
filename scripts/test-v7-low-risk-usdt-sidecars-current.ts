import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  RECLAIM_HYBRID_SLIPPAGE_BPS,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { buildIndicatorBars, resampleTo12h, resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h, EquityPoint, IndicatorBar } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-low-risk-usdt-sidecars-current");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Number(process.env.BT_START_TS ?? Date.UTC(2022, 0, 1));
const END_TS = Number(process.env.BT_END_TS ?? Date.UTC(2026, 4, 22, 23, 59, 59, 999));
const REPORT_SUFFIX = process.env.REPORT_SUFFIX || `${new Date(START_TS).toISOString().slice(0, 10)}_${new Date(END_TS).toISOString().slice(0, 10)}`;
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

type Candidate = "TWT12_STRICT" | "BIO_DUSK_CONFIRMED" | "PENGU15_IDLE" | "PENGU_GRIND" | "PENGU_GRIND_COST" | "PENGU_GRIND_BREAKOUT";
type Variant = {
  key: string;
  candidates: Candidate[];
  capUsd: number;
  priority: Candidate[];
  btcWeakOnly?: boolean;
  allowedSymbols?: Signal["symbol"][];
};
type Signal = {
  candidate: Candidate;
  symbol: "TWT" | "BIO" | "DUSK" | "PENGU";
  ts: number;
  close: number;
  score: number;
  timeframe: "12h" | "1h" | "15m";
};
type Trade = {
  variant: string;
  candidate: Candidate;
  symbol: Signal["symbol"];
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

const VARIANTS: Variant[] = [
  { key: "twt12_strict_cap100", candidates: ["TWT12_STRICT"], priority: ["TWT12_STRICT"], capUsd: 100 },
  { key: "twt12_strict_cap300", candidates: ["TWT12_STRICT"], priority: ["TWT12_STRICT"], capUsd: 300 },
  { key: "twt12_strict_btcweak_cap300", candidates: ["TWT12_STRICT"], priority: ["TWT12_STRICT"], capUsd: 300, btcWeakOnly: true },
  { key: "bio_dusk_confirmed_cap100", candidates: ["BIO_DUSK_CONFIRMED"], priority: ["BIO_DUSK_CONFIRMED"], capUsd: 100 },
  { key: "bio_dusk_confirmed_cap300", candidates: ["BIO_DUSK_CONFIRMED"], priority: ["BIO_DUSK_CONFIRMED"], capUsd: 300 },
  { key: "bio_confirmed_cap300", candidates: ["BIO_DUSK_CONFIRMED"], priority: ["BIO_DUSK_CONFIRMED"], capUsd: 300, allowedSymbols: ["BIO"] },
  { key: "dusk_confirmed_cap300", candidates: ["BIO_DUSK_CONFIRMED"], priority: ["BIO_DUSK_CONFIRMED"], capUsd: 300, allowedSymbols: ["DUSK"] },
  { key: "pengu15_idle_cap100", candidates: ["PENGU15_IDLE"], priority: ["PENGU15_IDLE"], capUsd: 100 },
  { key: "pengu15_idle_cap300", candidates: ["PENGU15_IDLE"], priority: ["PENGU15_IDLE"], capUsd: 300 },
  { key: "pengu_grind_cap100", candidates: ["PENGU_GRIND"], priority: ["PENGU_GRIND"], capUsd: 100 },
  { key: "pengu_grind_cap300", candidates: ["PENGU_GRIND"], priority: ["PENGU_GRIND"], capUsd: 300 },
  { key: "pengu_grind_cost_cap100", candidates: ["PENGU_GRIND_COST"], priority: ["PENGU_GRIND_COST"], capUsd: 100 },
  { key: "pengu_grind_cost_cap300", candidates: ["PENGU_GRIND_COST"], priority: ["PENGU_GRIND_COST"], capUsd: 300 },
  { key: "pengu_grind_breakout_cap100", candidates: ["PENGU_GRIND_BREAKOUT"], priority: ["PENGU_GRIND_BREAKOUT"], capUsd: 100 },
  { key: "pengu_grind_breakout_cap300", candidates: ["PENGU_GRIND_BREAKOUT"], priority: ["PENGU_GRIND_BREAKOUT"], capUsd: 300 },
  {
    key: "combined_twt_bio_dusk_cap300",
    candidates: ["TWT12_STRICT", "BIO_DUSK_CONFIRMED"],
    priority: ["TWT12_STRICT", "BIO_DUSK_CONFIRMED"],
    capUsd: 300,
  },
  {
    key: "combined_all_cap100",
    candidates: ["TWT12_STRICT", "BIO_DUSK_CONFIRMED", "PENGU15_IDLE", "PENGU_GRIND", "PENGU_GRIND_COST", "PENGU_GRIND_BREAKOUT"],
    priority: ["TWT12_STRICT", "BIO_DUSK_CONFIRMED", "PENGU_GRIND_BREAKOUT", "PENGU_GRIND_COST", "PENGU_GRIND", "PENGU15_IDLE"],
    capUsd: 100,
  },
  {
    key: "combined_all_cap300",
    candidates: ["TWT12_STRICT", "BIO_DUSK_CONFIRMED", "PENGU15_IDLE", "PENGU_GRIND", "PENGU_GRIND_COST", "PENGU_GRIND_BREAKOUT"],
    priority: ["TWT12_STRICT", "BIO_DUSK_CONFIRMED", "PENGU_GRIND_BREAKOUT", "PENGU_GRIND_COST", "PENGU_GRIND", "PENGU15_IDLE"],
    capUsd: 300,
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

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_low_risk_usdt_sidecar_base",
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

function build15mIndicators(candles: Candle1h[]) {
  const closes = candles.map((bar) => bar.close);
  const volumes = candles.map((bar) => bar.volume);
  return candles.map((bar, index) => {
    const sma20 = index >= 19 ? average(closes.slice(index - 19, index + 1)) : 0;
    const sma40 = index >= 39 ? average(closes.slice(index - 39, index + 1)) : 0;
    const mom20 = index >= 20 ? bar.close / candles[index - 20].close - 1 : 0;
    const mom20Prev = index >= 21 ? candles[index - 1].close / candles[index - 21].close - 1 : 0;
    const volAvg20 = index >= 19 ? average(volumes.slice(index - 19, index + 1)) : 0;
    return { ...bar, sma20, sma40, mom20, momAccel: mom20 - mom20Prev, volAvg20 };
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
  return { candidate: "PENGU15_IDLE", symbol: "PENGU", ts: bar.ts, close: bar.close, score, timeframe: "15m" };
}

function penguGrindSignal(candles: Candle1h[], indicators: ReturnType<typeof build15mIndicators>, index: number): Signal | null {
  const lookback = 32;
  if (index < 120) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prevHigh = Math.max(...candles.slice(index - lookback, index).map((item) => item.high));
  const recentLow = Math.min(...candles.slice(index - lookback, index + 1).map((item) => item.low));
  const rangePct = recentLow > 0 ? prevHigh / recentLow - 1 : 0;
  const pathPct = candles.slice(index - lookback + 1, index + 1)
    .reduce((sum, item, offset) => {
      const prev = candles[index - lookback + offset].close;
      return sum + Math.abs(item.close / prev - 1);
    }, 0);
  const highDistancePct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const oneBarMove = index >= 1 ? bar.close / candles[index - 1].close - 1 : 0;
  const shallowPullback = bar.close >= prevHigh * 0.985;
  const maRecovery = ind.sma20 > 0 && ind.sma40 > 0 && bar.close > ind.sma20 && ind.sma20 >= ind.sma40 * 0.995;
  const steadyMomentum = ind.mom20 >= 0.01 && ind.mom20 <= 0.11 && ind.momAccel >= -0.006;
  if (!maRecovery) return null;
  if (!steadyMomentum) return null;
  if (!shallowPullback && highDistancePct < -0.003) return null;
  if (volumeRatio < 0.45) return null;
  if (rangePct < 0.012 || rangePct > 0.16) return null;
  if (pathPct < 0.025) return null;
  if (oneBarMove > 0.035) return null;
  const score = ind.mom20 * 120 + Math.max(0, ind.momAccel) * 160 + Math.min(3, volumeRatio) * 3 + pathPct * 30 - Math.max(0, -highDistancePct) * 80;
  return { candidate: "PENGU_GRIND", symbol: "PENGU", ts: bar.ts, close: bar.close, score, timeframe: "15m" };
}

function penguGrindCostSignal(candles: Candle1h[], indicators: ReturnType<typeof build15mIndicators>, index: number): Signal | null {
  const lookback = 48;
  if (index < 160) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const window = candles.slice(index - lookback, index + 1);
  const prevHigh = Math.max(...candles.slice(index - lookback, index).map((item) => item.high));
  const recentLow = Math.min(...window.map((item) => item.low));
  const rangePct = recentLow > 0 ? prevHigh / recentLow - 1 : 0;
  const pathPct = window.slice(1).reduce((sum, item, offset) => {
    const prev = window[offset].close;
    return sum + Math.abs(item.close / prev - 1);
  }, 0);
  const highDistancePct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const oneBarMove = index >= 1 ? bar.close / candles[index - 1].close - 1 : 0;
  const aboveTrend = ind.sma20 > 0 && ind.sma40 > 0 && bar.close > ind.sma20 && ind.sma20 > ind.sma40 * 1.005;
  const enoughEdge = rangePct >= 0.07 && pathPct >= 0.09 && ind.mom20 >= 0.035 && ind.mom20 <= 0.18;
  const notLateSpike = oneBarMove <= 0.05 && highDistancePct >= -0.012;
  if (!aboveTrend) return null;
  if (!enoughEdge) return null;
  if (!notLateSpike) return null;
  if (volumeRatio < 0.65) return null;
  if (rangePct > 0.28) return null;
  if (ind.momAccel < -0.004) return null;
  const score = ind.mom20 * 140 + Math.max(0, ind.momAccel) * 180 + Math.min(3, volumeRatio) * 4 + rangePct * 80 + pathPct * 20;
  return { candidate: "PENGU_GRIND_COST", symbol: "PENGU", ts: bar.ts, close: bar.close, score, timeframe: "15m" };
}

function penguGrindBreakoutSignal(candles: Candle1h[], indicators: ReturnType<typeof build15mIndicators>, index: number): Signal | null {
  const lookback = 64;
  if (index < 200) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prevWindow = candles.slice(index - lookback, index);
  const window = candles.slice(index - lookback, index + 1);
  const prevHigh = Math.max(...prevWindow.map((item) => item.high));
  const recentLow = Math.min(...window.map((item) => item.low));
  const rangePct = recentLow > 0 ? prevHigh / recentLow - 1 : 0;
  const pathPct = window.slice(1).reduce((sum, item, offset) => {
    const prev = window[offset].close;
    return sum + Math.abs(item.close / prev - 1);
  }, 0);
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const oneBarMove = index >= 1 ? bar.close / candles[index - 1].close - 1 : 0;
  const aboveTrend = ind.sma20 > 0 && ind.sma40 > 0 && bar.close > ind.sma20 && ind.sma20 > ind.sma40 * 1.01;
  if (!aboveTrend) return null;
  if (breakoutPct < 0.006) return null;
  if (volumeRatio < 1.0) return null;
  if (ind.mom20 < 0.07 || ind.mom20 > 0.28) return null;
  if (ind.momAccel < -0.002) return null;
  if (rangePct < 0.1 || rangePct > 0.35) return null;
  if (pathPct < 0.12) return null;
  if (oneBarMove > 0.065) return null;
  const score = ind.mom20 * 150 + Math.max(0, ind.momAccel) * 180 + breakoutPct * 140 + Math.min(4, volumeRatio) * 5 + rangePct * 70;
  return { candidate: "PENGU_GRIND_BREAKOUT", symbol: "PENGU", ts: bar.ts, close: bar.close, score, timeframe: "15m" };
}

function twt12Signal(candles: Candle1h[], indicators: IndicatorBar[], index: number): Signal | null {
  const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar;
  const lookback = cfg.lookbackBars;
  if (index < Math.max(90, lookback + 1)) return null;
  const bar = candles[index];
  const ind = indicators[index];
  const prevHigh = Math.max(...candles.slice(index - lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volumeRatio = ind.volAvg20 > 0 ? bar.volume / ind.volAvg20 : 0;
  const efficiency = pathEfficiency(candles, index, lookback);
  if (!ind.ready) return null;
  if (bar.close <= ind.sma40) return null;
  if (ind.mom20 < cfg.minMom20) return null;
  if (breakoutPct < cfg.breakoutMinPct) return null;
  if (volumeRatio < cfg.minVolumeRatio) return null;
  if (ind.momAccel < cfg.minMomAccel) return null;
  if (efficiency < cfg.minEfficiencyRatio) return null;
  if (ind.adx14 < cfg.minAdx14) return null;
  const score = ind.mom20 * 100 + ind.momAccel * 180 + breakoutPct * 150 + Math.min(4, volumeRatio) * 4 + efficiency * 18 + ind.adx14 * 0.15;
  return { candidate: "TWT12_STRICT", symbol: "TWT", ts: bar.ts, close: bar.close, score, timeframe: "12h" };
}

function bioDuskSignal(symbol: "BIO" | "DUSK", candles: Candle1h[], fourHourCandles: Candle1h[], index: number): Signal | null {
  const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
  if (index < Math.max(30, cfg.lookbackBars + 1)) return null;
  const activeFrom = new Date(cfg.activeFrom[symbol]).getTime();
  const bar = candles[index];
  if (bar.ts < activeFrom) return null;
  const prevHigh = Math.max(...candles.slice(index - cfg.lookbackBars, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
  const volumeRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
  const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
  const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
  const oneHourJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
  const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 1;
  const fourHour = [...fourHourCandles].reverse().find((item) => item.ts <= bar.ts);
  const fourHourIndex = fourHour ? fourHourCandles.findIndex((item) => item.ts === fourHour.ts) : -1;
  const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0
    ? fourHour.close / fourHourCandles[fourHourIndex - 3].close - 1
    : 0;
  if (breakoutPct < cfg.breakoutMinPct) return null;
  if (volumeRatio < cfg.minVolumeRatio) return null;
  if (mom6 < cfg.minMom6) return null;
  if (mom24 < cfg.minMom24) return null;
  if (fourHourMom < cfg.minFourHourMom) return null;
  if (oneHourJump > cfg.maxOneHourJump) return null;
  if (closeLocation < cfg.minCloseLocation) return null;
  const score = mom6 * 120 + mom24 * 90 + fourHourMom * 120 + breakoutPct * 180 + Math.min(3.5, volumeRatio) * 2 + closeLocation * 4;
  if (score < cfg.minScore) return null;
  return { candidate: "BIO_DUSK_CONFIRMED", symbol, ts: bar.ts, close: bar.close, score, timeframe: "1h" };
}

async function loadCandles(symbol: string, interval: "15m" | "1h") {
  return loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: START_TS - 120 * 24 * HOUR_MS,
    endMs: END_TS,
    interval,
  }).catch(() => []);
}

function isUsdtWindow(point: EquityPoint | null) {
  if (!point) return false;
  if (point.cash < 25 || point.equity <= 0) return false;
  return point.position_side === "cash" || point.position_symbol.toUpperCase() === "CASH" || point.cash / point.equity >= 0.05;
}

function btcWeakAt(point: EquityPoint | null) {
  const regime = (point as EquityPoint & { regime?: { btc?: { close?: number; sma40?: number; mom20?: number } } } | null)?.regime;
  const btc = regime?.btc;
  if (!btc) return false;
  return Number(btc.close || 0) < Number(btc.sma40 || 0) || Number(btc.mom20 || 0) < 0;
}

function signalRank(variant: Variant, signal: Signal) {
  const rank = variant.priority.indexOf(signal.candidate);
  return rank >= 0 ? rank : 99;
}

function simulate(input: {
  variant: Variant;
  equityPoints: EquityPoint[];
  baselineEnd: number;
  signalsByTs: Map<number, Signal[]>;
  priceBySymbolTs: Map<string, Candle1h>;
  indicatorBySymbolTs: Map<string, { sma20?: number; sma40?: number; mom6?: number; mom20?: number; momAccel?: number }>;
}) {
  const { variant, equityPoints, baselineEnd, signalsByTs, priceBySymbolTs, indicatorBySymbolTs } = input;
  const timeline = [...new Set([...signalsByTs.keys(), ...equityPoints.map((point) => point.ts)])].sort((left, right) => left - right);
  const trades: Trade[] = [];
  let open: (Signal & { notionalUsd: number; peakPrice: number; mainSymbolAtEntry: string }) | null = null;
  let realizedPnl = 0;
  const curve: Array<{ ts: number; equity: number }> = [];

  for (const ts of timeline) {
    if (ts < START_TS || ts > END_TS) continue;
    const point = findPointAtOrBefore(equityPoints, ts);
    if (!point) continue;

    if (open) {
      const bar = priceBySymbolTs.get(`${open.symbol}:${ts}`);
      if (bar) {
        open.peakPrice = Math.max(open.peakPrice, bar.high);
        const holdingHours = (ts - open.ts) / HOUR_MS;
        const grossReturn = bar.close / open.close - 1;
        const retraceFromPeak = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
        const cost = FEE_RATE * 2 + slippageRate(open.symbol) * 2;
        const ind = indicatorBySymbolTs.get(`${open.symbol}:${ts}`);
        let exitReason: string | null = null;
        if (open.candidate === "TWT12_STRICT") {
          const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.twtUsdtSleeveSidecar;
          if (grossReturn <= -cfg.hardStopPct) exitReason = "hard-stop";
          if (!exitReason && grossReturn >= cfg.profitTrailActivationPct && retraceFromPeak <= -cfg.profitTrailRetracePct) exitReason = "profit-trail";
          if (!exitReason && holdingHours >= cfg.weakExitMinHoldHours && ind?.sma40 && bar.close < ind.sma40 && Number(ind.mom20 || 0) < 0) exitReason = "weak-exit";
          if (!exitReason && holdingHours >= cfg.maxHoldHours) exitReason = "max-hold";
        } else if (open.candidate === "BIO_DUSK_CONFIRMED") {
          const cfg = RECLAIM_HYBRID_EXECUTION_PROFILE.idleBigWaveSidecar;
          if (grossReturn <= -cfg.hardStopPct) exitReason = "hard-stop";
          if (!exitReason && grossReturn >= cfg.profitTrailActivationPct && retraceFromPeak <= -cfg.profitTrailRetracePct) exitReason = "profit-trail";
          if (!exitReason && holdingHours >= cfg.weakExitMinHoldHours && ind?.sma20 && bar.close < ind.sma20 && Number(ind.mom6 || 0) < 0) exitReason = "weak-exit";
          if (!exitReason && holdingHours >= cfg.maxHoldHours) exitReason = "max-hold";
        } else if (open.candidate === "PENGU15_IDLE") {
          const tier = [
            { activationPct: 0.05, retracePct: 0.025 },
            { activationPct: 0.18, retracePct: 0.0475 },
            { activationPct: 0.21, retracePct: 0.07 },
            { activationPct: 0.6, retracePct: 0.16 },
          ].filter((item) => grossReturn >= item.activationPct).at(-1);
          if (tier && retraceFromPeak <= -tier.retracePct) exitReason = "tiered-trail";
          if (!exitReason && holdingHours >= 1 && ind?.sma40 && bar.close < ind.sma40 && Number(ind.mom20 || 0) < 0.03 && Number(ind.momAccel || 0) < -0.01) exitReason = "weak-exit";
          if (!exitReason && holdingHours >= 36) exitReason = "max-hold";
        } else if (open.candidate === "PENGU_GRIND") {
          if (grossReturn <= -0.035) exitReason = "grind-hard-stop";
          if (!exitReason && grossReturn >= 0.03 && retraceFromPeak <= -0.015) exitReason = "grind-fast-profit";
          if (!exitReason && holdingHours >= 1 && ind?.sma20 && bar.close < ind.sma20 && Number(ind.mom20 || 0) < 0.005) exitReason = "grind-weak-exit";
          if (!exitReason && holdingHours >= 24) exitReason = "grind-max-hold";
        } else if (open.candidate === "PENGU_GRIND_COST") {
          if (grossReturn <= -0.055) exitReason = "cost-grind-hard-stop";
          if (!exitReason && grossReturn >= 0.085 && retraceFromPeak <= -0.035) exitReason = "cost-grind-profit-trail";
          if (!exitReason && holdingHours >= 2 && ind?.sma20 && bar.close < ind.sma20 && Number(ind.mom20 || 0) < 0.015) exitReason = "cost-grind-weak-exit";
          if (!exitReason && holdingHours >= 48) exitReason = "cost-grind-max-hold";
        } else {
          if (grossReturn <= -0.07) exitReason = "breakout-hard-stop";
          if (!exitReason && grossReturn >= 0.12 && retraceFromPeak <= -0.05) exitReason = "breakout-profit-trail";
          if (!exitReason && holdingHours >= 3 && ind?.sma20 && bar.close < ind.sma20 && Number(ind.mom20 || 0) < 0.02) exitReason = "breakout-weak-exit";
          if (!exitReason && holdingHours >= 72) exitReason = "breakout-max-hold";
        }
        if (exitReason) {
          const netReturnPct = grossReturn - cost;
          const netPnl = open.notionalUsd * netReturnPct;
          realizedPnl += netPnl;
          trades.push({
            variant: variant.key,
            candidate: open.candidate,
            symbol: open.symbol,
            entryTs: open.ts,
            exitTs: ts,
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
    }

    const unrealized = open
      ? (() => {
        const bar = priceBySymbolTs.get(`${open.symbol}:${ts}`);
        return bar ? open.notionalUsd * (bar.close / open.close - 1 - FEE_RATE - slippageRate(open.symbol)) : 0;
      })()
      : 0;
    curve.push({ ts, equity: point.equity + realizedPnl + unrealized });

    if (open || !isUsdtWindow(point)) continue;
    if (variant.btcWeakOnly && !btcWeakAt(point)) continue;
    const signals = (signalsByTs.get(ts) ?? [])
      .filter((signal) => variant.candidates.includes(signal.candidate))
      .filter((signal) => !variant.allowedSymbols || variant.allowedSymbols.includes(signal.symbol))
      .sort((left, right) => signalRank(variant, left) - signalRank(variant, right) || right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    if (point.position_symbol.toUpperCase() === best.symbol) continue;
    const notionalUsd = Math.min(point.cash, variant.capUsd);
    if (notionalUsd < 25) continue;
    open = { ...best, notionalUsd, peakPrice: best.close, mainSymbolAtEntry: point.position_symbol };
  }

  const endEquity = (equityPoints.at(-1)?.equity ?? baselineEnd) + realizedPnl;
  let peak = curve[0]?.equity ?? endEquity;
  let maxDd = 0;
  for (const point of curve) {
    peak = Math.max(peak, point.equity);
    maxDd = Math.min(maxDd, point.equity / peak - 1);
  }
  const gains = trades.filter((trade) => trade.netPnl > 0).reduce((sum, trade) => sum + trade.netPnl, 0);
  const losses = trades.filter((trade) => trade.netPnl < 0).reduce((sum, trade) => sum + Math.abs(trade.netPnl), 0);
  return {
    key: variant.key,
    endEquity,
    addedPnl: realizedPnl,
    maxDdPct: maxDd * 100,
    trades,
    pf: losses > 0 ? gains / losses : gains > 0 ? 999 : 0,
    winPct: trades.filter((trade) => trade.netPnl > 0).length / Math.max(1, trades.length) * 100,
    bySymbol: Object.fromEntries(["TWT", "BIO", "DUSK", "PENGU"].map((symbol) => [
      symbol,
      {
        trades: trades.filter((trade) => trade.symbol === symbol).length,
        pnl: trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.netPnl, 0),
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

  const [twt1hRaw, bio1hRaw, dusk1hRaw, pengu15Raw] = await Promise.all([
    loadCandles("TWT", "1h"),
    loadCandles("BIO", "1h"),
    loadCandles("DUSK", "1h"),
    loadCandles("PENGU", "15m"),
  ]);

  const signalsByTs = new Map<number, Signal[]>();
  const priceBySymbolTs = new Map<string, Candle1h>();
  const indicatorBySymbolTs = new Map<string, { sma20?: number; sma40?: number; mom6?: number; mom20?: number; momAccel?: number }>();
  const addSignal = (signal: Signal | null) => {
    if (!signal) return;
    signalsByTs.set(signal.ts, [...(signalsByTs.get(signal.ts) ?? []), signal]);
  };

  const twt12 = resampleTo12h(twt1hRaw).filter((bar) => bar.ts >= START_TS - 120 * 24 * HOUR_MS && bar.ts <= END_TS);
  const twt12Indicators = buildIndicatorBars(twt12);
  twt12.forEach((bar, index) => {
    priceBySymbolTs.set(`TWT:${bar.ts}`, bar);
    indicatorBySymbolTs.set(`TWT:${bar.ts}`, { sma40: twt12Indicators[index]?.sma40, mom20: twt12Indicators[index]?.mom20 });
    if (bar.ts >= START_TS) addSignal(twt12Signal(twt12, twt12Indicators, index));
  });

  for (const [symbol, raw] of [["BIO", bio1hRaw], ["DUSK", dusk1hRaw]] as const) {
    const candles = raw.filter((bar) => bar.ts >= START_TS - 120 * 24 * HOUR_MS && bar.ts <= END_TS);
    const fourHour = resampleToHours(candles, 4);
    candles.forEach((bar, index) => {
      priceBySymbolTs.set(`${symbol}:${bar.ts}`, bar);
      const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
      const mom6 = index >= 6 ? bar.close / candles[index - 6].close - 1 : 0;
      indicatorBySymbolTs.set(`${symbol}:${bar.ts}`, { sma20, mom6 });
      if (bar.ts >= START_TS) addSignal(bioDuskSignal(symbol, candles, fourHour, index));
    });
  }

  const pengu15 = pengu15Raw.filter((bar) => bar.ts >= START_TS - 30 * 24 * HOUR_MS && bar.ts <= END_TS);
  const pengu15Indicators = build15mIndicators(pengu15);
  pengu15.forEach((bar, index) => {
    priceBySymbolTs.set(`PENGU:${bar.ts}`, bar);
    const ind = pengu15Indicators[index];
    indicatorBySymbolTs.set(`PENGU:${bar.ts}`, { sma20: ind.sma20, sma40: ind.sma40, mom20: ind.mom20, momAccel: ind.momAccel });
    if (bar.ts >= START_TS) addSignal(pengu15Signal(pengu15, pengu15Indicators, index));
    if (bar.ts >= START_TS) addSignal(penguGrindSignal(pengu15, pengu15Indicators, index));
    if (bar.ts >= START_TS) addSignal(penguGrindCostSignal(pengu15, pengu15Indicators, index));
    if (bar.ts >= START_TS) addSignal(penguGrindBreakoutSignal(pengu15, pengu15Indicators, index));
  });

  const rows = VARIANTS.map((variant) => simulate({
    variant,
    equityPoints,
    baselineEnd: baseline.summary.end_equity,
    signalsByTs,
    priceBySymbolTs,
    indicatorBySymbolTs,
  })).sort((left, right) => right.endEquity - left.endEquity);

  const baseEnd = baseline.summary.end_equity;
  const md = [
    "# V7 Low-Risk USDT Sidecars Current Recheck",
    "",
    `- period: ${iso(START_TS)} - ${iso(END_TS)}`,
    "- baseline: V7 live-equivalent engine-direct profile with cash rescue options",
    "- scope: only when V7 has usable USDT/cash; main V7 position is not replaced",
    "- sizing: low-risk capped sidecar, 100 or 300 USDT max per position",
    "- candidates: current TWT 12H strict sleeve, current BIO/DUSK confirmed_48h, current PENGU 15m idle breakout, GPT-like PENGU grind proxy, cost-aware PENGU grind proxy, PENGU continuation breakout proxy",
    "",
    `Baseline End Equity: ${round(baseEnd, 2)}`,
    `Baseline MaxDD: ${round(baseline.summary.max_drawdown_pct, 2)}%`,
    "",
    "| rank | variant | End Equity | vs baseline | MaxDD | PF | win % | trades | by symbol |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.key} | ${round(row.endEquity, 2)} | ${round(row.endEquity - baseEnd, 2)} | ${round(row.maxDdPct, 2)}% | ${round(row.pf, 3)} | ${round(row.winPct, 1)} | ${row.trades.length} | ${JSON.stringify(Object.fromEntries(Object.entries(row.bySymbol).map(([key, value]) => [key, { trades: value.trades, pnl: round(value.pnl, 2) }]))) } |`),
    "",
    "## Top Variant Trades",
    "",
    "| variant | candidate | symbol | main | entry | exit | notional | net % | pnl | reason |",
    "| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |",
    ...rows[0].trades
      .sort((left, right) => Math.abs(right.netPnl) - Math.abs(left.netPnl))
      .slice(0, 30)
      .map((trade) => `| ${trade.variant} | ${trade.candidate} | ${trade.symbol} | ${trade.mainSymbolAtEntry} | ${iso(trade.entryTs)} | ${iso(trade.exitTs)} | ${round(trade.notionalUsd, 2)} | ${round(trade.netReturnPct, 2)} | ${round(trade.netPnl, 2)} | ${trade.exitReason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, `${REPORT_SUFFIX}-summary.md`), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, `${REPORT_SUFFIX}-result.json`), JSON.stringify({ baseline: baseline.summary, rows }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ baseline: baseline.summary, rows }, null, 2), "utf8");

  console.log(`[done] ${path.join(REPORT_DIR, `${REPORT_SUFFIX}-summary.md`)}`);
  for (const row of rows.slice(0, 8)) {
    console.log(`${row.key}: end=${round(row.endEquity)} diff=${round(row.endEquity - baseEnd)} trades=${row.trades.length} pf=${round(row.pf, 3)} win=${round(row.winPct, 1)}%`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
