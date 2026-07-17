import fs from "fs/promises";
import path from "path";

import {
  buildReclaimHybridVariantOptions,
  RECLAIM_HYBRID_EXECUTION_PROFILE,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-long-hold-full");
const START_LABEL = process.env.BT_START ?? "2022-01-01";
const END_LABEL = process.env.BT_END ?? "2026-04-24";
const START = Date.parse(`${START_LABEL}T00:00:00.000Z`);
const END = Date.parse(`${END_LABEL}T23:59:59.999Z`);

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguPnl: round(result.summary.symbol_contribution.PENGU ?? 0),
    penguTrades: result.trade_pairs.filter((row) => row.symbol === "PENGU").length,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const common = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START,
    backtestEndTs: END,
  } satisfies HybridVariantOptions;

  const baseline = {
    ...common,
    idleBreakoutEntryWhileCash: false,
    idleBreakoutSymbols: undefined,
    label: "baseline_no_pengu_idle",
  } satisfies HybridVariantOptions;

  const candidate = {
    ...common,
    label: "candidate_pengu_long_hold",
  } satisfies HybridVariantOptions;

  const [baselineResult, candidateResult] = await Promise.all([
    runHybridBacktest("RETQ22", baseline),
    runHybridBacktest("RETQ22", candidate),
  ]);

  const summary = {
    start: START_LABEL,
    end: END_LABEL,
    baseline: summarize(baselineResult),
    candidate: summarize(candidateResult),
    deltaEndEquity: round(candidateResult.summary.end_equity - baselineResult.summary.end_equity),
    deltaPenguPnl: round((candidateResult.summary.symbol_contribution.PENGU ?? 0) - (baselineResult.summary.symbol_contribution.PENGU ?? 0)),
  };

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
