import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { resampleToHours } from "../lib/backtest/indicators";
import type { Candle1h } from "../lib/backtest/types";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-2022-individual-alt-sidecars");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2022, 0, 1);
const END_TS = Date.UTC(2022, 11, 31, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;

const SYMBOLS = ["SFP", "UNI", "AAVE", "ALPACA", "LINK", "AVAX"] as const;
const REQUESTED_SYMBOL = (process.env.BT_SYMBOL || "").toUpperCase();
const QUOTE_LOSS_PCT: Record<string, number> = {
  SFP: 0.45,
  UNI: 0.6,
  AAVE: 0.7,
  ALPACA: 0.75,
  LINK: 0.5,
  AVAX: 0.55,
};

const VARIANTS = [
  { key: "weak_rebound_12h", maxHoldHours: 48, lookback: 5, breakoutPct: 0.004, minVolRatio: 0.75, minMom6: -0.015, minMom24: 0.004, minFourHourMom: -0.01, minScore: 6, trailActivationPct: 0.05, trailRetracePct: 0.025, hardStopPct: 0.075, weakExitMinHours: 8 },
  { key: "short_24h", maxHoldHours: 24, lookback: 8, breakoutPct: 0.008, minVolRatio: 0.9, minMom6: 0.008, minMom24: 0.018, minFourHourMom: 0.008, minScore: 10, trailActivationPct: 0.07, trailRetracePct: 0.035, hardStopPct: 0.07, weakExitMinHours: 6 },
  { key: "uni_alt_reclaim", onlySymbol: "UNI", maxHoldHours: 36, lookback: 6, breakoutPct: 0.003, minVolRatio: 0.65, minMom6: -0.02, minMom24: -0.005, minFourHourMom: -0.015, minScore: 4, trailActivationPct: 0.045, trailRetracePct: 0.022, hardStopPct: 0.065, weakExitMinHours: 6 },
  { key: "avax_short_impulse", onlySymbol: "AVAX", maxHoldHours: 18, lookback: 6, breakoutPct: 0.006, minVolRatio: 0.85, minMom6: 0.006, minMom24: 0.012, minFourHourMom: 0.005, minScore: 8, trailActivationPct: 0.055, trailRetracePct: 0.028, hardStopPct: 0.065, weakExitMinHours: 4 },
] as const;

type Window = { startTs: number; endTs: number };
type Trade = { symbol: string; variant: string; entryTs: number; exitTs: number; netReturnPct: number };

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
    initialEquity: 10_000,
    backtestStartTs: START_TS,
    backtestExecutionStartTs: START_TS,
    backtestEndTs: END_TS,
  };
}

