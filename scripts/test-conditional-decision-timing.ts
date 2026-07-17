import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-conditional-decision-timing");

const PERIODS = [
  { key: "full", startTs: Date.UTC(2022, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
  { key: "2024-H2", startTs: Date.UTC(2024, 6, 1), endTs: Date.UTC(2024, 11, 31, 23, 59, 59, 999) },
  { key: "2025-H1", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2025, 5, 30, 23, 59, 59, 999) },
  { key: "2025-H2", startTs: Date.UTC(2025, 6, 1), endTs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) },
  { key: "2026-YTD", startTs: Date.UTC(2026, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
  { key: "2025-2026", startTs: Date.UTC(2025, 0, 1), endTs: Date.UTC(2026, 4, 5, 23, 59, 59, 999) },
];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(startTs: number, endTs: number): HybridVariantOptions {
  return {
    ...buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: startTs,
    backtestEndTs: endTs,
  };
}

function summarize(
  period: string,
  variant: string,
  result: Awaited<ReturnType<typeof runHybridBacktest>>,
  baseline = 0,
) {
  return {
    period,
    variant,
    endEquity: round(result.summary.end_equity),
    delta: baseline ? round(result.summary.end_equity - baseline) : 0,
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: round(Number(result.summary.symbol_contribution.PENGU || 0)),
    dogePnl: round(Number(result.summary.symbol_contribution.DOGE || 0)),
    twtPnl: round(Number(result.summary.symbol_contribution.TWT || 0)),
    penguTrades: result.trade_pairs.filter((trade) => trade.symbol === "PENGU").length,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  const trades = [];

  for (const period of PERIODS) {
    const base = baseOptions(period.startTs, period.endTs);
    const variants: Array<{ key: string; options: HybridVariantOptions }> = [
      { key: "v7_current_12h", options: { ...base, label: `${period.key}_current` } },
      { key: "friday_2h", options: { ...base, fridayDecisionTimeframe: "2h", label: `${period.key}_friday_2h` } },
      {
        key: "night_20_03_1h",
        options: {
          ...base,
          nightDecisionTimeframe: "1h",
          nightDecisionJstStartHour: 20,
          nightDecisionJstEndHour: 3,
          label: `${period.key}_night_1h`,
        },
      },
      {
        key: "friday_2h_plus_night_20_03_1h",
        options: {
          ...base,
          fridayDecisionTimeframe: "2h",
          nightDecisionTimeframe: "1h",
          nightDecisionJstStartHour: 20,
          nightDecisionJstEndHour: 3,
          label: `${period.key}_friday_2h_night_1h`,
        },
      },
    ];
    let baselineEquity = 0;
    for (const variant of variants) {
      const result = await runHybridBacktest("RETQ22", variant.options);
      if (variant.key === "v7_current_12h") baselineEquity = result.summary.end_equity;
      const row = summarize(period.key, variant.key, result, baselineEquity);
      rows.push(row);
      trades.push(...result.trade_pairs.map((trade) => ({ period: period.key, variant: variant.key, ...trade })));
      console.log(`${period.key} ${variant.key} end=${row.endEquity.toLocaleString()} delta=${row.delta.toLocaleString()} trades=${row.trades}`);
    }
  }

  const md = [
    "# V7 Conditional Decision Timing",
    "",
    "- method: engine-direct `runHybridBacktest(\"RETQ22\", options)`",
    "- baseline: V7 current 12H decision",
    "- friday_2h: add 2H decision bars only on Friday JST",
    "- night_20_03_1h: add 1H decision bars during JST 20:00-03:00",
    "- combined: both additions",
    "",
    "| period | variant | End Equity | delta | MaxDD % | PF | trades | exposure % | PENGU PnL | DOGE PnL | TWT PnL | PENGU trades |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.period} | ${row.variant} | ${row.endEquity.toLocaleString()} | ${row.delta.toLocaleString()} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.exposurePct} | ${row.penguPnl.toLocaleString()} | ${row.dogePnl.toLocaleString()} | ${row.twtPnl.toLocaleString()} | ${row.penguTrades} |`),
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), md, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "trades.json"), JSON.stringify(trades, null, 2), "utf8");
  console.log(md);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
