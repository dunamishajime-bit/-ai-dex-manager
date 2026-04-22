export const RECLAIM_HYBRID_STRATEGY_ID = "reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_uni_twt_cashrotate_v8" as const;

export type ReclaimHybridExecutionProfile = {
  id: typeof RECLAIM_HYBRID_STRATEGY_ID;
  chainId: 56;
  chainLabel: "BNB Chain";
  quoteProviders: readonly ["paraswap", "openocean"];
  priceProviders: readonly ["coingecko", "coincap", "binance", "cache"];
  referenceSymbol: "BTC";
  reserveSymbol: "USDT";
  gasSymbol: "BNB";
  tradableSymbols: readonly ["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT"];
  trackedSymbols: readonly ["BNB", "USDT", "ETH", "SOL", "AVAX", "LINK", "PENGU", "DOGE", "INJ", "UNI", "TWT"];
  expandedTrendSymbols: readonly ["ETH", "SOL", "AVAX", "INJ"];
  strictExtraTrendSymbols: readonly ["PENGU", "DOGE"];
  strictExtraTrendIdleOnly: true;
  strictExtraTrendMinEfficiencyRatioBySymbol: Readonly<Record<string, number>>;
  strictExtraTrendTrailActivationPct: number;
  strictExtraTrendTrailRetracePct: number;
  strictExtraTrendRotationWhileHolding: boolean;
  strictExtraTrendRotationScoreGap: number;
  strictExtraTrendRotationCurrentMomAccelMax: number;
  strictExtraTrendRotationCurrentMom20Max: number;
  strictExtraTrendRotationRequireConsecutiveBars: number;
  strictExtraTrendRotationMinHoldBars: number;
  trendRotationWhileHolding: boolean;
  trendRotationCurrentSymbols: readonly ["SOL"];
  trendRotationScoreGap: number;
  trendRotationAlternateScoreGap: number;
  trendRotationCurrentMomAccelMax: number;
  trendRotationCurrentMom20Max: number;
  trendRotationRequireConsecutiveBars: number;
  trendRotationAlternateRequireConsecutiveBars: number;
  trendRotationMinHoldBars: number;
  trendBreakoutLookbackBarsBySymbol?: Readonly<Record<string, number>>;
  trendBreakoutMinPctBySymbol?: Readonly<Record<string, number>>;
  trendMinVolumeRatioBySymbol?: Readonly<Record<string, number>>;
  trendMinMomAccelBySymbol?: Readonly<Record<string, number>>;
  trendMinEfficiencyRatioBySymbol?: Readonly<Record<string, number>>;
  trendScoreAdjustmentBySymbol: Readonly<Record<string, number>>;
  symbolSpecificTrendWeakExitSymbols?: readonly string[];
  symbolSpecificTrendWeakExitMom20Below?: number;
  symbolSpecificTrendWeakExitMomAccelBelow?: number;
  trendPrioritySymbols: readonly [];
  trendPriorityMaxScoreGap?: number | null;
  targetAlloc: number;
  feeRate: number;
  maxConcurrentPositions: 1;
  maxTradeSizePct: number;
  stableReservePct: number;
  gasReserveUsd: number;
  dailyLossLimitPct: number;
  hardStopLossPct: number;
  trendTrailingStopPct: number;
  rangeTrailingStopPct: number;
  trendMinEfficiencyRatio: number;
  trendWeakExitBestMom20Below: number;
  trendWeakExitBtcAdxBelow: number;
  primaryRange: {
    mode: "reclaim";
    symbols: readonly ["ETH"];
    regimeBtcDistMin: number;
    regimeBtcDistMax: number;
    regimeBtcAdxMax: number;
    regimeBreadth40Max: number;
    regimeBestMom20Min: number;
    regimeBestMom20Max: number;
    entryBestMom20Below: number;
    entryBtcAdxBelow: number;
    overheatMax: number;
    exitMom20Above: number;
    maxHoldBars: number;
    alloc: number;
  };
  auxRange: {
    mode: "atr_snapback";
    symbols: readonly ["AVAX"];
    activeYears: readonly [2024, 2025];
    ignoreRegimeGate: boolean;
    entryBestMom20Below: number;
    entryBtcAdxBelow: number;
    overheatMax: number;
    exitMom20Above: number;
    maxHoldBars: number;
    alloc: number;
  };
};

