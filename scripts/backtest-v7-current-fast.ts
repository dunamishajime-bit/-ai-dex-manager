import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-current-fast");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 23, 23, 59, 59, 999);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>, elapsedMs: number) {
  const symbolRows = Object.entries(result.summary.symbol_contribution)
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(Number(pnl)),
      trades: result.trade_pairs.filter((trade) => trade.symbol === symbol).length,
    }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));

  return {
    start: new Date(START_TS).toISOString(),
    end: new Date(END_TS).toISOString(),
    elapsedSec: round(elapsedMs / 1000, 1),
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    symbols: symbolRows,
  };
}

function toMarkdown(summary: ReturnType<typeof summarize>) {
  return [
    "# V7 Current Fast Backtest",
    "",
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", buildReclaimHybridVariantOptions(currentProfile))`",
    "- purpose: current local/server-matched V7 implementation, single pass, no exploratory variants",
    "",
    "## Period",
    "",
    `- Start: ${summary.start}`,
    `- End: ${summary.end}`,
    `- Elapsed: ${summary.elapsedSec}s`,
    "",
    "## Summary",
    "",
    `- End Equity: ${summary.endEquity.toLocaleString()}`,
    `- CAGR: ${summary.cagrPct}%`,
    `- MaxDD: ${summary.maxDrawdownPct}%`,
    `- PF: ${summary.profitFactor}`,
    `- Trades: ${summary.trades}`,
    `- Exposure: ${summary.exposurePct}%`,
    "",
    "## Symbol PnL",
    "",
    "| symbol | PnL | trades |",
    "| --- | ---: | ---: |",
    ...summary.symbols.map((row) => `| ${row.symbol} | ${row.pnl.toLocaleString()} | ${row.trades} |`),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const options = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v7_current_fast",
  } satisfies HybridVariantOptions;

  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", options);
  const summary = summarize(result, Date.now() - started);
  const markdown = toMarkdown(summary);

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(result.trade_pairs, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
