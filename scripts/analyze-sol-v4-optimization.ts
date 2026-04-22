import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "sol-v4-optimization");
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

function buildVariants(): VariantSpec[] {
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;

  return [
    {
      key: "base_v4",
      thesis: "Current production v4.",
      options: { ...base, label: "sol_v4_base" },
    },
    {
      key: "sol_score_minus10",
      thesis: "Lower SOL rank slightly more so it needs to be more clearly superior before selection.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: { ...(base.trendScoreAdjustmentBySymbol ?? {}), SOL: -10 },
        label: "sol_score_minus10",
      },
    },
    {
      key: "sol_score_minus12",
      thesis: "Lower SOL rank further to cut marginal SOL entries.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: { ...(base.trendScoreAdjustmentBySymbol ?? {}), SOL: -12 },
        label: "sol_score_minus12",
      },
    },
    {
      key: "sol_failcut",
      thesis: "Keep SOL entry logic, but cut SOL earlier when momentum fails immediately after entry.",
      options: {
        ...base,
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.005,
        label: "sol_failcut",
      },
    },
    {
      key: "sol_score_minus10_plus_failcut",
      thesis: "Combine stronger SOL demotion with early failure cut.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: { ...(base.trendScoreAdjustmentBySymbol ?? {}), SOL: -10 },
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.005,
        label: "sol_score_minus10_plus_failcut",
      },
    },
    {
      key: "sol_loose_breakout_plus_demote",
      thesis: "Require SOL to break out a bit more cleanly while still demoting ranking modestly.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: { ...(base.trendScoreAdjustmentBySymbol ?? {}), SOL: -10 },
        trendBreakoutLookbackBarsBySymbol: { SOL: 3 },
        trendBreakoutMinPctBySymbol: { SOL: 0.025 },
        trendMinMomAccelBySymbol: { SOL: 0.002 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.24 },
        label: "sol_loose_breakout_plus_demote",
      },
    },
    {
      key: "sol_quality_gate",
      thesis: "Keep SOL in the universe, but require better volume and momentum quality before taking it.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: { ...(base.trendScoreAdjustmentBySymbol ?? {}), SOL: -10 },
        trendMinVolumeRatioBySymbol: { SOL: 1.1 },
        trendMinMomAccelBySymbol: { SOL: 0.003 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.24 },
        label: "sol_quality_gate",
      },
    },
    {
      key: "sol_quality_gate_strict",
      thesis: "Require clearly stronger SOL participation before entry, aiming to remove marginal losers.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: { ...(base.trendScoreAdjustmentBySymbol ?? {}), SOL: -10 },
        trendMinVolumeRatioBySymbol: { SOL: 1.2 },
        trendMinMomAccelBySymbol: { SOL: 0.005 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.25 },
        trendBreakoutLookbackBarsBySymbol: { SOL: 3 },
        trendBreakoutMinPctBySymbol: { SOL: 0.015 },
        label: "sol_quality_gate_strict",
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
    "# SOL V4 Optimization",
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
