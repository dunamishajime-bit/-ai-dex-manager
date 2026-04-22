import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-integrated-variants");

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
    key: "pengu_fast_exit_only",
    thesis: "Only PENGU exits faster using 6H checks.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendExitCheckTimeframe: "6h",
      label: "pengu_fast_exit_only",
    },
  },
  {
    key: "pengu_fast_exit_trailing",
    thesis: "PENGU exits faster and protects gains with trailing logic.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendExitCheckTimeframe: "6h",
      strictExtraTrendTrailActivationPct: 0.12,
      strictExtraTrendTrailRetracePct: 0.06,
      label: "pengu_fast_exit_trailing",
    },
  },
  {
    key: "pengu_light_early_entry_fast_exit",
    thesis: "PENGU gets lighter 6H early entry plus 6H exits.",
    options: {
      ...BASE_OPTIONS,
      strictExtraTrendDecisionTimeframe: "6h",
      strictExtraTrendExitCheckTimeframe: "6h",
      strictExtraTrendMinEfficiencyRatio: 0.18,
      label: "pengu_light_early_entry_fast_exit",
    },
  },
];

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of VARIANTS) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
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
      summary: formatResultSummary(result),
    });
    console.log(`${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count}`);
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# PENGU Integrated Variants",
      "",
      "| variant | thesis | end equity | CAGR % | MaxDD % | PF | win % | trades | PENGU contribution |",
      "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.pengu_contribution} |`),
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
