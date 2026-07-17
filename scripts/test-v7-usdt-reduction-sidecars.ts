import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h } from "../lib/backtest/types";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-usdt-reduction-sidecars");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const SYMBOLS = ["BIO", "DUSK", "PROVE", "ALLO"] as const;
const QUOTE_LOSS_PCT: Record<string, number> = {
  BIO: 0.6979,
  DUSK: 0.6026,
  PROVE: 0.1761,
  ALLO: 0.0945,
};

const PERIODS = [
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: END_TS },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: END_TS },
  { key: "2024-2026", startTs: START_TS, endTs: END_TS },
] as const;

const VARIANTS = [
  {
    key: "bio_dusk_confirmed_48h",
    symbols: ["BIO", "DUSK"] as const,
    activeFrom: { BIO: Date.UTC(2025, 6, 1), DUSK: Date.UTC(2026, 0, 1) } as Record<string, number>,
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
  {
    key: "bio_dusk_balanced_24h",
    symbols: ["BIO", "DUSK"] as const,
    activeFrom: { BIO: Date.UTC(2025, 6, 1), DUSK: Date.UTC(2026, 0, 1) } as Record<string, number>,
    maxHoldHours: 24,
    lookback: 8,
    breakoutPct: 0.01,
    minVolRatio: 1.12,
    minMom6: 0.025,
    minMom24: 0.045,
    minFourHourMom: 0.025,
    minScore: 18,
    maxOneHourJump: 0.22,
    minCloseLocation: 0.52,
    trailActivationPct: 0.1,
    trailRetracePct: 0.055,
    hardStopPct: 0.075,
    weakExitMinHours: 6,
  },
  {
    key: "bio_dusk_loose_12h",
    symbols: ["BIO", "DUSK"] as const,
    activeFrom: { BIO: Date.UTC(2025, 6, 1), DUSK: Date.UTC(2026, 0, 1) } as Record<string, number>,
    maxHoldHours: 12,
    lookback: 6,
    breakoutPct: 0.006,
    minVolRatio: 1.05,
    minMom6: 0.012,
    minMom24: 0.025,
    minFourHourMom: 0.012,
    minScore: 10,
    maxOneHourJump: 0.25,
    minCloseLocation: 0.48,
    trailActivationPct: 0.055,
    trailRetracePct: 0.035,
    hardStopPct: 0.06,
    weakExitMinHours: 4,
  },
  {
    key: "bio_dusk_prove_allo_loose_12h",
    symbols: ["BIO", "DUSK", "PROVE", "ALLO"] as const,
    activeFrom: {
      BIO: Date.UTC(2025, 6, 1),
      DUSK: Date.UTC(2026, 0, 1),
      PROVE: Date.UTC(2025, 0, 1),
      ALLO: Date.UTC(2025, 0, 1),
    } as Record<string, number>,
    maxHoldHours: 12,
    lookback: 6,
    breakoutPct: 0.006,
    minVolRatio: 1.05,
    minMom6: 0.012,
    minMom24: 0.025,
    minFourHourMom: 0.012,
    minScore: 10,
    maxOneHourJump: 0.25,
    minCloseLocation: 0.48,
    trailActivationPct: 0.055,
    trailRetracePct: 0.035,
    hardStopPct: 0.06,
    weakExitMinHours: 4,
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

function isInsideWindow(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEndFor(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

async function loadCandles(startTs: number, endTs: number) {
  const out = new Map<string, Candle1h[]>();
  for (const symbol of SYMBOLS) {
    const candles = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      cacheRoot: CACHE_ROOT,
      startMs: Math.max(START_TS, startTs - 160 * HOUR_MS),
      endMs: endTs,
      interval: "1h",
    }).catch(() => []);
    out.set(symbol, candles.filter((bar) => bar.ts >= startTs - 160 * HOUR_MS && bar.ts <= endTs));
  }
  return out;
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

  const score = mom6 * 120 + mom24 * 90 + fourHourMom * 120 + breakoutPct * 180 + Math.min(3.5, volRatio) * 2 + closeLocation * 4;
  return score >= variant.minScore ? { symbol, ts: bar.ts, close: bar.close, score } : null;
}

function simulate(candlesBySymbol: Map<string, Candle1h[]>, windows: readonly Window[], variant: typeof VARIANTS[number]) {
  const indexBySymbol = new Map<string, Map<number, number>>();
  const fourHourBySymbol = new Map<string, Candle1h[]>();
  const tsSet = new Set<number>();
  for (const symbol of variant.symbols) {
    const candles = candlesBySymbol.get(symbol) ?? [];
    indexBySymbol.set(symbol, buildIndex(candles));
    fourHourBySymbol.set(symbol, resampleToHours(candles, 4));
    candles.forEach((bar) => {
      if (bar.ts >= variant.activeFrom[symbol] && isInsideWindow(bar.ts, windows)) tsSet.add(bar.ts);
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
      if (!exitReason && (ts >= open.maxExitTs || !isInsideWindow(ts, windows))) exitReason = "max-hold-or-window-end";

      if (exitReason) {
        const quoteLossPct = Math.max(0, QUOTE_LOSS_PCT[open.symbol] ?? 1);
        trades.push({
          symbol: open.symbol,
          entryTs: open.entryTs,
          exitTs: ts,
          entryPrice: open.entryPrice,
          exitPrice: bar.close,
          netReturnPct: bar.close / open.entryPrice - 1 - (quoteLossPct / 100) * 2 - FEE_RATE * 2,
          exitReason,
        });
        open = null;
      }
      continue;
    }

    const signals: Signal[] = [];
    for (const symbol of variant.symbols) {
      if (ts < variant.activeFrom[symbol]) continue;
      const candles = candlesBySymbol.get(symbol) ?? [];
      const index = indexBySymbol.get(symbol)?.get(ts);
      if (index == null) continue;
      const signal = signalFor(symbol, candles, fourHourBySymbol.get(symbol) ?? [], index, variant);
      if (signal) signals.push(signal);
    }
    signals.sort((left, right) => right.score - left.score);
    const best = signals[0];
    if (!best) continue;
    const maxExitTs = Math.min(ts + variant.maxHoldHours * HOUR_MS, windowEndFor(ts, windows));
    if (maxExitTs <= ts) continue;
    open = {
      symbol: best.symbol,
      entryTs: ts,
      exitTs: ts,
      entryPrice: best.close,
      exitPrice: best.close,
      netReturnPct: 0,
      exitReason: "open",
      peakPrice: best.close,
      troughPrice: best.close,
      maxExitTs,
    };
  }
  return trades;
}

function tradeHours(trade: Trade) {
  return Math.max(0, trade.exitTs - trade.entryTs) / HOUR_MS;
}

function summarizeTrades(trades: Trade[], capUsd: number) {
  const pnl = trades.reduce((sum, trade) => sum + trade.netReturnPct * capUsd, 0);
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const gains = wins.reduce((sum, trade) => sum + trade.netReturnPct * capUsd, 0);
  const losses = trades.filter((trade) => trade.netReturnPct < 0).reduce((sum, trade) => sum + Math.abs(trade.netReturnPct * capUsd), 0);
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100),
    pnl: round(pnl, 2),
    pf: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : 0,
    hours: round(trades.reduce((sum, trade) => sum + tradeHours(trade), 0), 1),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];

  for (const period of PERIODS) {
    const base = await runHybridBacktest("RETQ22", { ...baseOptions(period), label: `v7_${period.key}` });
    const windows = cashWindowsFromBaseline(base);
    const baseCashPct = 100 - base.summary.exposure_pct;
    const periodHours = (period.endTs - period.startTs + 1) / HOUR_MS;
    const candles = await loadCandles(period.startTs, period.endTs);

    for (const variant of VARIANTS) {
      const trades = simulate(candles, windows, variant);
      const summary = summarizeTrades(trades, 300);
      const addedExposurePct = (summary.hours / periodHours) * 100;
      rows.push({
        period: period.key,
        variant: variant.key,
        v7End: round(base.summary.end_equity, 2),
        v7CashPct: round(baseCashPct, 2),
        trades: summary.trades,
        winPct: summary.winPct,
        pf: summary.pf,
        cap300Pnl: summary.pnl,
        addedDays: round(summary.hours / 24, 2),
        addedExposurePct: round(addedExposurePct, 3),
        estimatedCashPctAfter: round(Math.max(0, baseCashPct - addedExposurePct), 2),
        cashReductionPt: round(Math.min(baseCashPct, addedExposurePct), 3),
        bySymbol: Object.fromEntries(variant.symbols.map((symbol) => [
          symbol,
          {
            trades: trades.filter((trade) => trade.symbol === symbol).length,
            pnl: round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.netReturnPct * 300, 0), 2),
          },
        ])),
      });
      console.log(`${period.key} ${variant.key}: cash ${round(baseCashPct, 2)} -> ${round(Math.max(0, baseCashPct - addedExposurePct), 2)}, pnl=${summary.pnl}, trades=${summary.trades}`);
    }
  }

  const md = [
    "# V7 USDT Reduction Sidecars",
    "",
    "- method: engine-direct V7 cash windows + 1h sidecar simulation",
    "- cap: 300 USDT per sidecar position",
    "- quote value loss: historical q300 assumptions charged on entry and exit",
    "",
    "| period | variant | V7 USDT % | trades | win % | PF | cap300 PnL | added days | USDT after % | USDT reduction pt | by symbol |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.period} | ${row.variant} | ${row.v7CashPct} | ${row.trades} | ${row.winPct} | ${row.pf} | ${row.cap300Pnl} | ${row.addedDays} | ${row.estimatedCashPctAfter} | ${row.cashReductionPt} | ${JSON.stringify(row.bySymbol)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
