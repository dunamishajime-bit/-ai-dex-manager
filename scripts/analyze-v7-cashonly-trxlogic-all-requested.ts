import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import {
  analyzeHybridDecisionWindow,
  runHybridBacktest,
  type HybridVariantOptions,
} from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-cashonly-trxlogic-all-requested");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

const REQUESTED_SYMBOLS = [
  "SHIB",
  "PEPE",
  "FTM",
  "EOS",
  "AXS",
  "ALPACA",
  "DODO",
  "XVS",
  "WLFI",
  "ASTER",
  "DOGE",
  "PENGU",
  "TWT",
  "ZEC",
  "DASH",
  "BCH",
  "CAKE",
  "BNB",
  "LINK",
  "SFP",
  "NEAR",
  "LTC",
  "XRP",
  "ATOM",
  "AAVE",
  "ADA",
] as const;

type Window = {
  startTs: number;
  endTs: number;
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
  map: Record<string, readonly Window[]> | undefined,
  symbol: string,
  windows: readonly Window[],
) {
  return {
    ...(map ?? {}),
    [symbol]: windows,
  };
}

function buildCashOnlyWindows(
  points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>,
) {
  const cashPoints = points
    .filter((point) => point.decision.desiredSymbol === "USDT" && point.decision.desiredSide === "cash")
    .sort((left, right) => left.ts - right.ts);
  const windows: Window[] = [];
  let start: number | null = null;
  let prev: number | null = null;
  const stepMs = 12 * 60 * 60 * 1000;

  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }

    if (prev != null && point.ts - prev <= stepMs) {
      prev = point.ts;
      continue;
    }

    windows.push({ startTs: start, endTs: (prev ?? start) + stepMs });
    start = point.ts;
    prev = point.ts;
  }

  if (start != null) {
    windows.push({ startTs: start, endTs: (prev ?? start) + stepMs });
  }

  return windows;
}

function invertWindows(
  windows: readonly Window[],
  startTs: number,
  endTs: number,
) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
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

function applyTrxLogic(base: HybridVariantOptions, symbol: string): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, symbol, 8),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, symbol, 0.012),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, symbol, 1.01),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, symbol, 0.0005),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, symbol, 0.17),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const baseline = await runHybridBacktest("RETQ22", {
    ...base,
    label: "base_v7_cashonly_trxlogic_all_requested",
  });
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);

  const symbols = unique(["UNI", ...REQUESTED_SYMBOLS]);
  const rows: Array<Record<string, unknown>> = [];

  for (const symbol of symbols) {
    const expandedTrendSymbols = unique([...(base.expandedTrendSymbols ?? []), symbol]);
    const configured = applyTrxLogic({
      ...base,
      expandedTrendSymbols,
      trendSymbolBlockWindows: withSymbolBlockWindows(base.trendSymbolBlockWindows, symbol, nonCashWindows),
    }, symbol);

    try {
      const result = await runHybridBacktest("RETQ22", {
        ...configured,
        label: `cashonly_${symbol.toLowerCase()}_trx_logic`,
      });
      const trades = result.trade_pairs.filter((trade) => trade.symbol === symbol);
      const wins = trades.filter((trade) => trade.net_pnl > 0).length;
      const losses = trades.filter((trade) => trade.net_pnl <= 0).length;
      rows.push({
        symbol,
        status: "ok",
        endEquity: round(result.summary.end_equity),
        deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
        cagrPct: round(result.summary.cagr_pct),
        maxDrawdownPct: round(result.summary.max_drawdown_pct),
        profitFactor: round(result.summary.profit_factor, 3),
        tradeCount: result.summary.trade_count,
        symbolTradeCount: trades.length,
        symbolWins: wins,
        symbolLosses: losses,
        symbolPnl: round(result.summary.symbol_contribution[symbol] ?? 0),
        exposurePct: round(result.summary.exposure_pct),
      });
    } catch (error) {
      rows.push({
        symbol,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  rows.sort((left, right) => Number(right.deltaEndEquity ?? -Infinity) - Number(left.deltaEndEquity ?? -Infinity));

  const md = [
    "# V7 Cash-only Windows: Requested Symbols With TRX Logic",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- cash_window_count: ${cashOnlyWindows.length}`,
    `- baseline_end_equity: ${round(baseline.summary.end_equity)}`,
    `- baseline_cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- baseline_max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- baseline_profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    "",
    "| symbol | status | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | symbol trades | wins | losses | symbol pnl | exposure % | error |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) => `| ${row.symbol} | ${row.status} | ${row.endEquity ?? ""} | ${row.deltaEndEquity ?? ""} | ${row.cagrPct ?? ""} | ${row.maxDrawdownPct ?? ""} | ${row.profitFactor ?? ""} | ${row.tradeCount ?? ""} | ${row.symbolTradeCount ?? ""} | ${row.symbolWins ?? ""} | ${row.symbolLosses ?? ""} | ${row.symbolPnl ?? ""} | ${row.exposurePct ?? ""} | ${row.error ?? ""} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: baseline.summary,
    cashOnlyWindows,
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
    top: rows.slice(0, 10),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
