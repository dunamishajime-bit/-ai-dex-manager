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

const REPORT_DIR = path.join(process.cwd(), "reports", "eth-main-fix-after-inj");
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

function baseOptions(): HybridVariantOptions {
  return {
    ...buildReclaimHybridVariantOptions(RECLAIM_HYBRID_EXECUTION_PROFILE),
    backtestStartTs: START_TS,
    backtestEndTs: END_TS,
  } satisfies HybridVariantOptions;
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

function withInjLooseException(options: HybridVariantOptions) {
  return {
    ...options,
    trendRotationTargetBlockSymbols: unique([...(options.trendRotationTargetBlockSymbols ?? []), "INJ"]),
    trendRotationTargetExceptionBySymbol: {
      ...(options.trendRotationTargetExceptionBySymbol ?? {}),
      INJ: {
        minMom20: 0.12,
        minMomAccel: 0.01,
        minVolumeRatio: 1.15,
        minAdx14: 18,
        minEfficiencyRatio: 0.2,
        requireStructureBreak: true,
        requireDowHigherHighLow: false,
      },
    },
    trendBreakoutLookbackBarsBySymbol: {
      ...(options.trendBreakoutLookbackBarsBySymbol ?? {}),
      INJ: 2,
    },
  } satisfies HybridVariantOptions;
}

function withEthWeakExit(options: HybridVariantOptions, mom20Below: number, momAccelBelow: number) {
  return {
    ...options,
    symbolSpecificTrendWeakExitSymbols: unique([...(options.symbolSpecificTrendWeakExitSymbols ?? []), "ETH"]),
    symbolSpecificTrendWeakExitMom20BelowBySymbol: {
      ...(options.symbolSpecificTrendWeakExitMom20BelowBySymbol ?? {}),
      ETH: mom20Below,
    },
    symbolSpecificTrendWeakExitMomAccelBelowBySymbol: {
      ...(options.symbolSpecificTrendWeakExitMomAccelBelowBySymbol ?? {}),
      ETH: momAccelBelow,
    },
  } satisfies HybridVariantOptions;
}

function withEthQualityFilter(options: HybridVariantOptions, suffix: "soft" | "balanced" | "strict") {
  const params = suffix === "soft"
    ? { lookback: 2, minPct: 0.01, volume: 1.05, accel: 0.003, eff: 0.18 }
    : suffix === "balanced"
      ? { lookback: 3, minPct: 0.012, volume: 1.12, accel: 0.006, eff: 0.22 }
      : { lookback: 4, minPct: 0.018, volume: 1.2, accel: 0.01, eff: 0.26 };
  return {
    ...options,
    trendBreakoutLookbackBarsBySymbol: {
      ...(options.trendBreakoutLookbackBarsBySymbol ?? {}),
      ETH: params.lookback,
    },
    trendBreakoutMinPctBySymbol: {
      ...(options.trendBreakoutMinPctBySymbol ?? {}),
      ETH: params.minPct,
    },
    trendMinVolumeRatioBySymbol: {
      ...(options.trendMinVolumeRatioBySymbol ?? {}),
      ETH: params.volume,
    },
    trendMinMomAccelBySymbol: {
      ...(options.trendMinMomAccelBySymbol ?? {}),
      ETH: params.accel,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(options.trendMinEfficiencyRatioBySymbol ?? {}),
      ETH: params.eff,
    },
  } satisfies HybridVariantOptions;
}

function withMainOpportunityProtection(options: HybridVariantOptions, level: "gap5" | "gap0") {
  return {
    ...options,
    strictExtraTrendRotationScoreGap: level === "gap0" ? 0 : 5,
    strictExtraTrendRotationCurrentMomAccelMax: 999,
    strictExtraTrendRotationCurrentMom20Max: 999,
    strictExtraTrendRotationMinHoldBars: 1,
    strictExtraTrendRotationRequireConsecutiveBars: 1,
    strictExtraTrendPriorityCurrentSymbols: ["ETH"],
    strictExtraTrendPriorityScoreGap: level === "gap0" ? 0 : 5,
    strictExtraTrendPriorityRequireHigherMom20: true,
    strictExtraTrendPriorityRequireHigherEfficiency: true,
  } satisfies HybridVariantOptions;
}

function withSafeMainOpportunityProtection(options: HybridVariantOptions, level: "gap5" | "gap0") {
  return {
    ...options,
    strictExtraTrendRotationScoreGap: level === "gap0" ? 0 : 5,
    strictExtraTrendRotationMinHoldBars: 1,
    strictExtraTrendRotationRequireConsecutiveBars: 1,
    strictExtraTrendPriorityCurrentSymbols: ["ETH"],
    strictExtraTrendPriorityScoreGap: level === "gap0" ? 0 : 5,
    strictExtraTrendPriorityRequireHigherMom20: true,
    strictExtraTrendPriorityRequireHigherEfficiency: true,
  } satisfies HybridVariantOptions;
}

function withTwtStrongException(options: HybridVariantOptions, level: "gap5" | "gap0") {
  return {
    ...withMainOpportunityProtection(options, level),
    strictExtraTrendSymbols: unique([...(options.strictExtraTrendSymbols ?? []), "TWT"]),
    strictExtraTrendMinEfficiencyRatioBySymbol: {
      ...(options.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
      TWT: 0.2,
    },
    strictExtraTrendMinVolumeRatio: options.strictExtraTrendMinVolumeRatio ?? 1.05,
    strictExtraTrendRotationScoreGapBySymbol: {
      ...(options.strictExtraTrendRotationScoreGapBySymbol ?? {}),
      TWT: level === "gap0" ? 0 : 5,
    },
    strictExtraTrendRotationRequireConsecutiveBarsBySymbol: {
      ...(options.strictExtraTrendRotationRequireConsecutiveBarsBySymbol ?? {}),
      TWT: 1,
    },
    strictExtraTrendTrailActivationPctBySymbol: {
      ...(options.strictExtraTrendTrailActivationPctBySymbol ?? {}),
      TWT: 0.12,
    },
    strictExtraTrendTrailRetracePctBySymbol: {
      ...(options.strictExtraTrendTrailRetracePctBySymbol ?? {}),
      TWT: 0.06,
    },
  } satisfies HybridVariantOptions;
}

function withEthWeakOnlyOpportunityRotation(
  options: HybridVariantOptions,
  config: {
    name: string;
    currentMom20Max: number;
    currentMomAccelMax: number;
    scoreGap: number;
    includeTwt?: boolean;
  },
) {
  const strictSymbols = config.includeTwt
    ? unique([...(options.strictExtraTrendSymbols ?? []), "TWT"])
    : options.strictExtraTrendSymbols;
  return {
    ...options,
    strictExtraTrendSymbols: strictSymbols,
    strictExtraTrendRotationCurrentSymbols: ["ETH"],
    strictExtraTrendRotationScoreGap: config.scoreGap,
    strictExtraTrendRotationCurrentMom20Max: config.currentMom20Max,
    strictExtraTrendRotationCurrentMomAccelMax: config.currentMomAccelMax,
    strictExtraTrendRotationMinHoldBars: 1,
    strictExtraTrendRotationRequireConsecutiveBars: 1,
    strictExtraTrendMinEfficiencyRatioBySymbol: {
      ...(options.strictExtraTrendMinEfficiencyRatioBySymbol ?? {}),
      ...(config.includeTwt ? { TWT: 0.2 } : {}),
    },
    strictExtraTrendMinVolumeRatio: config.includeTwt
      ? (options.strictExtraTrendMinVolumeRatio ?? 1.05)
      : options.strictExtraTrendMinVolumeRatio,
    strictExtraTrendRotationScoreGapBySymbol: {
      ...(options.strictExtraTrendRotationScoreGapBySymbol ?? {}),
      ...(config.includeTwt ? { TWT: config.scoreGap } : {}),
    },
    strictExtraTrendRotationRequireConsecutiveBarsBySymbol: {
      ...(options.strictExtraTrendRotationRequireConsecutiveBarsBySymbol ?? {}),
      ...(config.includeTwt ? { TWT: 1 } : {}),
    },
    strictExtraTrendTrailActivationPctBySymbol: {
      ...(options.strictExtraTrendTrailActivationPctBySymbol ?? {}),
      ...(config.includeTwt ? { TWT: 0.12 } : {}),
    },
    strictExtraTrendTrailRetracePctBySymbol: {
      ...(options.strictExtraTrendTrailRetracePctBySymbol ?? {}),
      ...(config.includeTwt ? { TWT: 0.06 } : {}),
    },
  } satisfies HybridVariantOptions;
}

function withInjTighterLooseException(options: HybridVariantOptions, level: "volume" | "accel" | "strict") {
  const baseRule = {
    minMom20: 0.12,
    minMomAccel: 0.01,
    minVolumeRatio: 1.15,
    minAdx14: 18,
    minEfficiencyRatio: 0.2,
    requireStructureBreak: true,
    requireDowHigherHighLow: false,
  };
  const rule = level === "volume"
    ? { ...baseRule, minVolumeRatio: 1.25, minEfficiencyRatio: 0.22 }
    : level === "accel"
      ? { ...baseRule, minMomAccel: 0.015, minAdx14: 20 }
      : { ...baseRule, minMom20: 0.14, minMomAccel: 0.015, minVolumeRatio: 1.25, minAdx14: 20, minEfficiencyRatio: 0.22 };
  return {
    ...options,
    trendRotationTargetExceptionBySymbol: {
      ...(options.trendRotationTargetExceptionBySymbol ?? {}),
      INJ: rule,
    },
  } satisfies HybridVariantOptions;
}

function summarize(result: Awaited<ReturnType<typeof runHybridBacktest>>) {
  const ethTrades = result.trade_pairs.filter((row) => row.symbol === "ETH");
  const injTrades = result.trade_pairs.filter((row) => row.symbol === "INJ");
  const ethByExit = new Map<string, number>();
  for (const trade of ethTrades) {
    ethByExit.set(trade.exit_reason, (ethByExit.get(trade.exit_reason) ?? 0) + trade.net_pnl);
  }
  const injByExit = new Map<string, number>();
  for (const trade of injTrades) {
    injByExit.set(trade.exit_reason, (injByExit.get(trade.exit_reason) ?? 0) + trade.net_pnl);
  }
  const byExit = Object.fromEntries(
    [...ethByExit.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([reason, pnl]) => [reason, round(pnl)]),
  );
  const injExitRows = Object.fromEntries(
    [...injByExit.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([reason, pnl]) => [reason, round(pnl)]),
  );
  const wins = ethTrades.filter((row) => row.net_pnl > 0);
  const losses = ethTrades.filter((row) => row.net_pnl <= 0);
  const symbolRows = Object.entries(result.summary.symbol_contribution)
    .sort((left, right) => right[1] - left[1])
    .map(([symbol, pnl]) => ({
      symbol,
      pnl: round(pnl),
      trades: result.trade_pairs.filter((row) => row.symbol === symbol).length,
      rotateEntries: result.trade_pairs.filter((row) => row.symbol === symbol && String(row.entry_reason).startsWith("trend-rotate")).length,
    }));
  return {
    endEquity: round(result.summary.end_equity),
    cagrPct: round(result.summary.cagr_pct),
    maxDrawdownPct: round(result.summary.max_drawdown_pct),
    profitFactor: round(result.summary.profit_factor, 3),
    winRatePct: round(result.summary.win_rate_pct),
    tradeCount: result.summary.trade_count,
    exposurePct: round(result.summary.exposure_pct),
    ethPnl: round(result.summary.symbol_contribution.ETH ?? 0),
    ethTrades: ethTrades.length,
    ethWins: wins.length,
    ethLosses: losses.length,
    ethRotateEntries: ethTrades.filter((row) => String(row.entry_reason).startsWith("trend-rotate")).length,
    ethAvgHold: round(ethTrades.reduce((sum, row) => sum + row.holding_bars, 0) / Math.max(1, ethTrades.length), 2),
    ethByExit: byExit,
    injByExit: injExitRows,
    injTradeDetails: injTrades.map((trade) => ({
      entry: trade.entry_time,
      exit: trade.exit_time,
      pnl: round(trade.net_pnl),
      entryReason: trade.entry_reason,
      exitReason: trade.exit_reason,
    })),
    injPnl: round(result.summary.symbol_contribution.INJ ?? 0),
    penguPnl: round(result.summary.symbol_contribution.PENGU ?? 0),
    dogePnl: round(result.summary.symbol_contribution.DOGE ?? 0),
    twtPnl: round(result.summary.symbol_contribution.TWT ?? 0),
    symbolRows,
  };
}

async function main() {
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const base = baseOptions();
  const decisionWindow = await analyzeHybridDecisionWindow("RETQ22", base);
  const cashOnlyWindows = buildCashOnlyWindows(decisionWindow);
  const nonCashWindows = invertWindows(cashOnlyWindows, START_TS, END_TS);
  const production = withInjLooseException(applyCashOnlyUniTwt(base, nonCashWindows));

  const variants: Array<{ key: string; thesis: string; options: HybridVariantOptions }> = [
    {
      key: "inj_loose_baseline",
      thesis: "INJ loose exception baseline.",
      options: { ...production, label: "inj_loose_baseline" },
    },
    {
      key: "eth_weak_exit_008_000",
      thesis: "ETH weak exit when mom20 <= 8% and accel <= 0.",
      options: { ...withEthWeakExit(production, 0.08, 0), label: "eth_weak_exit_008_000" },
    },
    {
      key: "eth_weak_exit_006_m001",
      thesis: "ETH weak exit when mom20 <= 6% and accel <= -1%.",
      options: { ...withEthWeakExit(production, 0.06, -0.01), label: "eth_weak_exit_006_m001" },
    },
    {
      key: "eth_weak_exit_005_m001",
      thesis: "ETH weak exit when mom20 <= 5% and accel <= -1%.",
      options: { ...withEthWeakExit(production, 0.05, -0.01), label: "eth_weak_exit_005_m001" },
    },
    {
      key: "eth_weak_exit_004_m0015",
      thesis: "ETH weak exit when mom20 <= 4% and accel <= -1.5%.",
      options: { ...withEthWeakExit(production, 0.04, -0.015), label: "eth_weak_exit_004_m0015" },
    },
    {
      key: "eth004_protect_pengu_doge_gap5",
      thesis: "ETH 4%/-1.5% plus stronger PENGU/DOGE opportunity protection: gap 5, no weak-current gate.",
      options: {
        ...withMainOpportunityProtection(withEthWeakExit(production, 0.04, -0.015), "gap5"),
        label: "eth004_protect_pengu_doge_gap5",
      },
    },
    {
      key: "eth004_safe_protect_pengu_doge_gap5",
      thesis: "ETH 4%/-1.5% plus safer PENGU/DOGE protection: gap 5, keep weak-current gate.",
      options: {
        ...withSafeMainOpportunityProtection(withEthWeakExit(production, 0.04, -0.015), "gap5"),
        label: "eth004_safe_protect_pengu_doge_gap5",
      },
    },
    {
      key: "eth004_safe_protect_pengu_doge_gap0",
      thesis: "ETH 4%/-1.5% plus safer PENGU/DOGE protection: gap 0, keep weak-current gate.",
      options: {
        ...withSafeMainOpportunityProtection(withEthWeakExit(production, 0.04, -0.015), "gap0"),
        label: "eth004_safe_protect_pengu_doge_gap0",
      },
    },
    {
      key: "eth004_protect_pengu_doge_gap0",
      thesis: "ETH 4%/-1.5% plus strongest PENGU/DOGE opportunity protection: gap 0, no weak-current gate.",
      options: {
        ...withMainOpportunityProtection(withEthWeakExit(production, 0.04, -0.015), "gap0"),
        label: "eth004_protect_pengu_doge_gap0",
      },
    },
    {
      key: "eth004_protect_pengu_doge_twt_gap5",
      thesis: "ETH 4%/-1.5% plus PENGU/DOGE protection and TWT strong exception: gap 5.",
      options: {
        ...withTwtStrongException(withEthWeakExit(production, 0.04, -0.015), "gap5"),
        label: "eth004_protect_pengu_doge_twt_gap5",
      },
    },
    {
      key: "eth004_protect_pengu_doge_twt_gap0",
      thesis: "ETH 4%/-1.5% plus PENGU/DOGE protection and TWT strong exception: gap 0.",
      options: {
        ...withTwtStrongException(withEthWeakExit(production, 0.04, -0.015), "gap0"),
        label: "eth004_protect_pengu_doge_twt_gap0",
      },
    },
    {
      key: "eth004_weak_near_rotate_pd_gap5",
      thesis: "ETH 4%/-1.5%; allow PENGU/DOGE rotation only when held ETH is near weak exit: mom20 <= 6%, accel <= -1%, gap 5.",
      options: {
        ...withEthWeakOnlyOpportunityRotation(withEthWeakExit(production, 0.04, -0.015), {
          name: "near",
          currentMom20Max: 0.06,
          currentMomAccelMax: -0.01,
          scoreGap: 5,
        }),
        label: "eth004_weak_near_rotate_pd_gap5",
      },
    },
    {
      key: "eth004_weak_near_rotate_pd_gap0",
      thesis: "ETH 4%/-1.5%; allow PENGU/DOGE rotation only when held ETH is near weak exit: mom20 <= 6%, accel <= -1%, gap 0.",
      options: {
        ...withEthWeakOnlyOpportunityRotation(withEthWeakExit(production, 0.04, -0.015), {
          name: "near",
          currentMom20Max: 0.06,
          currentMomAccelMax: -0.01,
          scoreGap: 0,
        }),
        label: "eth004_weak_near_rotate_pd_gap0",
      },
    },
    {
      key: "eth004_weak_exact_rotate_pd_gap5",
      thesis: "ETH 4%/-1.5%; allow PENGU/DOGE rotation only when held ETH is at weak exit zone: mom20 <= 4%, accel <= -1.5%, gap 5.",
      options: {
        ...withEthWeakOnlyOpportunityRotation(withEthWeakExit(production, 0.04, -0.015), {
          name: "exact",
          currentMom20Max: 0.04,
          currentMomAccelMax: -0.015,
          scoreGap: 5,
        }),
        label: "eth004_weak_exact_rotate_pd_gap5",
      },
    },
    {
      key: "eth004_weak_near_rotate_pdt_gap5",
      thesis: "ETH 4%/-1.5%; allow PENGU/DOGE/TWT rotation only when held ETH is near weak exit: mom20 <= 6%, accel <= -1%, gap 5.",
      options: {
        ...withEthWeakOnlyOpportunityRotation(withEthWeakExit(production, 0.04, -0.015), {
          name: "near_twt",
          currentMom20Max: 0.06,
          currentMomAccelMax: -0.01,
          scoreGap: 5,
          includeTwt: true,
        }),
        label: "eth004_weak_near_rotate_pdt_gap5",
      },
    },
    {
      key: "eth004_weak_exact_rotate_pdt_gap5",
      thesis: "ETH 4%/-1.5%; allow PENGU/DOGE/TWT rotation only when held ETH is at weak exit zone: mom20 <= 4%, accel <= -1.5%, gap 5.",
      options: {
        ...withEthWeakOnlyOpportunityRotation(withEthWeakExit(production, 0.04, -0.015), {
          name: "exact_twt",
          currentMom20Max: 0.04,
          currentMomAccelMax: -0.015,
          scoreGap: 5,
          includeTwt: true,
        }),
        label: "eth004_weak_exact_rotate_pdt_gap5",
      },
    },
    {
      key: "eth_weak_exit_007_m0005",
      thesis: "ETH weak exit when mom20 <= 7% and accel <= -0.5%.",
      options: { ...withEthWeakExit(production, 0.07, -0.005), label: "eth_weak_exit_007_m0005" },
    },
    {
      key: "eth007_inj_no_rotate",
      thesis: "ETH 7%/-0.5% plus block INJ as rotation target without exception.",
      options: {
        ...withEthWeakExit({
          ...production,
          trendRotationTargetExceptionBySymbol: {
            ...(production.trendRotationTargetExceptionBySymbol ?? {}),
            INJ: {
              minMom20: 999,
            },
          },
        }, 0.07, -0.005),
        label: "eth007_inj_no_rotate",
      },
    },
    {
      key: "eth007_inj_tight_volume",
      thesis: "ETH 7%/-0.5% plus tighter INJ exception: higher volume and efficiency.",
      options: {
        ...withInjTighterLooseException(withEthWeakExit(production, 0.07, -0.005), "volume"),
        label: "eth007_inj_tight_volume",
      },
    },
    {
      key: "eth007_inj_tight_accel",
      thesis: "ETH 7%/-0.5% plus tighter INJ exception: stronger accel and ADX.",
      options: {
        ...withInjTighterLooseException(withEthWeakExit(production, 0.07, -0.005), "accel"),
        label: "eth007_inj_tight_accel",
      },
    },
    {
      key: "eth007_inj_tight_strict",
      thesis: "ETH 7%/-0.5% plus tighter INJ exception: volume, accel, ADX, efficiency.",
      options: {
        ...withInjTighterLooseException(withEthWeakExit(production, 0.07, -0.005), "strict"),
        label: "eth007_inj_tight_strict",
      },
    },
    {
      key: "eth0065_m0005",
      thesis: "ETH weak exit when mom20 <= 6.5% and accel <= -0.5%.",
      options: { ...withEthWeakExit(production, 0.065, -0.005), label: "eth0065_m0005" },
    },
    {
      key: "eth0065_m0005_inj_tight_volume",
      thesis: "ETH 6.5%/-0.5% plus tighter INJ exception: higher volume and efficiency.",
      options: {
        ...withInjTighterLooseException(withEthWeakExit(production, 0.065, -0.005), "volume"),
        label: "eth0065_m0005_inj_tight_volume",
      },
    },
    {
      key: "eth_weak_exit_0055_m00075",
      thesis: "ETH weak exit when mom20 <= 5.5% and accel <= -0.75%.",
      options: { ...withEthWeakExit(production, 0.055, -0.0075), label: "eth_weak_exit_0055_m00075" },
    },
    {
      key: "eth_weak_exit_0050_m00075",
      thesis: "ETH weak exit when mom20 <= 5.0% and accel <= -0.75%.",
      options: { ...withEthWeakExit(production, 0.05, -0.0075), label: "eth_weak_exit_0050_m00075" },
    },
    {
      key: "eth_weak_exit_0060_m00075",
      thesis: "ETH weak exit when mom20 <= 6.0% and accel <= -0.75%.",
      options: { ...withEthWeakExit(production, 0.06, -0.0075), label: "eth_weak_exit_0060_m00075" },
    },
    {
      key: "eth_weak_exit_0055_m0010",
      thesis: "ETH weak exit when mom20 <= 5.5% and accel <= -1.0%.",
      options: { ...withEthWeakExit(production, 0.055, -0.01), label: "eth_weak_exit_0055_m0010" },
    },
    {
      key: "eth_weak_exit_0055_m0005",
      thesis: "ETH weak exit when mom20 <= 5.5% and accel <= -0.5%.",
      options: { ...withEthWeakExit(production, 0.055, -0.005), label: "eth_weak_exit_0055_m0005" },
    },
    {
      key: "eth_score_minus5",
      thesis: "Reduce ETH priority by score -5.",
      options: {
        ...production,
        label: "eth_score_minus5",
        trendScoreAdjustmentBySymbol: {
          ...(production.trendScoreAdjustmentBySymbol ?? {}),
          ETH: -5,
        },
      },
    },
    {
      key: "eth_no_rotation_target",
      thesis: "Keep ETH normal cash entries but block ETH as a rotation target.",
      options: {
        ...production,
        label: "eth_no_rotation_target",
        trendRotationTargetBlockSymbols: unique([...(production.trendRotationTargetBlockSymbols ?? []), "ETH"]),
      },
    },
    {
      key: "eth_quality_soft",
      thesis: "Require soft ETH breakout, volume, accel, and efficiency gates.",
      options: { ...withEthQualityFilter(production, "soft"), label: "eth_quality_soft" },
    },
    {
      key: "eth_quality_balanced",
      thesis: "Require balanced ETH breakout, volume, accel, and efficiency gates.",
      options: { ...withEthQualityFilter(production, "balanced"), label: "eth_quality_balanced" },
    },
    {
      key: "eth_quality_strict",
      thesis: "Require strict ETH breakout, volume, accel, and efficiency gates.",
      options: { ...withEthQualityFilter(production, "strict"), label: "eth_quality_strict" },
    },
    {
      key: "eth_quality_soft_plus_weak",
      thesis: "Soft ETH quality gate plus ETH weak exit 8%/0.",
      options: { ...withEthWeakExit(withEthQualityFilter(production, "soft"), 0.08, 0), label: "eth_quality_soft_plus_weak" },
    },
    {
      key: "eth_no_rotate_plus_weak",
      thesis: "Block ETH as rotation target plus ETH weak exit 8%/0.",
      options: {
        ...withEthWeakExit(production, 0.08, 0),
        label: "eth_no_rotate_plus_weak",
        trendRotationTargetBlockSymbols: unique([...(production.trendRotationTargetBlockSymbols ?? []), "ETH"]),
      },
    },
    {
      key: "eth_no_rotate_plus_quality_soft",
      thesis: "Block ETH as rotation target plus soft ETH quality gate.",
      options: {
        ...withEthQualityFilter(production, "soft"),
        label: "eth_no_rotate_plus_quality_soft",
        trendRotationTargetBlockSymbols: unique([...(production.trendRotationTargetBlockSymbols ?? []), "ETH"]),
      },
    },
  ];

  const rows = [];
  for (const variant of variants) {
    const result = await runHybridBacktest("RETQ22", variant.options);
    const summary = summarize(result);
    rows.push({ key: variant.key, thesis: variant.thesis, ...summary });
    console.log(`${variant.key}: end=${summary.endEquity} CAGR=${summary.cagrPct} MaxDD=${summary.maxDrawdownPct} PF=${summary.profitFactor} trades=${summary.tradeCount} ETH=${summary.ethPnl} ethTrades=${summary.ethTrades} INJ=${summary.injPnl}`);
  }

  const md = [
    "# ETH Main Fix After INJ Loose Exception",
    "",
    `- start_utc: ${new Date(START_TS).toISOString()}`,
    `- end_utc: ${new Date(END_TS).toISOString()}`,
    "- base: V7-style production plus INJ loose/no-HHHL exception.",
    "",
    "| variant | thesis | end equity | CAGR % | MaxDD % | PF | trades | ETH pnl | ETH trades | ETH W/L | ETH avg hold | INJ pnl | PENGU pnl | DOGE pnl | TWT pnl |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.key} | ${row.thesis} | ${row.endEquity} | ${row.cagrPct} | ${row.maxDrawdownPct} | ${row.profitFactor} | ${row.tradeCount} | ${row.ethPnl} | ${row.ethTrades} | ${row.ethWins}/${row.ethLosses} | ${row.ethAvgHold} | ${row.injPnl} | ${row.penguPnl} | ${row.dogePnl} | ${row.twtPnl} |`),
    "",
    "## Details",
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
