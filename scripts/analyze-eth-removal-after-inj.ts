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

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "eth-removal-after-inj");
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

function withInjLooseException(options: HybridVariantOptions) {
  return {
    ...options,
    trendRotationTargetBlockSymbols: unique([...(options.trendRotationTargetBlockSymbols ?? []), "INJ"]),
    trendRotationTargetExceptionBySymbol: {
      ...(options.trendRotationTargetExceptionBySymbol ?? {}),
      INJ: {
        minMom20: 0.12,
        minMomAccel: 0.01,
        minVolumeRatio: 1.15,
        minAdx14: 18,
        minEfficiencyRatio: 0.2,
        requireStructureBreak: true,
        requireDowHigherHighLow: false,
      },
    },
    trendBreakoutLookbackBarsBySymbol: {
      ...(options.trendBreakoutLookbackBarsBySymbol ?? {}),
      INJ: 2,
    },
  } satisfies HybridVariantOptions;
}

function removeSymbols(items: readonly string[] | undefined, symbols: readonly string[]) {
  const blocked = symbols.map((symbol) => symbol.toUpperCase());
  return (items ?? []).filter((symbol) => !blocked.includes(symbol.toUpperCase()));
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolRows = Object.entries(result.summary.symbol_contribution)
    .sort((left, right) => right[1] - left[1])
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(pnl),
      trades: result.trade_pairs.filter((row) => row.symbol === symbol).length,
      rotateEntries: result.trade_pairs.filter((row) => row.symbol === symbol && String(row.entry_reason).startsWith("trend-rotate")).length,
    }));
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    ethPnl: round(result.summary.symbol_contribution.ETH ?? 0),
    injPnl: round(result.summary.symbol_contribution.INJ ?? 0),
    penguPnl: round(result.summary.symbol_contribution.PENGU ?? 0),
    dogePnl: round(result.summary.symbol_contribution.DOGE ?? 0),
    twtPnl: round(result.summary.symbol_contribution.TWT ?? 0),
    symbolRows,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = withInjLooseException(applyCashOnlyUniTwt(base, nonCashWindows));

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "inj_loose_baseline",
      thesis: "INJ loose exception baseline.",
      options: { ...production, label: "inj_loose_baseline" },
    },
    {
      key: "eth_removed_from_trend",
      thesis: "Remove ETH from trend universe only. ETH range remains if configured.",
      options: {
        ...production,
        label: "eth_removed_from_trend",
        expandedTrendSymbols: removeSymbols(production.expandedTrendSymbols, ["ETH"]),
        trendRotationCurrentSymbols: removeSymbols(production.trendRotationCurrentSymbols, ["ETH"]),
      },
    },
    {
      key: "eth_removed_from_trend_and_range",
      thesis: "Remove ETH from trend universe and range trading.",
      options: {
        ...production,
        label: "eth_removed_from_trend_and_range",
        expandedTrendSymbols: removeSymbols(production.expandedTrendSymbols, ["ETH"]),
        trendRotationCurrentSymbols: removeSymbols(production.trendRotationCurrentSymbols, ["ETH"]),
        rangeSymbols: removeSymbols(production.rangeSymbols, ["ETH"]) as any,
        auxRangeSymbols: removeSymbols(production.auxRangeSymbols, ["ETH"]) as any,
        aux2RangeSymbols: removeSymbols(production.aux2RangeSymbols, ["ETH"]) as any,
      },
    },
    {
      key: "eth_block_as_rotation_target",
      thesis: "Keep ETH cash entries, but block ETH as a rotation target.",
      options: {
        ...production,
        label: "eth_block_as_rotation_target",
        trendRotationTargetBlockSymbols: unique([...(production.trendRotationTargetBlockSymbols ?? []), "ETH"]),
      },
    },
    {
      key: "eth_score_minus20",
      thesis: "Keep ETH, but heavily reduce ETH score by -20.",
      options: {
        ...production,
        label: "eth_score_minus20",
        trendScoreAdjustmentBySymbol: {
          ...(production.trendScoreAdjustmentBySymbol ?? {}),
          ETH: -20,
        },
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, thesis: variant.thesis, ...summary });
    console.log(`${variant.key}: end=${summary.endEquity} CAGR=${summary.cagrPct} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.tradeCount} ETH=${summary.ethPnl} INJ=${summary.injPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl}`);
  }

  const md = [
    "# ETH Removal After INJ Loose",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | ETH pnl | INJ pnl | PENGU pnl | DOGE pnl | TWT pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.ethPnl} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.twtPnl} |`),
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
