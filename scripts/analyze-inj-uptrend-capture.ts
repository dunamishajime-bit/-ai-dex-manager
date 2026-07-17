import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";
import { loadHistoricalCandles } from "../lib/backtest/binance-source";
import { resampleToHours } from "../lib/backtest/indicators";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "inj-uptrend-capture");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

function buildCashOnlyWindows(points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>) {
  const cashPoints = points
    .filter((point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash")
    .sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }
    if (prev != null && point.ts - prev <= STEP_MS) {
      prev = point.ts;
      continue;
    }
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
    start = point.ts;
    prev = point.ts;
  }
  if (start != null) windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  return windows;
}

function invertWindows(windows: readonly Window[], startTs: number, endTs: number) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;
  for (const window of sorted) {
    if (window.startTs > cursor) inverted.push({ startTs: cursor, endTs: window.startTs });
    cursor = Math.max(cursor, window.endTs);
  }
  if (cursor < endTs) inverted.push({ startTs: cursor, endTs });
  return inverted.filter((window) => window.endTs > window.startTs);
}

function applyCashOnlyUniTwt(base: HybridVariantOptions, nonCashWindows: readonly Window[]) {
  return {
    ...base,
    expandedTrendSymbols: unique([...(base.expandedTrendSymbols ?? []), "UNI", "TWT"]),
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      UNI: 8,
      TWT: 8,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      UNI: 0.012,
      TWT: 0.012,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      UNI: 1.01,
      TWT: 1.01,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      UNI: 0.0005,
      TWT: 0.0005,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      UNI: 0.17,
      TWT: 0.17,
    },
    trendPrioritySymbols: ["TWT"],
    trendPriorityMaxScoreGap: null,
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
    trendSymbolBlockWindows: {
      ...(base.trendSymbolBlockWindows ?? {}),
      UNI: nonCashWindows,
      TWT: nonCashWindows,
    },
  } satisfies HybridVariantOptions;
}

function findMajorUptrends(bars: ReturnType<typeof resampleToHours>) {
  const windows = [];
  for (let start = 0; start < bars.length - 8; start += 1) {
    const startPrice = bars[start].close;
    let bestIndex = start;
    let bestReturn = 0;
    for (let end = start + 4; end < Math.min(bars.length, start + 80); end += 1) {
      const ret = bars[end].close / startPrice - 1;
      if (ret > bestReturn) {
        bestReturn = ret;
        bestIndex = end;
      }
    }
    if (bestReturn >= 0.8) {
      windows.push({
        startTs: bars[start].ts,
        endTs: bars[bestIndex].ts,
        startPrice,
        endPrice: bars[bestIndex].close,
        returnPct: bestReturn * 100,
        durationDays: (bars[bestIndex].ts - bars[start].ts) / (24 * 60 * 60 * 1000),
      });
      start = bestIndex;
    }
  }

  return windows
    .sort((left, right) => right.returnPct - left.returnPct)
    .slice(0, 12)
    .sort((left, right) => left.startTs - right.startTs);
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);
  const injNoRotation = {
    ...production,
    trendRotationTargetBlockSymbols: ["INJ"],
    label: "inj_no_rotation_target",
  } satisfies HybridVariantOptions;

  const [current, noRotate] = await Promise.all([
    runHybridBacktest("RETQ22", { ...production, label: "current_deployed" }),
    runHybridBacktest("RETQ22", injNoRotation),
  ]);

  const raw = await loadHistoricalCandles({
    symbol: "INJUSDT",
    cacheRoot: path.join(process.cwd(), ".cache", "inj-uptrend-capture"),
    startMs: START_TS,
    endMs: END_TS,
  });
  const bars12h = resampleToHours(raw, 12).filter((bar) => bar.close > 0);
  const majorUptrends = findMajorUptrends(bars12h);

  function attachTrades(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
    const injTrades = result.trade_pairs.filter((row) => row.symbol === "INJ");
    return majorUptrends.map((window) => {
      const overlappingTrades = injTrades.filter((trade) => {
        const entry = new Date(trade.entry_time).getTime();
        const exit = new Date(trade.exit_time).getTime();
        return entry <= window.endTs && exit >= window.startTs;
      });
      return {
        ...window,
        start: new Date(window.startTs).toISOString(),
        end: new Date(window.endTs).toISOString(),
        overlappingTrades: overlappingTrades.map((trade) => ({
          entry: trade.entry_time,
          exit: trade.exit_time,
          pnl: round(trade.net_pnl),
          hold: trade.holding_bars,
          entryReason: trade.entry_reason,
          exitReason: trade.exit_reason,
        })),
        captured: overlappingTrades.length > 0,
        pnl: round(overlappingTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
      };
    });
  }

  const rows = [
    {
      key: "current_deployed",
      endEquity: round(current.summary.end_equity),
      injPnl: round(current.summary.symbol_contribution.INJ ?? 0),
      injTrades: current.trade_pairs.filter((row) => row.symbol === "INJ").length,
      windows: attachTrades(current),
    },
    {
      key: "inj_no_rotation_target",
      endEquity: round(noRotate.summary.end_equity),
      injPnl: round(noRotate.summary.symbol_contribution.INJ ?? 0),
      injTrades: noRotate.trade_pairs.filter((row) => row.symbol === "INJ").length,
      windows: attachTrades(noRotate),
    },
  ];

  const md = [
    "# INJ Uptrend Capture",
    "",
    "Major INJ 12H uptrends are windows where INJ rose at least 80% within the next 40 days.",
    "",
    "| variant | end equity | INJ pnl | INJ trades | captured windows |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.injPnl} | ${row.injTrades} | ${row.windows.filter((window) => window.captured).length}/${row.windows.length} |`),
    "",
    "## Details",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(rows.map((row) => ({
    key: row.key,
    endEquity: row.endEquity,
    injPnl: row.injPnl,
    injTrades: row.injTrades,
    captured: `${row.windows.filter((window) => window.captured).length}/${row.windows.length}`,
  })), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
