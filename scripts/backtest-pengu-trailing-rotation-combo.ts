import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-trailing-rotation-combo");

const TRAILING_BASE: HybridVariantOptions = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  label: "production_trailing_base",
};

const LEGACY_BASE: HybridVariantOptions = {
  ...TRAILING_BASE,
  strictExtraTrendTrailActivationPct: undefined,
  strictExtraTrendTrailRetracePct: undefined,
  label: "legacy_base_no_pengu_trailing",
};

const VARIANTS: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
  {
    key: "legacy_base",
    thesis: "Original strongest profile before PENGU trailing was added.",
    options: {
      ...LEGACY_BASE,
      label: "legacy_base",
    },
  },
  {
    key: "trailing_base",
    thesis: "Production candidate with PENGU-only trailing protection.",
    options: {
      ...TRAILING_BASE,
      label: "trailing_base",
    },
  },
  {
    key: "trailing_plus_rotate_gap10_once",
    thesis: "PENGU trailing plus rotation from stalled normal trend into PENGU on a single 12H lead.",
    options: {
      ...TRAILING_BASE,
      strictExtraTrendRotationWhileHolding: true,
      strictExtraTrendRotationScoreGap: 10,
      strictExtraTrendRotationCurrentMomAccelMax: 0,
      strictExtraTrendRotationCurrentMom20Max: 0.14,
      strictExtraTrendRotationRequireConsecutiveBars: 1,
      strictExtraTrendRotationMinHoldBars: 2,
      label: "trailing_plus_rotate_gap10_once",
    },
  },
  {
    key: "trailing_plus_rotate_gap10_twice",
    thesis: "PENGU trailing plus rotation only after the 10-point lead persists for 2 consecutive 12H bars.",
    options: {
      ...TRAILING_BASE,
      strictExtraTrendRotationWhileHolding: true,
      strictExtraTrendRotationScoreGap: 10,
      strictExtraTrendRotationCurrentMomAccelMax: 0,
      strictExtraTrendRotationCurrentMom20Max: 0.14,
      strictExtraTrendRotationRequireConsecutiveBars: 2,
      strictExtraTrendRotationMinHoldBars: 2,
      label: "trailing_plus_rotate_gap10_twice",
    },
  },
];

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of VARIANTS) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    const penguRiskExitCount = result.trade_pairs.filter((trade) =>
      trade.exit_reason === "strict-extra-trailing"
      || trade.exit_reason === "strict-extra-hard-stop"
      || trade.exit_reason === "strict-extra-time",
    ).length;
    const rotateCount = result.trade_pairs.filter((trade) => trade.exit_reason === "strict-extra-rotate").length;
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
      pengu_risk_exit_count: penguRiskExitCount,
      rotate_count: rotateCount,
      summary: formatResultSummary(result),
    });
    console.log(
      `${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count} trailingExits=${penguRiskExitCount} rotate=${rotateCount}`,
    );
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# PENGU Trailing + Rotation Comparison",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | PENGU contribution | PENGU trailing exits | rotate count |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.pengu_contribution} | ${row.pengu_risk_exit_count} | ${row.rotate_count} |`),
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
