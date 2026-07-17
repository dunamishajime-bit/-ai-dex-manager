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

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-bio-bigwave-focused");
const CACHE_ROOT = path.join(process.cwd(), ".cache", "binance");
const START_TS = Date.UTC(2024, 0, 1);
const END_TS = Date.UTC(2026, 3, 23, 23, 59, 59, 999);
const HOUR_MS = 60 * 60 * 1000;
const STEP_MS = 12 * HOUR_MS;
const FEE_RATE = RECLAIM_HYBRID_EXECUTION_PROFILE.feeRate;
const QUOTE_LOSS_PCT = 0.6979;

const PERIODS = [
  { key: "2024-H1", startTs: Date.UTC(2024, 0, 1), endTs: Date.UTC(2024, 5, 30, 23, 59, 59, 999) },
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: END_TS },
  { key: "2025", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2024-2026", startTs: START_TS, endTs: END_TS },
];

const VARIANTS = [
  {
    key: "bio_early_quality_24h",
    maxHoldHours: 24,
    lookback: 8,
    breakoutPct: 0.012,
    minVolRatio: 1.18,
    minMom6: 0.035,
    minMom24: 0.055,
    minFourHourMom: 0.035,
    minScore: 24,
    maxOneHourJump: 0.16,
    minCloseLocation: 0.55,
    trailActivationPct: 0.12,
    trailRetracePct: 0.055,
    hardStopPct: 0.065,
    weakExitMinHours: 5,
  },
  {
    key: "bio_confirmed_48h",
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
    key: "bio_runner_72h_quality",
    maxHoldHours: 72,
    lookback: 12,
    breakoutPct: 0.018,
    minVolRatio: 1.25,
    minMom6: 0.05,
    minMom24: 0.09,
    minFourHourMom: 0.06,
    minScore: 38,
    maxOneHourJump: 0.24,
    minCloseLocation: 0.58,
    trailActivationPct: 0.26,
    trailRetracePct: 0.12,
    hardStopPct: 0.095,
    weakExitMinHours: 10,
  },
  {
    key: "bio_big_runner_120h",
    maxHoldHours: 120,
    lookback: 16,
    breakoutPct: 0.022,
    minVolRatio: 1.3,
    minMom6: 0.06,
    minMom24: 0.12,
    minFourHourMom: 0.075,
    minScore: 48,
    maxOneHourJump: 0.28,
    minCloseLocation: 0.62,
    trailActivationPct: 0.34,
    trailRetracePct: 0.16,
    hardStopPct: 0.11,
    weakExitMinHours: 14,
  },
  {
    key: "bio_ultra_selective_72h",
    maxHoldHours: 72,
    lookback: 12,
    breakoutPct: 0.024,
    minVolRatio: 1.45,
    minMom6: 0.07,
    minMom24: 0.14,
    minFourHourMom: 0.09,
    minScore: 62,
    maxOneHourJump: 0.3,
    minCloseLocation: 0.68,
    trailActivationPct: 0.3,
    trailRetracePct: 0.13,
    hardStopPct: 0.1,
    weakExitMinHours: 12,
  },
] as const;

