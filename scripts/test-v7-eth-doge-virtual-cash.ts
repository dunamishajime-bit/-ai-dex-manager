import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-eth-doge-virtual-cash");
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

function symbolPnl(trades: Array<{ symbol: string; net_pnl: number }>, symbol: string) {
  return round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.net_pnl, 0));
}

async function runCase(label: string, extra: Partial<HybridVariantOptions>) {
  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", baseOptions({ ...extra, label }));
  const trades = result.trade_pairs;
  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: symbolPnl(trades, "PENGU"),
    ethPnl: symbolPnl(trades, "ETH"),
    ethTrades: trades.filter((trade) => trade.symbol === "ETH").length,
    dogePnl: symbolPnl(trades, "DOGE"),
    dogeTrades: trades.filter((trade) => trade.symbol === "DOGE").length,
    twtPnl: symbolPnl(trades, "TWT"),
    solPnl: symbolPnl(trades, "SOL"),
    avaxPnl: symbolPnl(trades, "AVAX"),
    injPnl: symbolPnl(trades, "INJ"),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows.find((row) => row.label === "current_v7")?.endEquity ?? rows[0]?.endEquity ?? 0;
  const best = [...rows].sort((left, right) => right.endEquity - left.endEquity)[0];
  return [
    "# V7 ETH/DOGE Virtual Cash",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- idea: when ETH/DOGE trend entry fires, keep real funds in USDT but track a virtual ETH/DOGE holding for later rotation signals",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    best ? `- best: ${best.label} End Equity ${best.endEquity.toLocaleString()}` : "",
    "",
    "| pattern | End Equity | vs current | MaxDD | PF | trades | exposure | PENGU | ETH | ETH trades | DOGE | DOGE trades | TWT | SOL | AVAX | INJ | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.ethPnl.toLocaleString()} | ${row.ethTrades} | ${row.dogePnl.toLocaleString()} | ${row.dogeTrades} | ${row.twtPnl.toLocaleString()} | ${row.solPnl.toLocaleString()} | ${row.avaxPnl.toLocaleString()} | ${row.injPnl.toLocaleString()} | ${row.elapsedSec}s |`),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const cases: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_v7", {}],
    ["eth_virtual_cash", { trendVirtualCashInsteadOfEntrySymbols: ["ETH"] }],
    ["doge_virtual_cash", { trendVirtualCashInsteadOfEntrySymbols: ["DOGE"] }],
    ["eth_doge_virtual_cash", { trendVirtualCashInsteadOfEntrySymbols: ["ETH", "DOGE"] }],
    ["eth_doge_virtual_cash_doge_partial", {
      trendVirtualCashInsteadOfEntrySymbols: ["ETH", "DOGE"],
      partialExitBySymbol: {
        ...(RECLAIM_HYBRID_EXECUTION_PROFILE.partialExitBySymbol ?? {}),
        DOGE: {
          fraction: 0.5,
          baseTakeProfitPct: 0.08,
          strongTakeProfitPct: 0.16,
          runnerTrailActivationPct: 0.16,
          runnerTrailRetracePct: 0.04,
          stopAfterPartialPct: 0.02,
          strongMinMomAccel: 0.015,
          strongMinVolumeRatio: 1.15,
        },
      },
    }],
  ];

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
