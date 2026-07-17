import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h, EquityPoint } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-new-pengu-replacement-candidates");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 4, 22, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const SYMBOLS = (process.env.SYMBOLS ?? "COS,APE")
  .split(",")
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const QUOTE_LOSS_PCT: Record<string, number> = {
  COS: 0,
  APE: 0.6439,
  RDNT: 0.3667,
};

const VARIANTS = [
  {
    key: "pengu_like_48h",
    maxHoldHours: 48,
    lookback: 8,
    breakoutPct: 0.016,
    minVolRatio: 1.15,
    minMom6: 0.035,
    minMom24: 0.055,
    minFourHourMom: 0.04,
    minScore: 28,
    maxOneHourJump: 0.22,
    minCloseLocation: 0.55,
    trailActivationPct: 0.18,
    trailRetracePct: 0.085,
    hardStopPct: 0.08,
    weakExitMinHours: 8,
  },
  {
    key: "fast_24h",
    maxHoldHours: 24,
    lookback: 6,
    breakoutPct: 0.012,
    minVolRatio: 1.1,
    minMom6: 0.025,
    minMom24: 0.04,
    minFourHourMom: 0.03,
    minScore: 22,
    maxOneHourJump: 0.18,
    minCloseLocation: 0.52,
    trailActivationPct: 0.12,
    trailRetracePct: 0.055,
    hardStopPct: 0.065,
    weakExitMinHours: 5,
  },
  {
    key: "runner_72h",
    maxHoldHours: 72,
    lookback: 12,
    breakoutPct: 0.02,
    minVolRatio: 1.2,
    minMom6: 0.045,
    minMom24: 0.075,
    minFourHourMom: 0.055,
    minScore: 36,
    maxOneHourJump: 0.26,
    minCloseLocation: 0.58,
    trailActivationPct: 0.26,
    trailRetracePct: 0.12,
    hardStopPct: 0.095,
    weakExitMinHours: 10,
  },
] as const;

type Window = { startTs: number; endTs: number };
type Signal = { symbol: string; ts: number; close: number; score: number };
type Trade = {
  symbol: string;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  netReturnPct: number;
  score: number;
  exitReason: string;
  maxRunupPct: number;
  maxDrawdownPct: number;
  notionalUsd?: number;
  netPnl?: number;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_new_pengu_replacement_base",
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const points = result.equity_curve.sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of points) {
    const isCash = point.position_side === "cash" || point.position_symbol.toUpperCase() === "CASH" || point.cash / Math.max(1, point.equity) >= 0.05;
    if (isCash) {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS });
    start = null;
    prev = null;
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + STEP_MS });
  return windows.filter((window) => window.endTs - window.startTs >= HOUR_MS);
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

