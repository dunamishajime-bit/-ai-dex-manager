import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-sol-vs-extra-priority");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
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
    bySymbol: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "base_v7_style",
      thesis: "Current V7-style baseline with SOL still chosen by normal trend priority.",
      options: { ...base, label: "base_v7_style" },
    },
    {
      key: "extra_over_sol_gap8",
      thesis: "Prefer DOGE/PENGU over SOL when strict-extra score leads by 8.",
      options: {
        ...base,
        strictExtraTrendPriorityCurrentSymbols: ["SOL"],
        strictExtraTrendPriorityScoreGap: 8,
        label: "extra_over_sol_gap8",
      },
    },
    {
      key: "extra_over_sol_gap10",
      thesis: "Prefer DOGE/PENGU over SOL when strict-extra score leads by 10.",
      options: {
        ...base,
        strictExtraTrendPriorityCurrentSymbols: ["SOL"],
        strictExtraTrendPriorityScoreGap: 10,
        label: "extra_over_sol_gap10",
      },
    },
    {
      key: "extra_over_sol_gap8_mom_eff",
      thesis: "Prefer DOGE/PENGU over SOL when score leads by 8 and both mom20 / efficiency are stronger.",
      options: {
        ...base,
        strictExtraTrendPriorityCurrentSymbols: ["SOL"],
        strictExtraTrendPriorityScoreGap: 8,
        strictExtraTrendPriorityRequireHigherMom20: true,
        strictExtraTrendPriorityRequireHigherEfficiency: true,
        label: "extra_over_sol_gap8_mom_eff",
      },
    },
    {
      key: "extra_over_sol_gap10_mom_eff",
      thesis: "Prefer DOGE/PENGU over SOL when score leads by 10 and both mom20 / efficiency are stronger.",
      options: {
        ...base,
        strictExtraTrendPriorityCurrentSymbols: ["SOL"],
        strictExtraTrendPriorityScoreGap: 10,
        strictExtraTrendPriorityRequireHigherMom20: true,
        strictExtraTrendPriorityRequireHigherEfficiency: true,
        label: "extra_over_sol_gap10_mom_eff",
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
    "# V7 SOL vs DOGE/PENGU Priority Comparison",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- strategy_id_source: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.winRatePct} | ${row.tradeCount} | ${row.exposurePct} |`,
    ),
    "",
    "## Symbol Contribution",
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
