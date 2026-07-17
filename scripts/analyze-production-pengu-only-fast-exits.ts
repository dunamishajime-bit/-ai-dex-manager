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
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "production-pengu-only-fast-exits");
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
  if (start != null) {
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  }
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
  const penguTrades = result.trade_pairs.filter((row) => row.symbol === "PENGU");
  const dogeTrades = result.trade_pairs.filter((row) => row.symbol === "DOGE");
  const bySymbol = Object.fromEntries(
    Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
  );
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguTrades: penguTrades.length,
    penguPnl: round(result.summary.symbol_contribution.PENGU ?? 0),
    penguAvgHoldBars: penguTrades.length ? round(penguTrades.reduce((sum, row) => sum + row.holding_bars, 0) / penguTrades.length, 2) : 0,
    dogeTrades: dogeTrades.length,
    dogePnl: round(result.summary.symbol_contribution.DOGE ?? 0),
    bySymbol,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "production_current",
      thesis: "Current production-emulated logic. No PENGU-only exit change.",
      options: { ...production, label: "production_current" },
    },
    {
      key: "pengu_trail_12_055",
      thesis: "Only PENGU profit protection is faster: +12% activation / 5.5% retrace.",
      options: {
        ...production,
        strictExtraTrendTrailActivationPctBySymbol: { PENGU: 0.12 },
        strictExtraTrendTrailRetracePctBySymbol: { PENGU: 0.055 },
        label: "pengu_trail_12_055",
      },
    },
    {
      key: "pengu_trail_09_04",
      thesis: "Only PENGU profit protection is aggressive: +9% activation / 4% retrace.",
      options: {
        ...production,
        strictExtraTrendTrailActivationPctBySymbol: { PENGU: 0.09 },
        strictExtraTrendTrailRetracePctBySymbol: { PENGU: 0.04 },
        label: "pengu_trail_09_04",
      },
    },
    {
      key: "pengu_max_2day",
      thesis: "Only PENGU has a maximum 2-day hold after entry.",
      options: {
        ...production,
        strictExtraTrendMaxHoldBarsBySymbol: { PENGU: 4 },
        label: "pengu_max_2day",
      },
    },
    {
      key: "pengu_trail_12_055_max_2day",
      thesis: "Only PENGU uses faster profit protection plus max 2-day hold.",
      options: {
        ...production,
        strictExtraTrendTrailActivationPctBySymbol: { PENGU: 0.12 },
        strictExtraTrendTrailRetracePctBySymbol: { PENGU: 0.055 },
        strictExtraTrendMaxHoldBarsBySymbol: { PENGU: 4 },
        label: "pengu_trail_12_055_max_2day",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      ...summarize(result),
    });
    console.log(`${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} PF=${result.summary.profit_factor.toFixed(3)} trades=${result.summary.trade_count}`);
  }

  const md = [
    "# Production Logic + PENGU-only Fast Exit Tests",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- cash_window_count: ${cashOnlyWindows.length}`,
    "",
    "This emulates the current production logic, including UNI/TWT cash-only rescue. Only PENGU exit parameters are changed in the variants.",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | PENGU trades | PENGU pnl | PENGU avg hold bars | DOGE trades | DOGE pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.penguTrades} | ${row.penguPnl} | ${row.penguAvgHoldBars} | ${row.dogeTrades} | ${row.dogePnl} |`),
    "",
    "## Contributions",
    "",
    ...rows.map((row) => `- ${row.key}: ${Object.entries(row.bySymbol).map(([symbol, pnl]) => `${symbol} ${pnl}`).join(" / ")}`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
