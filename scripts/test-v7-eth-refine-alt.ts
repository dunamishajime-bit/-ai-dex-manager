import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-eth-refine-alt");
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

function dogePartial(): Partial<HybridVariantOptions> {
  return {
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
  };
}

function ethFilter(extra: Partial<HybridVariantOptions>): Partial<HybridVariantOptions> {
  return {
    ...extra,
    trendBreakoutLookbackBarsBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.trendBreakoutLookbackBarsBySymbol ?? {}),
      ...(extra.trendBreakoutLookbackBarsBySymbol ?? {}),
    },
    trendBreakoutMinPctBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.trendBreakoutMinPctBySymbol ?? {}),
      ...(extra.trendBreakoutMinPctBySymbol ?? {}),
    },
    trendMinVolumeRatioBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.trendMinVolumeRatioBySymbol ?? {}),
      ...(extra.trendMinVolumeRatioBySymbol ?? {}),
    },
    trendMinMomAccelBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.trendMinMomAccelBySymbol ?? {}),
      ...(extra.trendMinMomAccelBySymbol ?? {}),
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.trendMinEfficiencyRatioBySymbol ?? {}),
      ...(extra.trendMinEfficiencyRatioBySymbol ?? {}),
    },
    trendScoreAdjustmentBySymbol: {
      ...(RECLAIM_HYBRID_EXECUTION_PROFILE.trendScoreAdjustmentBySymbol ?? {}),
      ...(extra.trendScoreAdjustmentBySymbol ?? {}),
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
    penguPnl: symbolPnl(trades, "PENGU"),
    ethPnl: symbolPnl(trades, "ETH"),
    ethWins: ethTrades.filter((trade) => trade.net_pnl > 0).length,
    ethLosses: ethTrades.filter((trade) => trade.net_pnl <= 0).length,
    dogePnl: symbolPnl(trades, "DOGE"),
    dogeWins: dogeTrades.filter((trade) => trade.net_pnl > 0).length,
    dogeLosses: dogeTrades.filter((trade) => trade.net_pnl <= 0).length,
    twtPnl: symbolPnl(trades, "TWT"),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows.find((row) => row.label === "current_v7")?.endEquity ?? rows[0]?.endEquity ?? 0;
  const sorted = [...rows].sort((left, right) => right.endEquity - left.endEquity);
  return [
    "# V7 ETH Refine Alternative",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- DOGE main candidate kept separate; ETH tested by stricter entry quality and priority downgrade",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    `- best: ${sorted[0]?.label ?? "-"} End Equity ${sorted[0]?.endEquity.toLocaleString() ?? "-"}`,
    "",
    "| rank | group | pattern | End Equity | vs current | MaxDD | PF | trades | PENGU | ETH | ETH W/L | DOGE | DOGE W/L | TWT | elapsed |",
    "| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...sorted.map((row, index) => `| ${index + 1} | ${row.group} | ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.penguPnl.toLocaleString()} | ${row.ethPnl.toLocaleString()} | ${row.ethWins}/${row.ethLosses} | ${row.dogePnl.toLocaleString()} | ${row.dogeWins}/${row.dogeLosses} | ${row.twtPnl.toLocaleString()} | ${row.elapsedSec}s |`),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const doge = dogePartial();
  const cases: Array<[string, Partial<HybridVariantOptions>, string]> = [
    ["current_v7", {}, "baseline"],
    ["doge_partial_best", doge, "doge-main"],
    ["eth_score_minus5", ethFilter({ trendScoreAdjustmentBySymbol: { ETH: -5 } }), "eth-priority"],
    ["eth_score_minus10", ethFilter({ trendScoreAdjustmentBySymbol: { ETH: -10 } }), "eth-priority"],
    ["eth_score_minus15", ethFilter({ trendScoreAdjustmentBySymbol: { ETH: -15 } }), "eth-priority"],
    ["eth_breakout_8_1pct", ethFilter({ trendBreakoutLookbackBarsBySymbol: { ETH: 8 }, trendBreakoutMinPctBySymbol: { ETH: 0.01 } }), "eth-breakout"],
    ["eth_breakout_8_2pct", ethFilter({ trendBreakoutLookbackBarsBySymbol: { ETH: 8 }, trendBreakoutMinPctBySymbol: { ETH: 0.02 } }), "eth-breakout"],
    ["eth_volume_110", ethFilter({ trendMinVolumeRatioBySymbol: { ETH: 1.10 } }), "eth-volume"],
    ["eth_accel_005", ethFilter({ trendMinMomAccelBySymbol: { ETH: 0.005 } }), "eth-accel"],
    ["eth_eff_030", ethFilter({ trendMinEfficiencyRatioBySymbol: { ETH: 0.30 } }), "eth-efficiency"],
    ["eth_quality_combo_light", ethFilter({
      trendBreakoutLookbackBarsBySymbol: { ETH: 8 },
      trendBreakoutMinPctBySymbol: { ETH: 0.01 },
      trendMinVolumeRatioBySymbol: { ETH: 1.05 },
      trendMinMomAccelBySymbol: { ETH: 0.005 },
      trendMinEfficiencyRatioBySymbol: { ETH: 0.24 },
    }), "eth-combo"],
    ["doge_best_eth_score_minus5", { ...doge, ...ethFilter({ trendScoreAdjustmentBySymbol: { ETH: -5 } }) }, "combo"],
    ["doge_best_eth_quality_light", { ...doge, ...ethFilter({
      trendBreakoutLookbackBarsBySymbol: { ETH: 8 },
      trendBreakoutMinPctBySymbol: { ETH: 0.01 },
      trendMinVolumeRatioBySymbol: { ETH: 1.05 },
      trendMinMomAccelBySymbol: { ETH: 0.005 },
      trendMinEfficiencyRatioBySymbol: { ETH: 0.24 },
    }) }, "combo"],
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