function cashWindowsFromBaseline(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of [...result.equity_curve].sort((left, right) => left.ts - right.ts)) {
    if (point.position_side === "cash") {
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

function inWindow(ts: number, windows: readonly Window[]) {
  return windows.some((window) => ts >= window.startTs && ts <= window.endTs);
}

function windowEnd(ts: number, windows: readonly Window[]) {
  return windows.find((window) => ts >= window.startTs && ts <= window.endTs)?.endTs ?? ts;
}

function signal(candles: Candle1h[], index: number, fourHourCandles: Candle1h[], variant: typeof VARIANTS[number]) {
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
  const score = mom6 * 100 + mom24 * 80 + fourHourMom * 90 + breakoutPct * 160 + Math.min(3.5, volRatio) * 2;
  return score >= variant.minScore ? { price: bar.close } : null;
}

function simulate(symbol: string, candles: Candle1h[], windows: readonly Window[], variant: typeof VARIANTS[number]) {
  const fourHourCandles = resampleToHours(candles, 4);
  const indexByTs = new Map<number, number>();
  candles.forEach((bar, index) => indexByTs.set(bar.ts, index));
  const trades: Trade[] = [];
  let open: null | { entryTs: number; entryPrice: number; peak: number; maxExitTs: number } = null;
  for (const bar of candles.filter((item) => inWindow(item.ts, windows)).sort((left, right) => left.ts - right.ts)) {
    const index = indexByTs.get(bar.ts);
    if (index == null) continue;
    if (open) {
      open.peak = Math.max(open.peak, bar.high);
      const holdingHours = (bar.ts - open.entryTs) / HOUR_MS;
      const profit = bar.close / open.entryPrice - 1;
      const retrace = open.peak > 0 ? bar.close / open.peak - 1 : 0;
      const drawdown = bar.low / open.entryPrice - 1;
      const sma20 = average(candles.slice(Math.max(0, index - 19), index + 1).map((item) => item.close));
      const mom6 = index >= 6 ? bar.close / candles[index - 6].close - 1 : 0;
      const shouldExit = drawdown <= -variant.hardStopPct
        || (profit >= variant.trailActivationPct && retrace <= -variant.trailRetracePct)
        || (holdingHours >= variant.weakExitMinHours && bar.close < sma20 && mom6 < 0)
        || bar.ts >= open.maxExitTs
        || !inWindow(bar.ts, windows);
      if (shouldExit) {
        const quoteLossPct = Math.max(0, QUOTE_LOSS_PCT[symbol] ?? 1);
        trades.push({
          symbol,
          variant: variant.key,
          entryTs: open.entryTs,
          exitTs: bar.ts,
          netReturnPct: bar.close / open.entryPrice - 1 - (quoteLossPct / 100) * 2 - FEE_RATE * 2,
        });
        open = null;
      }
      continue;
    }
    const entry = signal(candles, index, fourHourCandles, variant);
    if (!entry) continue;
    const maxExitTs = Math.min(bar.ts + variant.maxHoldHours * HOUR_MS, windowEnd(bar.ts, windows));
    if (maxExitTs <= bar.ts) continue;
    open = { entryTs: bar.ts, entryPrice: entry.price, peak: entry.price, maxExitTs };
  }
  return trades;
}

function summarize(trades: readonly Trade[], capUsd: number) {
  const pnl = trades.reduce((sum, trade) => sum + trade.netReturnPct * capUsd, 0);
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netReturnPct * capUsd, 0);
  const grossLoss = trades.filter((trade) => trade.netReturnPct < 0).reduce((sum, trade) => sum + Math.abs(trade.netReturnPct * capUsd), 0);
  return {
    trades: trades.length,
    winPct: round((wins.length / Math.max(1, trades.length)) * 100, 1),
    pf: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    pnl: round(pnl),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseline = await runHybridBacktest("RETQ22", { ...baseOptions(), label: "v7_2022_individual_sidecar_base" });
  const windows = cashWindowsFromBaseline(baseline);
  const rows = [];
  const activeSymbols = REQUESTED_SYMBOL ? SYMBOLS.filter((symbol) => symbol === REQUESTED_SYMBOL) : SYMBOLS;
  for (const symbol of activeSymbols) {
    const candles = await loadHistoricalCandles({
      symbol: `${symbol}USDT`,
      cacheRoot: CACHE_ROOT,
      startMs: START_TS - 400 * HOUR_MS,
      endMs: END_TS,
      interval: "1h",
    }).catch(() => []);
    for (const variant of VARIANTS) {
      if ("onlySymbol" in variant && variant.onlySymbol !== symbol) continue;
      if (!("onlySymbol" in variant) && symbol === "UNI") continue;
      if (!("onlySymbol" in variant) && symbol === "AVAX") continue;
      const trades = simulate(symbol, candles, windows, variant);
      const cap300 = summarize(trades, 300);
      const cap1000 = summarize(trades, 1000);
      rows.push({
        symbol,
        variant: variant.key,
        baselineEnd: round(baseline.summary.end_equity),
        cashWindows: windows.length,
        cap300,
        cap1000,
        estimatedEnd300: round(baseline.summary.end_equity + cap300.pnl),
      });
      console.log(`${symbol} ${variant.key}: trades=${cap300.trades} cap300=${cap300.pnl}`);
    }
  }
  rows.sort((left, right) => right.cap300.pnl - left.cap300.pnl || right.cap300.pf - left.cap300.pf);
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  const md = [
    "# V7 2022 Individual Alt Sidecars",
    "",
    "- method: V7 engine-direct cash windows + individual 1h sidecar simulation",
    "- MATIC/POL excluded",
    "- cap300/cap1000 includes estimated quote value loss on entry and exit",
    "",
    "| symbol | variant | baseline End | trades | win % | PF | cap300 PnL | cap300 est End | cap1000 PnL |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.symbol} | ${row.variant} | ${row.baselineEnd.toLocaleString()} | ${row.cap300.trades} | ${row.cap300.winPct}% | ${row.cap300.pf} | ${row.cap300.pnl.toLocaleString()} | ${row.estimatedEnd300.toLocaleString()} | ${row.cap1000.pnl.toLocaleString()} |`),
  ].join("\n");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
