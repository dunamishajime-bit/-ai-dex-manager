import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-eth-doge-refine");
const START_TS = Date.UTC(2022, 0, 1);
const END_TS = Date.UTC(2026, 3, 29, 23, 59, 59, 999);

type Case = [string, Partial<HybridVariantOptions>, string];

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

function withWeakExit(symbols: string[], mom20BySymbol: Record<string, number>, momAccelBySymbol: Record<string, number>): Partial<HybridVariantOptions> {
  return {
    symbolSpecificTrendWeakExitSymbols: symbols,
    symbolSpecificTrendWeakExitMom20BelowBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.symbolSpecificTrendWeakExitMom20BelowBySymbol ?? {}),
      ...mom20BySymbol,
    },
    symbolSpecificTrendWeakExitMomAccelBelowBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.symbolSpecificTrendWeakExitMomAccelBelowBySymbol ?? {}),
      ...momAccelBySymbol,
    },
  };
}

function withPartial(symbol: "ETH" | "DOGE", baseTakeProfitPct: number, strongTakeProfitPct: number, trailPct: number): Partial<HybridVariantOptions> {
  return {
    partialExitBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.partialExitBySymbol ?? {}),
      [symbol]: {
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

function symbolPnl(trades: Array<{ symbol: string; net_pnl: number }>, symbol: string) {
  return round(trades.filter((trade) => trade.symbol === symbol).reduce((sum, trade) => sum + trade.net_pnl, 0));
}

async function runCase(label: string, extra: Partial<HybridVariantOptions>, group: string) {
  const started = Date.now();
  const result = await runHybridBacktest("RETQ22", baseOptions({ ...extra, label }));
  const trades = result.trade_pairs;
  const ethTrades = trades.filter((trade) => trade.symbol === "ETH");
  const dogeTrades = trades.filter((trade) => trade.symbol === "DOGE");
  return {
    group,
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: symbolPnl(trades, "PENGU"),
    ethPnl: symbolPnl(trades, "ETH"),
    ethTrades: ethTrades.length,
    ethWins: ethTrades.filter((trade) => trade.net_pnl > 0).length,
    dogePnl: symbolPnl(trades, "DOGE"),
    dogeTrades: dogeTrades.length,
    dogeWins: dogeTrades.filter((trade) => trade.net_pnl > 0).length,
    twtPnl: symbolPnl(trades, "TWT"),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows.find((row) => row.label === "current_v7")?.endEquity ?? rows[0]?.endEquity ?? 0;
  const best = [...rows].sort((left, right) => right.endEquity - left.endEquity)[0];
  return [
    "# V7 ETH/DOGE Refine",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- target: ETH/DOGE loss reduction without repeating simple cash-instead tests",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    best ? `- best: ${best.label} (${best.group}) End Equity ${best.endEquity.toLocaleString()}` : "",
    "",
    "| group | pattern | End Equity | vs current | MaxDD | PF | trades | exposure | PENGU | ETH | ETH W/L | DOGE | DOGE W/L | TWT | elapsed |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.group} | ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.ethPnl.toLocaleString()} | ${row.ethWins}/${row.ethTrades - row.ethWins} | ${row.dogePnl.toLocaleString()} | ${row.dogeWins}/${row.dogeTrades - row.dogeWins} | ${row.twtPnl.toLocaleString()} | ${row.elapsedSec}s |`),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const currentWeakSymbols = RECLAIM_HYBRID_EXECUTION_PROFILE.symbolSpecificTrendWeakExitSymbols ?? [];
  const currentWeakWithDoge = [...new Set([...currentWeakSymbols, "DOGE"])];
  const currentWeakWithEthDoge = [...new Set([...currentWeakSymbols, "ETH", "DOGE"])];

  const cases: Case[] = [
    ["current_v7", {}, "baseline"],
    ["doge_weak_exit_mom07_accel0", withWeakExit(currentWeakWithDoge, { DOGE: 0.07 }, { DOGE: 0 }), "doge-weak-exit"],
    ["doge_weak_exit_mom10_accel0", withWeakExit(currentWeakWithDoge, { DOGE: 0.10 }, { DOGE: 0 }), "doge-weak-exit"],
    ["doge_weak_exit_mom12_accel0", withWeakExit(currentWeakWithDoge, { DOGE: 0.12 }, { DOGE: 0 }), "doge-weak-exit"],
    ["doge_weak_exit_mom10_accel005", withWeakExit(currentWeakWithDoge, { DOGE: 0.10 }, { DOGE: 0.005 }), "doge-weak-exit"],
    ["eth_doge_weak_exit_mom10", withWeakExit(currentWeakWithEthDoge, { ETH: 0.10, DOGE: 0.10 }, { ETH: 0, DOGE: 0 }), "combined-weak-exit"],
    ["weak_market_block_add_doge", { trendWeakMarketBlockSymbols: ["ETH", "INJ", "SOL", "DOGE"] }, "weak-market-block"],
    ["weak_market_block_add_doge_loose", {
      trendWeakMarketBlockSymbols: ["ETH", "INJ", "SOL", "DOGE"],
      trendWeakMarketBlockBestMom20Below: 0.12,
      trendWeakMarketBlockBtcAdxBelow: 22,
    }, "weak-market-block"],
    ["doge_partial_10_18_trail6", withPartial("DOGE", 0.10, 0.18, 0.06), "partial"],
    ["doge_partial_08_16_trail5", withPartial("DOGE", 0.08, 0.16, 0.05), "partial"],
    ["eth_partial_06_12_trail4", withPartial("ETH", 0.06, 0.12, 0.04), "partial"],
    ["eth_doge_partial_combo", {
      partialExitBySymbol: {
        ...(RECLAIM_HYBRID_EXECUTION_PROFILE.partialExitBySymbol ?? {}),
        ETH: {
          fraction: 0.5,
          baseTakeProfitPct: 0.06,
          strongTakeProfitPct: 0.12,
          runnerTrailActivationPct: 0.12,
          runnerTrailRetracePct: 0.04,
          stopAfterPartialPct: 0.02,
          strongMinMomAccel: 0.015,
          strongMinVolumeRatio: 1.15,
        },
        DOGE: {
          fraction: 0.5,
          baseTakeProfitPct: 0.08,
          strongTakeProfitPct: 0.16,
          runnerTrailActivationPct: 0.16,
          runnerTrailRetracePct: 0.05,
          stopAfterPartialPct: 0.025,
          strongMinMomAccel: 0.015,
          strongMinVolumeRatio: 1.15,
        },
      },
    }, "partial"],
  ];

  const rows = [];
  for (const [label, extra, group] of cases) {
    console.log(`running ${label}`);
    rows.push(await runCase(label, extra, group));
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
