import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "sol-standalone-strategy");
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
  return {
    endEquity: round(result.summary.end_equity, 2),
    cagrPct: round(result.summary.cagr_pct, 2),
    maxDrawdownPct: round(result.summary.max_drawdown_pct, 2),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct, 2),
    tradeCount: result.summary.trade_count,
    solTradeCount: solTrades.length,
    solLossCount: solLosses.length,
    solWinCount: solTrades.length - solLosses.length,
    solPnl: round(result.summary.symbol_contribution.SOL ?? 0, 2),
  };
}

function buildBase(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    expandedTrendSymbols: ["SOL"] as const,
    strictExtraTrendSymbols: [] as const,
    strictExtraTrendIdleOnly: false,
    rangeSymbols: [] as const,
    auxRangeSymbols: [] as const,
    trendScoreAdjustmentBySymbol: {},
  } satisfies HybridVariantOptions;
}

function buildVariants(): VariantSpec[] {
  const base = buildBase();

  return [
    {
      key: "sol_only_base",
      thesis: "SOL only with the base shared trend logic and no range sleeves.",
      options: { ...base, label: "sol_only_base" },
    },
    {
      key: "sol_breakout_failcut",
      thesis: "SOL only breakout entry with moderate quality filters and early failure cut.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { SOL: 3 },
        trendBreakoutMinPctBySymbol: { SOL: 0.015 },
        trendMinVolumeRatioBySymbol: { SOL: 1.05 },
        trendMinMomAccelBySymbol: { SOL: 0.002 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.24 },
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.005,
        trendExitSma: 40,
        label: "sol_breakout_failcut",
      },
    },
    {
      key: "sol_breakout_failcut_trail",
      thesis: "SOL only breakout entry plus failure cut and profit protection trailing.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { SOL: 3 },
        trendBreakoutMinPctBySymbol: { SOL: 0.02 },
        trendMinVolumeRatioBySymbol: { SOL: 1.1 },
        trendMinMomAccelBySymbol: { SOL: 0.003 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.24 },
        symbolSpecificTrendWeakExitSymbols: ["SOL"],
        symbolSpecificTrendWeakExitMom20Below: 0.08,
        symbolSpecificTrendWeakExitMomAccelBelow: -0.005,
        trendProfitTrailActivationPct: 0.18,
        trendProfitTrailRetracePct: 0.08,
        trendExitSma: 40,
        label: "sol_breakout_failcut_trail",
      },
    },
    {
      key: "sol_trend_quality",
      thesis: "SOL only smoother trend strategy with stronger efficiency and volume confirmation.",
      options: {
        ...base,
        trendBreakoutLookbackBarsBySymbol: { SOL: 4 },
        trendBreakoutMinPctBySymbol: { SOL: 0.025 },
        trendMinVolumeRatioBySymbol: { SOL: 1.15 },
        trendMinMomAccelBySymbol: { SOL: 0.004 },
        trendMinEfficiencyRatioBySymbol: { SOL: 0.26 },
        trendProfitTrailActivationPct: 0.2,
        trendProfitTrailRetracePct: 0.09,
        trendExitSma: 40,
        label: "sol_trend_quality",
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
    "# SOL Standalone Strategy",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win rate % | trades | SOL wins | SOL losses | SOL pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.solWinCount} | ${row.solLossCount} | ${row.solPnl} |`,
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
