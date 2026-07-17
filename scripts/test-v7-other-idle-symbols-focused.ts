import fs from "fs/promises";
import path from "path";

import { RECLAIM_HYBRID_EXECUTION_PROFILE, buildReclaimHybridVariantOptions } from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-other-idle-symbols-focused");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const SYMBOLS = ["ZBT", "PENDLE", "ADX", "BANK", "ARK", "DEXE"] as const;
const QUOTE_LOSS_PCT: Record<string, number> = {
  ZBT: 0.7178,
  PENDLE: 0.7495,
  ADX: 0.8542,
  BANK: 0.4,
  ARK: 0.4698,
  DEXE: 0.5161,
};

const PERIODS = [
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: END_TS },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: END_TS },
] as const;

const VARIANTS = [
  {
    key: "early_24h",
    maxHoldHours: 24,
    lookback: 8,
    breakoutPct: 0.012,
    minVolRatio: 1.12,
    minMom6: 0.025,
    minMom24: 0.04,
    minFourHourMom: 0.025,
    minScore: 11,
    trailActivationPct: 0.12,
    trailRetracePct: 0.06,
    hardStopPct: 0.08,
    weakExitMinHours: 6,
  },
  {
    key: "confirmed_48h",
    maxHoldHours: 48,
    lookback: 10,
    breakoutPct: 0.015,
    minVolRatio: 1.18,
    minMom6: 0.035,
    minMom24: 0.065,
    minFourHourMom: 0.04,
    minScore: 15,
    trailActivationPct: 0.2,
    trailRetracePct: 0.1,
    hardStopPct: 0.1,
    weakExitMinHours: 10,
  },
  {
    key: "runner_72h",
    maxHoldHours: 72,
    lookback: 12,
    breakoutPct: 0.018,
    minVolRatio: 1.22,
    minMom6: 0.04,
    minMom24: 0.08,
    minFourHourMom: 0.055,
    minScore: 18,
    trailActivationPct: 0.28,
    trailRetracePct: 0.14,
    hardStopPct: 0.12,
    weakExitMinHours: 12,
  },
  {
    key: "dexe_trend_swing_168h",
    onlySymbol: "DEXE",
    maxHoldHours: 168,
    lookback: 24,
    breakoutPct: 0.018,
    minVolRatio: 0.9,
    minMom6: -0.01,
    minMom24: 0.035,
    minFourHourMom: 0.025,
    minScore: 12,
    trailActivationPct: 0.22,
    trailRetracePct: 0.11,
    hardStopPct: 0.14,
    weakExitMinHours: 24,
  },
  {
    key: "dexe_slow_follow_240h",
    onlySymbol: "DEXE",
    maxHoldHours: 240,
    lookback: 36,
    breakoutPct: 0.012,
    minVolRatio: 0.8,
    minMom6: -0.02,
    minMom24: 0.02,
    minFourHourMom: 0.02,
    minScore: 9,
    trailActivationPct: 0.28,
    trailRetracePct: 0.14,
    hardStopPct: 0.16,
    weakExitMinHours: 36,
  },
] as const;

type Window = { startTs: number; endTs: number };
type Trade = { symbol: string; entryTs: number; exitTs: number; entryPrice: number; exitPrice: number; netReturnPct: number };

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function baseOptions(period: { startTs: number; endTs: number }): HybridVariantOptions {
  return { ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE), backtestStartTs: period.startTs, backtestEndTs: period.endTs };
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

