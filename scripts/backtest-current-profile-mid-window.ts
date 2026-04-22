import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "current-profile-mid-window");
const WINDOW_START = Date.UTC(2025, 0, 1, 0, 0, 0, 0);
const WINDOW_END = Date.UTC(2026, 3, 17, 23, 59, 59, 999);

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const options = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: WINDOW_START,
    backtestEndTs: WINDOW_END,
    label: "current_profile_mid_window",
  } as const;

  const result = await runHybridBacktest("RETQ22", options);
  await writeBacktestArtifacts(result, REPORT_DIR);

  const md = [
    "# Current Profile Mid Window",
    "",
    `- start_utc: ${new Date(WINDOW_START).toISOString()}`,
    `- end_utc: ${new Date(WINDOW_END).toISOString()}`,
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    "",
    "## Summary",
    "",
    formatResultSummary(result),
    "",
    "## Symbol Contribution",
    "",
    "| symbol | pnl |",
    "| --- | ---: |",
    ...Object.entries(result.summary.symbol_contribution)
      .sort((a, b) => b[1] - a[1])
      .map(([symbol, pnl]) => `| ${symbol} | ${pnl.toFixed(2)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        startIso: new Date(WINDOW_START).toISOString(),
        endIso: new Date(WINDOW_END).toISOString(),
        strategyId: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
        summary: result.summary,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        strategyId: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
        endEquity: Number(result.summary.end_equity.toFixed(2)),
        cagrPct: Number(result.summary.cagr_pct.toFixed(2)),
        maxDrawdownPct: Number(result.summary.max_drawdown_pct.toFixed(2)),
        profitFactor: Number(result.summary.profit_factor.toFixed(3)),
        tradeCount: result.summary.trade_count,
        symbolContribution: Object.fromEntries(
          Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, Number(pnl.toFixed(2))]),
        ),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