function inWindows(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEndFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

function buildIndex(candles: Candle1h[]) {
  const index = new Map<number, number>();
  candles.forEach((bar, offset) => index.set(bar.ts, offset));
  return index;
}

function signalFor(symbol: string, candles: Candle1h[], fourHourCandles: Candle1h[], index: number, variant: typeof VARIANTS[number]): Signal | null {
  if (index < Math.max(30, variant.lookback + 1)) return null;
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
  const score = mom6 * 120 + mom24 * 90 + fourHourMom * 120 + breakoutPct * 180 + Math.min(4, volRatio) * 3 + closeLocation * 4;
  return score >= variant.minScore ? { symbol, ts: bar.ts, close: bar.close, score } : null;
}

function simulate(
  candlesBySymbol: Map<string, Candle1h[]>,
  windows: readonly Window[],
  equityPoints: EquityPoint[],
  variant: typeof VARIANTS[number],
  symbols: readonly string[],
) {
  const indexBySymbol = new Map<string, Map<number, number>>();
  const fourHourBySymbol = new Map<string, Candle1h[]>();
  const tsSet = new Set<number>();
  for (const symbol of symbols) {
    const candles = candlesBySymbol.get(symbol) ?? [];
    indexBySymbol.set(symbol, buildIndex(candles));
    fourHourBySymbol.set(symbol, resampleToHours(candles, 4));
    candles.forEach((bar) => {
      if (inWindows(bar.ts, windows)) tsSet.add(bar.ts);
    });
  }
  const trades: Trade[] = [];
  let open: (Trade & { peakPrice: number; troughPrice: number; maxExitTs: number }) | null = null;
  for (const ts of [...tsSet].sort((left, right) => left - right)) {
    if (open) {
      const candles = candlesBySymbol.get(open.symbol) ?? [];
      const index = indexBySymbol.get(open.symbol)?.get(ts);
      if (index == null) continue;
      const bar = candles[index];
      open.peakPrice = Math.max(open.peakPrice, bar.high);
      open.troughPrice = Math.min(open.troughPrice, bar.low);
      const grossReturn = bar.close / open.entryPrice - 1;
      const retrace = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
      const holdingHours = (ts - open.entryTs) / HOUR_MS;
      let exitReason: string | null = null;
      if (grossReturn <= -variant.hardStopPct) exitReason = "hard-stop";
      if (!exitReason && grossReturn >= variant.trailActivationPct && retrace <= -variant.trailRetracePct) exitReason = "profit-trail";
      if (!exitReason && holdingHours >= variant.weakExitMinHours && grossReturn < 0 && bar.close < open.entryPrice * 0.985) exitReason = "weak-exit";
      if (!exitReason && (holdingHours >= variant.maxHoldHours || ts >= open.maxExitTs)) exitReason = "window-or-max-hold";
      if (exitReason) {
        open.exitTs = ts;
        open.exitPrice = bar.close;
        open.exitReason = exitReason;
        open.maxRunupPct = open.peakPrice / open.entryPrice - 1;
        open.maxDrawdownPct = open.troughPrice / open.entryPrice - 1;
        open.netReturnPct = grossReturn - (FEE_RATE * 2) - ((QUOTE_LOSS_PCT[open.symbol] ?? 1) / 100) * 2;
        open.netPnl = (open.notionalUsd ?? 0) * open.netReturnPct;
        trades.push(open);
        open = null;
      }
    }
    if (open) continue;
    const signals = symbols
      .map((symbol) => {
        const candles = candlesBySymbol.get(symbol) ?? [];
        const index = indexBySymbol.get(symbol)?.get(ts);
        return index == null ? null : signalFor(symbol, candles, fourHourBySymbol.get(symbol) ?? [], index, variant);
      })
      .filter((signal): signal is Signal => Boolean(signal))
      .sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    const point = findPointAtOrBefore(equityPoints, best.ts);
    const notionalUsd = point ? Math.max(0, point.cash || (point.position_side === "cash" ? point.equity : 0)) : 0;
    if (notionalUsd < 25) continue;
    open = {
      symbol: best.symbol,
      entryTs: best.ts,
      exitTs: best.ts,
      entryPrice: best.close,
      exitPrice: best.close,
      netReturnPct: 0,
      score: best.score,
      exitReason: "",
      maxRunupPct: 0,
      maxDrawdownPct: 0,
      notionalUsd,
      netPnl: 0,
      peakPrice: best.close,
      troughPrice: best.close,
      maxExitTs: windowEndFor(best.ts, windows),
    };
  }
  const gains = trades.filter((trade) => trade.netReturnPct > 0).reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const losses = trades.filter((trade) => trade.netReturnPct < 0).reduce((sum, trade) => sum + Math.abs(trade.netReturnPct), 0);
  return {
    variant: variant.key,
    trades,
    winPct: trades.filter((trade) => trade.netReturnPct > 0).length / Math.max(1, trades.length) * 100,
    avgNetPct: average(trades.map((trade) => trade.netReturnPct)) * 100,
    pf: losses > 0 ? gains / losses : gains > 0 ? 999 : 0,
    cap100Pnl: trades.reduce((sum, trade) => sum + trade.netReturnPct * 100, 0),
    cap300Pnl: trades.reduce((sum, trade) => sum + trade.netReturnPct * 300, 0),
    noCapPnl: trades.reduce((sum, trade) => sum + (trade.netPnl ?? 0), 0),
    bySymbol: Object.fromEntries(symbols.map((symbol) => [
      symbol,
      {
        trades: trades.filter((trade) => trade.symbol === symbol).length,
        cap300Pnl: trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.netReturnPct * 300, 0),
      },
    ])),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseline = await runHybridBacktest("RETQ22", baseOptions());
  const equityPoints = [...baseline.equity_curve].sort((left, right) => left.ts - right.ts);
  const windows = cashWindowsFromBaseline(baseline);
  const candlesBySymbol = new Map<string, Candle1h[]>();
  for (const symbol of SYMBOLS) {
    const candles = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      interval: "1h",
      startMs: START_TS - 80 * 24 * HOUR_MS,
      endMs: END_TS,
      cacheRoot: CACHE_ROOT,
    });
    candlesBySymbol.set(symbol, candles);
    console.log(`${symbol}: ${candles.length}`);
  }
  const rows = [];
  for (const variant of VARIANTS) {
    rows.push({ group: "basket", symbols: [...SYMBOLS], ...simulate(candlesBySymbol, windows, equityPoints, variant, SYMBOLS) });
    for (const symbol of SYMBOLS) {
      rows.push({ group: symbol, symbols: [symbol], ...simulate(candlesBySymbol, windows, equityPoints, variant, [symbol]) });
    }
  }
  rows.sort((left, right) => right.noCapPnl - left.noCapPnl);
  const md = [
    "# V7 New PENGU Replacement Candidate Backtest",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: engine-direct V7 live-equivalent cash windows, standalone candidate overlay projection",
    `- baseline End Equity: ${round(baseline.summary.end_equity)}`,
    `- baseline MaxDD: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- symbols: ${SYMBOLS.join(" / ")}; quote loss charged from live quote check at 300 USDT`,
    "",
    "| rank | group | variant | trades | win % | avg net % | PF | no-cap PnL | no-cap End | cap300 PnL | by symbol |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.group} | ${row.variant} | ${row.trades.length} | ${round(row.winPct)} | ${round(row.avgNetPct)} | ${round(row.pf, 3)} | ${round(row.noCapPnl)} | ${round(baseline.summary.end_equity + row.noCapPnl)} | ${round(row.cap300Pnl)} | ${JSON.stringify(Object.fromEntries(Object.entries(row.bySymbol).map(([key, value]: any) => [key, { trades: value.trades, cap300Pnl: round(value.cap300Pnl) }]))) } |`),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "backtest.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "backtest.md"), md, "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