function isInsideWindow(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEndFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

async function loadCandles(symbol: string, startTs: number, endTs: number) {
  return loadHistoricalCandles({
    symbol: `${symbol}USDT`,
    cacheRoot: CACHE_ROOT,
    startMs: Math.max(START_TS, startTs - 400 * HOUR_MS),
    endMs: endTs,
    interval: "1h",
  }).catch(() => []);
}

function buildSignal(candles: Candle1h[], index: number, fourHourCandles: Candle1h[], variant: typeof VARIANTS[number]) {
  if (index < Math.max(40, variant.lookback + 1)) return null;
  const bar = candles[index];
  const prevHigh = Math.max(...candles.slice(index - variant.lookback, index).map((item) => item.high));
  const breakoutPct = prevHigh > 0 ? bar.close / prevHigh - 1 : 0;
  const volAvg20 = average(candles.slice(index - 20, index).map((item) => item.volume));
  const volRatio = volAvg20 > 0 ? bar.volume / volAvg20 : 0;
  const mom6 = candles[index - 6]?.close > 0 ? bar.close / candles[index - 6].close - 1 : 0;
  const mom24 = candles[index - 24]?.close > 0 ? bar.close / candles[index - 24].close - 1 : 0;
  const fourHour = [...fourHourCandles].reverse().find((item) => item.ts <= bar.ts);
  const fourHourIndex = fourHour ? fourHourCandles.findIndex((item) => item.ts === fourHour.ts) : -1;
  const fourHourMom = fourHourIndex >= 3 && fourHourCandles[fourHourIndex - 3]?.close > 0 ? fourHour!.close / fourHourCandles[fourHourIndex - 3].close - 1 : 0;
  if (breakoutPct < variant.breakoutPct || volRatio < variant.minVolRatio || mom6 < variant.minMom6 || mom24 < variant.minMom24 || fourHourMom < variant.minFourHourMom) return null;
  const score = mom6 * 100 + mom24 * 90 + fourHourMom * 90 + breakoutPct * 160 + Math.min(3.5, volRatio) * 2;
  return score >= variant.minScore ? { close: bar.close, score } : null;
}

function simulate(symbol: string, candles: Candle1h[], windows: readonly Window[], variant: typeof VARIANTS[number]) {
  const indexByTs = new Map<number, number>();
  candles.forEach((bar, index) => indexByTs.set(bar.ts, index));
  const fourHourCandles = resampleToHours(candles, 4);
  const tsList = candles.filter((bar) => isInsideWindow(bar.ts, windows)).map((bar) => bar.ts).sort((left, right) => left - right);
  const trades: Trade[] = [];
  let open: null | { entryTs: number; entryPrice: number; peak: number; maxExitTs: number } = null;

  for (const ts of tsList) {
    const index = indexByTs.get(ts);
    if (index == null) continue;
    const bar = candles[index];
    if (open) {
      open.peak = Math.max(open.peak, bar.high);
      const holdingHours = (ts - open.entryTs) / HOUR_MS;
      const profit = bar.close / open.entryPrice - 1;
      const drawdown = bar.low / open.entryPrice - 1;
      const retrace = open.peak > 0 ? bar.close / open.peak - 1 : 0;
      const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
      const mom6 = index >= 6 ? bar.close / candles[index - 6].close - 1 : 0;
      const shouldExit =
        drawdown <= -variant.hardStopPct
        || (profit >= variant.trailActivationPct && retrace <= -variant.trailRetracePct)
        || (holdingHours >= variant.weakExitMinHours && bar.close < sma20 && mom6 < 0)
        || ts >= open.maxExitTs
        || !isInsideWindow(ts, windows);
      if (shouldExit) {
        const quoteLossPct = Math.max(0, QUOTE_LOSS_PCT[symbol] ?? 1);
        trades.push({
          symbol,
          entryTs: open.entryTs,
          exitTs: ts,
          entryPrice: open.entryPrice,
          exitPrice: bar.close,
          netReturnPct: bar.close / open.entryPrice - 1 - (quoteLossPct / 100) * 2 - FEE_RATE * 2,
        });
        open = null;
      }
      continue;
    }
    const signal = buildSignal(candles, index, fourHourCandles, variant);
    if (!signal) continue;
    const maxExitTs = Math.min(ts + variant.maxHoldHours * HOUR_MS, windowEndFor(ts, windows));
    if (maxExitTs <= ts) continue;
    open = { entryTs: ts, entryPrice: signal.close, peak: signal.close, maxExitTs };
  }
  return trades;
}

function summarize(trades: Trade[], capUsd = 300) {
  const pnl = trades.reduce((sum, trade) => sum + trade.netReturnPct * capUsd, 0);
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const gains = wins.reduce((sum, trade) => sum + trade.netReturnPct * capUsd, 0);
  const losses = trades.filter((trade) => trade.netReturnPct < 0).reduce((sum, trade) => sum + Math.abs(trade.netReturnPct * capUsd), 0);
  const hours = trades.reduce((sum, trade) => sum + Math.max(0, trade.exitTs - trade.entryTs) / HOUR_MS, 0);
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pf: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : 0,
    pnl: round(pnl, 2),
    days: round(hours / 24, 2),
  };
}

async function writeReport(rows: any[]) {
  rows.sort((left, right) => right.pnl - left.pnl || right.pf - left.pf);
  const md = [
    "# V7 Other Idle Symbols Focused",
    "",
    "- method: V7 engine-direct cash windows + standalone 1h sidecar simulations",
    "- cap: 300 USDT",
    "- q300 quote loss charged on entry and exit",
    "- DEXE includes custom slow trend-follow variants.",
    "",
    "| period | symbol | variant | V7 USDT % | trades | win % | PF | cap300 PnL | added days |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.period} | ${row.symbol} | ${row.variant} | ${row.v7CashPct} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.pnl} | ${row.days} |`),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows: any[] = [];
  for (const period of PERIODS) {
    const baseline = await runHybridBacktest("RETQ22", { ...baseOptions(period), label: `v7_focused_${period.key}` });
    const windows = cashWindowsFromBaseline(baseline);
    const v7CashPct = round(100 - baseline.summary.exposure_pct, 2);
    for (const symbol of SYMBOLS) {
      const candles = (await loadCandles(symbol, period.startTs, period.endTs)).filter((bar) => bar.ts >= period.startTs - 400 * HOUR_MS && bar.ts <= period.endTs);
      for (const variant of VARIANTS) {
        if ("onlySymbol" in variant && variant.onlySymbol !== symbol) continue;
        if ("onlySymbol" in variant === false && symbol === "DEXE") continue;
        const summary = summarize(simulate(symbol, candles, windows, variant));
        rows.push({ period: period.key, symbol, variant: variant.key, v7CashPct, ...summary });
      }
      await writeReport(rows);
      console.log(`${period.key} ${symbol} done`);
    }
  }
  await writeReport(rows);
  console.log(JSON.stringify({ report: path.join(REPORT_DIR, "result.md"), top: rows.sort((a, b) => b.pnl - a.pnl).slice(0, 20) }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
