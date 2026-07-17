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

const REPORT_DIR = process.env.REPORT_DIR
  ? path.resolve(process.cwd(), process.env.REPORT_DIR)
  : path.join(process.cwd(), "reports", "v7-pengu-idle-breakout-compare");
const START_TS = process.env.BT_START
  ? Date.parse(`${process.env.BT_START}T00:00:00.000Z`)
  : Date.UTC(2024, 6, 1, 0, 0, 0, 0);
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

function withSwitchGuard(base: HybridVariantOptions) {
  return {
    ...base,
    idleBreakoutSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ", "DOGE", "TWT", "UNI"],
    idleBreakoutSwitchGuardMinCurrentScore: 30,
    idleBreakoutSwitchGuardMinCurrentMom20: 0.12,
    idleBreakoutSwitchGuardMinCurrentMomAccel: 0.01,
    idleBreakoutSwitchGuardMinCurrentEfficiencyRatio: 0.45,
    idleBreakoutSwitchGuardRequiredScoreGap: 12,
    idleBreakoutSwitchGuardBlockAfterTrailActivation: true,
    idleBreakoutSwitchGuardMode: "any",
  } satisfies HybridVariantOptions;
}

function withWeakExit(base: HybridVariantOptions) {
  return {
    ...base,
    idleBreakoutWeakExitMom20Below: 0.03,
    idleBreakoutWeakExitMomAccelBelow: -0.01,
    idleBreakoutWeakExitMinHoldBars: 4,
    idleBreakoutWeakExitRequireCloseBelowSma40: true,
  } satisfies HybridVariantOptions;
}

function withDrawdownRotationBlock(base: HybridVariantOptions) {
  return {
    ...base,
    strictExtraTrendRotationBlockBelowDrawdownPct: -35,
  } satisfies HybridVariantOptions;
}

function withoutAddedPenguControls(base: HybridVariantOptions) {
  return {
    ...base,
    idleBreakoutWeakExitMom20Below: null,
    idleBreakoutWeakExitMomAccelBelow: null,
    idleBreakoutWeakExitMinHoldBars: null,
    idleBreakoutWeakExitRequireCloseBelowSma40: false,
    idleBreakoutSwitchGuardTargetSymbols: [],
    idleBreakoutSwitchGuardMinCurrentScore: null,
    idleBreakoutSwitchGuardMinCurrentMom20: null,
    idleBreakoutSwitchGuardMinCurrentMomAccel: null,
    idleBreakoutSwitchGuardMinCurrentEfficiencyRatio: null,
    idleBreakoutSwitchGuardRequiredScoreGap: null,
    idleBreakoutSwitchGuardBlockAfterTrailActivation: false,
    idleBreakoutSwitchGuardMode: "any",
    strictExtraTrendRotationBlockBelowDrawdownPct: null,
  } satisfies HybridVariantOptions;
}

function withFormalPengu1h(base: HybridVariantOptions, maxHoldBars: number) {
  return {
    ...base,
    idleBreakoutEntryWhileCash: true,
    idleBreakoutEntryTimeframe: "1h",
    idleBreakoutSymbols: ["PENGU"],
    idleBreakoutAllowTradeGateOff: false,
    idleBreakoutMinVolumeRatio: 1.15,
    idleBreakoutMinMomAccel: 0.0015,
    idleBreakoutBreakoutLookbackBars: 16,
    idleBreakoutBreakoutMinPct: 0.006,
    idleBreakoutMinEfficiencyRatio: 0.18,
    idleBreakoutProfitTrailActivationPct: 0.06,
    idleBreakoutProfitTrailRetracePct: 0.03,
    idleBreakoutMaxHoldBars: maxHoldBars,
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const symbolTrades = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol).length;
  const exitCount = (symbol: string, reason: string) =>
    result.trade_pairs.filter((row) => row.symbol === symbol && row.exit_reason === reason).length;
  const penguPairs = result.trade_pairs.filter((row) => row.symbol === "PENGU");
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    trades: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    ethPnl: symbolPnl("ETH"),
    injPnl: symbolPnl("INJ"),
    penguPnl: symbolPnl("PENGU"),
    dogePnl: symbolPnl("DOGE"),
    uniPnl: symbolPnl("UNI"),
    twtPnl: symbolPnl("TWT"),
    penguTrades: symbolTrades("PENGU"),
    penguWins: penguPairs.filter((row) => row.net_pnl > 0).length,
    penguLosses: penguPairs.filter((row) => row.net_pnl <= 0).length,
    penguTrendSwitchExits: exitCount("PENGU", "trend-switch"),
    penguWeakExits: exitCount("PENGU", "idle-breakout-weak-exit"),
    penguTrailingExits: exitCount("PENGU", "idle-breakout-trailing"),
    penguTimeExits: exitCount("PENGU", "idle-breakout-time"),
    penguSmaBreakExits: exitCount("PENGU", "sma-break"),
  };
}

