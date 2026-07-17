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

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "v7-improvement-areas");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function unique<T>(items: readonly T[]) {
  return Array.from(new Set(items));
}

function buildCashOnlyWindows(points: Awaited<ReturnType<typeof analyzeHybridDecisionWindow>>) {
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

  if (start != null) windows.push({ startTs: start, endTs: (prev ?? start) + STEP_MS });
  return windows;
}

function invertWindows(windows: readonly Window[], startTs: number, endTs: number) {
  const sorted = [...windows].sort((left, right) => left.startTs - right.startTs);
  const inverted: Window[] = [];
  let cursor = startTs;
  for (const window of sorted) {
    if (window.startTs > cursor) inverted.push({ startTs: cursor, endTs: window.startTs });
    cursor = Math.max(cursor, window.endTs);
  }
  if (cursor < endTs) inverted.push({ startTs: cursor, endTs });
  return inverted.filter((window) => window.endTs > window.startTs);
}

function applyCashOnlyUniTwt(base: HybridVariantOptions, nonCashWindows: readonly Window[]) {
  return {
    ...base,
    expandedTrendSymbols: unique([...(base.expandedTrendSymbols ?? []), "UNI", "TWT"]),
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      UNI: 8,
      TWT: 8,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      UNI: 0.012,
      TWT: 0.012,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      UNI: 1.01,
      TWT: 1.01,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      UNI: 0.0005,
      TWT: 0.0005,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      UNI: 0.17,
      TWT: 0.17,
    },
    trendPrioritySymbols: ["TWT"],
    trendPriorityMaxScoreGap: null,
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
    trendSymbolBlockWindows: {
      ...(base.trendSymbolBlockWindows ?? {}),
      UNI: nonCashWindows,
      TWT: nonCashWindows,
    },
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    uniPnl: symbolPnl("UNI"),
    twtPnl: symbolPnl("TWT"),
    trxPnl: symbolPnl("TRX"),
    cakePnl: symbolPnl("CAKE"),
    ethTrades: symbolTrades("ETH"),
    solTrades: symbolTrades("SOL"),
    injTrades: symbolTrades("INJ"),
    penguTrades: symbolTrades("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
    twtTrades: symbolTrades("TWT"),
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const base = {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = applyCashOnlyUniTwt(base, nonCashWindows);

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "production_current",
      memo: "Current deployed V7+cash-only UNI/TWT baseline.",
      options: { ...production, label: "production_current" },
    },
    {
      key: "sol_quality_gate",
      memo: "Reduce poor SOL selections by requiring stronger SOL acceleration/efficiency/volume and extra score penalty.",
      options: {
        ...production,
        trendScoreAdjustmentBySymbol: {
          ...(production.trendScoreAdjustmentBySymbol ?? {}),
          SOL: -12,
        },
        trendMinMomAccelBySymbol: {
          ...(production.trendMinMomAccelBySymbol ?? {}),
          SOL: 0.04,
        },
        trendMinEfficiencyRatioBySymbol: {
          ...(production.trendMinEfficiencyRatioBySymbol ?? {}),
          SOL: 0.35,
        },
        trendMinVolumeRatioBySymbol: {
          ...(production.trendMinVolumeRatioBySymbol ?? {}),
          SOL: 0.9,
        },
        label: "sol_quality_gate",
      },
    },
    {
      key: "eth_weak_exit_faster",
      memo: "Exit ETH earlier when ETH momentum is weak/flat.",
      options: {
        ...production,
        symbolSpecificTrendWeakExitMom20BelowBySymbol: {
          ...(production.symbolSpecificTrendWeakExitMom20BelowBySymbol ?? {}),
          ETH: 0.08,
        },
        symbolSpecificTrendWeakExitMomAccelBelowBySymbol: {
          ...(production.symbolSpecificTrendWeakExitMomAccelBelowBySymbol ?? {}),
          ETH: 0,
        },
        label: "eth_weak_exit_faster",
      },
    },
    {
      key: "inj_big_move_only",
      memo: "Make INJ more selective so it only enters clear large-trend phases.",
      options: {
        ...production,
        trendBreakoutLookbackBarsBySymbol: {
          ...(production.trendBreakoutLookbackBarsBySymbol ?? {}),
          INJ: 3,
        },
        trendBreakoutMinPctBySymbol: {
          ...(production.trendBreakoutMinPctBySymbol ?? {}),
          INJ: 0.035,
        },
        trendMinVolumeRatioBySymbol: {
          ...(production.trendMinVolumeRatioBySymbol ?? {}),
          INJ: 1.4,
        },
        trendMinMomAccelBySymbol: {
          ...(production.trendMinMomAccelBySymbol ?? {}),
          INJ: 0.025,
        },
        trendMinEfficiencyRatioBySymbol: {
          ...(production.trendMinEfficiencyRatioBySymbol ?? {}),
          INJ: 0.25,
        },
        trendRotationTargetExceptionBySymbol: {
          ...(production.trendRotationTargetExceptionBySymbol ?? {}),
          INJ: {
            minScore: 28,
            minMom20: 0.15,
            minMomAccel: 0.02,
            minVolumeRatio: 1.3,
            minAdx14: 20,
            minEfficiencyRatio: 0.25,
            requireStructureBreak: true,
            requireDowHigherHighLow: false,
          },
        },
        label: "inj_big_move_only",
      },
    },
    {
      key: "idle_alt_trx_cake",
      memo: "Try extra idle-only rescue symbols TRX/CAKE during USDT cash windows only.",
      options: {
        ...production,
        idleBreakoutEntryWhileCash: true,
        idleBreakoutEntryTimeframe: "6h",
        idleBreakoutSymbols: ["TRX", "CAKE"],
        idleBreakoutAllowedWindows: cashOnlyWindows,
        idleBreakoutAllowTradeGateOff: true,
        idleBreakoutBreakoutLookbackBars: 8,
        idleBreakoutBreakoutMinPct: 0.012,
        idleBreakoutMinVolumeRatio: 1.01,
        idleBreakoutMinMomAccel: 0.0005,
        idleBreakoutMinEfficiencyRatio: 0.17,
        idleBreakoutProfitTrailActivationPct: 0.16,
        idleBreakoutProfitTrailRetracePct: 0.075,
        idleBreakoutMaxHoldBars: 8,
        label: "idle_alt_trx_cake",
      },
    },
    {
      key: "priority_profit_weighted",
      memo: "Nudge priority toward historically stronger ETH/INJ/TWT and penalize SOL further.",
      options: {
        ...production,
        trendScoreAdjustmentBySymbol: {
          ...(production.trendScoreAdjustmentBySymbol ?? {}),
          SOL: -12,
          ETH: 2,
          INJ: 4,
          TWT: 3,
        },
        trendPrioritySymbols: ["TWT", "ETH"],
        trendPriorityMaxScoreGap: 8,
        label: "priority_profit_weighted",
      },
    },
    {
      key: "combined_selective",
      memo: "Combine SOL quality gate, INJ big-move selectivity, and profit-weighted priority.",
      options: {
        ...production,
        trendScoreAdjustmentBySymbol: {
          ...(production.trendScoreAdjustmentBySymbol ?? {}),
          SOL: -12,
          ETH: 2,
          INJ: 4,
          TWT: 3,
        },
        trendMinMomAccelBySymbol: {
          ...(production.trendMinMomAccelBySymbol ?? {}),
          SOL: 0.04,
          INJ: 0.025,
        },
        trendMinEfficiencyRatioBySymbol: {
          ...(production.trendMinEfficiencyRatioBySymbol ?? {}),
          SOL: 0.35,
          INJ: 0.25,
        },
        trendMinVolumeRatioBySymbol: {
          ...(production.trendMinVolumeRatioBySymbol ?? {}),
          SOL: 0.9,
          INJ: 1.4,
        },
        trendBreakoutLookbackBarsBySymbol: {
          ...(production.trendBreakoutLookbackBarsBySymbol ?? {}),
          INJ: 3,
        },
        trendBreakoutMinPctBySymbol: {
          ...(production.trendBreakoutMinPctBySymbol ?? {}),
          INJ: 0.035,
        },
        trendPrioritySymbols: ["TWT", "ETH"],
        trendPriorityMaxScoreGap: 8,
        label: "combined_selective",
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(
      `${variant.key}: end=${summary.endEquity} CAGR=${summary.cagrPct} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} ETH=${summary.ethPnl} SOL=${summary.solPnl} INJ=${summary.injPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} TWT=${summary.twtPnl}`,
    );
  }

  const md = [
    "# V7 Improvement Areas",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | ETH | SOL | INJ | PENGU | DOGE | UNI | TWT | TRX | CAKE |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.ethPnl} | ${row.solPnl} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.uniPnl} | ${row.twtPnl} | ${row.trxPnl} | ${row.cakePnl} |`),
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "result.json"), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "result.md"), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
