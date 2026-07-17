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

const REPORT_DIR = path.join(process.cwd(), "reports", "pengu-strong-hold-guard");
const START_TS = Date.UTC(2022, 0, 1, 0, 0, 0, 0);
const END_TS = Date.UTC(2026, 3, 18, 23, 59, 59, 999);
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
  const bySymbol = (symbol: string) => result.trade_pairs.filter((row) => row.symbol === symbol);
  const symbolPnl = (symbol: string) => round(result.summary.symbol_contribution[symbol] ?? 0);
  const penguToSol = result.trade_pairs.filter((row) =>
    row.symbol === "PENGU"
    && ["trend-switch", "trend-rotate", "rebalance-switch"].includes(row.exit_reason)
  );

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
    penguTrades: bySymbol("PENGU").length,
    penguSwitchAwayCount: penguToSol.length,
    penguSwitchAwayPnl: round(penguToSol.reduce((sum, row) => sum + row.net_pnl, 0)),
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

  const variants: Array<{ key: string; options: HybridVariantOptions; memo: string }> = [
    {
      key: "production_current",
      memo: "Current deployed logic.",
      options: { ...production, label: "production_current" },
    },
    {
      key: "pengu_strong_hold_vs_sol_requested",
      memo: "Block PENGU -> SOL only when PENGU score>=30, mom20>=12%, momAccel>=5%, efficiency>=0.45, and SOL lead is under 10.",
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardMinCurrentScore: 30,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.12,
        strictExtraTrendSwitchGuardMinCurrentMomAccel: 0.05,
        strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.45,
        strictExtraTrendSwitchGuardRequiredScoreGap: 10,
        strictExtraTrendSwitchGuardMode: "all",
        label: "pengu_strong_hold_vs_sol_requested",
      },
    },
    ...[0.01, 0.015, 0.02].map((momAccel) => ({
      key: `pengu_strong_hold_vs_sol_mom_accel_${String(momAccel).replace(".", "p")}`,
      memo: `Block PENGU -> SOL only when PENGU score>=30, mom20>=12%, momAccel>=${momAccel}, efficiency>=0.45, and SOL lead is under 10.`,
      options: {
        ...production,
        strictExtraTrendSwitchGuardSymbols: ["PENGU"],
        strictExtraTrendSwitchGuardTargetSymbols: ["SOL"],
        strictExtraTrendSwitchGuardMinCurrentScore: 30,
        strictExtraTrendSwitchGuardMinCurrentMom20: 0.12,
        strictExtraTrendSwitchGuardMinCurrentMomAccel: momAccel,
        strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.45,
        strictExtraTrendSwitchGuardRequiredScoreGap: 10,
        strictExtraTrendSwitchGuardMode: "all",
        label: `pengu_strong_hold_vs_sol_mom_accel_${String(momAccel).replace(".", "p")}`,
      },
    })),
    ...[0.02, 0.05, 0.08, 0.10].flatMap((momAccel) => [
      {
        key: `pengu_strong_hold_vs_eth_sol_mom_accel_${String(momAccel).replace(".", "p")}`,
        memo: `Block PENGU -> ETH/SOL when PENGU score>=30, mom20>=12%, momAccel>=${momAccel}, efficiency>=0.45, and target lead is under 10.`,
        options: {
          ...production,
          strictExtraTrendSwitchGuardSymbols: ["PENGU"],
          strictExtraTrendSwitchGuardTargetSymbols: ["ETH", "SOL"],
          strictExtraTrendSwitchGuardMinCurrentScore: 30,
          strictExtraTrendSwitchGuardMinCurrentMom20: 0.12,
          strictExtraTrendSwitchGuardMinCurrentMomAccel: momAccel,
          strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.45,
          strictExtraTrendSwitchGuardRequiredScoreGap: 10,
          strictExtraTrendSwitchGuardMode: "all",
          label: `pengu_strong_hold_vs_eth_sol_mom_accel_${String(momAccel).replace(".", "p")}`,
        },
      },
      {
        key: `pengu_strong_hold_vs_any_mom_accel_${String(momAccel).replace(".", "p")}`,
        memo: `Block PENGU -> any normal candidate when PENGU score>=30, mom20>=12%, momAccel>=${momAccel}, efficiency>=0.45, and target lead is under 10.`,
        options: {
          ...production,
          strictExtraTrendSwitchGuardSymbols: ["PENGU"],
          strictExtraTrendSwitchGuardMinCurrentScore: 30,
          strictExtraTrendSwitchGuardMinCurrentMom20: 0.12,
          strictExtraTrendSwitchGuardMinCurrentMomAccel: momAccel,
          strictExtraTrendSwitchGuardMinCurrentEfficiencyRatio: 0.45,
          strictExtraTrendSwitchGuardRequiredScoreGap: 10,
          strictExtraTrendSwitchGuardMode: "all",
          label: `pengu_strong_hold_vs_any_mom_accel_${String(momAccel).replace(".", "p")}`,
        },
      },
    ]),
    ...[
      { key: "trail_12_8", activation: 0.12, retrace: 0.08, momAccel: 0.05 },
      { key: "trail_12_10", activation: 0.12, retrace: 0.10, momAccel: 0.05 },
      { key: "trail_18_7", activation: 0.18, retrace: 0.07, momAccel: 0.05 },
      { key: "trail_18_8", activation: 0.18, retrace: 0.08, momAccel: 0.05 },
      { key: "trail_12_8_mom_accel_0p02", activation: 0.12, retrace: 0.08, momAccel: 0.02 },
      { key: "trail_18_7_mom_accel_0p02", activation: 0.18, retrace: 0.07, momAccel: 0.02 },
    ].map((trail) => ({
      key: `pengu_strong_${trail.key}`,
      memo: `When PENGU is strong, use activation=${trail.activation}, retrace=${trail.retrace}, momAccel>=${trail.momAccel}.`,
      options: {
        ...production,
        strictExtraTrendStrongTrailSymbols: ["PENGU"],
        strictExtraTrendStrongTrailMinScore: 30,
        strictExtraTrendStrongTrailMinMom20: 0.12,
        strictExtraTrendStrongTrailMinMomAccel: trail.momAccel,
        strictExtraTrendStrongTrailMinEfficiencyRatio: 0.45,
        strictExtraTrendStrongTrailActivationPct: trail.activation,
        strictExtraTrendStrongTrailRetracePct: trail.retrace,
        label: `pengu_strong_${trail.key}`,
      },
    })),
    ...[0.05, 0.02].map((momAccel) => ({
      key: `pengu_strong_disable_trail_mom_accel_${String(momAccel).replace(".", "p")}`,
      memo: `Disable PENGU strict-extra trailing while PENGU is strong, then restore normal trailing after strength fades. momAccel>=${momAccel}.`,
      options: {
        ...production,
        strictExtraTrendStrongTrailSymbols: ["PENGU"],
        strictExtraTrendStrongTrailMinScore: 30,
        strictExtraTrendStrongTrailMinMom20: 0.12,
        strictExtraTrendStrongTrailMinMomAccel: momAccel,
        strictExtraTrendStrongTrailMinEfficiencyRatio: 0.45,
        strictExtraTrendStrongTrailDisableWhileStrong: true,
        label: `pengu_strong_disable_trail_mom_accel_${String(momAccel).replace(".", "p")}`,
      },
    })),
    ...[
      { key: "reentry_24h_gap0", maxBars: 24, scoreGap: 0, momAccel: 0.05 },
      { key: "reentry_24h_gap10", maxBars: 24, scoreGap: 10, momAccel: 0.05 },
      { key: "reentry_48h_gap0", maxBars: 48, scoreGap: 0, momAccel: 0.05 },
      { key: "reentry_48h_gap10", maxBars: 48, scoreGap: 10, momAccel: 0.05 },
      { key: "reentry_48h_gap0_mom_accel_0p02", maxBars: 48, scoreGap: 0, momAccel: 0.02 },
      { key: "reentry_48h_gap10_mom_accel_0p02", maxBars: 48, scoreGap: 10, momAccel: 0.02 },
    ].map((reentry) => ({
      key: `pengu_${reentry.key}`,
      memo: `After PENGU trailing exit, allow PENGU reentry within ${reentry.maxBars} engine bars if strong and score gap >= ${reentry.scoreGap}.`,
      options: {
        ...production,
        strictExtraTrendReentryAfterExitSymbols: ["PENGU"],
        strictExtraTrendReentryAfterExitReasons: ["strict-extra-trailing"],
        strictExtraTrendReentryMinBarsAfterExit: 1,
        strictExtraTrendReentryMaxBarsAfterExit: reentry.maxBars,
        strictExtraTrendReentryMinScore: 30,
        strictExtraTrendReentryMinMom20: 0.12,
        strictExtraTrendReentryMinMomAccel: reentry.momAccel,
        strictExtraTrendReentryMinEfficiencyRatio: 0.45,
        strictExtraTrendReentryRequiredScoreGap: reentry.scoreGap,
        label: `pengu_${reentry.key}`,
      },
    })),
    ...[
      { timeframe: "4h" as const, key: "reentry_4h_24h_gap0", maxBars: 24, scoreGap: 0, mom20: 0.12, momAccel: 0.05, eff: 0.45 },
      { timeframe: "4h" as const, key: "reentry_4h_24h_gap10", maxBars: 24, scoreGap: 10, mom20: 0.12, momAccel: 0.05, eff: 0.45 },
      { timeframe: "4h" as const, key: "reentry_4h_48h_gap0", maxBars: 48, scoreGap: 0, mom20: 0.12, momAccel: 0.05, eff: 0.45 },
      { timeframe: "4h" as const, key: "reentry_4h_48h_loose", maxBars: 48, scoreGap: 0, mom20: 0.08, momAccel: 0.02, eff: 0.35 },
      { timeframe: "1h" as const, key: "reentry_1h_24h_gap0", maxBars: 24, scoreGap: 0, mom20: 0.12, momAccel: 0.05, eff: 0.45 },
      { timeframe: "1h" as const, key: "reentry_1h_24h_gap10", maxBars: 24, scoreGap: 10, mom20: 0.12, momAccel: 0.05, eff: 0.45 },
      { timeframe: "1h" as const, key: "reentry_1h_48h_gap0", maxBars: 48, scoreGap: 0, mom20: 0.12, momAccel: 0.05, eff: 0.45 },
      { timeframe: "1h" as const, key: "reentry_1h_48h_loose", maxBars: 48, scoreGap: 0, mom20: 0.08, momAccel: 0.02, eff: 0.35 },
    ].map((reentry) => ({
      key: `pengu_${reentry.key}`,
      memo: `After PENGU trailing exit, allow ${reentry.timeframe} PENGU reentry within ${reentry.maxBars} engine bars.`,
      options: {
        ...production,
        strictExtraTrendReentryAfterExitSymbols: ["PENGU"],
        strictExtraTrendReentryAfterExitReasons: ["strict-extra-trailing"],
        strictExtraTrendReentryTimeframe: reentry.timeframe,
        strictExtraTrendReentryMinBarsAfterExit: 1,
        strictExtraTrendReentryMaxBarsAfterExit: reentry.maxBars,
        strictExtraTrendReentryMinScore: 30,
        strictExtraTrendReentryMinMom20: reentry.mom20,
        strictExtraTrendReentryMinMomAccel: reentry.momAccel,
        strictExtraTrendReentryMinEfficiencyRatio: reentry.eff,
        strictExtraTrendReentryRequiredScoreGap: reentry.scoreGap,
        label: `pengu_${reentry.key}`,
      },
    })),
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, memo: variant.memo, ...summary });
    console.log(
      `${variant.key}: end=${summary.endEquity} CAGR=${summary.cagrPct} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.trades} PENGU=${summary.penguPnl} SOL=${summary.solPnl} PENGU_switch=${summary.penguSwitchAwayCount}`,
    );
  }

  const md = [
    "# PENGU Strong Hold Guard",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "- rule: PENGU score >= 30, mom20 >= 0.12, momAccel >= 0.05, efficiency >= 0.45, and SOL score < PENGU score + 10.",
    "",
    "| variant | end equity | CAGR % | MaxDD % | PF | trades | ETH pnl | SOL pnl | INJ pnl | PENGU pnl | DOGE pnl | UNI pnl | TWT pnl | PENGU switch away | switch pnl |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.trades} | ${row.ethPnl} | ${row.solPnl} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.uniPnl} | ${row.twtPnl} | ${row.penguSwitchAwayCount} | ${row.penguSwitchAwayPnl} |`),
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
