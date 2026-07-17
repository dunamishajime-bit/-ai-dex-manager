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

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-15m-idle-tuning");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2025, 11, 31, 0, 0, 0, 0);
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
  const penguPairs = result.trade_pairs.filter((row) => row.symbol === "PENGU");
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    ethPnl: symbolPnl("ETH"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    penguTrades: symbolTrades("PENGU"),
    penguWins: penguPairs.filter((row) => row.net_pnl > 0).length,
    penguLosses: penguPairs.filter((row) => row.net_pnl <= 0).length,
    penguExitReasons: Object.fromEntries(
      [...new Set(penguPairs.map((row) => row.exit_reason))]
        .map((reason) => [reason, penguPairs.filter((row) => row.exit_reason === reason).length]),
    ),
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
      key: "baseline",
      memo: "Current production-equivalent baseline.",
      options: { ...production, label: "baseline" },
    },
  ];

  const entryCandidates = [
    { key: "prod_6_3", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.06, trailRet: 0.03, maxHold: 144 },
    { key: "prod_6_3_long192", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.06, trailRet: 0.03, maxHold: 192 },
    { key: "prod_8_4_long192", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.08, trailRet: 0.04, maxHold: 192 },
    { key: "prod_10_5_long192", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.10, trailRet: 0.05, maxHold: 192 },
    { key: "prod_12_6_long192", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.12, trailRet: 0.06, maxHold: 192 },
    { key: "early_6_3_long192", volumeRatio: 1.05, momAccel: 0.0005, breakoutPct: 0.003, efficiency: 0.14, trailAct: 0.06, trailRet: 0.03, maxHold: 192 },
    { key: "early_8_4_long192", volumeRatio: 1.05, momAccel: 0.0005, breakoutPct: 0.003, efficiency: 0.14, trailAct: 0.08, trailRet: 0.04, maxHold: 192 },
    { key: "early_12_6_long192", volumeRatio: 1.05, momAccel: 0.0005, breakoutPct: 0.003, efficiency: 0.14, trailAct: 0.12, trailRet: 0.06, maxHold: 192 },
    { key: "strict_6_3_long192", volumeRatio: 1.25, momAccel: 0.0025, breakoutPct: 0.008, efficiency: 0.22, trailAct: 0.06, trailRet: 0.03, maxHold: 192 },
    { key: "base_idle", volumeRatio: 1.25, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.10, trailRet: 0.045, maxHold: 96 },
    { key: "early_a", volumeRatio: 1.05, momAccel: 0.0005, breakoutPct: 0.003, efficiency: 0.14, trailAct: 0.08, trailRet: 0.035, maxHold: 48 },
    { key: "early_b", volumeRatio: 1.05, momAccel: 0.0005, breakoutPct: 0.006, efficiency: 0.14, trailAct: 0.10, trailRet: 0.045, maxHold: 96 },
    { key: "early_c", volumeRatio: 1.15, momAccel: 0.0005, breakoutPct: 0.003, efficiency: 0.18, trailAct: 0.10, trailRet: 0.045, maxHold: 96 },
    { key: "balanced_a", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.10, trailRet: 0.045, maxHold: 96 },
    { key: "balanced_b", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.003, efficiency: 0.14, trailAct: 0.12, trailRet: 0.055, maxHold: 96 },
    { key: "strict_a", volumeRatio: 1.25, momAccel: 0.0025, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.12, trailRet: 0.055, maxHold: 96 },
    { key: "strict_b", volumeRatio: 1.25, momAccel: 0.0015, breakoutPct: 0.01, efficiency: 0.18, trailAct: 0.12, trailRet: 0.055, maxHold: 96 },
  ];
  const exitCandidates = [
    { key: "fast_exit", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.08, trailRet: 0.035, maxHold: 48 },
    { key: "wide_exit", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.12, trailRet: 0.055, maxHold: 96 },
    { key: "long_hold", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.12, trailRet: 0.055, maxHold: 144 },
    { key: "combo_early_long", volumeRatio: 1.05, momAccel: 0.0005, breakoutPct: 0.003, efficiency: 0.14, trailAct: 0.12, trailRet: 0.055, maxHold: 144 },
  ];
  const guardCandidates = [
    { key: "guard_soft", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.12, trailRet: 0.055, maxHold: 144, guardScore: 20, guardMom20: 0.03, guardAccel: 0.0005, guardEff: 0.14, guardGap: 8 },
    { key: "guard_mid", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.12, trailRet: 0.055, maxHold: 144, guardScore: 24, guardMom20: 0.04, guardAccel: 0.001, guardEff: 0.16, guardGap: 10 },
    { key: "guard_strict", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.12, trailRet: 0.055, maxHold: 144, guardScore: 28, guardMom20: 0.06, guardAccel: 0.001, guardEff: 0.18, guardGap: 12 },
    { key: "idle_switch_guard_restore", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.06, trailRet: 0.03, maxHold: 144, idleGuardScore: 30, idleGuardMom20: 0.12, idleGuardAccel: 0.01, idleGuardEff: 0.45, idleGuardGap: 12 },
    { key: "idle_switch_guard_soft", volumeRatio: 1.15, momAccel: 0.0015, breakoutPct: 0.006, efficiency: 0.18, trailAct: 0.06, trailRet: 0.03, maxHold: 144, idleGuardScore: 24, idleGuardMom20: 0.04, idleGuardAccel: 0.001, idleGuardEff: 0.16, idleGuardGap: 10 },
  ];
  const group = process.env.PENGU_15M_GROUP ?? "base";
  const selectedCandidates = group === "entry"
    ? entryCandidates
    : group === "exit"
      ? exitCandidates
      : group === "guard"
        ? guardCandidates
        : group === "all"
          ? [...entryCandidates, ...exitCandidates]
          : [entryCandidates[0]];
  const only = process.env.PENGU_15M_ONLY;
  const candidates = only
    ? selectedCandidates.filter((candidate) => candidate.key === only)
    : selectedCandidates;

  for (const candidate of candidates) {
    const guardOptions = candidate.guardScore == null
      ? {}
      : {
          strictExtraTrendDecisionTimeframe: "15m" as const,
          strictExtraTrendExitCheckTimeframe: "15m" as const,
          strictExtraTrendSwitchGuardSymbols: ["PENGU"],
          strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ"],
          strictExtraTrendSwitchGuardMinCurrentScore: candidate.guardScore,
          strictExtraTrendSwitchGuardMinCurrentMom20: candidate.guardMom20,
          strictExtraTrendSwitchGuardMinCurrentMomAccel: candidate.guardAccel,
          strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: candidate.guardEff,
          strictExtraTrendSwitchGuardRequiredScoreGap: candidate.guardGap,
          strictExtraTrendSwitchGuardMode: "all" as const,
        };
    const idleGuardOptions = candidate.idleGuardScore == null
      ? {}
      : {
          idleBreakoutSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ", "DOGE", "TWT", "UNI"],
          idleBreakoutSwitchGuardMinCurrentScore: candidate.idleGuardScore,
          idleBreakoutSwitchGuardMinCurrentMom20: candidate.idleGuardMom20,
          idleBreakoutSwitchGuardMinCurrentMomAccel: candidate.idleGuardAccel,
          idleBreakoutSwitchGuardMinCurrentEfficiencyRatio: candidate.idleGuardEff,
          idleBreakoutSwitchGuardRequiredScoreGap: candidate.idleGuardGap,
          idleBreakoutSwitchGuardBlockAfterTrailActivation: true,
          idleBreakoutSwitchGuardMode: "any" as const,
        };
    variants.push({
      key: candidate.key,
      memo: `vol>=${candidate.volumeRatio}, accel>=${candidate.momAccel}, breakout>=${candidate.breakoutPct}, eff>=${candidate.efficiency}, trail=${candidate.trailAct}/${candidate.trailRet}, maxHold=${candidate.maxHold}`,
      options: {
        ...production,
        idleBreakoutEntryWhileCash: true,
        idleBreakoutEntryTimeframe: "15m",
        idleBreakoutSymbols: ["PENGU"],
        idleBreakoutAllowTradeGateOff: false,
        idleBreakoutMinVolumeRatio: candidate.volumeRatio,
        idleBreakoutMinMomAccel: candidate.momAccel,
        idleBreakoutBreakoutLookbackBars: 16,
        idleBreakoutBreakoutMinPct: candidate.breakoutPct,
        idleBreakoutMinEfficiencyRatio: candidate.efficiency,
        idleBreakoutProfitTrailActivationPct: candidate.trailAct,
        idleBreakoutProfitTrailRetracePct: candidate.trailRet,
        idleBreakoutMaxHoldBars: candidate.maxHold,
        ...guardOptions,
        ...idleGuardOptions,
        label: candidate.key,
      },
    });
  }

  const rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }> = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    if (process.env.WRITE_ARTIFACTS === "1") {
      await writeBacktestArtifacts(result, path.join(REPORT_DIR, `${group}-${variant.key}`));
    }
    rows.push({ key: variant.key, memo: variant.memo, summary: summarize(result) });
    if (rows.length % 50 === 0) console.log(`tested ${rows.length}/${variants.length}`);
  }

  const baseline = rows[0]?.summary;
  const ranked = [...rows].sort((left, right) => right.summary.endEquity - left.summary.endEquity);
  const markdown = [
    "# PENGU 15m Idle Tuning",
    "",
    "## Setup",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    `- Group: ${group}`,
    `- Variants: ${variants.length}`,
    "",
    "## Top 20",
    "",
    "| rank | variant | end equity | delta | MaxDD % | PF | trades | PENGU pnl | PENGU trades | PENGU W/L | params |",
    "|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
    ...ranked.slice(0, 20).map((row, index) => [
      index + 1,
      row.key,
      row.summary.endEquity.toLocaleString(),
      round(row.summary.endEquity - (baseline?.endEquity ?? row.summary.endEquity)).toLocaleString(),
      row.summary.maxDrawdownPct,
      row.summary.profitFactor,
      row.summary.trades,
      row.summary.penguPnl.toLocaleString(),
      row.summary.penguTrades,
      `${row.summary.penguWins}/${row.summary.penguLosses}`,
      row.memo,
    ].join(" | ").replace(/^/, "| ").replace(/$/, " |")),
    "",
    "## Baseline",
    "",
    "```json",
    JSON.stringify(rows[0], null, 2),
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
