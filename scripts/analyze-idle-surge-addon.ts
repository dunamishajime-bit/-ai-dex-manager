import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "idle-surge-addon");
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

  const surgeCore = {
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "6h" as const,
    idleBreakoutBreakoutLookbackBars: 4,
    idleBreakoutBreakoutMinPct: 0.008,
    idleBreakoutMinVolumeRatio: 1.02,
    idleBreakoutMinMomAccel: -0.01,
    idleBreakoutMinEfficiencyRatio: 0.16,
    idleBreakoutProfitTrailActivationPct: 0.12,
    idleBreakoutProfitTrailRetracePct: 0.07,
    idleBreakoutMaxHoldBars: 8,
  };

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "base",
      thesis: "Current live implementation.",
      options: baseOptions,
    },
    {
      key: "idle_surge_conservative",
      thesis: "Add USDT-only 6H surge entry with dedicated light trailing exit.",
      options: {
        ...baseOptions,
        ...surgeCore,
        label: "idle_surge_conservative",
      },
    },
    {
      key: "idle_surge_aggressive",
      thesis: "Loosen surge entry slightly to see whether waiting periods can be monetized without replacing the main logic.",
      options: {
        ...baseOptions,
        ...surgeCore,
        idleBreakoutBreakoutLookbackBars: 3,
        idleBreakoutBreakoutMinPct: 0.005,
        idleBreakoutMinVolumeRatio: 1,
        idleBreakoutMinMomAccel: -0.02,
        idleBreakoutMinEfficiencyRatio: 0.12,
        idleBreakoutProfitTrailActivationPct: 0.1,
        idleBreakoutProfitTrailRetracePct: 0.08,
        idleBreakoutMaxHoldBars: 10,
        label: "idle_surge_aggressive",
      },
    },
    {
      key: "idle_surge_with_smooth_bonus",
      thesis: "Surge add-on plus smooth-trend score bonus to improve which normal trend symbol wins when surge is inactive.",
      options: {
        ...baseOptions,
        ...surgeCore,
        trendScoreEfficiencyBonusWeight: 12,
        trendScoreOverheatPenaltyWeight: 0.25,
        label: "idle_surge_with_smooth_bonus",
      },
    },
  ];

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    const lossTrades = result.trade_pairs.filter((trade) => trade.net_pnl <= 0);
    const surgeTrades = result.trade_pairs.filter((trade) => trade.sub_variant === "idle-breakout");
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
      surge_trade_count: surgeTrades.length,
      surge_pnl: round(surgeTrades.reduce((sum, trade) => sum + trade.net_pnl, 0), 2),
      surge_trailing_exits: surgeTrades.filter((trade) => trade.exit_reason === "idle-breakout-trailing").length,
      surge_time_exits: surgeTrades.filter((trade) => trade.exit_reason === "idle-breakout-time").length,
      summary: formatResultSummary(result),
    });
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# Idle Surge Add-on Comparison",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | exposure % | ETH contrib | SOL contrib | AVAX contrib | PENGU contrib | surge trades | surge pnl | surge trailing exits | surge time exits |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.loss_count} | ${row.exposure_pct} | ${row.eth_contribution} | ${row.sol_contribution} | ${row.avax_contribution} | ${row.pengu_contribution} | ${row.surge_trade_count} | ${row.surge_pnl} | ${row.surge_trailing_exits} | ${row.surge_time_exits} |`),
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify({ rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
