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

const REPORT_DIR = path.join(process.cwd(), "reports", "inj-big-move-exception");
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

function withInjException(
  production: HybridVariantOptions,
  label: string,
  rule: NonNullable<HybridVariantOptions["trendRotationTargetExceptionBySymbol"]>["INJ"],
  breakoutLookbackBars: number,
) {
  return {
    ...production,
    label,
    trendRotationTargetBlockSymbols: ["INJ"],
    trendRotationTargetExceptionBySymbol: {
      ...(production.trendRotationTargetExceptionBySymbol ?? {}),
      INJ: rule,
    },
    trendBreakoutLookbackBarsBySymbol: {
      ...(production.trendBreakoutLookbackBarsBySymbol ?? {}),
      INJ: breakoutLookbackBars,
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

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>, majorWindows: ReturnType<typeof findMajorUptrends>) {
  const injTrades = result.trade_pairs.filter((row) => row.symbol === "INJ");
  const injRotationTrades = injTrades.filter((row) => String(row.entry_reason).startsWith("trend-rotate"));
  const capturedWindows = majorWindows.map((window) => {
    const overlappingTrades = injTrades.filter((trade) => {
      const entry = new Date(trade.entry_time).getTime();
      const exit = new Date(trade.exit_time).getTime();
      return entry <= window.endTs && exit >= window.startTs;
    });
    return {
      start: new Date(window.startTs).toISOString(),
      end: new Date(window.endTs).toISOString(),
      returnPct: round(window.returnPct),
      captured: overlappingTrades.length > 0,
      pnl: round(overlappingTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
      trades: overlappingTrades.map((trade) => ({
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl),
        entryReason: trade.entry_reason,
        exitReason: trade.exit_reason,
      })),
    };
  });
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    injPnl: round(result.summary.symbol_contribution.INJ ?? 0),
    injTrades: injTrades.length,
    injRotationEntries: injRotationTrades.length,
    injRotationPnl: round(injRotationTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    ethPnl: round(result.summary.symbol_contribution.ETH ?? 0),
    penguPnl: round(result.summary.symbol_contribution.PENGU ?? 0),
    dogePnl: round(result.summary.symbol_contribution.DOGE ?? 0),
    twtPnl: round(result.summary.symbol_contribution.TWT ?? 0),
    capturedMajorWindows: `${capturedWindows.filter((window) => window.captured).length}/${capturedWindows.length}`,
    capturedWindows,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const raw = await loadHistoricalCandles({
    symbol: "INJUSDT",
    cacheRoot: path.join(process.cwd(), ".cache", "inj-big-move-exception"),
    startMs: START_TS,
    endMs: END_TS,
  });
  const inj12h = resampleToHours(raw, 12).filter((bar) => bar.close > 0);
  const majorWindows = findMajorUptrends(inj12h);

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "current_deployed",
      thesis: "Current deployed logic.",
      options: { ...production, label: "current_deployed" },
    },
    {
      key: "inj_no_rotation_target",
      thesis: "Keep normal INJ entries, but block INJ as a rotation target while holding another symbol.",
      options: {
        ...production,
        label: "inj_no_rotation_target",
        trendRotationTargetBlockSymbols: ["INJ"],
      },
    },
    {
      key: "inj_big_move_12h_strict",
      thesis: "INJ big-move exception: strict 12H breakout, volume surge, stronger ADX, and higher-high/higher-low.",
      options: withInjException(
        production,
        "inj_big_move_12h_strict",
        {
          minMom20: 0.18,
          minMomAccel: 0.02,
          minVolumeRatio: 1.45,
          minAdx14: 24,
          minEfficiencyRatio: 0.26,
          requireStructureBreak: true,
          requireDowHigherHighLow: true,
        },
        2,
      ),
    },
    {
      key: "inj_big_move_12h_balanced",
      thesis: "INJ big-move exception: balanced 12H/1D-like breakout confirmation.",
      options: withInjException(
        production,
        "inj_big_move_12h_balanced",
        {
          minMom20: 0.14,
          minMomAccel: 0.015,
          minVolumeRatio: 1.25,
          minAdx14: 21,
          minEfficiencyRatio: 0.22,
          requireStructureBreak: true,
          requireDowHigherHighLow: true,
        },
        2,
      ),
    },
    {
      key: "inj_big_move_1d_confirmed",
      thesis: "INJ big-move exception: more confirmed 1D-style breakout to reduce noise.",
      options: withInjException(
        production,
        "inj_big_move_1d_confirmed",
        {
          minMom20: 0.16,
          minMomAccel: 0.012,
          minVolumeRatio: 1.2,
          minAdx14: 20,
          minEfficiencyRatio: 0.22,
          requireStructureBreak: true,
          requireDowHigherHighLow: true,
        },
        4,
      ),
    },
    {
      key: "inj_big_move_loose_no_dow",
      thesis: "INJ big-move exception: remove higher-high/higher-low gate to reduce missed moves.",
      options: withInjException(
        production,
        "inj_big_move_loose_no_dow",
        {
          minMom20: 0.12,
          minMomAccel: 0.01,
          minVolumeRatio: 1.15,
          minAdx14: 18,
          minEfficiencyRatio: 0.2,
          requireStructureBreak: true,
          requireDowHigherHighLow: false,
        },
        2,
      ),
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result, majorWindows);
    rows.push({ key: variant.key, thesis: variant.thesis, ...summary });
    console.log(`${variant.key}: end=${summary.endEquity} CAGR=${summary.cagrPct} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.tradeCount} INJ=${summary.injPnl} injRot=${summary.injRotationEntries}/${summary.injRotationPnl} captured=${summary.capturedMajorWindows}`);
  }

  const md = [
    "# INJ Big Move Exception Rotation",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "- logic: Block INJ as a normal rotation target. Allow INJ rotation only when the selected big-move rule passes breakout, volume, ADX, efficiency, and optionally higher-high/higher-low gates.",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | INJ pnl | INJ trades | INJ rotation entries | INJ rotation pnl | captured big INJ windows |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.injPnl} | ${row.injTrades} | ${row.injRotationEntries} | ${row.injRotationPnl} | ${row.capturedMajorWindows} |`),
    "",
    "## Details",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
