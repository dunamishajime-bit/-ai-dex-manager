import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v6-sol-rotate-combo");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
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
      key: "sol_gap5_twice",
      thesis: "Rotate out of SOL after 2 consecutive bars with 5-point lead.",
      options: {
        ...base,
        trendRotationWhileHolding: true,
        trendRotationCurrentSymbols: ["SOL"],
        trendRotationScoreGap: 5,
        trendRotationCurrentMomAccelMax: 999,
        trendRotationCurrentMom20Max: 999,
        trendRotationMinHoldBars: 1,
        trendRotationRequireConsecutiveBars: 2,
        label: "sol_gap5_twice",
      },
    },
    {
      key: "sol_gap10_once",
      thesis: "Rotate out of SOL immediately on a 10-point lead.",
      options: {
        ...base,
        trendRotationWhileHolding: true,
        trendRotationCurrentSymbols: ["SOL"],
        trendRotationScoreGap: 10,
        trendRotationCurrentMomAccelMax: 999,
        trendRotationCurrentMom20Max: 999,
        trendRotationMinHoldBars: 1,
        trendRotationRequireConsecutiveBars: 1,
        label: "sol_gap10_once",
      },
    },
    {
      key: "sol_gap10_once_or_gap5_twice",
      thesis: "Rotate out of SOL on either 10-point immediate lead or 5-point lead held for 2 bars.",
      options: {
        ...base,
        trendRotationWhileHolding: true,
        trendRotationCurrentSymbols: ["SOL"],
        trendRotationScoreGap: 10,
        trendRotationAlternateScoreGap: 5,
        trendRotationCurrentMomAccelMax: 999,
        trendRotationCurrentMom20Max: 999,
        trendRotationMinHoldBars: 1,
        trendRotationRequireConsecutiveBars: 1,
        trendRotationAlternateRequireConsecutiveBars: 2,
        label: "sol_gap10_once_or_gap5_twice",
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
    "# V6 SOL Rotation Combo Comparison",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % | SOL pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} | ${row.solNetPnl} |`,
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
