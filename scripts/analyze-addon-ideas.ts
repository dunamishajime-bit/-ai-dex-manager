import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "addon-ideas");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseOptions: HybridVariantOptions = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "base_current_live",
  };

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "base",
      thesis: "Current live implementation.",
      options: baseOptions,
    },
    {
      key: "profit_trailing_exit",
      thesis: "Keep current entries, but add profit-only trailing for normal trend positions after gains are already large enough.",
      options: {
        ...baseOptions,
        trendProfitTrailActivationPct: 0.16,
        trendProfitTrailRetracePct: 0.09,
        label: "profit_trailing_exit",
      },
    },
    {
      key: "idle_breakout_entry",
      thesis: "While in USDT only, allow an extra breakout entry path using 6H structure, volume, and acceleration confirmation.",
      options: {
        ...baseOptions,
        idleBreakoutEntryWhileCash: true,
        idleBreakoutEntryTimeframe: "6h",
        idleBreakoutBreakoutLookbackBars: 6,
        idleBreakoutBreakoutMinPct: 0.012,
        idleBreakoutMinVolumeRatio: 1.05,
        idleBreakoutMinMomAccel: -0.005,
        idleBreakoutMinEfficiencyRatio: 0.2,
        label: "idle_breakout_entry",
      },
    },
    {
      key: "smooth_trend_score_bonus",
      thesis: "Keep current eligibility rules, but add score bonus for efficient smooth trends and penalty for overheated moves.",
      options: {
        ...baseOptions,
        trendScoreEfficiencyBonusWeight: 18,
        trendScoreOverheatPenaltyWeight: 0.45,
        label: "smooth_trend_score_bonus",
      },
    },
    {
      key: "addon_combo",
      thesis: "Combine profit-only trailing exit, idle breakout entry, and smooth-trend score boost.",
      options: {
        ...baseOptions,
        trendProfitTrailActivationPct: 0.16,
        trendProfitTrailRetracePct: 0.09,
        idleBreakoutEntryWhileCash: true,
        idleBreakoutEntryTimeframe: "6h",
        idleBreakoutBreakoutLookbackBars: 6,
        idleBreakoutBreakoutMinPct: 0.012,
        idleBreakoutMinVolumeRatio: 1.05,
        idleBreakoutMinMomAccel: -0.005,
        idleBreakoutMinEfficiencyRatio: 0.2,
        trendScoreEfficiencyBonusWeight: 18,
        trendScoreOverheatPenaltyWeight: 0.45,
        label: "addon_combo",
      },
    },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    const lossTrades = result.trade_pairs.filter((trade) => trade.net_pnl <= 0);
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      end_equity: round(result.summary.end_equity, 2),
      cagr_pct: round(result.summary.cagr_pct, 2),
      max_drawdown_pct: round(result.summary.max_drawdown_pct, 2),
      profit_factor: round(result.summary.profit_factor, 3),
      win_rate_pct: round(result.summary.win_rate_pct, 2),
      trade_count: result.summary.trade_count,
      loss_count: lossTrades.length,
      exposure_pct: round(result.summary.exposure_pct, 2),
      eth_contribution: round(result.summary.symbol_contribution.ETH ?? 0, 2),
      sol_contribution: round(result.summary.symbol_contribution.SOL ?? 0, 2),
      avax_contribution: round(result.summary.symbol_contribution.AVAX ?? 0, 2),
      pengu_contribution: round(result.summary.symbol_contribution.PENGU ?? 0, 2),
      profit_trailing_exits: result.trade_pairs.filter((trade) => trade.exit_reason === "trend-profit-trailing").length,
      idle_breakout_entries: result.trade_pairs.filter((trade) => trade.entry_reason.includes("idle-breakout-entry")).length,
      summary: formatResultSummary(result),
    });
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# Add-on Ideas Comparison",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | exposure % | ETH contrib | SOL contrib | AVAX contrib | PENGU contrib | trailing exits | idle breakout entries |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.loss_count} | ${row.exposure_pct} | ${row.eth_contribution} | ${row.sol_contribution} | ${row.avax_contribution} | ${row.pengu_contribution} | ${row.profit_trailing_exits} | ${row.idle_breakout_entries} |`),
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify({ rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