type Window = { startTs: number; endTs: number };
type Trade = {
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  grossReturnPct: number;
  netReturnPct: number;
  score: number;
  exitReason: string;
  maxRunupPct: number;
  maxDrawdownPct: number;
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

function buildIndex(candles: Candle1h[]) {
  const index = new Map<number, number>();
  candles.forEach((bar, offset) => index.set(bar.ts, offset));
  return index;
}

function signalScore(candles: Candle1h[], fourHourCandles: Candle1h[], index: number, variant: typeof VARIANTS[number]) {
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

  const score =
    mom6 * 120
    + mom24 * 90
    + fourHourMom * 120
    + breakoutPct * 180
    + Math.min(3.5, volRatio) * 2
    + closeLocation * 4;
  return score >= variant.minScore ? score : null;
}

function simulate(candles: Candle1h[], windows: readonly Window[], variant: typeof VARIANTS[number]) {
  const indexByTs = buildIndex(candles);
  const fourHourCandles = resampleToHours(candles, 4);
  const timeline = candles.filter((bar) => isInsideWindow(bar.ts, windows)).map((bar) => bar.ts);
  const trades: Trade[] = [];
  let open: (Trade & { peakPrice: number; troughPrice: number; maxExitTs: number }) | null = null;

  for (const ts of timeline) {
    const index = indexByTs.get(ts);
    if (index == null) continue;
    const bar = candles[index];

    if (open) {
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
      if (!exitReason && profitFromEntry >= variant.trailActivationPct && retraceFromPeak <= -variant.trailRetracePct) {
        exitReason = "profit-trail";
      }
      if (!exitReason && holdingHours >= variant.weakExitMinHours && bar.close < sma20 && mom6 < 0) {
        exitReason = "weak-exit";
      }
      if (!exitReason && (ts >= open.maxExitTs || !isInsideWindow(ts, windows))) {
        exitReason = "max-hold-or-window-end";
      }

      if (exitReason) {
        const grossReturnPct = bar.close / open.entryPrice - 1;
        const netReturnPct = grossReturnPct - (QUOTE_LOSS_PCT / 100) * 2 - FEE_RATE * 2;
        trades.push({
          ...open,
          exitTs: ts,
          exitPrice: bar.close,
          grossReturnPct,
          netReturnPct,
          exitReason,
          maxRunupPct: open.peakPrice / open.entryPrice - 1,
          maxDrawdownPct: open.troughPrice / open.entryPrice - 1,
        });
        open = null;
      }
      continue;
    }

    const score = signalScore(candles, fourHourCandles, index, variant);
    if (score == null) continue;
    const maxExitTs = Math.min(ts + variant.maxHoldHours * HOUR_MS, windowEndFor(ts, windows));
    if (maxExitTs <= ts) continue;
    open = {
      entryTs: ts,
      exitTs: ts,
      entryPrice: bar.close,
      exitPrice: bar.close,
      grossReturnPct: 0,
      netReturnPct: 0,
      score,
      exitReason: "open",
      maxRunupPct: 0,
      maxDrawdownPct: 0,
      peakPrice: bar.close,
      troughPrice: bar.close,
      maxExitTs,
    };
  }
  return trades;
}

function summarize(trades: Trade[], baselineEndEquity: number) {
  const notionals = [100, 300, 500, 1000];
  const wins = trades.filter((trade) => trade.netReturnPct > 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.netReturnPct, 0);
  const grossLoss = Math.abs(trades.filter((trade) => trade.netReturnPct <= 0).reduce((sum, trade) => sum + trade.netReturnPct, 0));
  return {
    trades: trades.length,
    winRatePct: round((wins.length / Math.max(1, trades.length)) * 100),
    avgNetReturnPct: round(average(trades.map((trade) => trade.netReturnPct)) * 100, 3),
    bestNetReturnPct: round(Math.max(0, ...trades.map((trade) => trade.netReturnPct)) * 100, 2),
    worstNetReturnPct: round(Math.min(0, ...trades.map((trade) => trade.netReturnPct)) * 100, 2),
    profitFactor: round(grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 999 : 0, 3),
    byNotional: Object.fromEntries(notionals.map((notional) => {
      const pnl = trades.reduce((sum, trade) => sum + notional * trade.netReturnPct, 0);
      return [String(notional), { pnl: round(pnl), endEquity: round(baselineEndEquity + pnl) }];
    })),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const allCandles = await loadHistoricalCandles({
    symbol: "BIOUSDT",
    cacheRoot: CACHE_ROOT,
    startMs: START_TS - 120 * HOUR_MS,
    endMs: END_TS,
    interval: "1h",
  });

  const rows = [];
  const tradeRows = [];
  for (const period of PERIODS) {
    const baseline = await runHybridBacktest("RETQ22", {
      ...baseOptions(period),
      label: `v7_base_${period.key}`,
    });
    const windows = cashWindowsFromBaseline(baseline);
    const candles = allCandles.filter((bar) => bar.ts >= period.startTs - 120 * HOUR_MS && bar.ts <= period.endTs);
    for (const variant of VARIANTS) {
      const trades = simulate(candles, windows, variant);
      const summary = summarize(trades, baseline.summary.end_equity);
      rows.push({
        period: period.key,
        variant: variant.key,
        baselineEndEquity: round(baseline.summary.end_equity),
        baselineCashPct: round(100 - baseline.summary.exposure_pct),
        ...summary,
      });
      tradeRows.push(...trades.map((trade) => ({ period: period.key, variant: variant.key, symbol: "BIO", ...trade })));
      console.log(`${period.key} ${variant.key}: trades=${summary.trades} cap300=${summary.byNotional["300"].pnl} end=${summary.byNotional["300"].endEquity}`);
    }
  }

  rows.sort((left, right) =>
    String(left.period).localeCompare(String(right.period))
    || (right.byNotional["300"].pnl - left.byNotional["300"].pnl),
  );

  const md = [
    "# V7 BIO Big-Wave Focused",
    "",
    "- method: V7 engine-direct baseline cash windows + BIO 1h candles",
    "- assumption: V7 production logic remains unchanged; BIO sidecar can enter only while V7 is cash/USDT",
    "- quote cost: q300 value loss 0.6979% twice, plus normal fee twice",
    "",
    "| period | variant | V7 end | V7 USDT % | trades | win % | avg net % | PF | cap100 pnl | cap100 end | cap300 pnl | cap300 end | cap500 pnl | cap500 end | cap1000 pnl | cap1000 end |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row: any) => `| ${row.period} | ${row.variant} | ${row.baselineEndEquity} | ${row.baselineCashPct} | ${row.trades} | ${row.winRatePct} | ${row.avgNetReturnPct} | ${row.profitFactor} | ${row.byNotional["100"].pnl} | ${row.byNotional["100"].endEquity} | ${row.byNotional["300"].pnl} | ${row.byNotional["300"].endEquity} | ${row.byNotional["500"].pnl} | ${row.byNotional["500"].endEquity} | ${row.byNotional["1000"].pnl} | ${row.byNotional["1000"].endEquity} |`),
    "",
    "## Best cap300 by period",
    "",
    ...PERIODS.map((period) => {
      const best = rows.filter((row) => row.period === period.key).sort((left, right) => right.byNotional["300"].pnl - left.byNotional["300"].pnl)[0] as any;
      return `- ${period.key}: ${best?.variant ?? "-"} cap300 PnL ${best?.byNotional["300"].pnl ?? 0}, End Equity ${best?.byNotional["300"].endEquity ?? 0}, trades ${best?.trades ?? 0}`;
    }),
  ].join("\n");

  const tradesMd = [
    "# V7 BIO Big-Wave Focused Trades",
    "",
    "| period | variant | entry | exit | gross % | net % | max runup % | max drawdown % | score | exit |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...tradeRows.map((trade) => `| ${trade.period} | ${trade.variant} | ${new Date(trade.entryTs).toISOString()} | ${new Date(trade.exitTs).toISOString()} | ${round(trade.grossReturnPct * 100, 2)} | ${round(trade.netReturnPct * 100, 2)} | ${round(trade.maxRunupPct * 100, 2)} | ${round(trade.maxDrawdownPct * 100, 2)} | ${round(trade.score, 2)} | ${trade.exitReason} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(tradeRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.md"), tradesMd, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
