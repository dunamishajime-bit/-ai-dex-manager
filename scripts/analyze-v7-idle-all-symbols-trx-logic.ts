import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-idle-all-symbols-trx-logic");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const BAR_MS = 12 * 60 * 60 * 1000;

const SYMBOLS = [
  "ETH",
  "SOL",
  "AVAX",
  "TRX",
  "CAKE",
  "BNB",
  "LINK",
  "SFP",
  "NEAR",
  "LTC",
  "XRP",
  "ATOM",
  "AAVE",
  "UNI",
  "ADA",
  "INJ",
] as const;

type IdleWindow = {
  startTs: number;
  endTs: number;
  bars: number;
  startIso: string;
  endIso: string;
};

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
}

function buildIdleWindowsFromEquityCurve(
  equityCurve: Awaited<ReturnType<typeof runHybridBacktest>>["equity_curve"],
) {
  const windows: IdleWindow[] = [];
  let windowStartTs: number | null = null;

  for (const point of equityCurve) {
    const isCash = point.position_side === "cash";
    if (isCash && windowStartTs == null) {
      windowStartTs = point.ts;
      continue;
    }

    if (!isCash && windowStartTs != null) {
      const bars = Math.max(1, Math.round((point.ts - windowStartTs) / BAR_MS));
      windows.push({
        startTs: windowStartTs,
        endTs: point.ts,
        bars,
        startIso: new Date(windowStartTs).toISOString(),
        endIso: new Date(point.ts).toISOString(),
      });
      windowStartTs = null;
    }
  }

  if (windowStartTs != null) {
    const bars = Math.max(1, Math.round((END_TS - windowStartTs) / BAR_MS));
    windows.push({
      startTs: windowStartTs,
      endTs: END_TS,
      bars,
      startIso: new Date(windowStartTs).toISOString(),
      endIso: new Date(END_TS).toISOString(),
    });
  }

  return windows.filter((window) => window.bars >= 2);
}

function invertWindows(
  windows: readonly { startTs: number; endTs: number }[],
  startTs: number,
  endTs: number,
) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Array<{ startTs: number; endTs: number }> = [];
  let cursor = startTs;

  for (const window of sorted) {
    if (window.startTs > cursor) {
      inverted.push({ startTs: cursor, endTs: window.startTs });
    }
    cursor = Math.max(cursor, window.endTs);
  }

  if (cursor < endTs) {
    inverted.push({ startTs: cursor, endTs: endTs });
  }

  return inverted.filter((window) => window.endTs > window.startTs);
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function withSymbolMapNumber(
  map: Record<string, number> | undefined,
  symbol: string,
  value: number,
) {
  return {
    ...(map ?? {}),
    [symbol]: value,
  };
}

function withSymbolBlockWindows(
  map: Record<string, readonly { startTs: number; endTs: number }[]> | undefined,
  symbol: string,
  windows: readonly { startTs: number; endTs: number }[],
) {
  return {
    ...(map ?? {}),
    [symbol]: windows,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    ...baseOptions(),
    label: "base_v7_idle_all_symbols_trx_logic",
  });
  const idleWindows = buildIdleWindowsFromEquityCurve(baseline.equity_curve);
  const idleAllowedWindows = idleWindows.map((window) => ({ startTs: window.startTs, endTs: window.endTs }));
  const nonIdleWindows = invertWindows(idleAllowedWindows, START_TS, END_TS);

  const rows: Array<Record<string, unknown>> = [];

  for (const symbol of SYMBOLS) {
    const base = baseOptions();
    const expandedTrendSymbols = unique([...(base.expandedTrendSymbols ?? []), symbol]);
    const result = await runHybridBacktest("RETQ22", {
      ...base,
      label: `v7_idle_${symbol.toLowerCase()}_trx_logic`,
      expandedTrendSymbols,
      trendSymbolBlockWindows: withSymbolBlockWindows(base.trendSymbolBlockWindows, symbol, nonIdleWindows),
      trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, symbol, 8),
      trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, symbol, 0.012),
      trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, symbol, 1.01),
      trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, symbol, 0.0005),
      trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, symbol, 0.17),
    });

    const trades = result.trade_pairs.filter((trade) => trade.symbol === symbol);
    const wins = trades.filter((trade) => trade.net_pnl > 0).length;
    const losses = trades.filter((trade) => trade.net_pnl <= 0).length;

    rows.push({
      symbol,
      endEquity: round(result.summary.end_equity),
      deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      winRatePct: round(result.summary.win_rate_pct),
      tradeCount: result.summary.trade_count,
      symbolTradeCount: trades.length,
      symbolWins: wins,
      symbolLosses: losses,
      symbolPnl: round(result.summary.symbol_contribution[symbol] ?? 0),
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  rows.sort((left, right) => Number(right.endEquity) - Number(left.endEquity));

  const md = [
    "# V7 Idle Windows: All Symbols With TRX Logic",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    `- idle_window_count: ${idleWindows.length}`,
    "",
    "## Baseline",
    "",
    `- end_equity: ${round(baseline.summary.end_equity)}`,
    `- cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    `- trade_count: ${baseline.summary.trade_count}`,
    "",
    "## Candidate Comparison",
    "",
    "| symbol | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | symbol trades | wins | losses | symbol pnl | exposure % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.symbol} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.symbolTradeCount} | ${row.symbolWins} | ${row.symbolLosses} | ${row.symbolPnl} | ${row.exposurePct} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: baseline.summary,
    idleWindows,
    results: rows,
  }, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(JSON.stringify({
    baseline: {
      endEquity: round(baseline.summary.end_equity),
      cagrPct: round(baseline.summary.cagr_pct),
      maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
      profitFactor: round(baseline.summary.profit_factor, 3),
      tradeCount: baseline.summary.trade_count,
    },
    results: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
