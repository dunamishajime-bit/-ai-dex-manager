import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v6-sol-rotate-out");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const solTrades = result.trade_pairs.filter((row) => row.symbol === "SOL");
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    solTradeCount: solTrades.length,
    solNetPnl: round(result.summary.symbol_contribution.SOL ?? 0),
    bySymbol: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "base_v6",
      thesis: "Current production v6.",
      options: { ...base, label: "base_v6" },
    },
    {
      key: "sol_rotate_gap0_once",
      thesis: "If SOL is held and another trend candidate becomes eligible, rotate immediately.",
      options: {
        ...base,
        trendRotationWhileHolding: true,
        trendRotationCurrentSymbols: ["SOL"],
        trendRotationScoreGap: 0,
        trendRotationCurrentMomAccelMax: 999,
        trendRotationCurrentMom20Max: 999,
        trendRotationMinHoldBars: 1,
        trendRotationRequireConsecutiveBars: 1,
        label: "sol_rotate_gap0_once",
      },
    },
    {
      key: "sol_rotate_gap5_once",
      thesis: "Rotate out of SOL when another trend candidate leads by 5 points.",
      options: {
        ...base,
        trendRotationWhileHolding: true,
        trendRotationCurrentSymbols: ["SOL"],
        trendRotationScoreGap: 5,
        trendRotationCurrentMomAccelMax: 999,
        trendRotationCurrentMom20Max: 999,
        trendRotationMinHoldBars: 1,
        trendRotationRequireConsecutiveBars: 1,
        label: "sol_rotate_gap5_once",
      },
    },
    {
      key: "sol_rotate_gap10_once",
      thesis: "Rotate out of SOL when another trend candidate leads by 10 points.",
      options: {
        ...base,
        trendRotationWhileHolding: true,
        trendRotationCurrentSymbols: ["SOL"],
        trendRotationScoreGap: 10,
        trendRotationCurrentMomAccelMax: 999,
        trendRotationCurrentMom20Max: 999,
        trendRotationMinHoldBars: 1,
        trendRotationRequireConsecutiveBars: 1,
        label: "sol_rotate_gap10_once",
      },
    },
    {
      key: "sol_rotate_gap5_twice",
      thesis: "Rotate out of SOL after 2 consecutive bars where another candidate leads by 5.",
      options: {
        ...base,
        trendRotationWhileHolding: true,
        trendRotationCurrentSymbols: ["SOL"],
        trendRotationScoreGap: 5,
        trendRotationCurrentMomAccelMax: 999,
        trendRotationCurrentMom20Max: 999,
        trendRotationMinHoldBars: 1,
        trendRotationRequireConsecutiveBars: 2,
        label: "sol_rotate_gap5_twice",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      ...summarize(result),
    });
  }

  rows.sort((left, right) => right.endEquity - left.endEquity);

  const md = [
    "# V6 SOL Rotate-Out Comparison",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | SOL trades | SOL pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.solTradeCount} | ${row.solNetPnl} |`,
    ),
    "",
    "## Contributions",
    "",
    ...rows.map((row) => `- ${row.key}: ${Object.entries(row.bySymbol).map(([k, v]) => `${k} ${v}`).join(" / ")}`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
