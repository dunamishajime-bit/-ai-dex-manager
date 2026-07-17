import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-nonoverlap-candidate-search");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const LIQUIDITY_PATH = path.join(process.cwd(), "reports", "v7-bnb-idle-liquidity-candidate-search", "liquidity.json");
const START_TS = Date.UTC(2024, 6, 1);
const END_TS = Date.UTC(2026, 4, 5, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const EXCLUDE = new Set([
  "BTC", "ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT", "BNB", "LINK",
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "AEUR", "EURI", "FRAX", "XUSD", "USD1", "USDE", "WBTC", "WBETH",
  "JUP", "AI", "BANANA", "ACT", "ASTER", "WLFI", "HEMI",
]);

type Window = { startTs: number; endTs: number };
type LiquidityRow = {
  symbol: string;
  quoteVolume24h: number;
  trades24h: number;
  q100LossPct: number | null;
  q300LossPct: number | null;
  pass: boolean;
};
type Signal = {
  ts: number;
  price: number;
  score: number;
  breakoutPct: number;
  volRatio: number;
  mom6: number;
  mom24: number;
  closeLocation: number;
};
type SimTrade = {
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  netReturnPct: number;
  maxRunupPct: number;
  maxDrawdownPct: number;
  exitReason: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function windowsFromEquity(points: Awaited<ReturnType<typeof runHybridBacktest>>["equity_curve"], predicate: (point: typeof points[number]) => boolean) {
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of points.sort((left, right) => left.ts - right.ts)) {
    if (predicate(point)) {
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
  return windows.filter((window) => window.endTs > window.startTs);
}

function tradeWindows(trades: Awaited<ReturnType<typeof runHybridBacktest>>["trade_pairs"], symbol: string) {
  return trades
    .filter((trade) => trade.symbol === symbol)
    .map((trade) => ({
      startTs: Date.parse(trade.entry_time),
      endTs: Date.parse(trade.exit_time),
    }))
    .filter((window) => Number.isFinite(window.startTs) && Number.isFinite(window.endTs) && window.endTs > window.startTs);
}

function inWindows(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEndFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

function nearestPenguEntryHours(ts: number, penguEntries: readonly number[]) {
  if (!penguEntries.length) return Infinity;
  return Math.min(...penguEntries.map((entry) => Math.abs(ts - entry) / HOUR_MS));
}

function buildSignals(candles: Candle1h[]) {
  const signals: Signal[] = [];
  for (let index = 30; index < candles.length; index += 1) {
    const bar = candles[index];
    const prior = candles.slice(index - 8, index);
    const high = Math.max(...prior.map((item) => item.high));
    const low = Math.min(...prior.map((item) => item.low));
    const breakoutPct = high > 0 ? bar.close / high - 1 : 0;
    const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
    const volRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
    const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
    const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
    const oneHourJump = candles[index - 1]?.close > 0 ? bar.close / candles[index - 1].close - 1 : 0;
    const closeLocation = bar.high > bar.low ? (bar.close - bar.low) / (bar.high - bar.low) : 1;
    const recentRange = low > 0 ? high / low - 1 : 0;
    if (breakoutPct < 0.016) continue;
    if (volRatio < 1.15) continue;
    if (mom6 < 0.035) continue;
    if (mom24 < 0.055) continue;
    if (oneHourJump > 0.18) continue;
    if (closeLocation < 0.55) continue;
    if (recentRange < 0.025) continue;
    const score = breakoutPct * 180 + mom6 * 120 + mom24 * 90 + Math.min(3, volRatio) * 2 + closeLocation * 4;
    if (score < 18) continue;
    signals.push({
      ts: bar.ts,
      price: bar.close,
      score,
      breakoutPct,
      volRatio,
      mom6,
      mom24,
      closeLocation,
    });
  }
  return signals;
}

function simulateSignals(candles: Candle1h[], signals: Signal[], cashWindows: readonly Window[], q300LossPct: number | null) {
  const byTs = new Map(candles.map((bar, index) => [bar.ts, index]));
  const trades: SimTrade[] = [];
  let busyUntil = 0;
  for (const signal of signals) {
    if (signal.ts < busyUntil) continue;
    if (!inWindows(signal.ts, cashWindows)) continue;
    const entryIndex = byTs.get(signal.ts);
    if (entryIndex == null) continue;
    const entry = candles[entryIndex];
    const maxExitTs = Math.min(signal.ts + 48 * HOUR_MS, windowEndFor(signal.ts, cashWindows));
    let peak = entry.high;
    let trough = entry.low;
    let exit = entry;
    let exitReason = "window-or-max-hold";
    for (let index = entryIndex + 1; index < candles.length; index += 1) {
      const bar = candles[index];
      if (bar.ts > maxExitTs) break;
      peak = Math.max(peak, bar.high);
      trough = Math.min(trough, bar.low);
      const fromEntry = bar.close / entry.close - 1;
      const fromPeak = peak > 0 ? bar.close / peak - 1 : 0;
      if (fromEntry <= -0.08) {
        exit = bar;
        exitReason = "hard-stop";
        break;
      }
      if (fromEntry >= 0.18 && fromPeak <= -0.085) {
        exit = bar;
        exitReason = "profit-trail";
        break;
      }
      exit = bar;
    }
    const quoteLoss = Math.max(0, q300LossPct ?? 1) / 100;
    const netReturnPct = (exit.close / entry.close - 1) - quoteLoss * 2 - FEE_RATE * 2;
    trades.push({
      entryTs: entry.ts,
      exitTs: exit.ts,
      entryPrice: entry.close,
      exitPrice: exit.close,
      netReturnPct,
      maxRunupPct: peak / entry.close - 1,
      maxDrawdownPct: trough / entry.close - 1,
      exitReason,
    });
    busyUntil = exit.ts + HOUR_MS;
  }
  return trades;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = await runHybridBacktest("RETQ22", {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "pengu_nonoverlap_base",
  });
  const cashWindows = windowsFromEquity(base.equity_curve, (point) => point.position_side === "cash");
  const penguWindows = tradeWindows(base.trade_pairs, "PENGU");
  const penguEntries = penguWindows.map((window) => window.startTs);

  const liquidity = JSON.parse(await fs.readFile(LIQUIDITY_PATH, "utf8")) as LiquidityRow[];
  const candidates = liquidity
    .filter((row) => row.pass)
    .filter((row) => /^[A-Z0-9]+$/.test(row.symbol))
    .filter((row) => !EXCLUDE.has(row.symbol))
    .filter((row) => typeof row.q100LossPct === "number" && typeof row.q300LossPct === "number")
    .filter((row) => row.q100LossPct! >= -1 && row.q100LossPct! <= 1 && row.q300LossPct! >= -1 && row.q300LossPct! <= 1)
    .filter((row) => row.quoteVolume24h >= 300_000)
    .sort((left, right) => right.quoteVolume24h - left.quoteVolume24h)
    .slice(0, 70);

  const rows = [];
  const signalRows = [];
  for (const candidate of candidates) {
    const candles = await loadHistoricalCandles({
      symbol: `${candidate.symbol}USDT`,
      cacheRoot: CACHE_ROOT,
      startMs: START_TS,
      endMs: END_TS,
      interval: "1h",
    }).catch(() => []);
    if (candles.length < 200) continue;
    const signals = buildSignals(candles);
    const cashSignals = signals.filter((signal) => inWindows(signal.ts, cashWindows));
    const penguOverlapSignals = signals.filter((signal) => inWindows(signal.ts, penguWindows));
    const nearPenguEntrySignals = signals.filter((signal) => nearestPenguEntryHours(signal.ts, penguEntries) <= 12);
    const trades = simulateSignals(candles, signals, cashWindows, candidate.q300LossPct);
    const wins = trades.filter((trade) => trade.netReturnPct > 0);
    const losses = trades.filter((trade) => trade.netReturnPct <= 0);
    const grossWin = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netReturnPct, 0));
    const avgNet = average(trades.map((trade) => trade.netReturnPct));
    const score =
      trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) * 100
      + wins.length * 1.5
      - losses.length * 2
      - (penguOverlapSignals.length / Math.max(1, signals.length)) * 20
      - (nearPenguEntrySignals.length / Math.max(1, signals.length)) * 10
      + Math.log10(Math.max(1, candidate.quoteVolume24h));
    const row = {
      symbol: candidate.symbol,
      quoteVolume24h: round(candidate.quoteVolume24h, 0),
      trades24h: candidate.trades24h,
      q300LossPct: candidate.q300LossPct,
      signals: signals.length,
      cashSignals: cashSignals.length,
      penguOverlapSignals: penguOverlapSignals.length,
      nearPenguEntrySignals: nearPenguEntrySignals.length,
      overlapPct: round((penguOverlapSignals.length / Math.max(1, signals.length)) * 100, 1),
      nearPenguEntryPct: round((nearPenguEntrySignals.length / Math.max(1, signals.length)) * 100, 1),
      trades: trades.length,
      winRatePct: round((wins.length / Math.max(1, trades.length)) * 100, 1),
      netReturnSumPct: round(trades.reduce((sum, trade) => sum + trade.netReturnPct, 0) * 100, 2),
      avgNetReturnPct: round(avgNet * 100, 2),
      profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : grossWin > 0 ? 999 : 0,
      bestRunupPct: round(Math.max(0, ...trades.map((trade) => trade.maxRunupPct)) * 100, 2),
      worstDrawdownPct: round(Math.min(0, ...trades.map((trade) => trade.maxDrawdownPct)) * 100, 2),
      score: round(score, 2),
      topTrades: trades
        .sort((left, right) => right.netReturnPct - left.netReturnPct)
        .slice(0, 4)
        .map((trade) => ({
          entry: new Date(trade.entryTs).toISOString(),
          exit: new Date(trade.exitTs).toISOString(),
          netReturnPct: round(trade.netReturnPct * 100, 2),
          runupPct: round(trade.maxRunupPct * 100, 2),
          drawdownPct: round(trade.maxDrawdownPct * 100, 2),
          exitReason: trade.exitReason,
        })),
    };
    rows.push(row);
    signalRows.push(...signals.map((signal) => ({
      symbol: candidate.symbol,
      time: new Date(signal.ts).toISOString(),
      cash: inWindows(signal.ts, cashWindows),
      penguOverlap: inWindows(signal.ts, penguWindows),
      nearPenguEntryHours: round(nearestPenguEntryHours(signal.ts, penguEntries), 1),
      score: round(signal.score, 2),
      breakoutPct: round(signal.breakoutPct * 100, 2),
      volRatio: round(signal.volRatio, 2),
      mom6Pct: round(signal.mom6 * 100, 2),
      mom24Pct: round(signal.mom24 * 100, 2),
    })));
    console.log(`${candidate.symbol}: score=${row.score} trades=${row.trades} net=${row.netReturnSumPct}% overlap=${row.overlapPct}% cashSignals=${row.cashSignals}`);
  }
  rows.sort((left, right) => right.score - left.score);

  const md = [
    "# V7 PENGU Non-Overlap Candidate Search",
    "",
    "- method: V7 engine-direct cash windows + PENGU hold windows + BNB Chain quote-passed symbols + Binance 1h candles",
    "- target: PENGU-like breakout candidates whose signals occur during USDT windows and do not overlap PENGU firing/holding windows",
    "- signal: 1h breakout, lookback 8, breakout >=1.6%, volumeRatio >=1.15, mom6 >=3.5%, mom24 >=5.5%, closeLocation >=0.55",
    "- simulation: standalone 48h max hold inside cash windows, 18%/8.5% trail, 8% hard stop, quote loss included",
    "",
    "| rank | symbol | score | 24h vol | q300 loss % | signals | cash signals | PENGU overlap % | near PENGU entry % | trades | win % | net return sum % | avg net % | PF | best runup % | worst DD % |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.symbol} | ${row.score} | ${row.quoteVolume24h} | ${row.q300LossPct} | ${row.signals} | ${row.cashSignals} | ${row.overlapPct}% | ${row.nearPenguEntryPct}% | ${row.trades} | ${row.winRatePct}% | ${row.netReturnSumPct} | ${row.avgNetReturnPct} | ${row.profitFactor} | ${row.bestRunupPct} | ${row.worstDrawdownPct} |`),
    "",
    "## Top Trades",
    "",
    ...rows.slice(0, 12).flatMap((row) => [
      `### ${row.symbol}`,
      ...row.topTrades.map((trade) => `- ${trade.entry} -> ${trade.exit}: net ${trade.netReturnPct}%, runup ${trade.runupPct}%, dd ${trade.drawdownPct}%, ${trade.exitReason}`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "signals.json"), JSON.stringify(signalRows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
