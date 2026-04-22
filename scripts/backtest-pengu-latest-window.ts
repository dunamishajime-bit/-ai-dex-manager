import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-latest-window");
const WINDOW_START = Date.UTC(2025, 11, 31, 0, 0, 0);
const WINDOW_END = Date.UTC(2026, 3, 17, 23, 59, 59, 999);

const TRAILING_BASE: HybridVariantOptions = {
  ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
  backtestStartTs: WINDOW_START,
  backtestEndTs: WINDOW_END,
  label: "latest_window_trailing_base",
};

const LEGACY_BASE: HybridVariantOptions = {
  ...TRAILING_BASE,
  strictExtraTrendTrailActivationPct: undefined,
  strictExtraTrendTrailRetracePct: undefined,
  label: "latest_window_legacy_base",
};

const VARIANTS: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
  {
    key: "legacy_base",
    thesis: "Original strongest profile before PENGU trailing, limited to 2025-12-31 through 2026-04-17.",
    options: {
      ...LEGACY_BASE,
      label: "legacy_base",
    },
  },
  {
    key: "trailing_base",
    thesis: "PENGU-only trailing protection, limited to 2025-12-31 through 2026-04-17.",
    options: {
      ...TRAILING_BASE,
      label: "trailing_base",
    },
  },
  {
    key: "trailing_plus_rotate_gap10_once",
    thesis: "PENGU trailing plus single-bar gap10 rotation in the latest-window test.",
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
    thesis: "PENGU trailing plus two-bar gap10 rotation in the latest-window test.",
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
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      start_iso: new Date(WINDOW_START).toISOString(),
      end_iso: new Date(WINDOW_END).toISOString(),
      end_equity: Number(result.summary.end_equity.toFixed(2)),
      cagr_pct: Number(result.summary.cagr_pct.toFixed(2)),
      max_drawdown_pct: Number(result.summary.max_drawdown_pct.toFixed(2)),
      profit_factor: Number(result.summary.profit_factor.toFixed(3)),
      win_rate_pct: Number(result.summary.win_rate_pct.toFixed(2)),
      trade_count: result.summary.trade_count,
      pengu_contribution: Number((result.summary.symbol_contribution.PENGU ?? 0).toFixed(2)),
      summary: formatResultSummary(result),
    });
    console.log(
      `${variant.key}: end=${result.summary.end_equity.toFixed(2)} CAGR=${result.summary.cagr_pct.toFixed(2)} MaxDD=${result.summary.max_drawdown_pct.toFixed(2)} trades=${result.summary.trade_count}`,
    );
  }

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({ rows }, null, 2), "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.md"),
    [
      "# PENGU Latest Window (2025-12-31 to 2026-04-17)",
      "",
      "| variant | end equity | CAGR % | MaxDD % | PF | win % | trades | PENGU contribution |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
      ...rows.map((row) => `| ${row.key} | ${row.end_equity} | ${row.cagr_pct} | ${row.max_drawdown_pct} | ${row.profit_factor} | ${row.win_rate_pct} | ${row.trade_count} | ${row.pengu_contribution} |`),
    ].join("\n"),
    "utf8",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
