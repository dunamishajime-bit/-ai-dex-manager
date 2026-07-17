import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-live-runner-risk");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2024, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 22, 23, 59, 59, 999);

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

function symbolRows(trades: Array<{ symbol: string; net_pnl: number }>) {
  const rows = new Map<string, { symbol: string; trades: number; pnl: number }>();
  for (const trade of trades) {
    const row = rows.get(trade.symbol) ?? { symbol: trade.symbol, trades: 0, pnl: 0 };
    row.trades += 1;
    row.pnl += trade.net_pnl;
    rows.set(trade.symbol, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, pnl: round(row.pnl) }))
    .sort((left, right) => Math.abs(right.pnl) - Math.abs(left.pnl));
}

async function runCase(label: string, extra: Partial<HybridVariantOptions>) {
  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", baseOptions({ ...extra, label }));
  const runnerTrades = result.trade_pairs.filter((trade) => trade.entry_reason.includes("idle-breakout-entry"));
  const runnerSymbols = ["PENGU", "APE", "COS", "MITO"];
  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    runnerTrades: runnerTrades.length,
    runnerWins: runnerTrades.filter((trade) => trade.net_pnl > 0).length,
    runnerPnl: round(runnerTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    runnerSymbolPnl: Object.fromEntries(runnerSymbols.map((symbol) => [
      symbol,
      {
        trades: runnerTrades.filter((trade) => trade.symbol === symbol).length,
        pnl: round(runnerTrades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.net_pnl, 0)),
      },
    ])),
    symbols: symbolRows(result.trade_pairs),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows[0]?.endEquity ?? 0;
  return [
    "# V7 Live Runner Risk",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: engine-direct RETQ22, cash-rescue profile",
    "",
    "| case | End Equity | diff | MaxDD | PF | trades | runner trades | runner W/L | runner PnL | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.runnerTrades} | ${row.runnerWins}/${row.runnerTrades - row.runnerWins} | ${row.runnerPnl.toLocaleString()} | ${row.elapsedSec}s |`),
    "",
    "## Runner Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "",
      "| symbol | trades | pnl |",
      "| --- | ---: | ---: |",
      ...Object.entries(row.runnerSymbolPnl).map(([symbol, stats]) => `| ${symbol} | ${stats.trades} | ${stats.pnl.toLocaleString()} |`),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const cases: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_live", {}],
    ["runner_off", { idleBreakoutEntryWhileCash: false, idleBreakoutSymbols: [] }],
    ["runner_pengu_only", { idleBreakoutSymbols: ["PENGU"] }],
    ["runner_pengu_ape_only", { idleBreakoutSymbols: ["PENGU", "APE"] }],
    ["runner_no_cos_mito", { idleBreakoutSymbols: ["PENGU", "APE"] }],
    ["runner_strict_all", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutBreakoutMinPct: 0.024,
      idleBreakoutMinVolumeRatio: 1.35,
      idleBreakoutMinEfficiencyRatio: 0.18,
      idleBreakoutMinMomAccel: 0,
    }],
    ["runner_strict_more", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutBreakoutMinPct: 0.03,
      idleBreakoutMinVolumeRatio: 1.5,
      idleBreakoutMinEfficiencyRatio: 0.22,
      idleBreakoutMinMomAccel: 0.002,
    }],
    ["runner_weak_loss_only", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutWeakExitOnlyWhenLoss: true,
    }],
    ["runner_weak_min_loss_1pct", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.01,
    }],
    ["runner_weak_min_loss_2pct", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutWeakExitOnlyWhenLoss: true,
      idleBreakoutWeakExitMinLossPct: 0.02,
    }],
    ["runner_weak_later12", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutWeakExitMinHoldBars: 12,
    }],
    ["runner_weak_later16", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutWeakExitMinHoldBars: 16,
    }],
    ["runner_weak_looser_mom", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutWeakExitMinHoldBars: 12,
      idleBreakoutWeakExitMom20Below: 0,
      idleBreakoutWeakExitMomAccelBelow: -0.015,
    }],
    ["runner_failure_exit", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutFailureExitBySymbol: {
        PENGU: { minHoldBars: 6, maxPeakProfitPct: 0.015, requireLoss: true, maxMom20: 0.01, maxMomAccel: -0.01, requireCloseBelowSma40: true },
        APE: { minHoldBars: 6, maxPeakProfitPct: 0.015, requireLoss: true, maxMom20: 0.01, maxMomAccel: -0.01, requireCloseBelowSma40: true },
        COS: { minHoldBars: 6, maxPeakProfitPct: 0.015, requireLoss: true, maxMom20: 0.01, maxMomAccel: -0.01, requireCloseBelowSma40: true },
        MITO: { minHoldBars: 6, maxPeakProfitPct: 0.015, requireLoss: true, maxMom20: 0.01, maxMomAccel: -0.01, requireCloseBelowSma40: true },
      },
    }],
    ["runner_sma_risk_guard", {
      idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutSmaBreakGuardSymbols: ["PENGU", "APE", "COS", "MITO"],
      idleBreakoutSmaBreakGuardMinHoldBars: 6,
      idleBreakoutSmaBreakGuardMaxCloseBelowSmaPct: 0.008,
      idleBreakoutSmaBreakGuardMinMom20: 0,
      idleBreakoutSmaBreakGuardMinMomAccel: -0.006,
    }],
  ];
  const rows = [];
  for (const [label, extra] of cases) {
    console.log(`running ${label}`);
    rows.push(await runCase(label, extra));
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.json"), JSON.stringify(rows, null, 2), "utf8");
  }
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
