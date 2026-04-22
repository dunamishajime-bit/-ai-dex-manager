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

const REPORT_DIR = path.join(process.cwd(), "reports", "twt-vs-uni-cashonly");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);

type Window = {
  startTs: number;
  endTs: number;
};

type VariantSpec = {
  key: string;
  thesis: string;
  symbol: "UNI" | "TWT";
  options: HybridVariantOptions;
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

function applyTwtSmoothLogic(base: HybridVariantOptions, symbol: string): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, symbol, 6),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, symbol, 0.009),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, symbol, 1.0),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, symbol, 0.0008),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, symbol, 0.18),
  };
}

function applyTwtBreakoutLogic(base: HybridVariantOptions, symbol: string): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, symbol, 5),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, symbol, 0.015),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, symbol, 1.03),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, symbol, 0.002),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, symbol, 0.18),
    symbolSpecificTrendWeakExitSymbols: unique([...(base.symbolSpecificTrendWeakExitSymbols ?? []), symbol]),
    symbolSpecificTrendWeakExitMom20Below: 0.05,
    symbolSpecificTrendWeakExitMomAccelBelow: -0.001,
  };
}

function buildConfiguredBase(base: HybridVariantOptions, symbol: "UNI" | "TWT", nonCashWindows: readonly Window[]) {
  const expandedTrendSymbols = unique([...(base.expandedTrendSymbols ?? []), symbol]);
  return {
    ...base,
    expandedTrendSymbols,
    trendSymbolBlockWindows: withSymbolBlockWindows(base.trendSymbolBlockWindows, symbol, nonCashWindows),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const baseline = await runHybridBacktest("RETQ22", {
    ...base,
    label: "base_v7_twt_vs_uni_cashonly",
  });
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);

  const variants: VariantSpec[] = [
    {
      key: "uni_plus_trx_logic",
      thesis: "Current best idle-only candidate: UNI with TRX-style smooth trend logic.",
      symbol: "UNI",
      options: applyTrxLogic(buildConfiguredBase(base, "UNI", nonCashWindows), "UNI"),
    },
    {
      key: "twt_plus_trx_logic",
      thesis: "TWT with the same TRX-style smooth trend logic that topped the broad cash-only comparison.",
      symbol: "TWT",
      options: applyTrxLogic(buildConfiguredBase(base, "TWT", nonCashWindows), "TWT"),
    },
    {
      key: "twt_plus_smooth_logic",
      thesis: "TWT with a smoother, slightly stricter trend filter to reduce one-off luck.",
      symbol: "TWT",
      options: applyTwtSmoothLogic(buildConfiguredBase(base, "TWT", nonCashWindows), "TWT"),
    },
    {
      key: "twt_plus_breakout_logic",
      thesis: "TWT with a more confirmed breakout profile and early weak-exit guard.",
      symbol: "TWT",
      options: applyTwtBreakoutLogic(buildConfiguredBase(base, "TWT", nonCashWindows), "TWT"),
    },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", {
      ...variant.options,
      label: variant.key,
    });
    const trades = result.trade_pairs.filter((trade) => trade.symbol === variant.symbol);
    const wins = trades.filter((trade) => trade.net_pnl > 0).length;
    const losses = trades.filter((trade) => trade.net_pnl <= 0).length;
    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      symbol: variant.symbol,
      endEquity: round(result.summary.end_equity),
      deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      tradeCount: result.summary.trade_count,
      symbolTradeCount: trades.length,
      symbolWins: wins,
      symbolLosses: losses,
      symbolPnl: round(result.summary.symbol_contribution[variant.symbol] ?? 0),
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  rows.sort((left, right) => Number(right.deltaEndEquity) - Number(left.deltaEndEquity));

  const md = [
    "# TWT vs UNI Cash-only Comparison",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- cash_window_count: ${cashOnlyWindows.length}`,
    `- baseline_end_equity: ${round(baseline.summary.end_equity)}`,
    `- baseline_cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- baseline_max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- baseline_profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    "",
    "| variant | symbol | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | symbol trades | wins | losses | symbol pnl | exposure % |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.symbol} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.symbolTradeCount} | ${row.symbolWins} | ${row.symbolLosses} | ${row.symbolPnl} | ${row.exposurePct} |`),
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
    results: rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