export const RECLAIM_HYBRID_EXECUTION_PROFILE: ReclaimHybridExecutionProfile = {
  id: RECLAIM_HYBRID_STRATEGY_ID,
  chainId: 56,
  chainLabel: "BNB Chain",
  quoteProviders: ["paraswap", "openocean"],
  priceProviders: ["coingecko", "coincap", "binance", "cache"],
  referenceSymbol: "BTC",
  reserveSymbol: "USDT",
  gasSymbol: "BNB",
  tradableSymbols: ["ETH", "SOL", "AVAX", "PENGU", "DOGE", "INJ", "UNI", "TWT"],
  trackedSymbols: ["BNB", "USDT", "ETH", "SOL", "AVAX", "LINK", "PENGU", "DOGE", "INJ", "UNI", "TWT"],
  expandedTrendSymbols: ["ETH", "SOL", "AVAX", "INJ"],
  strictExtraTrendSymbols: ["PENGU", "DOGE"],
  strictExtraTrendIdleOnly: true,
  strictExtraTrendMinEfficiencyRatioBySymbol: {
    PENGU: 0.22,
    DOGE: 0.18,
  },
  strictExtraTrendTrailActivationPct: 0.18,
  strictExtraTrendTrailRetracePct: 0.08,
  strictExtraTrendRotationWhileHolding: true,
  strictExtraTrendRotationScoreGap: 10,
  strictExtraTrendRotationCurrentMomAccelMax: 0,
  strictExtraTrendRotationCurrentMom20Max: 0.14,
  strictExtraTrendRotationRequireConsecutiveBars: 1,
  strictExtraTrendRotationMinHoldBars: 2,
  trendRotationWhileHolding: true,
  trendRotationCurrentSymbols: ["SOL"],
  trendRotationScoreGap: 10,
  trendRotationAlternateScoreGap: 5,
  trendRotationCurrentMomAccelMax: 0,
  trendRotationCurrentMom20Max: 0.14,
  trendRotationRequireConsecutiveBars: 1,
  trendRotationAlternateRequireConsecutiveBars: 2,
  trendRotationMinHoldBars: 2,
  trendBreakoutLookbackBarsBySymbol: {
    INJ: 3,
  },
  trendBreakoutMinPctBySymbol: {
    INJ: 0.025,
  },
  trendMinVolumeRatioBySymbol: {
    INJ: 1.25,
  },
  trendMinMomAccelBySymbol: {
    INJ: 0.02,
  },
  trendMinEfficiencyRatioBySymbol: {
    INJ: 0.2,
  },
  trendScoreAdjustmentBySymbol: {
    SOL: -8,
  },
  symbolSpecificTrendWeakExitSymbols: ["INJ"],
  symbolSpecificTrendWeakExitMom20Below: 0.08,
  symbolSpecificTrendWeakExitMomAccelBelow: 0,
  trendPrioritySymbols: [],
  trendPriorityMaxScoreGap: null,
  targetAlloc: 1,
  feeRate: 0.003,
  maxConcurrentPositions: 1,
  maxTradeSizePct: 100,
  stableReservePct: 0,
  gasReserveUsd: 1,
  dailyLossLimitPct: 2.5,
  hardStopLossPct: 8,
  trendTrailingStopPct: 1.85,
  rangeTrailingStopPct: 1.2,
  trendMinEfficiencyRatio: 0.22,
  trendWeakExitBestMom20Below: 0.05,
  trendWeakExitBtcAdxBelow: 18,
  primaryRange: {
    mode: "reclaim",
    symbols: ["ETH"],
    regimeBtcDistMin: -0.03,
    regimeBtcDistMax: 0.02,
    regimeBtcAdxMax: 22,
    regimeBreadth40Max: 2,
    regimeBestMom20Min: -0.04,
    regimeBestMom20Max: 0.035,
    entryBestMom20Below: -0.003,
    entryBtcAdxBelow: 20,
    overheatMax: -0.009,
    exitMom20Above: 0.01,
    maxHoldBars: 3,
    alloc: 1,
  },
  auxRange: {
    mode: "atr_snapback",
    symbols: ["AVAX"],
    activeYears: [2024, 2025],
    ignoreRegimeGate: true,
    entryBestMom20Below: 0.06,
    entryBtcAdxBelow: 35,
    overheatMax: 0.03,
    exitMom20Above: 0.008,
    maxHoldBars: 4,
    alloc: 1,
  },
};

export const RECLAIM_HYBRID_REFERENCE_USD: Record<string, number> = {
  BNB: 650,
  USDT: 1,
  USDC: 1,
  USD1: 1,
  ETH: 3200,
  SOL: 160,
  AVAX: 42,
  LINK: 18,
  PENGU: 0.009,
  DOGE: 0.22,
  INJ: 32,
  UNI: 8,
  TWT: 1,
};

