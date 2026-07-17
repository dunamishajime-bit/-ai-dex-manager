import fs from "node:fs/promises";
import path from "node:path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-early-profit-longdd");

const periods = [
  { key: "2026_ytd", start: "2026-01-01", end: "2026-05-15" },
  { key: "pengu_era", start: "2024-12-17", end: "2026-05-15" },
  { key: "full", start: "2022-01-01", end: "2026-05-15" },
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

function earlyProtect(input: {
  minLongHighDrawdownPct?: number;
  longHighDrawdownLookbackBars?: number;
  maxMom80?: number;
  minRecentHighDrawdownPct?: number;
} = {}): HybridVariantOptions {
  return {
    idleBreakoutConditionalEarlyTrailBySymbol: {
      PENGU: {
        activationPct: 0.03,
        retracePct: 0.015,
        ...input,
      },
    },
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseProfileOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);
  const variants: { key: string; options: HybridVariantOptions }[] = [
    { key: "current", options: {} },
    { key: "early3_15", options: earlyProtect() },
  ];

  for (const lookback of [480, 960, 1920, 2880]) {
    for (const longDd of [0.1, 0.2, 0.3, 0.4, 0.5]) {
      variants.push({
        key: `longdd${longDd}_lb${lookback}`,
        options: earlyProtect({ minLongHighDrawdownPct: longDd, longHighDrawdownLookbackBars: lookback }),
      });
      for (const maxMom80 of [0.05, 0.08]) {
        variants.push({
          key: `longdd${longDd}_lb${lookback}_m80${maxMom80}`,
          options: earlyProtect({
            minLongHighDrawdownPct: longDd,
            longHighDrawdownLookbackBars: lookback,
            maxMom80,
          }),
        });
      }
      variants.push({
        key: `longdd${longDd}_lb${lookback}_recent2`,
        options: earlyProtect({
          minLongHighDrawdownPct: longDd,
          longHighDrawdownLookbackBars: lookback,
          minRecentHighDrawdownPct: 0.02,
        }),
      });
    }
  }

  const requestedPeriods = process.env.BT_PERIODS
    ? new Set(process.env.BT_PERIODS.split(",").map((item) => item.trim()))
    : null;
  const requestedVariants = process.env.BT_VARIANTS
    ? new Set(process.env.BT_VARIANTS.split(",").map((item) => item.trim()))
    : null;

  const rows = [];
  for (const period of periods) {
    if (requestedPeriods && !requestedPeriods.has(period.key)) continue;
    let currentEnd = 0;
    for (const variant of variants) {
      if (requestedVariants && !requestedVariants.has(variant.key)) continue;
      const started = Date.now();
      const result = await runHybridBacktest("RETQ22", {
        ...baseProfileOptions,
        ...variant.options,
        backtestStartTs: parseStart(period.start),
        backtestEndTs: parseEnd(period.end),
        label: `v7_peng_early_longdd_${period.key}_${variant.key}`,
      });
      if (variant.key === "current") currentEnd = result.summary.end_equity;
      const penguTrades = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
      const earlyExits = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-early-trailing");
      rows.push({
        period: period.key,
        variant: variant.key,
        elapsedSec: round((Date.now() - started) / 1000, 1),
        endEquity: round(result.summary.end_equity),
        vsCurrent: round(result.summary.end_equity - currentEnd),
        maxDrawdownPct: round(result.summary.max_drawdown_pct),
        profitFactor: round(result.summary.profit_factor, 3),
        trades: result.summary.trade_count,
        penguPnl: round(penguTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        earlyExits: earlyExits.length,
      });
    }
  }

  const lines = [
    "# V7 PENGU Early Profit Long Drawdown Gate",
    "",
    "| period | variant | End Equity | vs current | MaxDD | PF | trades | PENGU PnL | early exits | sec |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...periods.flatMap((period) =>
      rows
        .filter((row) => row.period === period.key)
        .sort((a, b) => b.endEquity - a.endEquity)
        .slice(0, 25)
        .map((row) => `| ${row.period} | ${row.variant} | ${row.endEquity.toLocaleString()} | ${row.vsCurrent.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.earlyExits} | ${row.elapsedSec} |`)
    ),
    "",
  ];
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), lines.join("\n"), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "rows.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(lines.join("\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
