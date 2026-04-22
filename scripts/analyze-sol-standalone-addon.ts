import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "sol-standalone-addon");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

type VariantSpec = {
  key: string;
  thesis: string;
  options: HybridVariantOptions;
};

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const solTrades = result.trade_pairs.filter((trade) => trade.symbol === "SOL");
  const solLosses = solTrades.filter((trade) => trade.net_pnl <= 0);
  const lossByReason = Object.entries(
    solLosses.reduce<Record<string, number>>((acc, trade) => {
      acc[trade.exit_reason] = (acc[trade.exit_reason] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  return {
    endEquity: round(result.summary.end_equity, 2),
    cagrPct: round(result.summary.cagr_pct, 2),
    maxDrawdownPct: round(result.summary.max_drawdown_pct, 2),
    profitFactor: round(result.summary.profit_factor, 3),
    tradeCount: result.summary.trade_count,
    solTradeCount: solTrades.length,
    solLossCount: solLosses.length,
    solWinCount: solTrades.length - solLosses.length,
    solPnl: round(result.summary.symbol_contribution.SOL ?? 0, 2),
    topSolLossReason: lossByReason[0]?.[0] ?? "none",
    topSolLossReasonCount: lossByReason[0]?.[1] ?? 0,
  };
}

function buildBaseOptions() {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

function buildVariants(): VariantSpec[] {
  const base = buildBaseOptions();
  const commonStandalone = {
    ...base,
    expandedTrendSymbols: ["ETH", "AVAX"] as const,
    strictExtraTrendSymbols: ["PENGU", "DOGE", "SOL"] as const,
    strictExtraTrendRotationScoreGapBySymbol: { SOL: 999 },
    strictExtraTrendRotationRequireConsecutiveBarsBySymbol: { SOL: 99 },
  } satisfies HybridVariantOptions;

  return [
    {
      key: "base_v4",
      thesis: "Current production v4.",
      options: { ...base, label: "sol_standalone_base_v4" },
    },
    {
      key: "sol_standalone_idle",
      thesis: "Remove SOL from the shared trend pool and only allow it as an idle-only standalone candidate.",
      options: {
        ...commonStandalone,
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(base.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          SOL: 0.24,
        },
        trendMinVolumeRatioBySymbol: { SOL: 1.05 },
        trendMinMomAccelBySymbol: { SOL: 0.002 },
        trendBreakoutLookbackBarsBySymbol: { SOL: 3 },
        trendBreakoutMinPctBySymbol: { SOL: 0.015 },
        label: "sol_standalone_idle",
      },
    },
    {
      key: "sol_standalone_idle_failcut",
      thesis: "Standalone idle-only SOL plus early failure cut if the move loses momentum quickly.",
      options: {
        ...commonStandalone,
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(base.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          SOL: 0.24,
        },
        trendMinVolumeRatioBySymbol: { SOL: 1.05 },
        trendMinMomAccelBySymbol: { SOL: 0.002 },
        trendBreakoutLookbackBarsBySymbol: { SOL: 3 },
        trendBreakoutMinPctBySymbol: { SOL: 0.015 },
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.005,
        label: "sol_standalone_idle_failcut",
      },
    },
    {
      key: "sol_standalone_idle_strict",
      thesis: "Standalone idle-only SOL with stricter breakout quality so only stronger SOL waves are taken.",
      options: {
        ...commonStandalone,
        strictExtraTrendMinEfficiencyRatioBySymbol: {
          ...(base.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
          SOL: 0.26,
        },
        trendMinVolumeRatioBySymbol: { SOL: 1.15 },
        trendMinMomAccelBySymbol: { SOL: 0.004 },
        trendBreakoutLookbackBarsBySymbol: { SOL: 4 },
        trendBreakoutMinPctBySymbol: { SOL: 0.025 },
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.005,
        label: "sol_standalone_idle_strict",
      },
    },
  ];
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of buildVariants()) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      ...summarize(result),
    });
  }

  rows.sort((left, right) => Number(right.endEquity) - Number(left.endEquity));

  const md = [
    "# SOL Standalone Addon",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | total trades | SOL trades | SOL wins | SOL losses | SOL pnl | top SOL loss reason | count |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.solTradeCount} | ${row.solWinCount} | ${row.solLossCount} | ${row.solPnl} | ${row.topSolLossReason} | ${row.topSolLossReasonCount} |`,
    ),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
