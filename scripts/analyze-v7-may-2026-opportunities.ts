import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  RECLAIM_HYBRID_SLIPPAGE_BPS,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import type { Candle1h, EquityPoint } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-may-2026-opportunities");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const DEFAULT_CANDIDATES = [
  "PENGU", "TWT", "BIO", "DUSK", "XVS", "TKO", "CAKE", "TRX", "SFP", "DODO",
  "BNB", "ASTER", "ALLO", "BANK", "NIGHT", "BARD", "SOLV", "PROVE", "LISTA", "HOOK",
] as const;
type SymbolName = typeof DEFAULT_CANDIDATES[number];
const CANDIDATES = (process.env.BT_CANDIDATES
  ? process.env.BT_CANDIDATES.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)
  : [...DEFAULT_CANDIDATES]) as readonly SymbolName[];

const PERIODS = [
  { key: "2026-May", startTs: Date.UTC(2026, 0, 1), evalStartTs: Date.UTC(2026, 4, 1), endTs: Date.UTC(2026, 4, 22, 23, 59, 59, 999), focus: true },
  { key: "2026-Jan-Apr", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 3, 30, 23, 59, 59, 999), focus: false },
  { key: "2025", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999), focus: false },
  { key: "2024", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999), focus: false },
] as const;

type Window = { startTs: number; endTs: number };
type Variant = {
  key: string;
  timeframe: "1h" | "15m";
  lookback: number;
  breakoutPct: number;
  minMom: number;
  minAccel: number;
  minVolumeRatio: number;
  minEfficiency: number;
  maxOneBarJump: number;
  trailAct: number;
  trailRet: number;
  hardStop: number;
  maxHoldHours: number;
  requireBtcWeak?: boolean;
};
type Signal = {
  symbol: SymbolName;
  ts: number;
  close: number;
  score: number;
};
type Trade = {
  symbol: SymbolName;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  netReturnPct: number;
  exitReason: string;
};

const VARIANTS: Variant[] = [
  { key: "may_fast_breakout_1h", timeframe: "1h", lookback: 8, breakoutPct: 0.006, minMom: 0.018, minAccel: 0, minVolumeRatio: 1.0, minEfficiency: 0.12, maxOneBarJump: 0.055, trailAct: 0.055, trailRet: 0.028, hardStop: 0.065, maxHoldHours: 36 },
  { key: "may_quality_breakout_1h", timeframe: "1h", lookback: 12, breakoutPct: 0.01, minMom: 0.035, minAccel: 0.0015, minVolumeRatio: 1.12, minEfficiency: 0.18, maxOneBarJump: 0.075, trailAct: 0.085, trailRet: 0.04, hardStop: 0.075, maxHoldHours: 72 },
  { key: "may_grind_up_1h", timeframe: "1h", lookback: 18, breakoutPct: 0.002, minMom: 0.045, minAccel: -0.004, minVolumeRatio: 0.72, minEfficiency: 0.22, maxOneBarJump: 0.04, trailAct: 0.045, trailRet: 0.022, hardStop: 0.055, maxHoldHours: 48 },
  { key: "may_btcweak_relative_1h", timeframe: "1h", lookback: 10, breakoutPct: 0.005, minMom: 0.025, minAccel: 0, minVolumeRatio: 0.85, minEfficiency: 0.14, maxOneBarJump: 0.06, trailAct: 0.06, trailRet: 0.03, hardStop: 0.065, maxHoldHours: 48, requireBtcWeak: true },
  { key: "may_fast_breakout_15m", timeframe: "15m", lookback: 16, breakoutPct: 0.004, minMom: 0.012, minAccel: 0, minVolumeRatio: 1.05, minEfficiency: 0.10, maxOneBarJump: 0.035, trailAct: 0.035, trailRet: 0.018, hardStop: 0.045, maxHoldHours: 12 },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function baseOptions(period: typeof PERIODS[number]): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: period.startTs,
    backtestEndTs: period.endTs,
    label: `v7_may_opportunity_base_${period.key}`,
  };
}

