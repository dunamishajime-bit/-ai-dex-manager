import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-doge-partial-grid");
const START_TS = Date.UTC(2022, 0, 1);
const END_TS = Date.UTC(2026, 3, 29, 23, 59, 59, 999);

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

function dogePartial(baseTakeProfitPct: number, strongTakeProfitPct: number, trailPct: number): Partial<HybridVariantOptions> {
  return {
    partialExitBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.partialExitBySymbol ?? {}),
      DOGE: {
        fraction: 0.5,
        baseTakeProfitPct,
        strongTakeProfitPct,
        runnerTrailActivationPct: strongTakeProfitPct,
        runnerTrailRetracePct: trailPct,
        stopAfterPartialPct: Math.max(0.02, trailPct / 2),
        strongMinMomAccel: 0.015,
        strongMinVolumeRatio: 1.15,
      },
    },
  };
}

async function runCase(label: string, extra: Partial<HybridVariantOptions>) {
  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", baseOptions({ ...extra, label }));
  const trades = result.trade_pairs;
  const dogeTrades = trades.filter((trade) => trade.symbol === "DOGE");
  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    dogePnl: round(dogeTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    dogeWins: dogeTrades.filter((trade) => trade.net_pnl > 0).length,
    dogeLosses: dogeTrades.filter((trade) => trade.net_pnl <= 0).length,
    penguPnl: round(trades.filter((trade) => trade.symbol === "PENGU").reduce((sum, trade) => sum + trade.net_pnl, 0)),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows.find((row) => row.label === "current_v7")?.endEquity ?? 198_190_075.13;
  const sorted = [...rows].sort((left, right) => right.endEquity - left.endEquity);
  return [
    "# V7 DOGE Partial Grid",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- target: DOGE partial profit-taking only",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    `- best: ${sorted[0]?.label ?? "-"} End Equity ${sorted[0]?.endEquity.toLocaleString() ?? "-"}`,
    "",
    "| rank | pattern | End Equity | vs current | MaxDD | PF | trades | DOGE PnL | DOGE W/L | PENGU PnL | elapsed |",
    "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...sorted.map((row, index) => `| ${index + 1} | ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.dogePnl.toLocaleString()} | ${row.dogeWins}/${row.dogeLosses} | ${row.penguPnl.toLocaleString()} | ${row.elapsedSec}s |`),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const cases: Array<[string, Partial<HybridVariantOptions>]> = [["current_v7", {}]];
  for (const base of [0.06, 0.07, 0.08, 0.09, 0.10]) {
    for (const strong of [0.14, 0.16, 0.18]) {
      for (const trail of [0.04, 0.05, 0.06]) {
        if (strong <= base) continue;
        cases.push([`doge_partial_${Math.round(base * 100)}_${Math.round(strong * 100)}_trail${Math.round(trail * 100)}`, dogePartial(base, strong, trail)]);
      }
    }
  }

  const rows = [];
  for (const [label, extra] of cases) {
    console.log(`running ${label}`);
    rows.push(await runCase(label, extra));
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
