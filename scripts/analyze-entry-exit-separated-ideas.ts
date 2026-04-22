import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "entry-exit-separated-ideas");
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
      key: "quality_entry",
      thesis: "Separate large-trend entry logic: require structure breakout, capital inflow proxy, and positive acceleration while keeping current exits.",
      options: {
        ...baseOptions,
        trendBreakoutLookbackBars: 6,
        trendBreakoutMinPct: 0.015,
        trendMinVolumeRatio: 1.1,
        trendMinMomAccel: 0,
        label: "quality_entry",
      },
    },
    {
      key: "faster_exit_6h",
      thesis: "Keep current entries, but monitor exits on 6H bars to reduce exit delay.",
      options: {
        ...baseOptions,
        trendExitCheckTimeframe: "6h",
        strictExtraTrendExitCheckTimeframe: "6h",
        label: "faster_exit_6h",
      },
    },
    {
      key: "quality_entry_plus_faster_exit",
      thesis: "Combine stricter large-trend entry selection with 6H exit monitoring.",
      options: {
        ...baseOptions,
        trendBreakoutLookbackBars: 6,
        trendBreakoutMinPct: 0.015,
        trendMinVolumeRatio: 1.1,
        trendMinMomAccel: 0,
        trendExitCheckTimeframe: "6h",
        strictExtraTrendExitCheckTimeframe: "6h",
        label: "quality_entry_plus_faster_exit",
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
      pengu_contribution: round(result.summary.symbol_contribution.PENGU ?? 0, 2),
      eth_contribution: round(result.summary.symbol_contribution.ETH ?? 0, 2),
      sol_contribution: round(result.summary.symbol_contribution.SOL ?? 0, 2),
      avax_contribution: round(result.summary.symbol_contribution.AVAX ?? 0, 2),
      sma_break_losses: lossTrades.filter((trade) => trade.exit_reason === "sma-break" || trade.exit_reason === "sma40-break").length,
      risk_off_losses: lossTrades.filter((trade) => trade.exit_reason === "risk-off").length,
      rotate_losses: lossTrades.filter((trade) => trade.exit_reason === "strict-extra-rotate").length,
      summary: formatResultSummary(result),
    });
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# Entry/Exit Separation Ideas",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | losses | exposure % | ETH contrib | SOL contrib | AVAX contrib | PENGU contrib | sma-break losses | risk-off losses | rotate losses |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.loss_count} | ${row.exposure_pct} | ${row.eth_contribution} | ${row.sol_contribution} | ${row.avax_contribution} | ${row.pengu_contribution} | ${row.sma_break_losses} | ${row.risk_off_losses} | ${row.rotate_losses} |`),
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify({ rows }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