function evalStart(period: typeof PERIODS[number]) {
  return "evalStartTs" in period ? period.evalStartTs : period.startTs;
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>, period: typeof PERIODS[number]) {
  const points = [...result.equity_curve].sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of points) {
    const usable = point.position_side === "cash" && point.cash / Math.max(1, point.equity) >= 0.05;
    if (usable) {
      if (start == null) start = point.ts;
      prev = point.ts;
      continue;
    }
    if (start != null && prev != null) {
      windows.push({ startTs: start, endTs: prev + 12 * HOUR_MS });
      start = null;
      prev = null;
    }
  }
  if (start != null && prev != null) windows.push({ startTs: start, endTs: prev + 12 * HOUR_MS });
  const scopeStart = evalStart(period);
  return windows
    .map((window) => ({ startTs: Math.max(window.startTs, scopeStart), endTs: Math.min(window.endTs, period.endTs) }))
    .filter((window) => window.endTs > window.startTs);
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

function cashIsUsable(point: EquityPoint | null) {
  if (!point) return false;
  if (point.cash < 25 || point.equity <= 0) return false;
  return point.cash / point.equity >= 0.05;
}

function cashPctInEval(points: EquityPoint[], period: typeof PERIODS[number]) {
  const start = evalStart(period);
  const scoped = points.filter((point) => point.ts >= start && point.ts <= period.endTs);
  if (!scoped.length) return 0;
  const cash = scoped.filter((point) => point.position_side === "cash" && point.cash / Math.max(1, point.equity) >= 0.05).length;
  return round((cash / scoped.length) * 100, 2);
}

function pathEfficiency(candles: Candle1h[], index: number, lookback: number) {
  if (index < lookback) return 0;
  const start = candles[index - lookback].close;
  const end = candles[index].close;
  const path = candles.slice(index - lookback + 1, index + 1).reduce((sum, bar, offset) => {
    const prev = candles[index - lookback + offset].close;
    return sum + Math.abs(bar.close / prev - 1);
  }, 0);
  return path > 0 ? Math.abs(end / start - 1) / path : 0;
}

function slippageRate(symbol: string) {
  return (RECLAIM_HYBRID_SLIPPAGE_BPS[`${symbol}_USDT`] ?? 120) / 10000;
}

async function loadCandles(symbol: string, period: typeof PERIODS[number], interval: "1h" | "15m") {
  const candles = await loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: period.startTs - 30 * 24 * HOUR_MS,
    endMs: period.endTs,
    interval,
  });
  return candles.filter((bar) => bar.ts >= period.startTs - 14 * 24 * HOUR_MS && bar.ts <= period.endTs);
}

function btcWeakAt(btc: Candle1h[], ts: number) {
  const idx = btc.findIndex((bar) => bar.ts === ts);
  if (idx < 40) return false;
  const bar = btc[idx];
  const sma40 = average(btc.slice(idx - 39, idx + 1).map((item) => item.close));
  const mom20 = btc[idx - 20]?.close > 0 ? bar.close / btc[idx - 20].close - 1 : 0;
  return bar.close < sma40 || mom20 < 0;
}

