import fs from "fs/promises";
import path from "path";

import { runExpandedUniverseBacktest, runHybridBacktest } from "../lib/backtest/hybrid-engine";
import { formatResultSummary, writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "top10-expanded-universe");
const SYMBOLS = ["ETH", "SOL", "AVAX", "LINK", "NEAR", "LTC", "XRP", "ATOM", "AAVE", "UNI"] as const;

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    label: "retq22_baseline_for_top10",
  });
  const expanded = await runExpandedUniverseBacktest({
    label: "retq22_top10_expanded_universe",
    expandedTrendSymbols: SYMBOLS,
  });

  await writeBacktestArtifacts(baseline, path.join(REPORT_DIR, "baseline"));
  await writeBacktestArtifacts(expanded, path.join(REPORT_DIR, "expanded"));

  const md = [
    "# Top 10 Expanded Universe",
    "",
    `- symbols: ${SYMBOLS.join(", ")}`,
    "",
    "## Baseline",
    "",
    formatResultSummary(baseline),
    "",
    "## Expanded",
    "",
    formatResultSummary(expanded),
    "",
    "## Delta",
    "",
    `- End Equity delta: ${(expanded.summary.end_equity - baseline.summary.end_equity).toFixed(2)}`,
    `- CAGR delta: ${(expanded.summary.cagr_pct - baseline.summary.cagr_pct).toFixed(2)}pt`,
    `- MaxDD delta: ${(expanded.summary.max_drawdown_pct - baseline.summary.max_drawdown_pct).toFixed(2)}pt`,
    `- PF delta: ${(expanded.summary.profit_factor - baseline.summary.profit_factor).toFixed(3)}`,
    `- Trades delta: ${expanded.summary.trade_count - baseline.summary.trade_count}`,
    "",
    "## Expanded Symbol Contribution",
    "",
    "| symbol | pnl |",
    "| --- | ---: |",
    ...Object.entries(expanded.summary.symbol_contribution)
      .sort((a, b) => b[1] - a[1])
      .map(([symbol, pnl]) => `| ${symbol} | ${pnl.toFixed(2)} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        symbols: SYMBOLS,
        baseline: baseline.summary,
        expanded: expanded.summary,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(
    JSON.stringify(
      {
        symbols: SYMBOLS,
        baseline: {
          endEquity: Number(baseline.summary.end_equity.toFixed(2)),
          cagrPct: Number(baseline.summary.cagr_pct.toFixed(2)),
          maxDrawdownPct: Number(baseline.summary.max_drawdown_pct.toFixed(2)),
          profitFactor: Number(baseline.summary.profit_factor.toFixed(3)),
          tradeCount: baseline.summary.trade_count,
        },
        expanded: {
          endEquity: Number(expanded.summary.end_equity.toFixed(2)),
          cagrPct: Number(expanded.summary.cagr_pct.toFixed(2)),
          maxDrawdownPct: Number(expanded.summary.max_drawdown_pct.toFixed(2)),
          profitFactor: Number(expanded.summary.profit_factor.toFixed(3)),
          tradeCount: expanded.summary.trade_count,
          symbolContribution: Object.fromEntries(
            Object.entries(expanded.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, Number(pnl.toFixed(2))]),
          ),
        },
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
