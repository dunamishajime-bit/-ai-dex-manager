export const RECLAIM_HYBRID_STRATEGY_ID = "reclaim_plus_avax_aux_alloc100_pengu_doge_injdedicated_idle_solrotate_uni_twt_cashrotate_v7" as const;

type PartialExitRule = {
  fraction: number;
  baseTakeProfitPct: number;
  strongTakeProfitPct?: number;
  strongMinMomAccel?: number;
  strongMinVolumeRatio?: number;
  stopAfterPartialPct?: number;
  runnerTrailActivationPct?: number;
  runnerTrailRetracePct?: number;
};

type TrendSymbolQualityBlockRule = {
  minMom20?: number;
  maxMom20?: number;
  minMomAccel?: number;
  maxMomAccel?: number;
  minVolumeRatio?: number;
  maxVolumeRatio?: number;
  minAdx14?: number;
  maxAdx14?: number;
  minOverheatPct?: number;
  maxOverheatPct?: number;
  minSmaDistancePct?: number;
  maxSmaDistancePct?: number;
  mode?: "all" | "any";
};

export type ReclaimHybridExecutionProfile = {
  id: typeof RECLAIM_HYBRID_STRATEGY_ID;
  chainId: 56;
  chainLabel: "BNB Chain";
  quoteProviders: readonly ["paraswap", "openocean"];
  priceProviders: readonly ["coingecko", "coincap", "binance", "cache"];
  referenceSymbol: "BTC";
  reserveSymbol: "USDT";
  gasSymbol: "BNB";
  tradableSymbols: readonly string[];
  trackedSymbols: readonly string[];
  expandedTrendSymbols: readonly ["ETH", "SOL", "AVAX", "INJ"];
  strictExtraTrendSymbols: readonly ["PENGU", "DOGE"];
  strictExtraTrendIdleOnly: true;
  strictExtraTrendMinEfficiencyRatioBySymbol: Readonly<Record<string, number>>;
  strictExtraTrendTrailActivationPct: number;
  strictExtraTrendTrailRetracePct: number;
  strictExtraTrendTrailActivationPctBySymbol: Readonly<Record<string, number>>;
  strictExtraTrendTrailRetracePctBySymbol: Readonly<Record<string, number>>;
  strictExtraTrendRotationWhileHolding: boolean;
  strictExtraTrendRotationScoreGap: number;
  strictExtraTrendRotationCurrentMomAccelMax: number;
  strictExtraTrendRotationCurrentMom20Max: number;
  strictExtraTrendRotationRequireConsecutiveBars: number;
  strictExtraTrendRotationMinHoldBars: number;
  penguOffRotation: {
    enabled: boolean;
    timeframe: "1h";
    symbols: readonly ["UNI"];
    currentSymbols: readonly ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"];
    scoreGap: number;
    minHoldBars: number;
    allowFromCash: boolean;
    allowWhileHolding: boolean;
    allowTradeGateOff: boolean;
    breakoutLookbackBarsBySymbol: Readonly<Record<string, number>>;
    breakoutMinPctBySymbol: Readonly<Record<string, number>>;
    minVolumeRatioBySymbol: Readonly<Record<string, number>>;
    minMomAccelBySymbol: Readonly<Record<string, number>>;
    minEfficiencyRatioBySymbol: Readonly<Record<string, number>>;
    trailActivationPctBySymbol: Readonly<Record<string, number>>;
    trailRetracePctBySymbol: Readonly<Record<string, number>>;
  };
  penguStrongOverride: {
    enabled: boolean;
    timeframe: "15m";
    symbols: readonly ["PENGU"];
    currentSymbols: readonly ["ETH", "SOL", "INJ"];
    scoreGap: number;
    minHoldBars: number;
    allowTradeGateOff: boolean;
    breakoutLookbackBarsBySymbol: Readonly<Record<string, number>>;
    breakoutMinPctBySymbol: Readonly<Record<string, number>>;
    minVolumeRatioBySymbol: Readonly<Record<string, number>>;
    minMomAccelBySymbol: Readonly<Record<string, number>>;
    minEfficiencyRatioBySymbol: Readonly<Record<string, number>>;
  };
  solWaveOverride: {
    enabled: boolean;
    timeframe: "1h";
    symbol: "SOL";
    currentSymbols: readonly ["UNI"];
    activeMonths: readonly [10, 11, 12];
    scoreGap: number;
    minHoldBars: number;
    allowTradeGateOff: boolean;
    breakoutLookbackBars: number;
    breakoutMinPct: number;
    minVolumeRatio: number;
    minMomAccel: number;
    minEfficiencyRatio: number;
  };
  smallWalletNonPenguGuard: {
    enabled: boolean;
    minPortfolioUsd: number;
    allowedSymbols: readonly string[];
  };
  idleBreakoutEntryWhileCash?: boolean;
  idleBreakoutEntryTimeframe?: "15m" | "1h" | "4h" | "6h" | "12h";
  idleBreakoutSymbols?: readonly string[];
  idleBreakoutAllowTradeGateOff?: boolean;
  idleBreakoutMinVolumeRatio?: number;
  idleBreakoutMinMomAccel?: number;
  idleBreakoutBreakoutLookbackBars?: number;
  idleBreakoutBreakoutMinPct?: number;
  idleBreakoutMinEfficiencyRatio?: number;
  idleBreakoutProfitTrailActivationPct?: number;
  idleBreakoutProfitTrailRetracePct?: number;
  idleBreakoutTieredTrailBySymbol?: Readonly<Record<string, readonly { activationPct: number; retracePct: number }[]>>;
  idleBreakoutConditionalEarlyTrailBySymbol?: Readonly<Record<string, {
    activationPct: number;
    retracePct: number;
    entryMaxMom80?: number | null;
    entryMaxVolumeRatio?: number | null;
  }>>;
  idleBreakoutMaxHoldBars?: number;
  idleBreakoutWeakExitMom20Below?: number;
  idleBreakoutWeakExitMomAccelBelow?: number;
  idleBreakoutWeakExitMinHoldBars?: number;
  idleBreakoutWeakExitRequireCloseBelowSma40?: boolean;
  idleBreakoutSwitchGuardMinCurrentScore?: number;
  idleBreakoutSwitchGuardMinCurrentMom20?: number;
  idleBreakoutSwitchGuardMinCurrentMomAccel?: number;
  idleBreakoutSwitchGuardMinCurrentEfficiencyRatio?: number;
  idleBreakoutSwitchGuardRequiredScoreGap?: number;
  idleBreakoutSwitchGuardTargetSymbols?: readonly string[];
  idleBreakoutSwitchGuardBlockAfterTrailActivation?: boolean;
  idleBreakoutSwitchGuardMode?: "any" | "all";
  partialExitBySymbol?: Readonly<Record<string, PartialExitRule>>;
  strictExtraTrendRotationBlockBelowDrawdownPct?: number;
  idleBigWaveSidecar: {
    enabled: boolean;
    symbols: readonly ["BIO", "DUSK"];
    timeframe: "1h";
    activeFrom: Readonly<Record<"BIO" | "DUSK", string>>;
    maxNotionalUsd: number;
    maxNotionalUsdBySymbol?: Readonly<Partial<Record<"BIO" | "DUSK", number>>>;
    quoteValueLossCapPct: number;
    lookbackBars: number;
    breakoutMinPct: number;
    minVolumeRatio: number;
    minMom6: number;
    minMom24: number;
    minFourHourMom: number;
    minScore: number;
    maxOneHourJump: number;
    minCloseLocation: number;
    profitTrailActivationPct: number;
    profitTrailRetracePct: number;
    hardStopPct: number;
    weakExitMinHoldHours: number;
    maxHoldHours: number;
  };
  twtUsdtSleeveSidecar: {
    enabled: boolean;
    symbol: "TWT";
    timeframe: "12h";
    activeMonths: readonly number[];
    sleeveFraction: number;
    quoteValueLossCapPct: number;
    lookbackBars: number;
    breakoutMinPct: number;
    minVolumeRatio: number;
    minMom20: number;
    minMomAccel: number;
    minEfficiencyRatio: number;
    minAdx14: number;
    profitTrailActivationPct: number;
    profitTrailRetracePct: number;
    hardStopPct: number;
    weakExitMinHoldHours: number;
    maxHoldHours: number;
  };
  trendRotationWhileHolding: boolean;
  trendRotationCurrentSymbols: readonly ["SOL"];
  trendRotationScoreGap: number;
  trendRotationAlternateScoreGap: number;
  trendRotationCurrentMomAccelMax: number;
  trendRotationCurrentMom20Max: number;
  trendRotationRequireConsecutiveBars: number;
  trendRotationAlternateRequireConsecutiveBars: number;
  trendRotationMinHoldBars: number;
  trendRotationTargetBlockSymbols?: readonly string[];
  trendRotationTargetExceptionBySymbol?: Readonly<Record<string, {
    minScore?: number;
    minMom20?: number;
    minMomAccel?: number;
    minVolumeRatio?: number;
    minAdx14?: number;
    minEfficiencyRatio?: number;
    requireStructureBreak?: boolean;
    requireDowHigherHighLow?: boolean;
  }>>;
  trendBreakoutLookbackBarsBySymbol?: Readonly<Record<string, number>>;
  trendBreakoutMinPctBySymbol?: Readonly<Record<string, number>>;
  trendMinVolumeRatioBySymbol?: Readonly<Record<string, number>>;
  trendMinMomAccelBySymbol?: Readonly<Record<string, number>>;
  trendMinEfficiencyRatioBySymbol?: Readonly<Record<string, number>>;
  trendScoreAdjustmentBySymbol: Readonly<Record<string, number>>;
  symbolSpecificTrendWeakExitSymbols?: readonly string[];
  symbolSpecificTrendWeakExitMom20Below?: number;
  symbolSpecificTrendWeakExitMomAccelBelow?: number;
  symbolSpecificTrendWeakExitMom20BelowBySymbol?: Readonly<Record<string, number>>;
  symbolSpecificTrendWeakExitMomAccelBelowBySymbol?: Readonly<Record<string, number>>;
  trendPrioritySymbols: readonly [];
  trendPriorityMaxScoreGap?: number | null;
  trendAllocBySymbol?: Readonly<Record<string, number>>;
  trendSymbolQualityBlockBySymbol?: Readonly<Record<string, TrendSymbolQualityBlockRule>>;
  trendWeakMarketBlockSymbols: readonly ["ETH", "INJ", "SOL"];
  trendWeakMarketBlockRequireWeak2022: boolean;
  trendWeakMarketBlockBestMom20Below: number;
  trendWeakMarketBlockBtcAdxBelow: number;
  portfolioDrawdownCashExitPct: number | null;
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
  trendProfitTrailActivationPct: number;
  trendProfitTrailRetracePct: number;
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
  tradableSymbols: ["ETH", "SOL", "AVAX", "PENGU", "APE", "COS", "MITO", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"],
  trackedSymbols: ["BNB", "USDT", "ETH", "SOL", "AVAX", "LINK", "PENGU", "APE", "COS", "MITO", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"],
  expandedTrendSymbols: ["ETH", "SOL", "AVAX", "INJ"],
  strictExtraTrendSymbols: ["PENGU", "DOGE"],
  strictExtraTrendIdleOnly: true,
  strictExtraTrendMinEfficiencyRatioBySymbol: {
    PENGU: 0.22,
    DOGE: 0.28,
  },
  strictExtraTrendTrailActivationPct: 0.18,
  strictExtraTrendTrailRetracePct: 0.08,
  strictExtraTrendTrailActivationPctBySymbol: {
    PENGU: 0.12,
    DOGE: 0.14,
  },
  strictExtraTrendTrailRetracePctBySymbol: {
    PENGU: 0.055,
    DOGE: 0.06,
  },
  strictExtraTrendRotationWhileHolding: true,
  strictExtraTrendRotationScoreGap: 10,
  strictExtraTrendRotationCurrentMomAccelMax: 0,
  strictExtraTrendRotationCurrentMom20Max: 0.14,
  strictExtraTrendRotationRequireConsecutiveBars: 1,
  strictExtraTrendRotationMinHoldBars: 2,
  penguOffRotation: {
    enabled: true,
    timeframe: "1h",
    symbols: ["UNI"],
    currentSymbols: ["ETH", "SOL", "AVAX", "DOGE", "INJ", "UNI", "TWT", "BIO", "DUSK"],
    scoreGap: 5,
    minHoldBars: 2,
    allowFromCash: false,
    allowWhileHolding: true,
    allowTradeGateOff: true,
    breakoutLookbackBarsBySymbol: {
      UNI: 8,
    },
    breakoutMinPctBySymbol: {
      UNI: 0.024,
    },
    minVolumeRatioBySymbol: {
      UNI: 1.2,
    },
    minMomAccelBySymbol: {
      UNI: 0.0005,
    },
    minEfficiencyRatioBySymbol: {
      UNI: 0.2,
    },
    trailActivationPctBySymbol: {
      UNI: 0.18,
    },
    trailRetracePctBySymbol: {
      UNI: 0.085,
    },
  },
  penguStrongOverride: {
    enabled: false,
    timeframe: "15m",
    symbols: ["PENGU"],
    currentSymbols: ["ETH", "SOL", "INJ"],
    scoreGap: 15,
    minHoldBars: 2,
    allowTradeGateOff: true,
    breakoutLookbackBarsBySymbol: {
      PENGU: 16,
    },
    breakoutMinPctBySymbol: {
      PENGU: 0.006,
    },
    minVolumeRatioBySymbol: {
      PENGU: 1.15,
    },
    minMomAccelBySymbol: {
      PENGU: 0,
    },
    minEfficiencyRatioBySymbol: {
      PENGU: 0.12,
    },
  },
  solWaveOverride: {
    enabled: true,
    timeframe: "1h",
    symbol: "SOL",
    currentSymbols: ["UNI"],
    activeMonths: [10, 11, 12],
    scoreGap: 0,
    minHoldBars: 2,
    allowTradeGateOff: true,
    breakoutLookbackBars: 16,
    breakoutMinPct: 0.006,
    minVolumeRatio: 1.25,
    minMomAccel: 0,
    minEfficiencyRatio: 0.12,
  },
  smallWalletNonPenguGuard: {
    enabled: true,
    minPortfolioUsd: 300,
    allowedSymbols: ["PENGU", "APE", "COS", "MITO"],
  },
  idleBreakoutEntryWhileCash: true,
  idleBreakoutEntryTimeframe: "1h",
  idleBreakoutSymbols: ["PENGU", "APE", "COS", "MITO"],
  idleBreakoutAllowTradeGateOff: true,
  idleBreakoutMinVolumeRatio: 1.15,
  idleBreakoutMinMomAccel: -0.002,
  idleBreakoutBreakoutLookbackBars: 8,
  idleBreakoutBreakoutMinPct: 0.016,
  idleBreakoutMinEfficiencyRatio: 0.12,
  idleBreakoutProfitTrailActivationPct: 0.18,
  idleBreakoutProfitTrailRetracePct: 0.085,
  idleBreakoutTieredTrailBySymbol: {},
  idleBreakoutConditionalEarlyTrailBySymbol: {},
  idleBreakoutMaxHoldBars: 48,
  idleBreakoutWeakExitMom20Below: 0.02,
  idleBreakoutWeakExitMomAccelBelow: -0.01,
  idleBreakoutWeakExitMinHoldBars: 8,
  idleBreakoutWeakExitRequireCloseBelowSma40: true,
  idleBreakoutSwitchGuardTargetSymbols: ["ETH", "SOL", "AVAX", "INJ", "DOGE", "TWT", "UNI"],
  idleBreakoutSwitchGuardMinCurrentScore: 30,
  idleBreakoutSwitchGuardMinCurrentMom20: 0.12,
  idleBreakoutSwitchGuardMinCurrentMomAccel: 0.01,
  idleBreakoutSwitchGuardMinCurrentEfficiencyRatio: 0.45,
  idleBreakoutSwitchGuardRequiredScoreGap: 12,
  idleBreakoutSwitchGuardBlockAfterTrailActivation: true,
  idleBreakoutSwitchGuardMode: "any",
  partialExitBySymbol: {
    DOGE: {
      fraction: 0.5,
      baseTakeProfitPct: 0.08,
      strongTakeProfitPct: 0.16,
      strongMinMomAccel: 0.015,
      strongMinVolumeRatio: 1.15,
      stopAfterPartialPct: 0.02,
      runnerTrailActivationPct: 0.16,
      runnerTrailRetracePct: 0.04,
    },
    TWT: {
      fraction: 0.5,
      baseTakeProfitPct: 0.15,
      strongTakeProfitPct: 0.25,
      strongMinMomAccel: 0.02,
      strongMinVolumeRatio: 1.25,
      stopAfterPartialPct: 0.05,
      runnerTrailActivationPct: 0.25,
      runnerTrailRetracePct: 0.08,
    },
    INJ: {
      fraction: 0.5,
      baseTakeProfitPct: 0.12,
      strongTakeProfitPct: 0.22,
      strongMinMomAccel: 0.02,
      strongMinVolumeRatio: 1.25,
      stopAfterPartialPct: 0.04,
      runnerTrailActivationPct: 0.22,
      runnerTrailRetracePct: 0.08,
    },
    AVAX: {
      fraction: 0.5,
      baseTakeProfitPct: 0.12,
      strongTakeProfitPct: 0.22,
      strongMinMomAccel: 0.02,
      strongMinVolumeRatio: 1.25,
      stopAfterPartialPct: 0.04,
      runnerTrailActivationPct: 0.22,
      runnerTrailRetracePct: 0.08,
    },
  },
  idleBigWaveSidecar: {
    enabled: true,
    symbols: ["BIO", "DUSK"],
    timeframe: "1h",
    activeFrom: {
      BIO: "2025-07-01T00:00:00.000Z",
      DUSK: "2026-01-01T00:00:00.000Z",
    },
    maxNotionalUsd: 300,
    maxNotionalUsdBySymbol: {
      BIO: 500,
      DUSK: 300,
    },
    quoteValueLossCapPct: 1,
    lookbackBars: 10,
    breakoutMinPct: 0.016,
    minVolumeRatio: 1.22,
    minMom6: 0.045,
    minMom24: 0.075,
    minFourHourMom: 0.05,
    minScore: 32,
    maxOneHourJump: 0.2,
    minCloseLocation: 0.6,
    profitTrailActivationPct: 0.18,
    profitTrailRetracePct: 0.085,
    hardStopPct: 0.08,
    weakExitMinHoldHours: 8,
    maxHoldHours: 48,
  },
  twtUsdtSleeveSidecar: {
    enabled: true,
    symbol: "TWT",
    timeframe: "12h",
    activeMonths: [10, 11, 12],
    sleeveFraction: 0.75,
    quoteValueLossCapPct: 1,
    lookbackBars: 8,
    breakoutMinPct: 0.032,
    minVolumeRatio: 1.08,
    minMom20: 0.06,
    minMomAccel: 0.0005,
    minEfficiencyRatio: 0.17,
    minAdx14: 22,
    profitTrailActivationPct: 0.15,
    profitTrailRetracePct: 0.08,
    hardStopPct: 0.08,
    weakExitMinHoldHours: 24,
    maxHoldHours: 240,
  },
  trendRotationWhileHolding: true,
  trendRotationCurrentSymbols: ["SOL"],
  trendRotationScoreGap: 10,
  trendRotationAlternateScoreGap: 5,
  trendRotationCurrentMomAccelMax: 0,
  trendRotationCurrentMom20Max: 0.14,
  trendRotationRequireConsecutiveBars: 1,
  trendRotationAlternateRequireConsecutiveBars: 2,
  trendRotationMinHoldBars: 2,
  trendRotationTargetBlockSymbols: ["INJ"],
  trendRotationTargetExceptionBySymbol: {
    INJ: {
      minScore: 26,
      minMom20: 0.14,
      minMomAccel: 0.015,
      minVolumeRatio: 1.25,
      minAdx14: 20,
      minEfficiencyRatio: 0.24,
      requireStructureBreak: true,
      requireDowHigherHighLow: false,
    },
  },
  trendBreakoutLookbackBarsBySymbol: {
    INJ: 3,
  },
  trendBreakoutMinPctBySymbol: {
    INJ: 0.03,
  },
  trendMinVolumeRatioBySymbol: {
    INJ: 1.35,
  },
  trendMinMomAccelBySymbol: {
    INJ: 0.02,
  },
  trendMinEfficiencyRatioBySymbol: {
    INJ: 0.24,
  },
  trendScoreAdjustmentBySymbol: {
    SOL: -8,
  },
  symbolSpecificTrendWeakExitSymbols: ["INJ", "ETH"],
  symbolSpecificTrendWeakExitMom20Below: 0.08,
  symbolSpecificTrendWeakExitMomAccelBelow: 0,
  symbolSpecificTrendWeakExitMom20BelowBySymbol: {
    ETH: 0.07,
  },
  symbolSpecificTrendWeakExitMomAccelBelowBySymbol: {
    ETH: -0.005,
  },
  trendPrioritySymbols: [],
  trendPriorityMaxScoreGap: null,
  trendAllocBySymbol: {
    ETH: 0.1,
    DOGE: 0.4,
  },
  trendSymbolQualityBlockBySymbol: {
    SOL: {
      minMom20: 0.08,
      maxOverheatPct: 0.15,
      mode: "all",
    },
    TWT: {
      minMom20: 0.05,
      maxAdx14: 35,
      mode: "all",
    },
  },
  trendWeakMarketBlockSymbols: ["ETH", "INJ", "SOL"],
  trendWeakMarketBlockRequireWeak2022: true,
  trendWeakMarketBlockBestMom20Below: 0.08,
  trendWeakMarketBlockBtcAdxBelow: 18,
  portfolioDrawdownCashExitPct: -25,
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
  trendProfitTrailActivationPct: 0.18,
  trendProfitTrailRetracePct: 0.12,
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
  BIO: 0.18,
  DUSK: 0.12,
  APE: 1.5,
  COS: 0.012,
  MITO: 0.15,
};

function monthlyWindows(months: readonly number[], startYear = 2022, endYear = 2030) {
  const windows: { startTs: number; endTs: number }[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (const month of months) {
      windows.push({
        startTs: Date.UTC(year, month - 1, 1),
        endTs: Date.UTC(year, month, 1),
      });
    }
  }
  return windows;
}

function blockOutsideMonthlyWindows(months: readonly number[], startYear = 2022, endYear = 2030) {
  const allowed = new Set(months);
  const windows: { startTs: number; endTs: number }[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      if (allowed.has(month + 1)) continue;
      windows.push({
        startTs: Date.UTC(year, month, 1),
        endTs: Date.UTC(year, month + 1, 1),
      });
    }
  }
  return windows;
}

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
    strictExtraTrendTrailActivationPctBySymbol: profile.strictExtraTrendTrailActivationPctBySymbol,
    strictExtraTrendTrailRetracePctBySymbol: profile.strictExtraTrendTrailRetracePctBySymbol,
    strictExtraTrendRotationWhileHolding: profile.strictExtraTrendRotationWhileHolding,
    strictExtraTrendRotationScoreGap: profile.strictExtraTrendRotationScoreGap,
    strictExtraTrendRotationCurrentMomAccelMax: profile.strictExtraTrendRotationCurrentMomAccelMax,
    strictExtraTrendRotationCurrentMom20Max: profile.strictExtraTrendRotationCurrentMom20Max,
    strictExtraTrendRotationRequireConsecutiveBars: profile.strictExtraTrendRotationRequireConsecutiveBars,
    strictExtraTrendRotationMinHoldBars: profile.strictExtraTrendRotationMinHoldBars,
    penguOffRotationEntry: profile.penguOffRotation.enabled,
    penguOffRotationTimeframe: profile.penguOffRotation.timeframe,
    penguOffRotationSymbols: profile.penguOffRotation.symbols,
    penguOffRotationCurrentSymbols: profile.penguOffRotation.currentSymbols,
    penguOffRotationScoreGap: profile.penguOffRotation.scoreGap,
    penguOffRotationMinHoldBars: profile.penguOffRotation.minHoldBars,
    penguOffRotationAllowFromCash: profile.penguOffRotation.allowFromCash,
    penguOffRotationAllowWhileHolding: profile.penguOffRotation.allowWhileHolding,
    penguOffRotationAllowTradeGateOff: profile.penguOffRotation.allowTradeGateOff,
    penguStrongOverrideEntry: profile.penguStrongOverride.enabled,
    penguStrongOverrideTimeframe: profile.penguStrongOverride.timeframe,
    penguStrongOverrideSymbols: profile.penguStrongOverride.symbols,
    penguStrongOverrideCurrentSymbols: profile.penguStrongOverride.currentSymbols,
    penguStrongOverrideScoreGap: profile.penguStrongOverride.scoreGap,
    penguStrongOverrideMinHoldBars: profile.penguStrongOverride.minHoldBars,
    penguStrongOverrideAllowTradeGateOff: profile.penguStrongOverride.allowTradeGateOff,
    solWaveOverrideEntry: profile.solWaveOverride.enabled,
    solWaveOverrideTimeframe: profile.solWaveOverride.timeframe,
    solWaveOverrideCurrentSymbols: profile.solWaveOverride.currentSymbols,
    solWaveOverrideScoreGap: profile.solWaveOverride.scoreGap,
    solWaveOverrideMinHoldBars: profile.solWaveOverride.minHoldBars,
    solWaveOverrideAllowTradeGateOff: profile.solWaveOverride.allowTradeGateOff,
    solWaveOverrideAllowedWindows: monthlyWindows(profile.solWaveOverride.activeMonths),
    solWaveOverrideBreakoutLookbackBars: profile.solWaveOverride.breakoutLookbackBars,
    solWaveOverrideBreakoutMinPct: profile.solWaveOverride.breakoutMinPct,
    solWaveOverrideMinVolumeRatio: profile.solWaveOverride.minVolumeRatio,
    solWaveOverrideMinMomAccel: profile.solWaveOverride.minMomAccel,
    solWaveOverrideMinEfficiencyRatio: profile.solWaveOverride.minEfficiencyRatio,
    idleBreakoutEntryWhileCash: profile.idleBreakoutEntryWhileCash,
    idleBreakoutEntryTimeframe: profile.idleBreakoutEntryTimeframe,
    idleBreakoutSymbols: profile.idleBreakoutSymbols,
    idleBreakoutAllowTradeGateOff: profile.idleBreakoutAllowTradeGateOff,
    idleBreakoutMinVolumeRatio: profile.idleBreakoutMinVolumeRatio,
    idleBreakoutMinMomAccel: profile.idleBreakoutMinMomAccel,
    idleBreakoutBreakoutLookbackBars: profile.idleBreakoutBreakoutLookbackBars,
    idleBreakoutBreakoutMinPct: profile.idleBreakoutBreakoutMinPct,
    idleBreakoutMinEfficiencyRatio: profile.idleBreakoutMinEfficiencyRatio,
    idleBreakoutProfitTrailActivationPct: profile.idleBreakoutProfitTrailActivationPct,
    idleBreakoutProfitTrailRetracePct: profile.idleBreakoutProfitTrailRetracePct,
    idleBreakoutTieredTrailBySymbol: profile.idleBreakoutTieredTrailBySymbol,
    idleBreakoutConditionalEarlyTrailBySymbol: profile.idleBreakoutConditionalEarlyTrailBySymbol,
    idleBreakoutMaxHoldBars: profile.idleBreakoutMaxHoldBars,
    idleBreakoutWeakExitMom20Below: profile.idleBreakoutWeakExitMom20Below,
    idleBreakoutWeakExitMomAccelBelow: profile.idleBreakoutWeakExitMomAccelBelow,
    idleBreakoutWeakExitMinHoldBars: profile.idleBreakoutWeakExitMinHoldBars,
    idleBreakoutWeakExitRequireCloseBelowSma40: profile.idleBreakoutWeakExitRequireCloseBelowSma40,
    idleBreakoutSwitchGuardMinCurrentScore: profile.idleBreakoutSwitchGuardMinCurrentScore,
    idleBreakoutSwitchGuardMinCurrentMom20: profile.idleBreakoutSwitchGuardMinCurrentMom20,
    idleBreakoutSwitchGuardMinCurrentMomAccel: profile.idleBreakoutSwitchGuardMinCurrentMomAccel,
    idleBreakoutSwitchGuardMinCurrentEfficiencyRatio: profile.idleBreakoutSwitchGuardMinCurrentEfficiencyRatio,
    idleBreakoutSwitchGuardRequiredScoreGap: profile.idleBreakoutSwitchGuardRequiredScoreGap,
    idleBreakoutSwitchGuardTargetSymbols: profile.idleBreakoutSwitchGuardTargetSymbols,
    idleBreakoutSwitchGuardBlockAfterTrailActivation: profile.idleBreakoutSwitchGuardBlockAfterTrailActivation,
    idleBreakoutSwitchGuardMode: profile.idleBreakoutSwitchGuardMode,
    partialExitBySymbol: profile.partialExitBySymbol,
    strictExtraTrendRotationBlockBelowDrawdownPct: profile.strictExtraTrendRotationBlockBelowDrawdownPct,
    trendRotationWhileHolding: profile.trendRotationWhileHolding,
    trendRotationCurrentSymbols: profile.trendRotationCurrentSymbols,
    trendRotationScoreGap: profile.trendRotationScoreGap,
    trendRotationAlternateScoreGap: profile.trendRotationAlternateScoreGap,
    trendRotationCurrentMomAccelMax: profile.trendRotationCurrentMomAccelMax,
    trendRotationCurrentMom20Max: profile.trendRotationCurrentMom20Max,
    trendRotationRequireConsecutiveBars: profile.trendRotationRequireConsecutiveBars,
    trendRotationAlternateRequireConsecutiveBars: profile.trendRotationAlternateRequireConsecutiveBars,
    trendRotationMinHoldBars: profile.trendRotationMinHoldBars,
    trendRotationTargetBlockSymbols: profile.trendRotationTargetBlockSymbols,
    trendRotationTargetExceptionBySymbol: profile.trendRotationTargetExceptionBySymbol,
    trendBreakoutLookbackBarsBySymbol: {
      ...(profile.trendBreakoutLookbackBarsBySymbol ?? {}),
      ...profile.penguStrongOverride.breakoutLookbackBarsBySymbol,
    },
    trendBreakoutMinPctBySymbol: {
      ...(profile.trendBreakoutMinPctBySymbol ?? {}),
      ...profile.penguStrongOverride.breakoutMinPctBySymbol,
    },
    trendMinVolumeRatioBySymbol: {
      ...(profile.trendMinVolumeRatioBySymbol ?? {}),
      ...profile.penguStrongOverride.minVolumeRatioBySymbol,
    },
    trendMinMomAccelBySymbol: {
      ...(profile.trendMinMomAccelBySymbol ?? {}),
      ...profile.penguStrongOverride.minMomAccelBySymbol,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(profile.trendMinEfficiencyRatioBySymbol ?? {}),
      ...profile.penguStrongOverride.minEfficiencyRatioBySymbol,
    },
    trendProfitTrailActivationPctBySymbol: profile.penguOffRotation.trailActivationPctBySymbol,
    trendProfitTrailRetracePctBySymbol: profile.penguOffRotation.trailRetracePctBySymbol,
    trendScoreAdjustmentBySymbol: profile.trendScoreAdjustmentBySymbol,
    trendAllocBySymbol: profile.trendAllocBySymbol,
    symbolSpecificTrendWeakExitSymbols: profile.symbolSpecificTrendWeakExitSymbols,
    symbolSpecificTrendWeakExitMom20Below: profile.symbolSpecificTrendWeakExitMom20Below,
    symbolSpecificTrendWeakExitMomAccelBelow: profile.symbolSpecificTrendWeakExitMomAccelBelow,
    symbolSpecificTrendWeakExitMom20BelowBySymbol: profile.symbolSpecificTrendWeakExitMom20BelowBySymbol,
    symbolSpecificTrendWeakExitMomAccelBelowBySymbol: profile.symbolSpecificTrendWeakExitMomAccelBelowBySymbol,
    trendPrioritySymbols: profile.trendPrioritySymbols,
    trendPriorityMaxScoreGap: profile.trendPriorityMaxScoreGap,
    trendSymbolQualityBlockBySymbol: profile.trendSymbolQualityBlockBySymbol,
    trendWeakMarketBlockSymbols: profile.trendWeakMarketBlockSymbols,
    trendWeakMarketBlockRequireWeak2022: profile.trendWeakMarketBlockRequireWeak2022,
    trendWeakMarketBlockBestMom20Below: profile.trendWeakMarketBlockBestMom20Below,
    trendWeakMarketBlockBtcAdxBelow: profile.trendWeakMarketBlockBtcAdxBelow,
    portfolioDrawdownCashExitPct: profile.portfolioDrawdownCashExitPct,
    trendMinEfficiencyRatio: profile.trendMinEfficiencyRatio,
    trendProfitTrailActivationPct: profile.trendProfitTrailActivationPct,
    trendProfitTrailRetracePct: profile.trendProfitTrailRetracePct,
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

export const RECLAIM_HYBRID_CASH_RESCUE_SYMBOLS = ["TWT"] as const;
export const RECLAIM_HYBRID_CASH_RESCUE_PRIORITY_SYMBOLS = ["TWT"] as const;

export function buildReclaimHybridCashRescueVariantOptions(profile = RECLAIM_HYBRID_EXECUTION_PROFILE) {
  const base = buildReclaimHybridVariantOptions(profile);
  return {
    ...base,
    expandedTrendSymbols: [...new Set([...base.expandedTrendSymbols, ...RECLAIM_HYBRID_CASH_RESCUE_SYMBOLS])],
    trendBreakoutLookbackBarsBySymbol: {
      ...(base.trendBreakoutLookbackBarsBySymbol ?? {}),
      TWT: 8,
      ...profile.penguOffRotation.breakoutLookbackBarsBySymbol,
    },
    trendBreakoutMinPctBySymbol: {
      ...(base.trendBreakoutMinPctBySymbol ?? {}),
      TWT: 0.012,
      ...profile.penguOffRotation.breakoutMinPctBySymbol,
    },
    trendMinVolumeRatioBySymbol: {
      ...(base.trendMinVolumeRatioBySymbol ?? {}),
      TWT: 1.01,
      ...profile.penguOffRotation.minVolumeRatioBySymbol,
    },
    trendMinMomAccelBySymbol: {
      ...(base.trendMinMomAccelBySymbol ?? {}),
      TWT: 0.0005,
      ...profile.penguOffRotation.minMomAccelBySymbol,
    },
    trendMinEfficiencyRatioBySymbol: {
      ...(base.trendMinEfficiencyRatioBySymbol ?? {}),
      TWT: 0.17,
      ...profile.penguOffRotation.minEfficiencyRatioBySymbol,
    },
    trendPrioritySymbols: [],
    trendPriorityMaxScoreGap: null,
    trendSymbolBlockWindows: {
      TWT: blockOutsideMonthlyWindows(profile.twtUsdtSleeveSidecar.activeMonths),
    },
    trendRotationWhileHolding: true,
    trendRotationCurrentSymbols: ["ETH", "SOL", "AVAX", "INJ"],
    trendRotationScoreGap: 0,
    trendRotationCurrentMomAccelMax: 999,
    trendRotationCurrentMom20Max: 999,
    trendRotationMinHoldBars: 1,
    trendRotationRequireConsecutiveBars: 1,
    injSpringCashEntry: true,
    injSpringCashQuoteCostPct: 0.01,
    injSpringCashHardStopLossPct: 0.085,
    injSpringCashTrailActivationPct: 0.34,
    injSpringCashTrailRetracePct: 0.12,
    injSpringCashMaxHoldBars: 24 * 50,
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
  APE_USDT: 100,
  COS_USDT: 100,
  MITO_USDT: 100,
  BIO_USDT: 100,
  DUSK_USDT: 100,
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
