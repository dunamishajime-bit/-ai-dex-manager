import fs from "fs/promises";
import path from "path";

import {
  buildReclaimHybridVariantOptions,
  RECLAIM_HYBRID_EXECUTION_PROFILE,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-bad-window");
const START = Date.parse("2024-07-01T00:00:00.000Z");
const END = Date.parse("2024-10-31T23:59:59.999Z");

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolContribution = result.summary.symbol_contribution;
  return {
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    ethPnl: round(symbolContribution.ETH ?? 0),
    solPnl: round(symbolContribution.SOL ?? 0),
    avaxPnl: round(symbolContribution.AVAX ?? 0),
    injPnl: round(symbolContribution.INJ ?? 0),
    penguPnl: round(symbolContribution.PENGU ?? 0),
    penguTrades: result.trade_pairs.filter((row) => row.symbol === "PENGU").length,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START,
    backtestEndTs: END,
  } satisfies HybridVariantOptions;

  const baseline = {
    ...base,
    idleBreakoutEntryWhileCash: false,
    idleBreakoutSymbols: undefined,
    label: "baseline_no_pengu_idle",
  } satisfies HybridVariantOptions;

  const candidate = {
    ...base,
    label: "candidate_pengu_long_hold",
  } satisfies HybridVariantOptions;

  const [baselineResult, candidateResult] = await Promise.all([
    runHybridBacktest("RETQ22", baseline),
    runHybridBacktest("RETQ22", candidate),
  ]);

  await writeBacktestArtifacts(baselineResult, path.join(REPORT_DIR, "baseline"));
  await writeBacktestArtifacts(candidateResult, path.join(REPORT_DIR, "candidate"));

  const summary = {
    baseline: summarize(baselineResult),
    candidate: summarize(candidateResult),
  };

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