function signalAt(symbol: SymbolName, candles: Candle1h[], index: number, variant: Variant, btc: Candle1h[]) {
  if (index < Math.max(45, variant.lookback + 21)) return null;
  const bar = candles[index];
  if (variant.requireBtcWeak && !btcWeakAt(btc, bar.ts)) return null;
  const closes = candles.slice(index - 40, index + 1).map((item) => item.close);
  const volumes = candles.slice(index - 20, index).map((item) => item.volume);
  const sma40 = average(closes);
  const mom = candles[index - 20]?.close > 0 ? bar.close / candles[index - 20].close - 1 : 0;
  const prevMom = candles[index - 21]?.close > 0 ? candles[index - 1].close / candles[index - 21].close - 1 : 0;
  const accel = mom - prevMom;
  const volRatio = average(volumes) > 0 ? bar.volume / average(volumes) : 0;
  const recentHigh = Math.max(...candles.slice(index - variant.lookback, index).map((item) => item.high));
  const breakout = recentHigh > 0 ? bar.close / recentHigh - 1 : 0;
  const efficiency = pathEfficiency(candles, index, variant.lookback);
  const oneBarJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
  const ok =
    bar.close > sma40 &&
    mom >= variant.minMom &&
    accel >= variant.minAccel &&
    volRatio >= variant.minVolumeRatio &&
    breakout >= variant.breakoutPct &&
    efficiency >= variant.minEfficiency &&
    oneBarJump <= variant.maxOneBarJump;
  if (!ok) return null;
  const score = mom * 120 + accel * 180 + breakout * 160 + Math.min(4, volRatio) * 3 + efficiency * 24;
  return { symbol, ts: bar.ts, close: bar.close, score } satisfies Signal;
}

function simulate(input: {
  variant: Variant;
  points: EquityPoint[];
  cashWindows: Window[];
  btc: Candle1h[];
  data: Map<SymbolName, Candle1h[]>;
}) {
  const signals: Signal[] = [];
  const prices = new Map<string, Candle1h>();
  for (const symbol of CANDIDATES) {
    const candles = input.data.get(symbol);
    if (!candles) continue;
    for (let index = 0; index < candles.length; index += 1) {
      const bar = candles[index];
      prices.set(`${symbol}:${bar.ts}`, bar);
      if (!inWindows(bar.ts, input.cashWindows)) continue;
      const point = findPointAtOrBefore(input.points, bar.ts);
      if (!cashIsUsable(point)) continue;
      const signal = signalAt(symbol, candles, index, input.variant, input.btc);
      if (signal) signals.push(signal);
    }
  }

  const timeline = [...new Set([...Array.from(prices.values()).map((bar) => bar.ts), ...signals.map((signal) => signal.ts)])]
    .sort((left, right) => left - right);
  const trades: Trade[] = [];
  let open: (Trade & { peakPrice: number; maxExitTs: number }) | null = null;

  for (const ts of timeline) {
    if (open) {
      const bar = prices.get(`${open.symbol}:${ts}`);
      if (!bar) continue;
      open.peakPrice = Math.max(open.peakPrice, bar.high);
      const grossReturn = bar.close / open.entryPrice - 1;
      const drawdown = bar.low / open.entryPrice - 1;
      const retrace = open.peakPrice > 0 ? bar.close / open.peakPrice - 1 : 0;
      let exitReason: string | null = null;
      if (drawdown <= -input.variant.hardStop) exitReason = "hard-stop";
      if (!exitReason && grossReturn >= input.variant.trailAct && retrace <= -input.variant.trailRet) exitReason = "profit-trail";
      if (!exitReason && ts >= open.maxExitTs) exitReason = "max-hold";
      const point = findPointAtOrBefore(input.points, ts);
      if (!exitReason && !cashIsUsable(point)) exitReason = "cash-window-end";
      if (exitReason) {
        const netReturnPct = bar.close / open.entryPrice - 1 - (slippageRate(open.symbol) + FEE_RATE) * 2;
        trades.push({ ...open, exitTs: ts, exitPrice: bar.close, netReturnPct, exitReason });
        open = null;
      }
      continue;
    }

    const best = signals.filter((signal) => signal.ts === ts).sort((left, right) => right.score - left.score)[0];
    if (!best) continue;
    open = {
      symbol: best.symbol,
      entryTs: best.ts,
      exitTs: best.ts,
      entryPrice: best.close,
      exitPrice: best.close,
      netReturnPct: 0,
      exitReason: "open",
      peakPrice: best.close,
      maxExitTs: best.ts + input.variant.maxHoldHours * HOUR_MS,
    };
  }
  return trades;
}

