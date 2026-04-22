import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-risk-controls");

const BASE_OPTIONS: HybridVariantOptions = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  label: "base_pengu_idle_integrated",
};

const VARIANTS: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
  {
    key: "base",
    thesis: "Current strongest profile.",
    options: {
      ...BASE_OPTIONS,
      label: "base",
    },
  },
  {
    key: "pengu_tighter_trailing",
    thesis: "Keep base logic but tighten PENGU trailing protection once profit is on the table.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendTrailActivationPct: 0.18,
      strictExtraTrendTrailRetracePct: 0.08,
      label: "pengu_tighter_trailing",
    },
  },
  {
    key: "pengu_hard_stop_12pct",
    thesis: "Keep base logic but cut PENGU if it falls 12% below entry.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendHardStopLossPct: 0.12,
      label: "pengu_hard_stop_12pct",
    },
  },
  {
    key: "pengu_max_hold_12bars",
    thesis: "Keep base logic but cap PENGU holding time to 12 bars.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendMaxHoldBars: 12,
      label: "pengu_max_hold_12bars",
    },
  },
  {
    key: "pengu_hard_stop_and_trailing",
    thesis: "Combine PENGU hard stop and tighter trailing protection.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendHardStopLossPct: 0.12,
      strictExtraTrendTrailActivationPct: 0.18,
      strictExtraTrendTrailRetracePct: 0.08,
      label: "pengu_hard_stop_and_trailing",
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
      summary: formatResultSummary(result),
    });
    console.log(
      `${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count} riskExits=${penguRiskExitCount}`,
    );
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# PENGU Risk Controls",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | PENGU contribution | PENGU risk exits |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.pengu_contribution} | ${row.pengu_risk_exit_count} |`),
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
