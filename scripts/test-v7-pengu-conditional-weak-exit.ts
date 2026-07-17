import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import type { HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-pengu-conditional-weak-exit");
const START_TS = process.env.START ? Date.parse(process.env.START) : Date.UTC(2022, 0, 1);
const END_TS = process.env.END ? Date.parse(process.env.END) : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const PATTERN_FILTER = process.env.PATTERN ? new Set(process.env.PATTERN.split(",").map((item) => item.trim()).filter(Boolean)) : null;
const PATTERN_LIMIT = process.env.PATTERN_LIMIT ? Number(process.env.PATTERN_LIMIT) : null;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  return {
    ...(buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    ...extra,
  };
}

function groupLosses(trades: Array<{ exit_reason: string; net_pnl: number }>) {
  const rows = new Map<string, { exitReason: string; count: number; pnl: number }>();
  for (const trade of trades.filter((row) => row.net_pnl < 0)) {
    const row = rows.get(trade.exit_reason) ?? { exitReason: trade.exit_reason, count: 0, pnl: 0 };
    row.count += 1;
    row.pnl += trade.net_pnl;
    rows.set(trade.exit_reason, row);
  }
  return [...rows.values()]
    .sort((left, right) => left.pnl - right.pnl)
    .map((row) => ({ ...row, pnl: round(row.pnl) }));
}

async function runCase(label: string, options: HybridVariantOptions) {
  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", { ...options, label });
  const pengu = result.trade_pairs.filter((trade) => trade.symbol === "PENGU");
  const idleTimeLoss = pengu
    .filter((trade) => trade.exit_reason === "idle-breakout-time" && trade.net_pnl < 0)
    .reduce((sum, trade) => sum + trade.net_pnl, 0);
  const weakExit = pengu.filter((trade) => trade.exit_reason === "idle-breakout-weak-exit");
  const worst = result.trade_pairs
    .filter((trade) => trade.net_pnl < 0)
    .sort((left, right) => left.net_pnl - right.net_pnl)
    .slice(0, 10)
    .map((trade) => ({
      symbol: trade.symbol,
      entry: trade.entry_time,
      exit: trade.exit_time,
      pnl: round(trade.net_pnl),
      exitReason: trade.exit_reason,
      movePct: round(((trade.exit_price / trade.entry_price) - 1) * 100, 2),
    }));

  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    penguTrades: pengu.length,
    penguPnl: round(pengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    penguLosses: pengu.filter((trade) => trade.net_pnl < 0).length,
    penguWeakExitTrades: weakExit.length,
    penguWeakExitPnl: round(weakExit.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    penguIdleTimeLoss: round(idleTimeLoss),
    lossByExitReason: groupLosses(result.trade_pairs),
    worst,
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows[0]?.endEquity ?? 0;
  return [
    "# V7 PENGU Conditional Weak Exit",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- purpose: avoid fixed stop-loss; exit only when PENGU is in loss and momentum/reversal evidence is gone",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "| pattern | End Equity | diff | MaxDD | PF | trades | PENGU PnL | PENGU losses | weak exits | weak exit PnL | idle time loss | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => [
      `| ${row.label}`,
      row.endEquity.toLocaleString(),
      round(row.endEquity - baseline).toLocaleString(),
      `${row.maxDrawdownPct}%`,
      row.profitFactor,
      row.trades,
      row.penguPnl.toLocaleString(),
      row.penguLosses,
      row.penguWeakExitTrades,
      row.penguWeakExitPnl.toLocaleString(),
      row.penguIdleTimeLoss.toLocaleString(),
      `${row.elapsedSec}s |`,
    ].join(" | ")),
    "",
    "## Worst Trades",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "",
      "| symbol | entry | exit | move | pnl | exit |",
      "| --- | --- | --- | ---: | ---: | --- |",
      ...row.worst.map((trade) => `| ${trade.symbol} | ${trade.entry} | ${trade.exit} | ${trade.movePct}% | ${trade.pnl.toLocaleString()} | ${trade.exitReason} |`),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const patterns: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_v7", {}],
    ["loss_only_current_thresholds", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
    }],
    ["loss_2pct_mom05_accel0_sma", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.02,
      idleBreakoutWeakExitMom20Below: 0.05,
      idleBreakoutWeakExitMomAccelBelow: 0,
      idleBreakoutWeakExitMinHoldBars: 4,
      idleBreakoutWeakExitRequireCloseBelowSma40: true,
    }],
    ["loss_3pct_mom05_accel_neg005_sma", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.03,
      idleBreakoutWeakExitMom20Below: 0.05,
      idleBreakoutWeakExitMomAccelBelow: -0.005,
      idleBreakoutWeakExitMinHoldBars: 4,
      idleBreakoutWeakExitRequireCloseBelowSma40: true,
    }],
    ["loss_5pct_mom07_accel0_sma", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.05,
      idleBreakoutWeakExitMom20Below: 0.07,
      idleBreakoutWeakExitMomAccelBelow: 0,
      idleBreakoutWeakExitMinHoldBars: 4,
      idleBreakoutWeakExitRequireCloseBelowSma40: true,
    }],
    ["loss_3pct_mom05_accel0_no_sma", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.03,
      idleBreakoutWeakExitMom20Below: 0.05,
      idleBreakoutWeakExitMomAccelBelow: 0,
      idleBreakoutWeakExitMinHoldBars: 4,
      idleBreakoutWeakExitRequireCloseBelowSma40: false,
    }],
    ["loss_2pct_mom03_accel_neg01_sma_hold2", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.02,
      idleBreakoutWeakExitMom20Below: 0.03,
      idleBreakoutWeakExitMomAccelBelow: -0.01,
      idleBreakoutWeakExitMinHoldBars: 2,
      idleBreakoutWeakExitRequireCloseBelowSma40: true,
    }],
    ["loss_1pct_mom08_accel005_no_sma_hold1", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.01,
      idleBreakoutWeakExitMom20Below: 0.08,
      idleBreakoutWeakExitMomAccelBelow: 0.005,
      idleBreakoutWeakExitMinHoldBars: 1,
      idleBreakoutWeakExitRequireCloseBelowSma40: false,
    }],
    ["loss_0pct_mom10_accel01_no_sma_hold1", {
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0,
      idleBreakoutWeakExitMom20Below: 0.1,
      idleBreakoutWeakExitMomAccelBelow: 0.01,
      idleBreakoutWeakExitMinHoldBars: 1,
      idleBreakoutWeakExitRequireCloseBelowSma40: false,
    }],
  ];

  const rows = [];
  const selectedPatterns = patterns
    .filter(([label]) => !PATTERN_FILTER || PATTERN_FILTER.has(label))
    .slice(0, PATTERN_LIMIT && PATTERN_LIMIT > 0 ? PATTERN_LIMIT : patterns.length);

  for (const [label, extra] of selectedPatterns) {
    console.log(`running ${label}`);
    rows.push(await runCase(label, baseOptions(extra)));
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.json"), JSON.stringify(rows, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.md"), toMarkdown(rows), "utf8");
  }

  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