export function buildReclaimHybridVariantOptions(profile = RECLAIM_HYBRID_EXECUTION_PROFILE) {
  return {
    useThreeWayRegime: true,
    rangeEntryMode: profile.primaryRange.mode,
    rangeSymbols: profile.primaryRange.symbols,
    rangeAlloc: profile.primaryRange.alloc,
    trendAlloc: profile.targetAlloc,
    expandedTrendSymbols: profile.expandedTrendSymbols,
    strictExtraTrendSymbols: profile.strictExtraTrendSymbols,
    strictExtraTrendIdleOnly: profile.strictExtraTrendIdleOnly,
    strictExtraTrendMinEfficiencyRatioBySymbol: profile.strictExtraTrendMinEfficiencyRatioBySymbol,
    strictExtraTrendTrailActivationPct: profile.strictExtraTrendTrailActivationPct,
    strictExtraTrendTrailRetracePct: profile.strictExtraTrendTrailRetracePct,
    strictExtraTrendRotationWhileHolding: profile.strictExtraTrendRotationWhileHolding,
    strictExtraTrendRotationScoreGap: profile.strictExtraTrendRotationScoreGap,
    strictExtraTrendRotationCurrentMomAccelMax: profile.strictExtraTrendRotationCurrentMomAccelMax,
    strictExtraTrendRotationCurrentMom20Max: profile.strictExtraTrendRotationCurrentMom20Max,
    strictExtraTrendRotationRequireConsecutiveBars: profile.strictExtraTrendRotationRequireConsecutiveBars,
    strictExtraTrendRotationMinHoldBars: profile.strictExtraTrendRotationMinHoldBars,
    trendRotationWhileHolding: profile.trendRotationWhileHolding,
    trendRotationCurrentSymbols: profile.trendRotationCurrentSymbols,
    trendRotationScoreGap: profile.trendRotationScoreGap,
    trendRotationAlternateScoreGap: profile.trendRotationAlternateScoreGap,
    trendRotationCurrentMomAccelMax: profile.trendRotationCurrentMomAccelMax,
    trendRotationCurrentMom20Max: profile.trendRotationCurrentMom20Max,
    trendRotationRequireConsecutiveBars: profile.trendRotationRequireConsecutiveBars,
    trendRotationAlternateRequireConsecutiveBars: profile.trendRotationAlternateRequireConsecutiveBars,
    trendRotationMinHoldBars: profile.trendRotationMinHoldBars,
    trendBreakoutLookbackBarsBySymbol: profile.trendBreakoutLookbackBarsBySymbol,
    trendBreakoutMinPctBySymbol: profile.trendBreakoutMinPctBySymbol,
    trendMinVolumeRatioBySymbol: profile.trendMinVolumeRatioBySymbol,
    trendMinMomAccelBySymbol: profile.trendMinMomAccelBySymbol,
    trendMinEfficiencyRatioBySymbol: profile.trendMinEfficiencyRatioBySymbol,
    trendScoreAdjustmentBySymbol: profile.trendScoreAdjustmentBySymbol,
    symbolSpecificTrendWeakExitSymbols: profile.symbolSpecificTrendWeakExitSymbols,
    symbolSpecificTrendWeakExitMom20Below: profile.symbolSpecificTrendWeakExitMom20Below,
    symbolSpecificTrendWeakExitMomAccelBelow: profile.symbolSpecificTrendWeakExitMomAccelBelow,
    trendPrioritySymbols: profile.trendPrioritySymbols,
    trendPriorityMaxScoreGap: profile.trendPriorityMaxScoreGap,
    trendMinEfficiencyRatio: profile.trendMinEfficiencyRatio,
    trendWeakExitBestMom20Below: profile.trendWeakExitBestMom20Below,
    trendWeakExitBtcAdxBelow: profile.trendWeakExitBtcAdxBelow,
    rangeRegimeBtcDistMin: profile.primaryRange.regimeBtcDistMin,
    rangeRegimeBtcDistMax: profile.primaryRange.regimeBtcDistMax,
    rangeRegimeBtcAdxMax: profile.primaryRange.regimeBtcAdxMax,
    rangeRegimeBreadth40Max: profile.primaryRange.regimeBreadth40Max,
    rangeRegimeBestMom20Min: profile.primaryRange.regimeBestMom20Min,
    rangeRegimeBestMom20Max: profile.primaryRange.regimeBestMom20Max,
    rangeEntryBestMom20Below: profile.primaryRange.entryBestMom20Below,
    rangeEntryBtcAdxBelow: profile.primaryRange.entryBtcAdxBelow,
    rangeOverheatMax: profile.primaryRange.overheatMax,
    rangeExitMom20Above: profile.primaryRange.exitMom20Above,
    rangeMaxHoldBars: profile.primaryRange.maxHoldBars,
    auxRangeSymbols: profile.auxRange.symbols,
    auxRangeEntryMode: profile.auxRange.mode,
    auxRangeActiveYears: profile.auxRange.activeYears,
    auxRangeIgnoreRegimeGate: profile.auxRange.ignoreRegimeGate,
    auxRangeAlloc: profile.auxRange.alloc,
    auxRangeEntryBestMom20Below: profile.auxRange.entryBestMom20Below,
    auxRangeEntryBtcAdxBelow: profile.auxRange.entryBtcAdxBelow,
    auxRangeOverheatMax: profile.auxRange.overheatMax,
    auxRangeExitMom20Above: profile.auxRange.exitMom20Above,
    auxRangeMaxHoldBars: profile.auxRange.maxHoldBars,
  } as const;
}

