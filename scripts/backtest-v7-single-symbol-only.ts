import fs from "fs/promises";
import path from "path";

process.env.BT_USE_FRAME_SNAPSHOT ??= "1";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridCashRescueVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_KEY = (process.env.REPORT_KEY || process.env.SYMBOLS || "all")
  .replace(/[^a-z0-9_-]+/gi, "_")
  .replace(/^_+|_+$/g, "")
  .toLowerCase();
const REPORT_DIR = path.join(process.cwd(), "reports", "v7-single-symbol-only", REPORT_KEY || "all");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 4, 22, 23, 59, 59, 999);

const SYMBOLS = (process.env.SYMBOLS
  ? process.env.SYMBOLS.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean)
  : RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols.filter((symbol) => symbol !== "PENGU")
) as string[];

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function blockAllExcept(allowed: string) {
  const allowedUpper = allowed.toUpperCase();
  return Object.fromEntries(
    RECLAIM_HYBRID_EXECUTION_PROFILE.tradableSymbols
      .filter((symbol) => symbol.toUpperCase() !== allowedUpper)
      .map((symbol) => [symbol, [{ startTs: START_TS, endTs: END_TS }]]),
  );
}

function singleSymbolOptions(symbol: string): HybridVariantOptions {
  const base = buildReclaimHybridCashRescueVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE) as HybridVariantOptions;
  return {
    ...base,
    label: `v7_single_${symbol.toLowerCase()}`,
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
    expandedTrendSymbols: [symbol],
    rangeSymbols: [symbol] as unknown as HybridVariantOptions["rangeSymbols"],
    strictExtraTrendSymbols: [symbol],
    strictExtraTrendRotationCurrentSymbols: [symbol],
    strictExtraTrendPriorityCurrentSymbols: [symbol],
    strictExtraTrendSwitchGuardSymbols: [symbol],
    idleBreakoutSymbols: [symbol],
    idleNightBreakoutSymbols: [symbol],
    penguOffRotationSymbols: [],
    penguOffRotationCurrentSymbols: [],
    penguStrongOverrideSymbols: [],
    penguStrongOverrideCurrentSymbols: [],
    solWaveOverrideSymbols: [],
    solWaveOverrideCurrentSymbols: [],
    idleBigWaveSidecarSymbols: [],
    twtUsdtSleeveSidecar: undefined,
    trendSymbolBlockWindows: {
      ...(base.trendSymbolBlockWindows ?? {}),
      ...blockAllExcept(symbol),
    },
  } as HybridVariantOptions;
}

function summarizeTrades(symbol: string, result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const trades = result.trade_pairs.filter((trade) => trade.symbol.toUpperCase() === symbol.toUpperCase());
  const sorted = [...trades].sort((left, right) => right.net_pnl - left.net_pnl);
  const positives = trades.filter((trade) => trade.net_pnl > 0);
  const pnl = trades.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const positivePnl = positives.reduce((sum, trade) => sum + trade.net_pnl, 0);
  const top = sorted[0] ?? null;
  const topPnl = top?.net_pnl ?? 0;
  const pnlWithoutTop = pnl - topPnl;
  const topShareOfPositive = positivePnl > 0 ? topPnl / positivePnl : 0;
  return {
    symbol,
    endEquity: round(result.summary.end_equity),
    pnl: round(pnl),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: trades.length,
    wins: positives.length,
    losses: trades.length - positives.length,
    winRatePct: round((positives.length / Math.max(1, trades.length)) * 100, 1),
    topPnl: round(topPnl),
    topShareOfPositivePct: round(topShareOfPositive * 100, 1),
    pnlWithoutTop: round(pnlWithoutTop),
    positivePnl: round(positivePnl),
    topTrade: top ? {
      entry: top.entry_time,
      exit: top.exit_time,
      pnl: round(top.net_pnl),
      movePct: round(((top.exit_price / top.entry_price) - 1) * 100, 2),
      entryReason: top.entry_reason,
      exitReason: top.exit_reason,
    } : null,
  };
}

function toMarkdown(rows: ReturnType<typeof summarizeTrades>[]) {
  return [
    "# V7 Single Symbol Only",
    "",
    `- period: ${new Date(START_TS).toISOString()} - ${new Date(END_TS).toISOString()}`,
    "- method: one symbol enabled at a time; PENGU excluded by default",
    "",
    "| symbol | End Equity | PnL | MaxDD | PF | trades | W/L | win | top PnL | top/positive | PnL without top | top trade |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.symbol} | ${row.endEquity.toLocaleString()} | ${row.pnl.toLocaleString()} | ${row.maxDrawdownPct}% | ${row.profitFactor} | ${row.trades} | ${row.wins}/${row.losses} | ${row.winRatePct}% | ${row.topPnl.toLocaleString()} | ${row.topShareOfPositivePct}% | ${row.pnlWithoutTop.toLocaleString()} | ${row.topTrade ? `${row.topTrade.entry} -> ${row.topTrade.exit} (${row.topTrade.movePct}%)` : "-"} |`),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const rows = [];
  for (const symbol of SYMBOLS) {
    console.log(`running ${symbol}`);
    const result = await runHybridBacktest("RETQ22", singleSymbolOptions(symbol));
    rows.push(summarizeTrades(symbol, result));
    await fs.writeFile(path.join(REPORT_DIR, "summary.partial.json"), JSON.stringify(rows, null, 2), "utf8");
  }
  rows.sort((left, right) => left.pnlWithoutTop - right.pnlWithoutTop);
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), toMarkdown(rows), "utf8");
  console.log(toMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
