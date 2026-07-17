import fs from "node:fs/promises";
import path from "node:path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-early-profit-reentry");

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

function earlyProtect(): HybridVariantOptions {
  return {
    idleBreakoutConditionalEarlyTrailBySymbol: {
      PENGU: {
        activationPct: 0.03,
        retracePct: 0.015,
      },
    },
  };
}

function earlyProtectReentry(input: {
  reentryPct: number;
  maxBarsAfterExit?: number;
  referencePrice?: "exit" | "peak";
}): HybridVariantOptions {
  return {
    ...earlyProtect(),
    idleBreakoutEarlyTrailReentryBySymbol: {
      PENGU: input,
    },
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const baseProfileOptions = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE);

  const variants: { key: string; note: string; options: HybridVariantOptions }[] = [
    { key: "current", note: "current V7", options: {} },
    { key: "early3_15", note: "+3% reached, exit on 1.5% retrace", options: earlyProtect() },
    { key: "exit_reentry10_96", note: "early exit, reenter +1.0% from exit within 24h", options: earlyProtectReentry({ reentryPct: 0.01, maxBarsAfterExit: 96, referencePrice: "exit" }) },
    { key: "exit_reentry15_96", note: "early exit, reenter +1.5% from exit within 24h", options: earlyProtectReentry({ reentryPct: 0.015, maxBarsAfterExit: 96, referencePrice: "exit" }) },
    { key: "exit_reentry20_96", note: "early exit, reenter +2.0% from exit within 24h", options: earlyProtectReentry({ reentryPct: 0.02, maxBarsAfterExit: 96, referencePrice: "exit" }) },
    { key: "peak_reentry0_24", note: "early exit, reenter when prior peak is reclaimed within 6h", options: earlyProtectReentry({ reentryPct: 0, maxBarsAfterExit: 24, referencePrice: "peak" }) },
    { key: "peak_reentry0_48", note: "early exit, reenter when prior peak is reclaimed within 12h", options: earlyProtectReentry({ reentryPct: 0, maxBarsAfterExit: 48, referencePrice: "peak" }) },
    { key: "peak_reentry0_96", note: "early exit, reenter when prior peak is reclaimed within 24h", options: earlyProtectReentry({ reentryPct: 0, maxBarsAfterExit: 96, referencePrice: "peak" }) },
    { key: "peak_reentry0_288", note: "early exit, reenter when prior peak is reclaimed within 72h", options: earlyProtectReentry({ reentryPct: 0, maxBarsAfterExit: 288, referencePrice: "peak" }) },
    { key: "peak_reentry05_96", note: "early exit, reenter prior peak +0.5% within 24h", options: earlyProtectReentry({ reentryPct: 0.005, maxBarsAfterExit: 96, referencePrice: "peak" }) },
    { key: "peak_reentry10_96", note: "early exit, reenter prior peak +1.0% within 24h", options: earlyProtectReentry({ reentryPct: 0.01, maxBarsAfterExit: 96, referencePrice: "peak" }) },
  ];

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
        label: `v7_peng_early_profit_${period.key}_${variant.key}`,
      });
      if (variant.key === "current") currentEnd = result.summary.end_equity;
      const penguTrades = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
      const earlyExits = result.trade_pairs.filter((trade) => trade.exit_reason === "idle-breakout-early-trailing");
      const reentries = result.trade_pairs.filter((trade) => trade.entry_reason.includes("idle-breakout-early-trail-reentry"));
      rows.push({
        period: period.key,
        variant: variant.key,
        note: variant.note,
        elapsedSec: round((Date.now() - started) / 1000, 1),
        endEquity: round(result.summary.end_equity),
        vsCurrent: round(result.summary.end_equity - currentEnd),
        maxDrawdownPct: round(result.summary.max_drawdown_pct),
        profitFactor: round(result.summary.profit_factor, 3),
        trades: result.summary.trade_count,
        penguPnl: round(penguTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
        earlyExits: earlyExits.length,
        reentries: reentries.length,
      });
    }
  }

  const lines = [
    "# V7 PENGU Early Profit Reentry Test",
    "",
    "| period | variant | End Equity | vs current | MaxDD | PF | trades | PENGU PnL | early exits | reentries | sec |",
    "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) => `| ${row.period} | ${row.variant} | ${row.endEquity.toLocaleString()} | ${row.vsCurrent.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.earlyExits} | ${row.reentries} | ${row.elapsedSec} |`),
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
