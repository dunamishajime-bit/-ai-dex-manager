import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-twt-rebound12-integration");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const PATTERN = process.env.PATTERN
  ? new Set(process.env.PATTERN.split(",").map((value) => value.trim()).filter(Boolean))
  : null;

const ALL_NON_PENGU = ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"] as const;
const LOSSY_CORE = ["ETH", "DOGE"] as const;
const CURRENT_HOLD_CANDIDATES = ["ETH", "SOL", "INJ"] as const;
const LARGE_ROTATION = ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI"] as const;

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

function twt12(params: {
  lookback: number;
  breakout: number;
  volumeRatio: number;
  accel: number;
  efficiency: number;
  trailAct: number;
  trailRetrace: number;
  maxHold: number;
}, extra: Partial<HybridVariantOptions> = {}): Partial<HybridVariantOptions> {
  return {
    penguOffRotationEntry: true,
    penguOffRotationSymbols: ["TWT"],
    penguOffRotationTimeframe: "12h",
    penguOffRotationAllowTradeGateOff: true,
    penguOffRotationMinHoldBars: 2,
    penguOffRotationMaxNotionalUsd: null,
    trendBreakoutLookbackBarsBySymbol: { TWT: params.lookback },
    trendBreakoutMinPctBySymbol: { TWT: params.breakout },
    trendMinVolumeRatioBySymbol: { TWT: params.volumeRatio },
    trendMinMomAccelBySymbol: { TWT: params.accel },
    trendMinEfficiencyRatioBySymbol: { TWT: params.efficiency },
    trendProfitTrailActivationPctBySymbol: { TWT: params.trailAct },
    trendProfitTrailRetracePctBySymbol: { TWT: params.trailRetrace },
    trendMaxHoldBarsBySymbol: { TWT: params.maxHold },
    ...extra,
  };
}

function twtRebound12(extra: Partial<HybridVariantOptions> = {}): Partial<HybridVariantOptions> {
  return twt12({
    lookback: 5,
    breakout: 0.004,
    volumeRatio: 0.75,
    accel: 0.01,
    efficiency: 0.16,
    trailAct: 0.05,
    trailRetrace: 0.025,
    maxHold: 4,
  }, extra);
}

function twtFast12(extra: Partial<HybridVariantOptions> = {}): Partial<HybridVariantOptions> {
  return twt12({
    lookback: 6,
    breakout: 0.006,
    volumeRatio: 0.8,
    accel: 0,
    efficiency: 0.12,
    trailAct: 0.06,
    trailRetrace: 0.035,
    maxHold: 6,
  }, extra);
}

function twtQuality12(extra: Partial<HybridVariantOptions> = {}): Partial<HybridVariantOptions> {
  return twt12({
    lookback: 8,
    breakout: 0.01,
    volumeRatio: 0.9,
    accel: 0.005,
    efficiency: 0.18,
    trailAct: 0.12,
    trailRetrace: 0.06,
    maxHold: 10,
  }, extra);
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
  const trades = result.trade_pairs;
  const twtTrades = trades.filter((trade) => trade.symbol === "TWT");
  const twtRotationTrades = twtTrades.filter((trade) => trade.entry_reason?.includes("pengu-off-rotation"));
  const twtTimeExits = twtTrades.filter((trade) => trade.exit_reason === "trend-time");
  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    winRatePct: round(result.summary.win_rate_pct),
    exposurePct: round(result.summary.exposure_pct),
    twtPnl: round(twtTrades.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    twtTrades: twtTrades.length,
    twtRotationTrades: twtRotationTrades.length,
    twtTimeExits: twtTimeExits.length,
    symbolRows: symbolRows(trades),
    twtRows: twtRotationTrades.map((trade) => ({
      entry: trade.entry_time,
      exit: trade.exit_time,
      pnl: round(trade.net_pnl),
      returnPct: round((trade.net_pnl / Math.max(1, trade.entry_value)) * 100, 2),
      exitReason: trade.exit_reason,
    })),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows.find((row) => row.label === "current_v7")?.endEquity ?? rows[0]?.endEquity ?? 0;
  const best = [...rows].sort((left, right) => right.endEquity - left.endEquity)[0];
  return [
    "# V7 TWT rebound_12h integration",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue profile",
    "- TWT candidate: rebound_12h from standalone full test",
    "- TWT params: 12h / lookback 5 / breakout 0.4% / vol 0.75 / accel 1% / efficiency 0.16 / trail 5%/2.5% / maxHold 4 bars",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    best ? `- best: ${best.label} End Equity ${best.endEquity.toLocaleString()}` : "",
    "",
    "| pattern | End Equity | vs current | MaxDD | PF | win | trades | exposure | TWT PnL | TWT trades | TWT rotation | TWT time exits | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.winRatePct}% | ${row.trades} | ${row.exposurePct}% | ${row.twtPnl.toLocaleString()} | ${row.twtTrades} | ${row.twtRotationTrades} | ${row.twtTimeExits} | ${row.elapsedSec}s |`),
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
    "## TWT rotation trades",
    "",
    ...rows.flatMap((row) => [
      `### ${row.label}`,
      "",
      "| entry | exit | pnl | return | exit |",
      "| --- | --- | ---: | ---: | --- |",
      ...(row.twtRows.length
        ? row.twtRows.map((trade) => `| ${trade.entry} | ${trade.exit} | ${trade.pnl.toLocaleString()} | ${trade.returnPct}% | ${trade.exitReason} |`)
        : ["| - | - | 0 | 0% | none |"]),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const patterns: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_v7", {}],
    ["twt12_cash_only", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: false })],
    ["twt12_all_gap0", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 0 })],
    ["twt12_all_gap5", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 5 })],
    ["twt12_all_gap10", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 10 })],
    ["twt12_lossy_gap5", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: LOSSY_CORE, penguOffRotationScoreGap: 5 })],
    ["twt12_lossy_gap10", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: LOSSY_CORE, penguOffRotationScoreGap: 10 })],
    ["twt12_current_hold_gap5", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: CURRENT_HOLD_CANDIDATES, penguOffRotationScoreGap: 5 })],
    ["twt12_large_rotation_gap5", twtRebound12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: LARGE_ROTATION, penguOffRotationScoreGap: 5 })],
    ["twt12_fast_cash_only", twtFast12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: false })],
    ["twt12_fast_all_gap5", twtFast12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 5 })],
    ["twt12_quality_cash_only", twtQuality12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: false })],
    ["twt12_quality_all_gap5", twtQuality12({ penguOffRotationAllowFromCash: true, penguOffRotationAllowWhileHolding: true, penguOffRotationCurrentSymbols: ALL_NON_PENGU, penguOffRotationScoreGap: 5 })],
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
