import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "normal-rotation-integrated");

const BASE_OPTIONS: HybridVariantOptions = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  strictExtraTrendSymbols: [],
  strictExtraTrendIdleOnly: false,
  label: "base_no_pengu",
};

const VARIANTS: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
  {
    key: "base_no_pengu",
    thesis: "Current strongest profile with PENGU disabled, using only ETH/SOL/AVAX normal switching.",
    options: {
      ...BASE_OPTIONS,
      label: "base_no_pengu",
    },
  },
  {
    key: "normal_rotate_gap10_once",
    thesis: "Rotate between ETH/SOL/AVAX when current trend stalls and a normal candidate leads by 10 score points once.",
    options: {
      ...BASE_OPTIONS,
      trendRotationWhileHolding: true,
      trendRotationScoreGap: 10,
      trendRotationCurrentMomAccelMax: 0,
      trendRotationCurrentMom20Max: 0.14,
      trendRotationRequireConsecutiveBars: 1,
      trendRotationMinHoldBars: 2,
      label: "normal_rotate_gap10_once",
    },
  },
  {
    key: "normal_rotate_gap10_twice",
    thesis: "Rotate between ETH/SOL/AVAX only after the same 10-point lead persists for 2 consecutive 12H bars.",
    options: {
      ...BASE_OPTIONS,
      trendRotationWhileHolding: true,
      trendRotationScoreGap: 10,
      trendRotationCurrentMomAccelMax: 0,
      trendRotationCurrentMom20Max: 0.14,
      trendRotationRequireConsecutiveBars: 2,
      trendRotationMinHoldBars: 2,
      label: "normal_rotate_gap10_twice",
    },
  },
  {
    key: "normal_rotate_gap15_twice",
    thesis: "Rotate between ETH/SOL/AVAX only after a stronger 15-point lead persists for 2 consecutive 12H bars.",
    options: {
      ...BASE_OPTIONS,
      trendRotationWhileHolding: true,
      trendRotationScoreGap: 15,
      trendRotationCurrentMomAccelMax: 0,
      trendRotationCurrentMom20Max: 0.14,
      trendRotationRequireConsecutiveBars: 2,
      trendRotationMinHoldBars: 2,
      label: "normal_rotate_gap15_twice",
    },
  },
];

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of VARIANTS) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    const rotateCount = result.trade_pairs.filter((trade) => trade.exit_reason === "trend-rotate").length;
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      end_equity: Number(result.summary.end_equity.toFixed(2)),
      cagr_pct: Number(result.summary.cagr_pct.toFixed(2)),
      max_drawdown_pct: Number(result.summary.max_drawdown_pct.toFixed(2)),
      profit_factor: Number(result.summary.profit_factor.toFixed(3)),
      win_rate_pct: Number(result.summary.win_rate_pct.toFixed(2)),
      trade_count: result.summary.trade_count,
      eth_contribution: Number((result.summary.symbol_contribution.ETH ?? 0).toFixed(2)),
      sol_contribution: Number((result.summary.symbol_contribution.SOL ?? 0).toFixed(2)),
      avax_contribution: Number((result.summary.symbol_contribution.AVAX ?? 0).toFixed(2)),
      rotate_count: rotateCount,
      summary: formatResultSummary(result),
    });
    console.log(
      `${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count} rotate=${rotateCount}`,
    );
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# Normal Rotation Integrated Variants",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | ETH contrib | SOL contrib | AVAX contrib | rotate count |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.eth_contribution} | ${row.sol_contribution} | ${row.avax_contribution} | ${row.rotate_count} |`),
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
