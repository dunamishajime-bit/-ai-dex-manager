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
import { writeBacktestArtifacts } from "../lib/backtest/reporting";

type Window = { startTs: number; endTs: number };

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-realtime-overlay");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = process.env.BT_END
  ? Date.parse(`${process.env.BT_END}T23:59:59.999Z`)
  : Date.UTC(2026, 3, 23, 23, 59, 59, 999);
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
    avaxPnl: symbolPnl("AVAX"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    uniPnl: symbolPnl("UNI"),
    twtPnl: symbolPnl("TWT"),
    penguTrades: symbolTrades("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
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
      key: "baseline_current",
      memo: "Current production-equivalent V7 baseline.",
      options: { ...production, label: "baseline_current" },
    },
    {
      key: "pengu_hold_extension",
      memo: "PENGU保有中のみ。PENGUがまだ強い時だけETH/SOL/AVAX/INJへの乗り換えを抑制。",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ"],
        strictExtraTrendSwitchGuardMinCurrentScore: 24,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.08,
        strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.005,
        strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.20,
        strictExtraTrendSwitchGuardRequiredScoreGap: 10,
        strictExtraTrendSwitchGuardMode: "all",
        label: "pengu_hold_extension",
      },
    },
    {
      key: "pengu_strict_hold_extension",
      memo: "PENGU保有中のみ厳格版。PENGUがかなり強い時だけETH/SOLへの乗り換えを抑制。",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL"],
        strictExtraTrendSwitchGuardMinCurrentScore: 36,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.14,
        strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.02,
        strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.28,
        strictExtraTrendSwitchGuardRequiredScoreGap: 14,
        strictExtraTrendSwitchGuardMode: "all",
        label: "pengu_strict_hold_extension",
      },
    },
    {
      key: "pengu_score_rising_priority",
      memo: "PENGUのScore上昇中プロキシ。通常通貨保有中にPENGUが1Hで改善した時だけPENGUへ早めにローテーション許可。",
      options: {
        ...production,
        strictExtraTrendDecisionTimeframe: "1h",
        strictExtraTrendExitCheckTimeframe: "1h",
        strictExtraTrendRotationWhileHolding: true,
        strictExtraTrendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ"],
        strictExtraTrendRotationScoreGapBySymbol: { PENGU: 8 },
        strictExtraTrendRotationCurrentMomAccelMax: 0.005,
        strictExtraTrendRotationCurrentMom20Max: 0.12,
        strictExtraTrendRotationCandidateMinScore: 22,
        strictExtraTrendRotationCandidateMinMom20: 0.06,
        strictExtraTrendRotationCandidateMinMomAccel: 0.006,
        strictExtraTrendRotationCandidateMinEfficiencyRatio: 0.18,
        strictExtraTrendRotationRequireConsecutiveBarsBySymbol: { PENGU: 1 },
        strictExtraTrendRotationMinHoldBars: 1,
        label: "pengu_score_rising_priority",
      },
    },
    {
      key: "pengu_idle_early_pick_only",
      memo: "USDT待機中のみPENGU。PENGUのブレイクプロキシが出た時だけ早期拾い。",
      options: {
        ...production,
        idleBreakoutEntryWhileCash: true,
        idleBreakoutEntryTimeframe: "4h",
        idleBreakoutSymbols: ["PENGU"],
        idleBreakoutAllowTradeGateOff: false,
        idleBreakoutMinVolumeRatio: 1.15,
        idleBreakoutMinMomAccel: 0.002,
        idleBreakoutBreakoutLookbackBars: 8,
        idleBreakoutBreakoutMinPct: 0.012,
        idleBreakoutMinEfficiencyRatio: 0.20,
        idleBreakoutProfitTrailActivationPct: 0.12,
        idleBreakoutProfitTrailRetracePct: 0.06,
        idleBreakoutMaxHoldBars: 8,
        label: "pengu_idle_early_pick_only",
      },
    },
    {
      key: "pengu_hold_plus_score_rising",
      memo: "PENGU保有延長 + PENGU Score上昇時の早めローテーション。",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ"],
        strictExtraTrendSwitchGuardMinCurrentScore: 24,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.08,
        strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.005,
        strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.20,
        strictExtraTrendSwitchGuardRequiredScoreGap: 10,
        strictExtraTrendSwitchGuardMode: "all",
        strictExtraTrendDecisionTimeframe: "1h",
        strictExtraTrendExitCheckTimeframe: "1h",
        strictExtraTrendRotationWhileHolding: true,
        strictExtraTrendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ"],
        strictExtraTrendRotationScoreGapBySymbol: { PENGU: 8 },
        strictExtraTrendRotationCurrentMomAccelMax: 0.005,
        strictExtraTrendRotationCurrentMom20Max: 0.12,
        strictExtraTrendRotationCandidateMinScore: 22,
        strictExtraTrendRotationCandidateMinMom20: 0.06,
        strictExtraTrendRotationCandidateMinMomAccel: 0.006,
        strictExtraTrendRotationCandidateMinEfficiencyRatio: 0.18,
        strictExtraTrendRotationRequireConsecutiveBarsBySymbol: { PENGU: 1 },
        strictExtraTrendRotationMinHoldBars: 1,
        label: "pengu_hold_plus_score_rising",
      },
    },
  ];

  const rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }> = [];
  for (const variant of variants) {
    console.log(`running ${variant.key}`);
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push({ key: variant.key, memo: variant.memo, summary: summarize(result) });
  }

  const baseline = rows[0]?.summary;
  const markdown = [
    "# PENGU Realtime Overlay Backtest",
    "",
    "## Setup",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "- Method: engine-connected 1H/4H proxy. 15m historical overlay is not yet wired.",
    "",
    "## Summary",
    "",
    "| variant | end equity | delta | CAGR % | MaxDD % | PF | trades | ETH | SOL | AVAX | INJ | PENGU | DOGE | UNI | TWT | PENGU trades |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map(({ key, summary }) => [
      key,
      summary.endEquity.toLocaleString(),
      round(summary.endEquity - (baseline?.endEquity ?? summary.endEquity)).toLocaleString(),
      summary.cagrPct,
      summary.maxDrawdownPct,
      summary.profitFactor,
      summary.trades,
      summary.ethPnl.toLocaleString(),
      summary.solPnl.toLocaleString(),
      summary.avaxPnl.toLocaleString(),
      summary.injPnl.toLocaleString(),
      summary.penguPnl.toLocaleString(),
      summary.dogePnl.toLocaleString(),
      summary.uniPnl.toLocaleString(),
      summary.twtPnl.toLocaleString(),
      summary.penguTrades,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Variant Meaning",
    "",
    ...rows.flatMap(({ key, memo }) => [`- ${key}: ${memo}`]),
    "",
    "## Raw JSON",
    "",
    "```json",
    JSON.stringify(rows, null, 2),
    "```",
    "",
  ].join("\n");

  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), markdown, "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
  console.log(markdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
