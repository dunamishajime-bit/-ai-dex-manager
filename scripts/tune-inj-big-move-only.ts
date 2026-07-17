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

const REPORT_DIR = path.join(process.cwd(), "reports", "inj-big-move-tuning");
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

function withInjVariant(base: HybridVariantOptions, inj: {
  key: string;
  lookback: number;
  breakout: number;
  volume: number;
  momAccel: number;
  efficiency: number;
  exceptionScore?: number;
  exceptionMom20: number;
  exceptionMomAccel: number;
  exceptionVolume: number;
  exceptionAdx: number;
  exceptionEfficiency: number;
}) {
  return {
    ...base,
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      INJ: inj.lookback,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      INJ: inj.breakout,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      INJ: inj.volume,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      INJ: inj.momAccel,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      INJ: inj.efficiency,
    },
    trendRotationTargetExceptionBySymbol: {
      ...(base.trendRotationTargetExceptionBySymbol ?? {}),
      INJ: {
        minScore: inj.exceptionScore,
        minMom20: inj.exceptionMom20,
        minMomAccel: inj.exceptionMomAccel,
        minVolumeRatio: inj.exceptionVolume,
        minAdx14: inj.exceptionAdx,
        minEfficiencyRatio: inj.exceptionEfficiency,
        requireStructureBreak: true,
        requireDowHigherHighLow: false,
      },
    },
    label: `inj_${inj.key}`,
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
    ethPnl: symbolPnl("ETH"),
    solPnl: symbolPnl("SOL"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    twtPnl: symbolPnl("TWT"),
    injTrades: symbolTrades("INJ"),
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

  const injVariants = [
    { key: "current_profile", lookback: 2, breakout: 0.025, volume: 1.25, momAccel: 0.02, efficiency: 0.2, exceptionMom20: 0.12, exceptionMomAccel: 0.01, exceptionVolume: 1.15, exceptionAdx: 18, exceptionEfficiency: 0.2 },
    { key: "bigmove_a", lookback: 3, breakout: 0.035, volume: 1.4, momAccel: 0.025, efficiency: 0.25, exceptionScore: 28, exceptionMom20: 0.15, exceptionMomAccel: 0.02, exceptionVolume: 1.3, exceptionAdx: 20, exceptionEfficiency: 0.25 },
    { key: "bigmove_b_less_dd", lookback: 3, breakout: 0.04, volume: 1.5, momAccel: 0.03, efficiency: 0.28, exceptionScore: 32, exceptionMom20: 0.16, exceptionMomAccel: 0.025, exceptionVolume: 1.4, exceptionAdx: 22, exceptionEfficiency: 0.28 },
    { key: "bigmove_c_mid", lookback: 3, breakout: 0.03, volume: 1.35, momAccel: 0.02, efficiency: 0.24, exceptionScore: 26, exceptionMom20: 0.14, exceptionMomAccel: 0.015, exceptionVolume: 1.25, exceptionAdx: 20, exceptionEfficiency: 0.24 },
    { key: "bigmove_d_eff", lookback: 2, breakout: 0.035, volume: 1.35, momAccel: 0.025, efficiency: 0.3, exceptionScore: 30, exceptionMom20: 0.15, exceptionMomAccel: 0.02, exceptionVolume: 1.3, exceptionAdx: 20, exceptionEfficiency: 0.3 },
    { key: "bigmove_e_no_rotation", lookback: 3, breakout: 0.035, volume: 1.4, momAccel: 0.025, efficiency: 0.25, exceptionScore: 999, exceptionMom20: 9, exceptionMomAccel: 9, exceptionVolume: 9, exceptionAdx: 99, exceptionEfficiency: 9 },
    { key: "bigmove_f_plug_loss", lookback: 4, breakout: 0.045, volume: 1.55, momAccel: 0.035, efficiency: 0.32, exceptionScore: 36, exceptionMom20: 0.18, exceptionMomAccel: 0.03, exceptionVolume: 1.45, exceptionAdx: 24, exceptionEfficiency: 0.32 },
  ];

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    { key: "production_current", memo: "Current deployed baseline.", options: { ...production, label: "production_current" } },
    ...injVariants.map((inj) => ({
      key: inj.key,
      memo: `INJ tuning ${inj.key}`,
      options: withInjVariant(production, inj),
    })),
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(
      `${variant.key}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} INJ=${summary.injPnl}/${summary.injTrades} ETH=${summary.ethPnl} SOL=${summary.solPnl} PENGU=${summary.penguPnl} DOGE=${summary.dogePnl} TWT=${summary.twtPnl}`,
    );
  }

  const md = [
    "# INJ Big Move Tuning",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | INJ pnl | INJ trades | ETH | SOL | PENGU | DOGE | TWT |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.injPnl} | ${row.injTrades} | ${row.ethPnl} | ${row.solPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.twtPnl} |`),
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
