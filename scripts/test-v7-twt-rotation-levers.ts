import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-twt-rotation-levers");
const START_TS = process.env.START ? Date.parse(`${process.env.START}T00:00:00.000Z`) : Date.UTC(2022, 0, 1);
const END_TS = process.env.END ? Date.parse(`${process.env.END}T23:59:59.999Z`) : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const PATTERN = process.env.PATTERN ? new Set(process.env.PATTERN.split(",").map((value) => value.trim()).filter(Boolean)) : null;

const ALL_NON_PENGU = ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"] as const;
const CORE_LOSSY = ["ETH", "DOGE"] as const;
const CURRENT_ROTATION = ["ETH", "SOL", "AVAX", "INJ"] as const;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function options(extra: Partial<HybridVariantOptions> = {}): HybridVariantOptions {
  return {
    ...(buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    ...extra,
  };
}

function twtRotation(extra: Partial<HybridVariantOptions>): Partial<HybridVariantOptions> {
  return {
    penguOffRotationEntry: true,
    penguOffRotationSymbols: ["TWT"],
    penguOffRotationAllowFromCash: false,
    penguOffRotationAllowWhileHolding: true,
    penguOffRotationAllowTradeGateOff: true,
    penguOffRotationMinHoldBars: 2,
    penguOffRotationMaxNotionalUsd: null,
    trendProfitTrailActivationPctBySymbol: {
      TWT: 0.22,
    },
    trendProfitTrailRetracePctBySymbol: {
      TWT: 0.08,
    },
    trendBreakoutLookbackBarsBySymbol: {
      TWT: 8,
    },
    trendBreakoutMinPctBySymbol: {
      TWT: 0.012,
    },
    trendMinVolumeRatioBySymbol: {
      TWT: 1.01,
    },
    trendMinMomAccelBySymbol: {
      TWT: 0.0005,
    },
    trendMinEfficiencyRatioBySymbol: {
      TWT: 0.17,
    },
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
  const result = await runHybridBacktest("RETQ22", options({ ...extra, label }));
  const trades = result.trade_pairs;
  const twtTrades = trades.filter((trade) => trade.symbol === "TWT");
  const twtRotationTrades = trades.filter((trade) => trade.entry_reason?.includes("pengu-off-rotation") && trade.symbol === "TWT");
  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    twtPnl: round(twtTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    twtTrades: twtTrades.length,
    twtRotationTrades: twtRotationTrades.length,
    symbolRows: symbolRows(trades),
    twtRotationRows: twtRotationTrades.map((trade) => ({
      entry: trade.entry_time,
      exit: trade.exit_time,
      pnl: round(trade.net_pnl),
      reason: trade.exit_reason,
    })),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows.find((row) => row.label === "current_v7")?.endEquity ?? rows[0]?.endEquity ?? 0;
  const best = [...rows].sort((left, right) => right.endEquity - left.endEquity)[0];
  return [
    "# V7 TWT Rotation Levers",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- baseline includes ETH 20% + DOGE 1/3 allocation",
    "- tested: TWT as a while-holding rotation target, including 15m monitoring",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    best ? `- best: ${best.label} End Equity ${best.endEquity.toLocaleString()}` : "",
    "",
    "| pattern | End Equity | vs current | MaxDD | PF | trades | exposure | TWT PnL | TWT trades | TWT rotation entries | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.twtPnl.toLocaleString()} | ${row.twtTrades} | ${row.twtRotationTrades} | ${row.elapsedSec}s |`),
    "",
    "## Symbol PnL",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "",
      "| symbol | pnl | trades |",
      "| --- | ---: | ---: |",
      ...row.symbolRows.map((symbol) => `| ${symbol.symbol} | ${symbol.pnl.toLocaleString()} | ${symbol.trades} |`),
      "",
    ]),
    "## TWT Rotation Entries",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "",
      "| entry | exit | pnl | exit |",
      "| --- | --- | ---: | --- |",
      ...(row.twtRotationRows.length ? row.twtRotationRows.map((trade) => `| ${trade.entry} | ${trade.exit} | ${trade.pnl.toLocaleString()} | ${trade.reason} |`) : ["| - | - | 0 | none |"]),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const patterns: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_v7", {}],
    ["twt_1h_all_gap0", twtRotation({ penguOffRotationTimeframe: "1h", penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 0 })],
    ["twt_1h_all_gap5", twtRotation({ penguOffRotationTimeframe: "1h", penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 5 })],
    ["twt_1h_all_gap10", twtRotation({ penguOffRotationTimeframe: "1h", penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 10 })],
    ["twt_15m_all_gap10", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 10 })],
    ["twt_15m_all_gap15", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 15 })],
    ["twt_15m_all_gap20", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 20 })],
    ["twt_15m_eth_doge_gap10", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: CORE_LOSSY, penguOffRotationScoreGap: 10 })],
    ["twt_15m_eth_doge_gap15", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: CORE_LOSSY, penguOffRotationScoreGap: 15 })],
    ["twt_15m_current_rotation_gap10", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: CURRENT_ROTATION, penguOffRotationScoreGap: 10 })],
    ["twt_15m_current_rotation_gap15", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: CURRENT_ROTATION, penguOffRotationScoreGap: 15 })],
    ["twt_15m_all_gap15_hold4", twtRotation({ penguOffRotationTimeframe: "15m", penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 15, penguOffRotationMinHoldBars: 4 })],
    ["twt_15m_all_gap15_strict_quality", twtRotation({
      penguOffRotationTimeframe: "15m",
      penguOffRotationCurrentSymbols: ALL_NON_PENGU,
      penguOffRotationScoreGap: 15,
      trendBreakoutMinPctBySymbol: { TWT: 0.018 },
      trendMinVolumeRatioBySymbol: { TWT: 1.12 },
      trendMinEfficiencyRatioBySymbol: { TWT: 0.2 },
    })],
  ].filter(([label]) => !PATTERN || PATTERN.has(label));

  const rows = [];
  for (const [label, extra] of patterns) {
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
