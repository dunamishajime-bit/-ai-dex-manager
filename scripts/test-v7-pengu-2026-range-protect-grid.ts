import fs from "node:fs/promises";
import path from "node:path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-2026-range-protect-grid");

const periods = [
  { key: "2026_ytd", start: "2026-01-01", end: "2026-05-15" },
  { key: "pengu_era", start: "2024-12-17", end: "2026-05-15" },
] as const;

function parseStart(date: string) {
  return Date.parse(`${date}T00:00:00.000Z`);
}

function parseEnd(date: string) {
  return Date.parse(`${date}T23:59:59.999Z`);
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function conditionalProtect(input: {
  activationPct: number;
  retracePct: number;
  maxMom80: number;
  minRecentHighDrawdownPct: number;
  minHoldBars?: number;
}): HybridVariantOptions {
  return {
    idleBreakoutConditionalEarlyTrailBySymbol: {
      PENGU: input,
    },
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseProfileOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const variants: { key: string; options: HybridVariantOptions }[] = [{ key: "current", options: {} }];

  for (const activationPct of [0.025, 0.03, 0.035, 0.04]) {
    for (const retracePct of [0.01, 0.0125, 0.015, 0.02]) {
      for (const maxMom80 of [0.03, 0.05, 0.08]) {
        for (const minRecentHighDrawdownPct of [0.01, 0.02, 0.03, 0.04]) {
          variants.push({
            key: `a${activationPct}_r${retracePct}_m80${maxMom80}_dd${minRecentHighDrawdownPct}`,
            options: conditionalProtect({
              activationPct,
              retracePct,
              maxMom80,
              minRecentHighDrawdownPct,
            }),
          });
        }
      }
    }
  }

  const rows: {
    period: string;
    variant: string;
    endEquity: number;
    vsCurrent: number;
    maxDrawdownPct: number;
    profitFactor: number;
    trades: number;
    penguPnl: number;
    earlyTrailTrades: number;
  }[] = [];

  for (const period of periods) {
    let currentEnd = 0;
    for (const variant of variants) {
      const result = await runHybridBacktest("RETQ22", {
        ...baseProfileOptions,
        ...variant.options,
        backtestStartTs: parseStart(period.start),
        backtestEndTs: parseEnd(period.end),
        label: `v7_peng_range_grid_${period.key}_${variant.key}`,
      });
      if (variant.key === "current") currentEnd = result.summary.end_equity;
      const penguTrades = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
      const earlyTrailTrades = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-early-trailing");
      rows.push({
        period: period.key,
        variant: variant.key,
        endEquity: round(result.summary.end_equity),
        vsCurrent: round(result.summary.end_equity - currentEnd),
        maxDrawdownPct: round(result.summary.max_drawdown_pct),
        profitFactor: round(result.summary.profit_factor, 3),
        trades: result.summary.trade_count,
        penguPnl: round(penguTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        earlyTrailTrades: earlyTrailTrades.length,
      });
    }
  }

  const lines = [
    "# V7 PENGU 2026 Range Protect Grid",
    "",
    "| period | variant | End Equity | vs current | MaxDD | PF | trades | PENGU PnL | early exits |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|",
    ...periods.flatMap((period) =>
      rows
        .filter((row) => row.period === period.key)
        .filter((row) => row.variant === "current" || row.vsCurrent > 0)
        .sort((a, b) => b.endEquity - a.endEquity)
        .slice(0, 40)
        .map((row) => `| ${row.period} | ${row.variant} | ${row.endEquity.toLocaleString()} | ${row.vsCurrent.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.earlyTrailTrades} |`)
    ),
    "",
  ];
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
