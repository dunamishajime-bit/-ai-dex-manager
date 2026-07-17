import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest } from "../lib/backtest/hybrid-engine";
import type { HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-position-sizing");
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

function mergedAlloc(base: Partial<HybridVariantOptions>, alloc: Record<string, number>) {
  return {
    ...base,
    trendAllocBySymbol: {
      ...(base.trendAllocBySymbol ?? {}),
      ...alloc,
    },
  };
}

function blockSymbolsAllPeriod(symbols: readonly string[]) {
  return Object.fromEntries(symbols.map((symbol) => [
    symbol,
    [{ startTs: START_TS, endTs: END_TS }],
  ]));
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
  return {
    label,
    elapsedSec: round((Date.now() - started) / 1000, 1),
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    penguPnl: round(pengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    nonPenguPnl: round(nonPengu.reduce((sum, trade) => sum + trade.net_pnl, 0)),
    symbolRows: symbolRows(trades),
    worst: trades
      .filter((trade) => trade.net_pnl < 0)
      .sort((left, right) => left.net_pnl - right.net_pnl)
      .slice(0, 8)
      .map((trade) => ({
        symbol: trade.symbol,
        entry: trade.entry_time,
        exit: trade.exit_time,
        pnl: round(trade.net_pnl),
        exitReason: trade.exit_reason,
        movePct: round(((trade.exit_price / trade.entry_price) - 1) * 100, 2),
      })),
  };
}

function toMarkdown(rows: Awaited<ReturnType<typeof runCase>>[]) {
  const baseline = rows[0]?.endEquity ?? 0;
  return [
    "# V7 Position Sizing Test",
    "",
    "- method: engine-direct V7 live-equivalent cash rescue",
    "- changed: position size only; entries/exits/rotation logic unchanged",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "",
    "| pattern | End Equity | diff | MaxDD | PF | trades | exposure | PENGU PnL | non-PENGU PnL | elapsed |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.label} | ${row.endEquity.toLocaleString()} | ${round(row.endEquity - baseline).toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.exposurePct}% | ${row.penguPnl.toLocaleString()} | ${row.nonPenguPnl.toLocaleString()} | ${row.elapsedSec}s |`),
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
  const nonPengu70 = { ETH: 0.7, SOL: 0.7, AVAX: 0.7, DOGE: 0.7, INJ: 0.7, UNI: 0.7, TWT: 0.7, BIO: 0.7, DUSK: 0.7 };
  const nonPengu50 = { ETH: 0.5, SOL: 0.5, AVAX: 0.5, DOGE: 0.5, INJ: 0.5, UNI: 0.5, TWT: 0.5, BIO: 0.5, DUSK: 0.5 };
  const negativeHeavy60 = { ETH: 0.6, DOGE: 0.6, AVAX: 0.6, SOL: 0.8, INJ: 0.8, UNI: 0.8, TWT: 0.8, BIO: 0.8, DUSK: 0.8 };
  const penguBoost = { PENGU: 1.15, ETH: 0.7, SOL: 0.7, AVAX: 0.7, DOGE: 0.7, INJ: 0.7, UNI: 0.7, TWT: 0.7, BIO: 0.7, DUSK: 0.7 };

  const patterns: Array<[string, Partial<HybridVariantOptions>]> = [
    ["current_v7", {}],
    ["non_pengu_70pct", mergedAlloc({}, nonPengu70)],
    ["non_pengu_50pct", mergedAlloc({}, nonPengu50)],
    ["loss_heavy_60pct_others80", mergedAlloc({}, negativeHeavy60)],
    ["pengu_115_non_pengu_70pct", mergedAlloc({}, penguBoost)],
    ["pengu_100_eth_doge_avax_50", mergedAlloc({}, { ETH: 0.5, DOGE: 0.5, AVAX: 0.5 })],
    ["eth_doge_uni_33pct", mergedAlloc({}, { ETH: 1 / 3, DOGE: 1 / 3, UNI: 1 / 3 })],
    ["eth_doge_uni_50pct", mergedAlloc({}, { ETH: 0.5, DOGE: 0.5, UNI: 0.5 })],
    ["eth_doge_33pct", mergedAlloc({}, { ETH: 1 / 3, DOGE: 1 / 3 })],
    ["eth_doge_50pct", mergedAlloc({}, { ETH: 0.5, DOGE: 0.5 })],
    ["eth_doge_block_next_best", { trendSymbolBlockWindows: blockSymbolsAllPeriod(["ETH", "DOGE"]) }],
    ["eth_block_next_best", { trendSymbolBlockWindows: blockSymbolsAllPeriod(["ETH"]) }],
    ["doge_block_next_best", { trendSymbolBlockWindows: blockSymbolsAllPeriod(["DOGE"]) }],
    ["eth_doge_cash_instead", { trendCashInsteadOfEntrySymbols: ["ETH", "DOGE"] }],
    ["eth_cash_instead", { trendCashInsteadOfEntrySymbols: ["ETH"] }],
    ["doge_cash_instead", { trendCashInsteadOfEntrySymbols: ["DOGE"] }],
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
