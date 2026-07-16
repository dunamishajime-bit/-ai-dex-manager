export type StrategyFamily =
  | "trend"
  | "breakout"
  | "range"
  | "mean_reversion"
  | "momentum_rotation"
  | "volatility"
  | "regime_hybrid";

export type ResearcherId =
  | "alpha-trend"
  | "alpha-breakout"
  | "alpha-range"
  | "alpha-mean-reversion"
  | "quant-statistics"
  | "quant-regime"
  | "execution-cost"
  | "exit-engineer"
  | "portfolio-construction"
  | "wildcard-innovation";

export type CriticId = "overfit-critic" | "tail-risk-critic" | "execution-critic";

export type ResearchVerdict = "rejected" | "candidate" | "final_candidate";
export type ValidationLevel = "single_pass" | "temporal_validation" | "stress_tested";
export type ResearchTimeframe = "4h" | "6h" | "12h" | "1d";
export type ExitTimeframe = "4h" | "6h" | "12h";

export interface StrategyGenome {
  id: string;
  generation: number;
  parentIds: string[];
  createdBy: ResearcherId;
  family: StrategyFamily;
  thesis: string;
  markets: string[];
  parameters: {
    trendDecisionTimeframe: ResearchTimeframe;
    trendExitCheckTimeframe: ExitTimeframe;
    trendAlloc: number;
    rangeAlloc: number;
    rangeEntryMode:
      | "mean_revert"
      | "box_rebound"
      | "reclaim"
      | "wick_rejection"
      | "midline_reclaim"
      | "volatility_spring"
      | "failed_breakdown"
      | "atr_snapback"
      | "compression_turn"
      | "sma_reclaim_pulse"
      | "atr_or_failed_breakdown";
    trendExitSma: 40 | 45;
    trendBreakoutLookbackBars: number;
    trendBreakoutMinPct: number;
    trendMinVolumeRatio: number;
    trendMinMomAccel: number;
    trendMinEfficiencyRatio: number;
    trendProfitTrailActivationPct: number;
    trendProfitTrailRetracePct: number;
    rangeEntryBestMom20Below: number;
    rangeEntryBtcAdxBelow: number;
    rangeOverheatMax: number;
    rangeExitMom20Above: number;
    rangeMaxHoldBars: number;
    trendRotationWhileHolding: boolean;
    trendRotationScoreGap: number;
    trendRotationRequireConsecutiveBars: number;
  };
}

export interface ResearchMetrics {
  cagrPct: number;
  maxDrawdownPct: number;
  sharpe: number;
  sortino: number;
  profitFactor: number;
  winRatePct: number;
  tradeCount: number;
  exposurePct: number;
  averageMonthlyReturnPct: number;
  medianMonthlyReturnPct: number;
  positiveMonthPct: number;
  targetMonthlyHitRatePct: number;
  rolling3MonthTargetHitRatePct: number;
  bestMonthPct: number;
  worstMonthPct: number;
  temporalStabilityScore: number;
  recentPeriodScore: number;
}

export interface Critique {
  critic: CriticId;
  severity: "low" | "medium" | "high";
  message: string;
}

export interface TemporalWindow {
  label: string;
  startTs: number;
  endTs: number;
}

export interface WalkForwardWindow {
  label: string;
  train: TemporalWindow;
  test: TemporalWindow;
}

export interface TemporalValidationPlan {
  train: TemporalWindow;
  validation: TemporalWindow;
  oos: TemporalWindow;
  walkForward: WalkForwardWindow[];
}

export interface ValidationSegmentResult {
  label: string;
  window: TemporalWindow;
  metrics: ResearchMetrics;
}

export interface WalkForwardResult {
  label: string;
  trainWindow: TemporalWindow;
  test: ValidationSegmentResult;
  passed: boolean;
  reasons: string[];
}

export interface StressScenarioResult {
  label: string;
  extraRoundTripCostBps: number;
  metrics: ResearchMetrics;
  passed: boolean;
  reasons: string[];
}

export interface StrategyValidationReport {
  plan: TemporalValidationPlan;
  train: ValidationSegmentResult;
  validation: ValidationSegmentResult;
  oos: ValidationSegmentResult;
  walkForward: WalkForwardResult[];
  stress: StressScenarioResult[];
  oosRetentionRatio: number;
  stressRetentionRatio: number;
  walkForwardPassRatePct: number;
  passedTemporalValidation: boolean;
  passedStressTest: boolean;
  finalGateReasons: string[];
}

export interface StrategyEvaluation {
  genome: StrategyGenome;
  metrics: ResearchMetrics;
  validationLevel: ValidationLevel;
  validation?: StrategyValidationReport;
  score: number;
  verdict: ResearchVerdict;
  rejectionReasons: string[];
  critiques: Critique[];
  evaluatedAt: string;
}

export interface ResearchRound {
  round: number;
  generated: number;
  evaluated: number;
  rejected: number;
  candidates: number;
  best: StrategyEvaluation | null;
}

export interface ResearchLabThresholds {
  minCagrPct: number;
  maxDrawdownPct: number;
  minSharpe: number;
  minSortino: number;
  minProfitFactor: number;
  minTradeCount: number;
  minAverageMonthlyReturnPct: number;
  minMedianMonthlyReturnPct: number;
  minPositiveMonthPct: number;
  minTemporalStabilityScore: number;
  minRecentPeriodScore: number;
  targetAverageMonthlyReturnPct: number;
  finalMinOosAverageMonthlyReturnPct: number;
  finalMinStressAverageMonthlyReturnPct: number;
  minTargetMonthlyHitRatePct: number;
  minOosRetentionRatio: number;
  minStressRetentionRatio: number;
  maxOosDrawdownPct: number;
  minWalkForwardPassRatePct: number;
}

export interface ResearchLabConfig {
  rounds: number;
  populationPerRound: number;
  eliteCount: number;
  finalValidationCount: number;
  maxConcurrency: number;
  seed: number;
  startTs?: number;
  endTs?: number;
  walkForwardFolds: number;
  stressExtraRoundTripCostBps: number[];
  thresholds: ResearchLabThresholds;
}

export interface ResearchCacheStats {
  hits: number;
  misses: number;
  entries: number;
}

export interface ResearchLabResult {
  startedAt: string;
  completedAt: string;
  config: ResearchLabConfig;
  rounds: ResearchRound[];
  leaderboard: StrategyEvaluation[];
  finalCandidates: StrategyEvaluation[];
  totalEvaluations: number;
  validatedStrategies: number;
  cacheStats?: ResearchCacheStats;
}

export interface StrategyBacktestAdapter {
  evaluate(genome: StrategyGenome, config: ResearchLabConfig): Promise<{
    metrics: ResearchMetrics;
    validationLevel: ValidationLevel;
  }>;
  validate?(
    genome: StrategyGenome,
    config: ResearchLabConfig,
    discoveryMetrics: ResearchMetrics,
  ): Promise<StrategyValidationReport>;
  getCacheStats?(): ResearchCacheStats;
}
