import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v6-sol-alloc");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

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
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    bySymbol: Object.fromEntries(
      Object.entries(result.summary.symbol_contribution).map(([symbol, pnl]) => [symbol, round(Number(pnl))]),
    ),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseOptions: HybridVariantOptions = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    label: "v6_base",
  };

  const sol5Options: HybridVariantOptions = {
    ...baseOptions,
    trendAllocBySymbol: {
      SOL: 0.05,
    },
    label: "v6_sol_5pct",
  };

  const [base, sol5] = await Promise.all([
    runHybridBacktest("RETQ22", baseOptions),
    runHybridBacktest("RETQ22", sol5Options),
  ]);

  const payload = {
    setup: {
      startUtc: new Date(START_TS).toISOString(),
      endUtc: new Date(END_TS).toISOString(),
      strategyId: RECLAIM_HYBRID_EXECUTION_PROFILE.id,
    },
    base: summarize(base),
    sol5: summarize(sol5),
  };

  const md = [
    "# V6 SOL 5% Allocation Comparison",
    "",
    `- start_utc: ${payload.setup.startUtc}`,
    `- end_utc: ${payload.setup.endUtc}`,
    `- strategy_id: ${payload.setup.strategyId}`,
    "",
    "## Summary",
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | win % | trades | exposure % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    `| base | ${payload.base.endEquity} | ${payload.base.cagrPct} | ${payload.base.maxDrawdownPct} | ${payload.base.profitFactor} | ${payload.base.winRatePct} | ${payload.base.tradeCount} | ${payload.base.exposurePct} |`,
    `| sol_5pct | ${payload.sol5.endEquity} | ${payload.sol5.cagrPct} | ${payload.sol5.maxDrawdownPct} | ${payload.sol5.profitFactor} | ${payload.sol5.winRatePct} | ${payload.sol5.tradeCount} | ${payload.sol5.exposurePct} |`,
    "",
    "## Symbol Contribution",
    "",
    `- base: ${Object.entries(payload.base.bySymbol).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
    `- sol_5pct: ${Object.entries(payload.sol5.bySymbol).map(([k, v]) => `${k} ${v}`).join(" / ")}`,
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
  console.log(JSON.stringify(payload, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