function summarize(trades: Trade[]) {
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const gains = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const losses = trades.filter((trade) => trade.netReturnPct < 0).reduce((sum, trade) => sum + Math.abs(trade.netReturnPct), 0);
  const compounded = trades.reduce((value, trade) => value * (1 + trade.netReturnPct), 1) - 1;
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pf: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : 0,
    compoundedPct: round(compounded * 100, 2),
    cap300Pnl: round(compounded * 300, 2),
    bySymbol: Object.fromEntries(CANDIDATES.map((symbol) => {
      const rows = trades.filter((trade) => trade.symbol === symbol);
      const symComp = rows.reduce((value, trade) => value * (1 + trade.netReturnPct), 1) - 1;
      return [symbol, { trades: rows.length, compoundedPct: round(symComp * 100, 2), cap300Pnl: round(symComp * 300, 2) }];
    }).filter(([, value]) => value.trades > 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const details: Record<string, Trade[]> = {};

  for (const period of PERIODS) {
    const base = await runHybridBacktest("RETQ22", baseOptions(period));
    const points = [...base.equity_curve].sort((left, right) => left.ts - right.ts);
    const cashWindows = cashWindowsFromBaseline(base, period);
    const baseCashPct = cashPctInEval(points, period);
    for (const variant of VARIANTS) {
      const data = new Map<SymbolName, Candle1h[]>();
      const btc = await loadCandles("BTC", period, variant.timeframe);
      for (const symbol of CANDIDATES) {
        try {
          const candles = await loadCandles(symbol, period, variant.timeframe);
          if (candles.length > 120) data.set(symbol, candles);
        } catch (error) {
          console.log(`${period.key} ${variant.key} ${symbol}: no data`);
        }
      }
      const trades = simulate({ variant, points, cashWindows, btc, data });
      const summary = summarize(trades);
      const key = `${period.key}_${variant.key}`;
      details[key] = trades;
      rows.push({
        period: period.key,
        focus: period.focus,
        evalStart: new Date(evalStart(period)).toISOString(),
        variant: variant.key,
        timeframe: variant.timeframe,
        baseEnd: round(base.summary.end_equity, 2),
        baseCashPct,
        cashWindows: cashWindows.length,
        ...summary,
      });
      console.log(`${period.key} ${variant.key}: ret=${summary.compoundedPct}% pnl300=${summary.cap300Pnl} trades=${summary.trades} win=${summary.winPct}% pf=${summary.pf}`);
    }
  }

  const focusRows = rows.filter((row) => row.focus).sort((left, right) => right.compoundedPct - left.compoundedPct);
  const allRows = [...rows].sort((left, right) => {
    if (left.period === "2026-May" && right.period !== "2026-May") return -1;
    if (right.period === "2026-May" && left.period !== "2026-May") return 1;
    return right.compoundedPct - left.compoundedPct;
  });
  const md = [
    "# V7 May 2026 Opportunity Scan",
    "",
    "- method: engine-direct V7 live-equivalent cash windows + candidate sidecar simulation",
    "- scope: USDT/cash waiting only",
    "- purpose: find logic that captures May 2026 market, then validate against other periods",
    "- cap300Pnl is a 300 USDT sidecar reference; compoundedPct is the raw per-trade compounded return of the sidecar sequence",
    "",
    "## May Ranking",
    "",
    "| rank | variant | timeframe | return % | cap300 pnl | trades | win % | PF | by symbol |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...focusRows.map((row, index) => `| ${index + 1} | ${row.variant} | ${row.timeframe} | ${row.compoundedPct} | ${row.cap300Pnl} | ${row.trades} | ${row.winPct} | ${row.pf} | ${JSON.stringify(row.bySymbol)} |`),
    "",
    "## All Periods",
    "",
    "| period | variant | return % | cap300 pnl | trades | win % | PF | base USDT % | by symbol |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...allRows.map((row) => `| ${row.period} | ${row.variant} | ${row.compoundedPct} | ${row.cap300Pnl} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.baseCashPct} | ${JSON.stringify(row.bySymbol)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify({ rows, details }, null, 2), "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
