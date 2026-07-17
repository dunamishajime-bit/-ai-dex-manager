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

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-sol-switch-guard-search");
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

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const strictSwitches = result.trade_pairs.filter((row) =>
    row.symbol === "PENGU"
    && ["trend-switch", "trend-rotate", "rebalance-switch"].includes(row.exit_reason)
  );
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    ethPnl: round(result.summary.symbol_contribution.ETH ?? 0),
    solPnl: round(result.summary.symbol_contribution.SOL ?? 0),
    penguPnl: round(result.summary.symbol_contribution.PENGU ?? 0),
    dogePnl: round(result.summary.symbol_contribution.DOGE ?? 0),
    strictSwitches: strictSwitches.length,
    strictSwitchPnl: round(strictSwitches.reduce((sum, row) => sum + row.net_pnl, 0)),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const variants: Array<{ key: string; options: HybridVariantOptions }> = [
    { key: "production_current", options: { ...production, label: "production_current" } },
  ];

  const profitThresholds = [0.04, 0.06, 0.08, 0.1, 0.12, 0.15];
  const scoreThresholds = [10, 15, 20, 25, 30, 35, 40];
  const momThresholds = [0.02, 0.04, 0.06, 0.08, 0.1, 0.12];
  const scoreGaps = [0, 5, 8, 10, 12, 15, 20];

  for (const profit of profitThresholds) {
    for (const score of scoreThresholds) {
      for (const mom of momThresholds) {
        for (const gap of scoreGaps) {
          variants.push({
            key: `all_p${Math.round(profit * 100)}_s${score}_m${Math.round(mom * 100)}_g${gap}`,
            options: {
              ...production,
              strictExtraTrendSwitchGuardSymbols: ["PENGU"],
              strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
              strictExtraTrendSwitchGuardMode: "all",
              strictExtraTrendSwitchGuardBlockBelowProfitPct: profit,
              strictExtraTrendSwitchGuardMinCurrentScore: score,
              strictExtraTrendSwitchGuardMinCurrentMom20: mom,
              strictExtraTrendSwitchGuardRequiredScoreGap: gap,
              label: `all_p${Math.round(profit * 100)}_s${score}_m${Math.round(mom * 100)}_g${gap}`,
            },
          });
        }
      }
    }
  }

  const rows = [];
  let best = { key: "", endEquity: -Infinity };
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    const row = { key: variant.key, ...summary };
    rows.push(row);
    if (summary.endEquity > best.endEquity) {
      best = { key: variant.key, endEquity: summary.endEquity };
      console.log(`best ${best.key}: end=${summary.endEquity} PF=${summary.profitFactor} PENGU=${summary.penguPnl} SOL=${summary.solPnl}`);
    }
  }

  rows.sort((left, right) => right.endEquity - left.endEquity);

  const md = [
    "# PENGU -> SOL Switch Guard Search",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| rank | variant | end equity | CAGR % | MaxDD % | PF | trades | PENGU pnl | SOL pnl | PENGU switch count |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.slice(0, 30).map((row, index) =>
      `| ${index + 1} | ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.penguPnl} | ${row.solPnl} | ${row.strictSwitches} |`,
    ),
    "",
    "```json",
    JSON.stringify(rows.slice(0, 100), null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
