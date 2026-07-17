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

const REPORT_DIR = path.join(process.cwd(), "reports", "realtime-market-overlay");
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
  const exitCount = (reason: string) => result.trade_pairs.filter((row) => row.exit_reason === reason).length;
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
    ethTrades: symbolTrades("ETH"),
    solTrades: symbolTrades("SOL"),
    avaxTrades: symbolTrades("AVAX"),
    injTrades: symbolTrades("INJ"),
    penguTrades: symbolTrades("PENGU"),
    dogeTrades: symbolTrades("DOGE"),
    uniTrades: symbolTrades("UNI"),
    twtTrades: symbolTrades("TWT"),
    strictTrailExits: exitCount("strict-extra-trailing"),
    trendTrailExits: exitCount("trend-profit-trailing"),
    idleBreakoutExits: exitCount("idle-breakout-trailing") + exitCount("idle-breakout-time"),
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

  const strongHold = {
    strictExtraTrendSwitchGuardSymbols: ["PENGU", "DOGE"],
    strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ"],
    strictExtraTrendSwitchGuardMinCurrentScore: 24,
    strictExtraTrendSwitchGuardMinCurrentMom20: 0.08,
    strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.005,
    strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.20,
    strictExtraTrendSwitchGuardRequiredScoreGap: 10,
    strictExtraTrendSwitchGuardMode: "all" as const,
  } satisfies Partial<HybridVariantOptions>;

  const penguOnlyStrongHold = {
    strictExtraTrendSwitchGuardSymbols: ["PENGU"],
    strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ"],
    strictExtraTrendSwitchGuardMinCurrentScore: 24,
    strictExtraTrendSwitchGuardMinCurrentMom20: 0.08,
    strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.005,
    strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.20,
    strictExtraTrendSwitchGuardRequiredScoreGap: 10,
    strictExtraTrendSwitchGuardMode: "all" as const,
  } satisfies Partial<HybridVariantOptions>;

  const penguOnlyStrictHold = {
    strictExtraTrendSwitchGuardSymbols: ["PENGU"],
    strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL"],
    strictExtraTrendSwitchGuardMinCurrentScore: 36,
    strictExtraTrendSwitchGuardMinCurrentMom20: 0.14,
    strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.02,
    strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.28,
    strictExtraTrendSwitchGuardRequiredScoreGap: 14,
    strictExtraTrendSwitchGuardMode: "all" as const,
  } satisfies Partial<HybridVariantOptions>;

  const penguScoreRisingPriority = {
    strictExtraTrendDecisionTimeframe: "1h" as const,
    strictExtraTrendExitCheckTimeframe: "1h" as const,
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
  } satisfies Partial<HybridVariantOptions>;

  const penguIdleEarlyPick = {
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "4h" as const,
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
  } satisfies Partial<HybridVariantOptions>;

  const realtimePriority = {
    strictExtraTrendDecisionTimeframe: "1h" as const,
    strictExtraTrendExitCheckTimeframe: "1h" as const,
    strictExtraTrendRotationWhileHolding: true,
    strictExtraTrendRotationScoreGap: 6,
    strictExtraTrendRotationCurrentMomAccelMax: 0.01,
    strictExtraTrendRotationCurrentMom20Max: 0.12,
    strictExtraTrendRotationCandidateMinScore: 18,
    strictExtraTrendRotationCandidateMinMom20: 0.04,
    strictExtraTrendRotationCandidateMinMomAccel: 0.002,
    strictExtraTrendRotationCandidateMinEfficiencyRatio: 0.16,
    strictExtraTrendRotationRequireConsecutiveBars: 1,
    strictExtraTrendRotationMinHoldBars: 1,
  } satisfies Partial<HybridVariantOptions>;

  const idleEarlyPick = {
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "4h" as const,
    idleBreakoutSymbols: ["PENGU", "DOGE", "UNI", "TWT"],
    idleBreakoutAllowTradeGateOff: true,
    idleBreakoutMinVolumeRatio: 1.05,
    idleBreakoutMinMomAccel: 0.0005,
    idleBreakoutBreakoutLookbackBars: 8,
    idleBreakoutBreakoutMinPct: 0.01,
    idleBreakoutMinEfficiencyRatio: 0.16,
    idleBreakoutProfitTrailActivationPct: 0.12,
    idleBreakoutProfitTrailRetracePct: 0.06,
    idleBreakoutMaxHoldBars: 10,
  } satisfies Partial<HybridVariantOptions>;

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "baseline_current",
      memo: "Current production-equivalent V7 baseline. Realtime data is display/reference only.",
      options: { ...production, label: "baseline_current" },
    },
    {
      key: "rt_proxy_strong_hold",
      memo: "Use realtime-score proxy for strong PENGU/DOGE holding extension. Blocks weak rotations to ETH/SOL/AVAX/INJ while current meme trend remains strong.",
      options: { ...production, ...strongHold, label: "rt_proxy_strong_hold" },
    },
    {
      key: "pengu_only_hold_extension",
      memo: "PENGU holding only. Blocks rotations away from PENGU when PENGU remains strong.",
      options: { ...production, ...penguOnlyStrongHold, label: "pengu_only_hold_extension" },
    },
    {
      key: "pengu_only_strict_hold_extension",
      memo: "PENGU holding only, stricter. Blocks only ETH/SOL rotations when PENGU is very strong.",
      options: { ...production, ...penguOnlyStrictHold, label: "pengu_only_strict_hold_extension" },
    },
    {
      key: "pengu_score_rising_priority",
      memo: "PENGU score rising proxy. Allows faster rotation into PENGU from normal trend symbols when PENGU 1H proxy is improving.",
      options: { ...production, ...penguScoreRisingPriority, label: "pengu_score_rising_priority" },
    },
    {
      key: "pengu_idle_early_pick_only",
      memo: "USDT waiting only, PENGU only. Tries to catch PENGU early when breakout proxy fires.",
      options: { ...production, ...penguIdleEarlyPick, label: "pengu_idle_early_pick_only" },
    },
    {
      key: "pengu_hold_plus_score_rising",
      memo: "PENGU holding extension + faster rotation into rising PENGU.",
      options: { ...production, ...penguOnlyStrongHold, ...penguScoreRisingPriority, label: "pengu_hold_plus_score_rising" },
    },
    {
      key: "pengu_hold_plus_idle_pick",
      memo: "PENGU holding extension + USDT waiting PENGU early pick.",
      options: { ...production, ...penguOnlyStrongHold, ...penguIdleEarlyPick, label: "pengu_hold_plus_idle_pick" },
    },
    {
      key: "rt_proxy_strict_pengudoge_hold",
      memo: "Stricter hold-extension only. Blocks rotations only when PENGU/DOGE are very strong on the existing engine score proxy.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU", "DOGE"],
        strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL"],
        strictExtraTrendSwitchGuardMinCurrentScore: 36,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.14,
        strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.02,
        strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.28,
        strictExtraTrendSwitchGuardRequiredScoreGap: 14,
        strictExtraTrendSwitchGuardMode: "all",
        label: "rt_proxy_strict_pengudoge_hold",
      },
    },
    {
      key: "rt_proxy_pengudoge_trail_wide_when_strong",
      memo: "Do not block rotation. Only widen PENGU/DOGE trailing while strong, using the realtime-score proxy idea as a softer effect.",
      options: {
        ...production,
        strictExtraTrendStrongTrailSymbols: ["PENGU", "DOGE"],
        strictExtraTrendStrongTrailMinScore: 36,
        strictExtraTrendStrongTrailMinMom20: 0.14,
        strictExtraTrendStrongTrailMinMomAccel: 0.02,
        strictExtraTrendStrongTrailMinEfficiencyRatio: 0.28,
        strictExtraTrendStrongTrailActivationPct: 0.18,
        strictExtraTrendStrongTrailRetracePct: 0.12,
        label: "rt_proxy_pengudoge_trail_wide_when_strong",
      },
    },
    {
      key: "rt_proxy_priority",
      memo: "Use 1H realtime-score proxy to make PENGU/DOGE rotation priority more responsive.",
      options: { ...production, ...realtimePriority, label: "rt_proxy_priority" },
    },
    {
      key: "rt_proxy_idle_early_pick",
      memo: "Use realtime breakout proxy only while in USDT. 4H proxy is used because engine idle breakout supports 4H/6H/12H.",
      options: { ...production, ...idleEarlyPick, label: "rt_proxy_idle_early_pick" },
    },
    {
      key: "rt_proxy_combo",
      memo: "Strong hold + responsive priority + USDT idle early pick.",
      options: { ...production, ...strongHold, ...realtimePriority, ...idleEarlyPick, label: "rt_proxy_combo" },
    },
  ];

  const rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }> = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    rows.push({ key: variant.key, memo: variant.memo, summary: summarize(result) });
  }

  const baseline = rows[0]?.summary;
  const markdown = [
    "# Realtime Market Overlay Backtest",
    "",
    "## Setup",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "- Method: engine-connected backtest using 1H/4H proxy for the HP/Telegram realtime market checks.",
    "- Note: 15m historical execution is not yet wired into the backtest engine, so this is the safe first-pass proxy.",
    "",
    "## Summary",
    "",
    "| variant | end equity | delta | CAGR % | MaxDD % | PF | trades | exposure % | ETH | SOL | AVAX | INJ | PENGU | DOGE | UNI | TWT |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...rows.map(({ key, summary }) => [
      key,
      summary.endEquity.toLocaleString(),
      round(summary.endEquity - (baseline?.endEquity ?? summary.endEquity)).toLocaleString(),
      summary.cagrPct,
      summary.maxDrawdownPct,
      summary.profitFactor,
      summary.trades,
      summary.exposurePct,
      summary.ethPnl.toLocaleString(),
      summary.solPnl.toLocaleString(),
      summary.avaxPnl.toLocaleString(),
      summary.injPnl.toLocaleString(),
      summary.penguPnl.toLocaleString(),
      summary.dogePnl.toLocaleString(),
      summary.uniPnl.toLocaleString(),
      summary.twtPnl.toLocaleString(),
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
