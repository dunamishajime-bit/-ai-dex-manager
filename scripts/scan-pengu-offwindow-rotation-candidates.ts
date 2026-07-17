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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-offwindow-rotation-search");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const LIQUIDITY_PATH = path.join(process.cwd(), "reports", "v7-bnb-idle-liquidity-candidate-search", "liquidity.json");
const START_TS = Date.UTC(2024, 6, 1);
const END_TS = Date.UTC(2026, 4, 5, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const CURRENT_SYMBOLS = ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI", "TWT"];

const EXCLUDE = new Set([
  "BTC", "PENGU", "BNB", "LINK",
  "USDT", "USDC", "FDUSD", "TUSD", "DAI", "AEUR", "EURI", "FRAX", "XUSD", "USD1", "USDE", "WBTC", "WBETH",
  "JUP", "AI", "BANANA", "ACT", "ASTER", "WLFI", "HEMI", "ZBT",
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
type Candidate = LiquidityRow & { group: "current" | "new" };
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

function tradeWindows(trades: Awaited<ReturnType<typeof runHybridBacktest>>["trade_pairs"], symbol: string) {
  return trades
    .filter((trade) => trade.symbol === symbol)
    .map((trade) => ({
      startTs: Date.parse(trade.entry_time),
      endTs: Date.parse(trade.exit_time),
    }))
    .filter((window) => Number.isFinite(window.startTs) && Number.isFinite(window.endTs) && window.endTs > window.startTs)
    .sort((left, right) => left.startTs - right.startTs);
}

function invertWindows(blocked: readonly Window[], startTs: number, endTs: number) {
  const windows: Window[] = [];
  let cursor = startTs;
  for (const window of blocked) {
    if (window.endTs <= cursor) continue;
    if (window.startTs > cursor) windows.push({ startTs: cursor, endTs: Math.min(window.startTs, endTs) });
    cursor = Math.max(cursor, window.endTs);
    if (cursor >= endTs) break;
  }
  if (cursor < endTs) windows.push({ startTs: cursor, endTs });
  return windows.filter((window) => window.endTs - window.startTs >= HOUR_MS);
}

function inWindows(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEndFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

function nearestWindowStartHours(ts: number, windows: readonly Window[]) {
  if (!windows.length) return Infinity;
  return Math.min(...windows.map((window) => Math.abs(ts - window.startTs) / HOUR_MS));
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

function simulateSignals(candles: Candle1h[], signals: Signal[], allowedWindows: readonly Window[], q300LossPct: number | null) {
  const byTs = new Map(candles.map((bar, index) => [bar.ts, index]));
  const trades: SimTrade[] = [];
  let busyUntil = 0;
  for (const signal of signals) {
    if (signal.ts < busyUntil) continue;
    if (!inWindows(signal.ts, allowedWindows)) continue;
    const entryIndex = byTs.get(signal.ts);
    if (entryIndex == null) continue;
    const entry = candles[entryIndex];
    const maxExitTs = Math.min(signal.ts + 48 * HOUR_MS, windowEndFor(signal.ts, allowedWindows));
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

function summarizeWindows(windows: readonly Window[]) {
  const totalHours = windows.reduce((sum, window) => sum + (window.endTs - window.startTs) / HOUR_MS, 0);
  const avgHours = totalHours / Math.max(1, windows.length);
  return { count: windows.length, totalHours: round(totalHours, 1), avgHours: round(avgHours, 1) };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = await runHybridBacktest("RETQ22", {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "pengu_offwindow_rotation_base",
  });
  const penguWindows = tradeWindows(base.trade_pairs, "PENGU");
  const penguOffWindows = invertWindows(penguWindows, START_TS, END_TS);
  const liquidity = JSON.parse(await fs.readFile(LIQUIDITY_PATH, "utf8")) as LiquidityRow[];
  const liquidityBySymbol = new Map(liquidity.map((row) => [row.symbol, row]));

  const currentCandidates: Candidate[] = CURRENT_SYMBOLS.map((symbol) => ({
    symbol,
    quoteVolume24h: liquidityBySymbol.get(symbol)?.quoteVolume24h ?? 0,
    trades24h: liquidityBySymbol.get(symbol)?.trades24h ?? 0,
    q100LossPct: liquidityBySymbol.get(symbol)?.q100LossPct ?? 0,
    q300LossPct: liquidityBySymbol.get(symbol)?.q300LossPct ?? 0,
    pass: true,
    group: "current",
  }));

  const newCandidates: Candidate[] = liquidity
    .filter((row) => row.pass)
    .filter((row) => /^[A-Z0-9]+$/.test(row.symbol))
    .filter((row) => !EXCLUDE.has(row.symbol))
    .filter((row) => !CURRENT_SYMBOLS.includes(row.symbol))
    .filter((row) => typeof row.q100LossPct === "number" && typeof row.q300LossPct === "number")
    .filter((row) => row.q100LossPct! >= -1 && row.q100LossPct! <= 1 && row.q300LossPct! >= -1 && row.q300LossPct! <= 1)
    .filter((row) => row.quoteVolume24h >= 300_000)
    .sort((left, right) => right.quoteVolume24h - left.quoteVolume24h)
    .slice(0, 90)
    .map((row) => ({ ...row, group: "new" }));

  const rows = [];
  const signalRows = [];
  for (const candidate of [...currentCandidates, ...newCandidates]) {
    const candles = await loadHistoricalCandles({
      symbol: `${candidate.symbol}USDT`,
      cacheRoot: CACHE_ROOT,
      startMs: START_TS,
      endMs: END_TS,
      interval: "1h",
    }).catch(() => []);
    if (candles.length < 200) continue;
    const signals = buildSignals(candles);
    const offSignals = signals.filter((signal) => inWindows(signal.ts, penguOffWindows));
    const penguOverlapSignals = signals.filter((signal) => inWindows(signal.ts, penguWindows));
    const nearPenguEntrySignals = signals.filter((signal) => nearestWindowStartHours(signal.ts, penguWindows) <= 12);
    const trades = simulateSignals(candles, signals, penguOffWindows, candidate.q300LossPct);
    const wins = trades.filter((trade) => trade.netReturnPct > 0);
    const losses = trades.filter((trade) => trade.netReturnPct <= 0);
    const grossWin = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.netReturnPct, 0));
    const avgNet = average(trades.map((trade) => trade.netReturnPct));
    const net = trades.reduce((sum, trade) => sum + trade.netReturnPct, 0);
    const overlapPct = penguOverlapSignals.length / Math.max(1, signals.length);
    const score =
      net * 100
      + wins.length * 1.4
      - losses.length * 2.2
      - overlapPct * 30
      - (nearPenguEntrySignals.length / Math.max(1, signals.length)) * 10
      + Math.log10(Math.max(1, candidate.quoteVolume24h));
    const row = {
      symbol: candidate.symbol,
      group: candidate.group,
      quoteVolume24h: round(candidate.quoteVolume24h, 0),
      trades24h: candidate.trades24h,
      q300LossPct: candidate.q300LossPct,
      signals: signals.length,
      penguOffSignals: offSignals.length,
      penguOverlapSignals: penguOverlapSignals.length,
      nearPenguEntrySignals: nearPenguEntrySignals.length,
      offSignalPct: round((offSignals.length / Math.max(1, signals.length)) * 100, 1),
      overlapPct: round(overlapPct * 100, 1),
      nearPenguEntryPct: round((nearPenguEntrySignals.length / Math.max(1, signals.length)) * 100, 1),
      trades: trades.length,
      winRatePct: round((wins.length / Math.max(1, trades.length)) * 100, 1),
      netReturnSumPct: round(net * 100, 2),
      avgNetReturnPct: round(avgNet * 100, 2),
      profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 3) : grossWin > 0 ? 999 : 0,
      bestRunupPct: round(Math.max(0, ...trades.map((trade) => trade.maxRunupPct)) * 100, 2),
      worstDrawdownPct: round(Math.min(0, ...trades.map((trade) => trade.maxDrawdownPct)) * 100, 2),
      score: round(score, 2),
      topTrades: trades
        .sort((left, right) => right.netReturnPct - left.netReturnPct)
        .slice(0, 5)
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
      group: candidate.group,
      time: new Date(signal.ts).toISOString(),
      penguOffWindow: inWindows(signal.ts, penguOffWindows),
      penguOverlap: inWindows(signal.ts, penguWindows),
      nearPenguEntryHours: round(nearestWindowStartHours(signal.ts, penguWindows), 1),
      score: round(signal.score, 2),
      breakoutPct: round(signal.breakoutPct * 100, 2),
      volRatio: round(signal.volRatio, 2),
      mom6Pct: round(signal.mom6 * 100, 2),
      mom24Pct: round(signal.mom24 * 100, 2),
    })));
    console.log(`${candidate.symbol}: score=${row.score} trades=${row.trades} net=${row.netReturnSumPct}% overlap=${row.overlapPct}% offSignals=${row.penguOffSignals}`);
  }
  rows.sort((left, right) => right.score - left.score);

  const windowSummary = summarizeWindows(penguOffWindows);
  const md = [
    "# V7 PENGU Off-Window Rotation Candidate Search",
    "",
    "- method: V7 engine-direct baseline trade history, then scan all periods where PENGU is not held",
    "- target: candidates that can become a PENGU rotation partner or replace weak non-PENGU trades",
    "- PENGU off-window summary: " + `${windowSummary.count} windows, ${windowSummary.totalHours} hours total, average ${windowSummary.avgHours} hours`,
    "- signal: 1h breakout, lookback 8, breakout >=1.6%, volumeRatio >=1.15, mom6 >=3.5%, mom24 >=5.5%, closeLocation >=0.55",
    "- simulation: standalone 48h max hold inside PENGU-off windows, 18%/8.5% trail, 8% hard stop, q300 quote loss included",
    "- note: ZBT is excluded by prior production-candidate decision",
    "",
    "| rank | symbol | group | score | 24h vol | q300 loss % | signals | PENGU-off signals | off % | PENGU overlap % | near PENGU entry % | trades | win % | net return sum % | avg net % | PF | best runup % | worst DD % |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row, index) => `| ${index + 1} | ${row.symbol} | ${row.group} | ${row.score} | ${row.quoteVolume24h} | ${row.q300LossPct} | ${row.signals} | ${row.penguOffSignals} | ${row.offSignalPct}% | ${row.overlapPct}% | ${row.nearPenguEntryPct}% | ${row.trades} | ${row.winRatePct}% | ${row.netReturnSumPct} | ${row.avgNetReturnPct} | ${row.profitFactor} | ${row.bestRunupPct} | ${row.worstDrawdownPct} |`),
    "",
    "## Top Trades",
    "",
    ...rows.slice(0, 15).flatMap((row) => [
      `### ${row.symbol} (${row.group})`,
      ...row.topTrades.map((trade) => `- ${trade.entry} -> ${trade.exit}: net ${trade.netReturnPct}%, runup ${trade.runupPct}%, dd ${trade.drawdownPct}%, ${trade.exitReason}`),
      "",
    ]),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify({ windowSummary, rows }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "signals.json"), JSON.stringify(signalRows, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
