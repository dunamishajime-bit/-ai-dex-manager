import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "sol-specialized-variants");
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

function summarizeSol(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
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
      key: "base",
      thesis: "Current production logic.",
      options: { ...base, label: "sol_specialized_base" },
    },
    {
      key: "sol_breakout_entry",
      thesis: "SOL only: require clearer breakout and stronger internal trend quality before entry.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { SOL: 4 },
        trendBreakoutMinPctBySymbol: { SOL: 0.04 },
        trendMinMomAccelBySymbol: { SOL: 0.005 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.28 },
        label: "sol_breakout_entry",
      },
    },
    {
      key: "sol_breakout_plus_weak_exit",
      thesis: "SOL only: breakout entry plus early failure cut when momentum quickly weakens.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { SOL: 4 },
        trendBreakoutMinPctBySymbol: { SOL: 0.04 },
        trendMinMomAccelBySymbol: { SOL: 0.005 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.28 },
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.1,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.01,
        label: "sol_breakout_plus_weak_exit",
      },
    },
    {
      key: "sol_score_demotion",
      thesis: "SOL only: keep current entry shape but lower ranking priority unless SOL is clearly stronger.",
      options: {
        ...base,
        trendScoreAdjustmentBySymbol: { SOL: -8 },
        label: "sol_score_demotion",
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
      ...summarizeSol(result),
    });
  }

  rows.sort((left, right) => Number(right.endEquity) - Number(left.endEquity));

  const md = [
    "# SOL Specialized Variants",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | total trades | SOL trades | SOL losses | SOL pnl | top SOL loss reason | count |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |",
    ...rows.map((row) =>
      `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.solTradeCount} | ${row.solLossCount} | ${row.solPnl} | ${row.topSolLossReason} | ${row.topSolLossReasonCount} |`,
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
