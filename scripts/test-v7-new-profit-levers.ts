import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-new-profit-levers");
const START_TS = process.env.START ? Date.parse(`${process.env.START}T00:00:00.000Z`) : Date.UTC(2022, 0, 1);
const END_TS = process.env.END ? Date.parse(`${process.env.END}T23:59:59.999Z`) : Date.UTC(2026, 3, 29, 23, 59, 59, 999);
const PATTERN = process.env.PATTERN ? new Set(process.env.PATTERN.split(",").map((value) => value.trim()).filter(Boolean)) : null;

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

function mergedAlloc(extra: Partial<HybridVariantOptions>, alloc: Record<string, number>) {
  return {
    ...extra,
    trendAllocBySymbol: {
      ...(extra.trendAllocBySymbol ?? {}),
      ...alloc,
    },
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
  const pengu = trades.filter((trade) => trade.symbol === "PENGU");
  const nonPengu = trades.filter((trade) => trade.symbol !== "PENGU");
  const overrides = trades.filter((trade) => trade.entry_reason?.includes("pengu-strong-override") || trade.exit_reason?.includes("pengu-strong-override"));
  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: round(pengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    nonPenguPnl: round(nonPengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    penguStrongOverrideTrades: overrides.length,
    symbolRows: symbolRows(trades),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows[0]?.endEquity ?? 0;
  const best = [...rows].sort((left, right) => right.endEquity - left.endEquity)[0];
  return [
    "# V7 New Profit Levers",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- tested: TWT->PENGU strong override scope, ETH/DOGE position ratios",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    best ? `- best: ${best.label} End Equity ${best.endEquity.toLocaleString()}` : "",
    "",
    "| pattern | End Equity | diff | MaxDD | PF | trades | exposure | PENGU PnL | non-PENGU PnL | PENGU override trades | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.nonPenguPnl.toLocaleString()} | ${row.penguStrongOverrideTrades} | ${row.elapsedSec}s |`),
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
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const currentPenguOverride = ["ETH", "SOL", "INJ"] as const;
  const withTwtPenguOverride = ["ETH", "SOL", "INJ", "TWT"] as const;
  const ratioCases: Array<[string, number, number]> = [
    ["eth_doge_20pct", 0.2, 0.2],
    ["eth_doge_25pct", 0.25, 0.25],
    ["eth_doge_33pct", 1 / 3, 1 / 3],
    ["eth_doge_40pct", 0.4, 0.4],
    ["eth_doge_50pct", 0.5, 0.5],
    ["eth20_doge33pct", 0.2, 1 / 3],
    ["eth25_doge33pct", 0.25, 1 / 3],
    ["eth33_doge25pct", 1 / 3, 0.25],
    ["eth25_doge50pct", 0.25, 0.5],
    ["eth50_doge25pct", 0.5, 0.25],
  ];

  const patterns: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_v7", {} as Partial<HybridVariantOptions>],
    ["pengu_override_twt_gap15_hold2", {
      penguStrongOverrideCurrentSymbols: withTwtPenguOverride,
      penguStrongOverrideScoreGap: 15,
      penguStrongOverrideMinHoldBars: 2,
    }],
    ["pengu_override_twt_gap20_hold2", {
      penguStrongOverrideCurrentSymbols: withTwtPenguOverride,
      penguStrongOverrideScoreGap: 20,
      penguStrongOverrideMinHoldBars: 2,
    }],
    ["pengu_override_twt_gap25_hold2", {
      penguStrongOverrideCurrentSymbols: withTwtPenguOverride,
      penguStrongOverrideScoreGap: 25,
      penguStrongOverrideMinHoldBars: 2,
    }],
    ["pengu_override_twt_gap15_hold4", {
      penguStrongOverrideCurrentSymbols: withTwtPenguOverride,
      penguStrongOverrideScoreGap: 15,
      penguStrongOverrideMinHoldBars: 4,
    }],
    ["pengu_override_twt_only_gap15_hold2", {
      penguStrongOverrideCurrentSymbols: ["TWT"],
      penguStrongOverrideScoreGap: 15,
      penguStrongOverrideMinHoldBars: 2,
    }],
    ...ratioCases.map(([label, eth, doge]) => [
      label,
      mergedAlloc({}, { ETH: eth, DOGE: doge }),
    ] as [string, Partial<HybridVariantOptions>]),
    ...ratioCases.map(([label, eth, doge]) => [
      `${label}_pengu_twt_gap15`,
      mergedAlloc({
        penguStrongOverrideCurrentSymbols: withTwtPenguOverride,
        penguStrongOverrideScoreGap: 15,
        penguStrongOverrideMinHoldBars: 2,
      }, { ETH: eth, DOGE: doge }),
    ] as [string, Partial<HybridVariantOptions>]),
    ["pengu_override_scope_baseline_explicit", {
      penguStrongOverrideCurrentSymbols: currentPenguOverride,
      penguStrongOverrideScoreGap: 15,
      penguStrongOverrideMinHoldBars: 2,
    }],
  ].filter(([label]) => !PATTERN || PATTERN.has(label));

  const rows = [];
  for (const [label, extra] of patterns) {
    console.log(`running ${label}`);
    rows.push(await runCase(label, extra));
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.json"), JSON.stringify(rows, null, 2), "utf8");
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.md"), toMarkdown(rows), "utf8");
  }

  const sortedRows = rows;
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(sortedRows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(sortedRows), "utf8");
  console.log(toMarkdown(sortedRows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
