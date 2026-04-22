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

const REPORT_DIR = path.join(process.cwd(), "reports", "twt-dedicated-cashonly");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

type Window = {
  startTs: number;
  endTs: number;
};

type VariantSpec = {
  key: string;
  thesis: string;
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

  for (const point of cashPoints) {
    if (start == null) {
      start = point.ts;
      prev = point.ts;
      continue;
    }

    if (prev != null && point.ts - prev <= STEP_MS) {
      prev = point.ts;
      continue;
    }

    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
    start = point.ts;
    prev = point.ts;
  }

  if (start != null) {
    windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
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

function buildConfiguredBase(base: HybridVariantOptions, nonCashWindows: readonly Window[]) {
  const expandedTrendSymbols = unique([...(base.expandedTrendSymbols ?? []), "TWT"]);
  return {
    ...base,
    expandedTrendSymbols,
    trendSymbolBlockWindows: withSymbolBlockWindows(base.trendSymbolBlockWindows, "TWT", nonCashWindows),
  };
}

function applyTrxLogic(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TWT", 8),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TWT", 0.012),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TWT", 1.01),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TWT", 0.0005),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, "TWT", 0.17),
  };
}

function applyTwtOpportunityLogic(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TWT", 4),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TWT", 0.008),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TWT", 1.0),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TWT", 0),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, "TWT", 0.14),
    symbolSpecificTrendWeakExitSymbols: unique([...(base.symbolSpecificTrendWeakExitSymbols ?? []), "TWT"]),
    symbolSpecificTrendWeakExitMom20Below: 0.04,
    symbolSpecificTrendWeakExitMomAccelBelow: -0.001,
  };
}

function applyTwtOpportunityLogicLoose(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TWT", 3),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TWT", 0.006),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TWT", 0.98),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TWT", -0.0005),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, "TWT", 0.12),
    symbolSpecificTrendWeakExitSymbols: unique([...(base.symbolSpecificTrendWeakExitSymbols ?? []), "TWT"]),
    symbolSpecificTrendWeakExitMom20Below: 0.03,
    symbolSpecificTrendWeakExitMomAccelBelow: -0.002,
  };
}

function applyTwtBalancedBreakout(base: HybridVariantOptions): HybridVariantOptions {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: withSymbolMapNumber(base.trendBreakoutLookbackBarsBySymbol, "TWT", 5),
    trendBreakoutMinPctBySymbol: withSymbolMapNumber(base.trendBreakoutMinPctBySymbol, "TWT", 0.01),
    trendMinVolumeRatioBySymbol: withSymbolMapNumber(base.trendMinVolumeRatioBySymbol, "TWT", 1.01),
    trendMinMomAccelBySymbol: withSymbolMapNumber(base.trendMinMomAccelBySymbol, "TWT", 0.0002),
    trendMinEfficiencyRatioBySymbol: withSymbolMapNumber(base.trendMinEfficiencyRatioBySymbol, "TWT", 0.15),
    symbolSpecificTrendWeakExitSymbols: unique([...(base.symbolSpecificTrendWeakExitSymbols ?? []), "TWT"]),
    symbolSpecificTrendWeakExitMom20Below: 0.045,
    symbolSpecificTrendWeakExitMomAccelBelow: -0.001,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = baseOptions();
  const baseline = await runHybridBacktest("RETQ22", {
    ...base,
    label: "base_v7_twt_dedicated_cashonly",
  });
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const configuredBase = buildConfiguredBase(base, nonCashWindows);

  const variants: VariantSpec[] = [
    {
      key: "twt_plus_trx_logic",
      thesis: "Current reference: TRX-style smooth trend logic.",
      options: applyTrxLogic(configuredBase),
    },
    {
      key: "twt_opportunity_balanced",
      thesis: "TWT専用の軽めブレイクアウトと弱化出口で、価格機会を増やしつつ崩れは早めに降りる版。",
      options: applyTwtOpportunityLogic(configuredBase),
    },
    {
      key: "twt_opportunity_loose",
      thesis: "さらに拾いやすくした版。発火回数を増やす代わりにノイズ許容も増える。",
      options: applyTwtOpportunityLogicLoose(configuredBase),
    },
    {
      key: "twt_balanced_breakout",
      thesis: "緩すぎず厳しすぎない中間版。",
      options: applyTwtBalancedBreakout(configuredBase),
    },
  ];

  const rows: Array<Record<string, unknown>> = [];

  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", {
      ...variant.options,
      label: variant.key,
    });
    const trades = result.trade_pairs.filter((trade) => trade.symbol === "TWT");
    const wins = trades.filter((trade) => trade.net_pnl > 0).length;
    const losses = trades.filter((trade) => trade.net_pnl <= 0).length;

    rows.push({
      key: variant.key,
      thesis: variant.thesis,
      endEquity: round(result.summary.end_equity),
      deltaEndEquity: round(result.summary.end_equity - baseline.summary.end_equity),
      cagrPct: round(result.summary.cagr_pct),
      maxDrawdownPct: round(result.summary.max_drawdown_pct),
      profitFactor: round(result.summary.profit_factor, 3),
      tradeCount: result.summary.trade_count,
      twtTradeCount: trades.length,
      twtWins: wins,
      twtLosses: losses,
      twtPnl: round(result.summary.symbol_contribution.TWT ?? 0),
      exposurePct: round(result.summary.exposure_pct),
    });
  }

  rows.sort((left, right) => Number(right.deltaEndEquity) - Number(left.deltaEndEquity));

  const md = [
    "# TWT Dedicated Cash-only Variants",
    "",
    `- strategy_id: ${RECLAIM_HYBRID_EXECUTION_PROFILE.id}`,
    `- cash_window_count: ${cashOnlyWindows.length}`,
    `- baseline_end_equity: ${round(baseline.summary.end_equity)}`,
    `- baseline_cagr_pct: ${round(baseline.summary.cagr_pct)}%`,
    `- baseline_max_drawdown_pct: ${round(baseline.summary.max_drawdown_pct)}%`,
    `- baseline_profit_factor: ${round(baseline.summary.profit_factor, 3)}`,
    "",
    "| variant | end equity | delta end equity | CAGR % | MaxDD % | PF | trades | TWT trades | wins | losses | TWT pnl | exposure % |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.key} | ${row.endEquity} | ${row.deltaEndEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.twtTradeCount} | ${row.twtWins} | ${row.twtLosses} | ${row.twtPnl} | ${row.exposurePct} |`,
    ),
  ].join("\n");

  await fs.writeFile(
    path.join(REPORT_DIR, "result.json"),
    JSON.stringify(
      {
        baseline: baseline.summary,
        cashOnlyWindows,
        results: rows,
      },
      null,
      2,
    ),
    "utf8",
  );
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");

  console.log(
    JSON.stringify(
      {
        baseline: {
          endEquity: round(baseline.summary.end_equity),
          cagrPct: round(baseline.summary.cagr_pct),
          maxDrawdownPct: round(baseline.summary.max_drawdown_pct),
          profitFactor: round(baseline.summary.profit_factor, 3),
          tradeCount: baseline.summary.trade_count,
        },
        results: rows,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