export const RECLAIM_HYBRID_CASH_RESCUE_SYMBOLS = ["UNI", "TWT"] as const;
export const RECLAIM_HYBRID_CASH_RESCUE_PRIORITY_SYMBOLS = ["TWT"] as const;

export function buildReclaimHybridCashRescueVariantOptions(profile = RECLAIM_HYBRID_EXECUTION_PROFILE) {
  const base = buildReclaimHybridVariantOptions(profile);
  return {
    ...base,
    expandedTrendSymbols: [...new Set([...base.expandedTrendSymbols, ...RECLAIM_HYBRID_CASH_RESCUE_SYMBOLS])],
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
    trendPrioritySymbols: RECLAIM_HYBRID_CASH_RESCUE_PRIORITY_SYMBOLS,
    trendPriorityMaxScoreGap: null,
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ", "UNI"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
  } as const;
}

export const RECLAIM_HYBRID_SLIPPAGE_BPS: Record<string, number> = {
  AVAX_USDT: 90,
  BNB_USDT: 45,
  DOGE_USDT: 130,
  ETH_USDT: 65,
  LINK_USDT: 85,
  INJ_USDT: 110,
  TWT_USDT: 110,
  UNI_USDT: 95,
  PENGU_USDT: 150,
  SOL_USDT: 85,
  USDC_USDT: 25,
  USD1_USDT: 35,
};

function assertSubset(name: string, values: readonly string[], allowed: readonly string[]) {
  const missing = values.filter((value) => !allowed.includes(value));
  if (missing.length) {
    throw new Error(`${name} includes symbols outside the approved universe: ${missing.join(", ")}`);
  }
}

export function validateReclaimHybridExecutionProfile(profile: ReclaimHybridExecutionProfile) {
  const tradable = profile.tradableSymbols;
  const tracked = profile.trackedSymbols;
  const expanded = profile.expandedTrendSymbols;
  const priority = profile.trendPrioritySymbols;

  assertSubset("expandedTrendSymbols", expanded, tradable);
  assertSubset("trendPrioritySymbols", priority, expanded);
  assertSubset("primaryRange.symbols", profile.primaryRange.symbols, tradable);
  assertSubset("auxRange.symbols", profile.auxRange.symbols, tradable);

  for (const required of [profile.gasSymbol, profile.reserveSymbol, ...tradable]) {
    if (!tracked.includes(required)) {
      throw new Error(`trackedSymbols must include ${required}`);
    }
  }

  for (const symbol of tradable) {
    if (getHybridReferenceUsd(symbol) == null) {
      throw new Error(`Missing reference USD price for ${symbol}`);
    }
    const pairKey = [symbol, profile.reserveSymbol].sort().join("_");
    if (!(pairKey in RECLAIM_HYBRID_SLIPPAGE_BPS)) {
      throw new Error(`Missing slippage setting for ${symbol}/${profile.reserveSymbol}`);
    }
  }

  return true;
}

export function normalizeTradePairKey(srcSymbol: string, destSymbol: string) {
  return [String(srcSymbol || "").toUpperCase(), String(destSymbol || "").toUpperCase()]
    .sort()
    .join("_");
}

export function getHybridSlippageBps(srcSymbol: string, destSymbol: string) {
  const key = normalizeTradePairKey(srcSymbol, destSymbol);
  return RECLAIM_HYBRID_SLIPPAGE_BPS[key] ?? 100;
}

export function getHybridReferenceUsd(symbol: string) {
  return RECLAIM_HYBRID_REFERENCE_USD[String(symbol || "").toUpperCase()] ?? null;
}

validateReclaimHybridExecutionProfile(RECLAIM_HYBRID_EXECUTION_PROFILE);
