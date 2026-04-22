import fs from "fs/promises";
import path from "path";

import {
  RECLAIM_HYBRID_EXECUTION_PROFILE,
  buildReclaimHybridVariantOptions,
} from "../config/reclaimHybridStrategy";
import { runHybridBacktest, type HybridVariantOptions } from "../lib/backtest/hybrid-engine";

const REPORT_DIR = path.join(process.cwd(), "reports", "uni-trx-cross-logic");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const BAR_MS = 12 * 60 * 60 * 1000;

type IdleWindow = {
  startTs: number;
  endTs: number;
  bars: number;
};

type LogicKey = "trx_logic" | "uni_logic";

type Variant = {
  key: string;
  symbol: "TRX" | "UNI";
  logic: LogicKey;
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

function withSymbolList(
  list: readonly string[] | undefined,
  symbol: string,
) {
  return unique([...(list ?? []), symbol]);
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

function applyUniLogic(base: HybridVariantOptions, symbol: string): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, symbol, 5),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, symbol, 0.018),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, symbol, 1.03),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, symbol, 0.002),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, symbol, 0.18),
    trendProfitTrailActivationPct: 0.16,
    trendProfitTrailRetracePct: 0.09,
    symbolSpecificTrendWeakExitSymbols: withSymbolList(base.symbolSpecificTrendWeakExitSymbols, symbol),
    symbolSpecificTrendWeakExitMom20Below: 0.05,
    symbolSpecificTrendWeakExitMomAccelBelow: -0.001,
  };
}

function applyLogic(base: HybridVariantOptions, symbol: string, logic: LogicKey) {
  if (logic === "trx_logic") return applyTrxLogic(base, symbol);
  return applyUniLogic(base, symbol);
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const baseline = await runHybridBacktest("RETQ22", {
    ...baseOptions(),
    label: "base_v7_uni_trx_cross_logic",
  });
  const idleWindows = buildIdleWindowsFromEquityCurve(baseline.equity_curve);
  const idleAllowedWindows = idleWindows.map((window) => ({ startTs: window.startTs, endTs: window.endTs }));
  const nonIdleWindows = invertWindows(idleAllowedWindows, START_TS, END_TS);

  const variants: Variant[] = [
    { key: "uni_plus_uni_logic", symbol: "UNI", logic: "uni_logic" },
    { key: "uni_plus_trx_logic", symbol: "UNI", logic: "trx_logic" },
    { key: "trx_plus_uni_logic", symbol: "TRX", logic: "uni_logic" },
    { key: "trx_plus_trx_logic", symbol: "TRX", logic: "trx_logic" },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const base = baseOptions();
    const expandedTrendSymbols = unique([...(base.expandedTrendSymbols ?? []), variant.symbol]);
    const configured = applyLogic({
      ...base,
      expandedTrendSymbols,
      trendSymbolBlockWindows: withSymbolBlockWindows(base.trendSymbolBlockWindows, variant.symbol, nonIdleWindows),
    }, variant.symbol, variant.logic);

    const result = await runHybridBacktest("RETQ22", {
      ...configured,
      label: variant.key,
    });

    const trades = result.trade_pairs.filter((trade) => trade.symbol === variant.symbol);
    const wins = trades.filter((trade) => trade.net_pnl > 0).length;
    const losses = trades.filter((trade) => trade.net_pnl <= 0).length;

    rows.push({
      key: variant.key,
      symbol: variant.symbol,
      logic: variant.logic,
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
      symbolPnl: round(result.summary.symbol_contribution[variant.symbol] ?? 0),
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  const md = [
    "# UNI / TRX Cross Logic",
    "",
    "## Baseline",
    "",
    `- end_equity: ${round(baseline.summary.end_equity)}`,
    `- cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    `- trade_count: ${baseline.summary.trade_count}`,
    "",
    "## Variants",
    "",
    "| variant | symbol | logic | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | symbol trades | wins | losses | symbol pnl | exposure % |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.symbol} | ${row.logic} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.symbolTradeCount} | ${row.symbolWins} | ${row.symbolLosses} | ${row.symbolPnl} | ${row.exposurePct} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify({
    baseline: {
      endEquity: round(baseline.summary.end_equity),
      cagrPct: round(baseline.summary.cagr_pct),
      maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
      profitFactor: round(baseline.summary.profit_factor, 3),
      tradeCount: baseline.summary.trade_count,
    },
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
