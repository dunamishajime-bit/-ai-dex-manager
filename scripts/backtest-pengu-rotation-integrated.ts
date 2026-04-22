import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-rotation-integrated");

const BASE_OPTIONS: HybridVariantOptions = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  label: "base_pengu_idle_integrated",
};

const VARIANTS: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
  {
    key: "base",
    thesis: "Current strongest profile without mid-hold PENGU rotation.",
    options: {
      ...BASE_OPTIONS,
      label: "base",
    },
  },
  {
    key: "pengu_rotate_gap10_once",
    thesis: "Rotate full position into PENGU when current trend stalls and PENGU leads by 10 score points once.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendRotationWhileHolding: true,
      strictExtraTrendRotationScoreGap: 10,
      strictExtraTrendRotationCurrentMomAccelMax: 0,
      strictExtraTrendRotationCurrentMom20Max: 0.14,
      strictExtraTrendRotationRequireConsecutiveBars: 1,
      strictExtraTrendRotationMinHoldBars: 2,
      label: "pengu_rotate_gap10_once",
    },
  },
  {
    key: "pengu_rotate_gap10_twice",
    thesis: "Rotate only after the same 10-point PENGU lead persists for 2 consecutive 12H bars.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendRotationWhileHolding: true,
      strictExtraTrendRotationScoreGap: 10,
      strictExtraTrendRotationCurrentMomAccelMax: 0,
      strictExtraTrendRotationCurrentMom20Max: 0.14,
      strictExtraTrendRotationRequireConsecutiveBars: 2,
      strictExtraTrendRotationMinHoldBars: 2,
      label: "pengu_rotate_gap10_twice",
    },
  },
  {
    key: "pengu_rotate_gap15_twice",
    thesis: "Rotate only after a stronger 15-point PENGU lead persists for 2 consecutive 12H bars.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendRotationWhileHolding: true,
      strictExtraTrendRotationScoreGap: 15,
      strictExtraTrendRotationCurrentMomAccelMax: 0,
      strictExtraTrendRotationCurrentMom20Max: 0.14,
      strictExtraTrendRotationRequireConsecutiveBars: 2,
      strictExtraTrendRotationMinHoldBars: 2,
      label: "pengu_rotate_gap15_twice",
    },
  },
];

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of VARIANTS) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    const strictExtraRotateCount = result.trade_pairs.filter((trade) => trade.exit_reason === "strict-extra-rotate").length;
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      end_equity: Number(result.summary.end_equity.toFixed(2)),
      cagr_pct: Number(result.summary.cagr_pct.toFixed(2)),
      max_drawdown_pct: Number(result.summary.max_drawdown_pct.toFixed(2)),
      profit_factor: Number(result.summary.profit_factor.toFixed(3)),
      win_rate_pct: Number(result.summary.win_rate_pct.toFixed(2)),
      trade_count: result.summary.trade_count,
      pengu_contribution: Number((result.summary.symbol_contribution.PENGU ?? 0).toFixed(2)),
      strict_extra_rotate_count: strictExtraRotateCount,
      summary: formatResultSummary(result),
    });
    console.log(
      `${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count} rotate=${strictExtraRotateCount}`,
    );
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# PENGU Rotation Integrated Variants",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | PENGU contribution | rotate count |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.pengu_contribution} | ${row.strict_extra_rotate_count} |`),
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
