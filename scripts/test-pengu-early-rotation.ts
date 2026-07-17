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

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-early-rotation");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 18, 23, 59, 59, 999);
const STEP_MS = 12 * 60 * 60 * 1000;
const REPORT_SUFFIX = process.env.BT_START || process.env.BT_END
  ? `-${process.env.BT_START ?? "start"}-${process.env.BT_END ?? "end"}`
  : "";

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
  const penguRotations = result.trade_pairs.filter((row) =>
    row.symbol === "PENGU" &&
    row.entry_reason.includes("strict-extra-rotate")
  );
  const intoPenguAfterNormal = result.trade_pairs.filter((row, index) => {
    if (row.symbol !== "PENGU" || !row.entry_reason.includes("strict-extra-rotate")) return false;
    const previous = result.trade_pairs[index - 1];
    return !!previous && !["PENGU", "DOGE"].includes(previous.symbol);
  });
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    ETH: symbolPnl("ETH"),
    SOL: symbolPnl("SOL"),
    AVAX: symbolPnl("AVAX"),
    INJ: symbolPnl("INJ"),
    PENGU: symbolPnl("PENGU"),
    DOGE: symbolPnl("DOGE"),
    UNI: symbolPnl("UNI"),
    TWT: symbolPnl("TWT"),
    penguTrades: symbolTrades("PENGU"),
    penguRotationEntries: penguRotations.length,
    penguRotationPnl: round(penguRotations.reduce((sum, row) => sum + row.net_pnl, 0)),
    intoPenguAfterNormal: intoPenguAfterNormal.length,
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
  const production = applyCashOnlyUniTwt(base, invertWindows(cashOnlyWindows, START_TS, END_TS));

  const earlySets = [
    { key: "A_safe", score: 40, mom20: 0.16, momAccel: 0.05, efficiency: 0.45, adx: 24, gap: 12 },
    { key: "B_balance", score: 35, mom20: 0.13, momAccel: 0.035, efficiency: 0.45, adx: 24, gap: 12 },
    { key: "C_early", score: 32, mom20: 0.10, momAccel: 0.025, efficiency: 0.38, adx: 22, gap: 10 },
    { key: "B_gap8", score: 35, mom20: 0.13, momAccel: 0.035, efficiency: 0.45, adx: 24, gap: 8 },
    { key: "C_gap8", score: 32, mom20: 0.10, momAccel: 0.025, efficiency: 0.38, adx: 22, gap: 8 },
    { key: "D_fast", score: 30, mom20: 0.08, momAccel: 0.015, efficiency: 0.35, adx: 20, gap: 8 },
  ];

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "production_current",
      memo: "Current production V7 with weak-market ETH/INJ/SOL block.",
      options: { ...production, label: "production_current" },
    },
    ...earlySets.flatMap((item) => [
      {
        key: `pengu_early_${item.key}_all_normal`,
        memo: `Allow ETH/SOL/AVAX/INJ/UNI -> PENGU when score>=${item.score}, mom20>=${item.mom20}, accel>=${item.momAccel}, eff>=${item.efficiency}, ADX>=${item.adx}, score gap>=${item.gap}.`,
        options: {
          ...production,
          strictExtraTrendRotationWhileHolding: true,
          strictExtraTrendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
          strictExtraTrendRotationScoreGap: item.gap,
          strictExtraTrendRotationCurrentMomAccelMax: 0.03,
          strictExtraTrendRotationCurrentMom20Max: 0.20,
          strictExtraTrendRotationMinHoldBars: 1,
          strictExtraTrendRotationCandidateMinScore: item.score,
          strictExtraTrendRotationCandidateMinMom20: item.mom20,
          strictExtraTrendRotationCandidateMinMomAccel: item.momAccel,
          strictExtraTrendRotationCandidateMinEfficiencyRatio: item.efficiency,
          strictExtraTrendRotationCandidateMinAdx14: item.adx,
          label: `pengu_early_${item.key}_all_normal`,
        },
      },
      {
        key: `pengu_early_${item.key}_gap_only_all_normal`,
        memo: `Allow normal -> PENGU with ${item.key} thresholds using score gap only; no current weakness gate.`,
        options: {
          ...production,
          strictExtraTrendRotationWhileHolding: true,
          strictExtraTrendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
          strictExtraTrendRotationScoreGap: item.gap,
          strictExtraTrendRotationCurrentMomAccelMax: 999,
          strictExtraTrendRotationCurrentMom20Max: 999,
          strictExtraTrendRotationMinHoldBars: 1,
          strictExtraTrendRotationCandidateMinScore: item.score,
          strictExtraTrendRotationCandidateMinMom20: item.mom20,
          strictExtraTrendRotationCandidateMinMomAccel: item.momAccel,
          strictExtraTrendRotationCandidateMinEfficiencyRatio: item.efficiency,
          strictExtraTrendRotationCandidateMinAdx14: item.adx,
          label: `pengu_early_${item.key}_gap_only_all_normal`,
        },
      },
      {
        key: `pengu_early_${item.key}_gap25_all_normal`,
        memo: `Allow normal -> PENGU with ${item.key} thresholds and larger score gap>=25; no current weakness gate.`,
        options: {
          ...production,
          strictExtraTrendRotationWhileHolding: true,
          strictExtraTrendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
          strictExtraTrendRotationScoreGap: 25,
          strictExtraTrendRotationCurrentMomAccelMax: 999,
          strictExtraTrendRotationCurrentMom20Max: 999,
          strictExtraTrendRotationMinHoldBars: 1,
          strictExtraTrendRotationCandidateMinScore: item.score,
          strictExtraTrendRotationCandidateMinMom20: item.mom20,
          strictExtraTrendRotationCandidateMinMomAccel: item.momAccel,
          strictExtraTrendRotationCandidateMinEfficiencyRatio: item.efficiency,
          strictExtraTrendRotationCandidateMinAdx14: item.adx,
          label: `pengu_early_${item.key}_gap25_all_normal`,
        },
      },
      {
        key: `pengu_early_${item.key}_eth_only`,
        memo: `Allow ETH -> PENGU only with ${item.key} thresholds.`,
        options: {
          ...production,
          strictExtraTrendRotationWhileHolding: true,
          strictExtraTrendRotationCurrentSymbols: ["ETH"],
          strictExtraTrendRotationScoreGap: item.gap,
          strictExtraTrendRotationCurrentMomAccelMax: 0.03,
          strictExtraTrendRotationCurrentMom20Max: 0.20,
          strictExtraTrendRotationMinHoldBars: 1,
          strictExtraTrendRotationCandidateMinScore: item.score,
          strictExtraTrendRotationCandidateMinMom20: item.mom20,
          strictExtraTrendRotationCandidateMinMomAccel: item.momAccel,
          strictExtraTrendRotationCandidateMinEfficiencyRatio: item.efficiency,
          strictExtraTrendRotationCandidateMinAdx14: item.adx,
          label: `pengu_early_${item.key}_eth_only`,
        },
      },
    ]),
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(`${variant.key}: end=${summary.endEquity} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} PENGU=${summary.PENGU} rotations=${summary.penguRotationEntries} rotationPnl=${summary.penguRotationPnl}`);
  }

  const md = [
    "# PENGU Early Rotation Test",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | ETH | SOL | AVAX | INJ | PENGU | DOGE | UNI | TWT | PENGU trades | PENGU rotation entries | rotation pnl |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.ETH} | ${row.SOL} | ${row.AVAX} | ${row.INJ} | ${row.PENGU} | ${row.DOGE} | ${row.UNI} | ${row.TWT} | ${row.penguTrades} | ${row.penguRotationEntries} | ${row.penguRotationPnl} |`),
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, `result${REPORT_SUFFIX}.json`), JSON.stringify(rows, null, 2), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, `result${REPORT_SUFFIX}.md`), md, "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