function buildMarkdown(rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }>) {
  const baseline = rows[0]?.summary;
  return [
    "# V7 PENGU Idle Breakout Compare",
    "",
    "## Setup",
    "",
    `- Start: ${new Date(START_TS).toISOString()}`,
    `- End: ${new Date(END_TS).toISOString()}`,
    "- Method: engine-direct `runHybridBacktest(\"RETQ22\", options)` using current local hybrid engine.",
    "- Note: restoretmp 29M behavior is not copied; 1H candidates use explicit `idleBreakoutEntryTimeframe: \"1h\"`.",
    "",
    "## Summary",
    "",
    "| variant | end equity | delta | CAGR % | MaxDD % | PF | trades | exposure % | ETH | INJ | PENGU | DOGE | UNI | TWT | PENGU trades | PENGU W/L | PENGU trend-switch | weak exits | trail exits | time exits | sma-break |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
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
      summary.injPnl.toLocaleString(),
      summary.penguPnl.toLocaleString(),
      summary.dogePnl.toLocaleString(),
      summary.uniPnl.toLocaleString(),
      summary.twtPnl.toLocaleString(),
      summary.penguTrades,
      `${summary.penguWins}/${summary.penguLosses}`,
      summary.penguTrendSwitchExits,
      summary.penguWeakExits,
      summary.penguTrailingExits,
      summary.penguTimeExits,
      summary.penguSmaBreakExits,
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
}

async function writeSummary(rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }>) {
  await fs.writeFile(path.join(REPORT_DIR, "summary.md"), buildMarkdown(rows), "utf8");
  await fs.writeFile(path.join(REPORT_DIR, "summary.json"), JSON.stringify(rows, null, 2), "utf8");
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
  const legacyProduction = withoutAddedPenguControls(production);

  const switchGuard = withSwitchGuard(legacyProduction);
  const switchGuardWeakExit = withWeakExit(switchGuard);
  const switchGuardWeakExitDrawdownBlock = withDrawdownRotationBlock(switchGuardWeakExit);

  const variants: Array<{ key: string; memo: string; options: HybridVariantOptions }> = [
    {
      key: "v7_legacy_before_added_controls",
      memo: "V7 production profile before adding PENGU switch guard and weak exit.",
      options: { ...legacyProduction, label: "v7_legacy_before_added_controls" },
    },
    {
      key: "v7_plus_idle_switch_guard",
      memo: "Current V7 + idleBreakoutSwitchGuard restore values.",
      options: { ...switchGuard, label: "v7_plus_idle_switch_guard" },
    },
    {
      key: "v7_plus_idle_switch_guard_weak_exit",
      memo: "Current V7 + switch guard + PENGU weak exit.",
      options: { ...switchGuardWeakExit, label: "v7_plus_idle_switch_guard_weak_exit" },
    },
    {
      key: "v7_plus_idle_switch_guard_weak_exit_dd_block_35",
      memo: "Current V7 + switch guard + weak exit + strictExtraTrendRotationBlockBelowDrawdownPct -35.",
      options: { ...switchGuardWeakExitDrawdownBlock, label: "v7_plus_idle_switch_guard_weak_exit_dd_block_35" },
    },
    {
      key: "v7_profile_after_added_controls",
      memo: "V7 profile after adding PENGU switch guard and weak exit to config.",
      options: { ...production, label: "v7_profile_after_added_controls" },
    },
    ...[36, 48, 72].map((maxHold) => ({
      key: `formal_pengu_1h_long_hold_maxhold_${maxHold}`,
      memo: `Formal PENGU 1h idle-breakout long_hold. vol>=1.15, accel>=0.0015, breakout>=0.006, eff>=0.18, trail 6%/3%, maxHold ${maxHold}.`,
      options: {
        ...withFormalPengu1h(production, maxHold),
        label: `formal_pengu_1h_long_hold_maxhold_${maxHold}`,
      },
    })),
  ];

  const variantFilter = process.env.BT_VARIANTS
    ? new Set(process.env.BT_VARIANTS.split(",").map((item) => item.trim()).filter(Boolean))
    : null;
  const selectedVariants = variantFilter
    ? variants.filter((variant) => variantFilter.has(variant.key))
    : variants;

  const rows: Array<{ key: string; memo: string; summary: ReturnType<typeof summarize> }> = [];
  for (const variant of selectedVariants) {
    console.log(`running ${variant.key}`);
    const result = await runHybridBacktest("RETQ22", variant.options);
    if (process.env.WRITE_ARTIFACTS === "1") {
      await writeBacktestArtifacts(result, path.join(REPORT_DIR, variant.key));
    }
    rows.push({ key: variant.key, memo: variant.memo, summary: summarize(result) });
    await writeSummary(rows);
  }

  console.log(buildMarkdown(rows));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
