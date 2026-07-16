import type { Candle1h } from "@/lib/backtest/types";
import type { ResearchMetrics, ResearcherId, TemporalValidationPlan, TemporalWindow } from "../types";

export type PerpSide = "long" | "short";
export type PerpFamily = "regime_momentum" | "breakout" | "relative_strength" | "dual_direction";
export type PerpTimeframeHours = 2 | 4 | 6 | 8 | 12;
export type PerpResearchProfile = "balanced" | "attack";

export interface PerpStrategyParameters {
  timeframeHours: PerpTimeframeHours;
  leverage: number;
  riskPerTradePct: number;
  maxMarginUsagePct: number;
  btcRegimeSmaBars: number;
  btcRegimeMomentumBars: number;
  regimeThresholdPct: number;
  momentumBars: number;
  breakoutBars: number;
  breakoutBufferPct: number;
  minimumMomentumPct: number;
  minimumVolumeRatio: number;
  minimumEdgeToCostRatio: number;
  volatilityLookbackBars: number;
  volatilityPenalty: number;
  atrBars: number;
  stopAtr: number;
  takeProfitAtr: number;
  trailingAtr: number;
  maxHoldBars: number;
  rebalanceBars: number;
  cooldownBars: number;
  allowLong: boolean;
  allowShort: boolean;
  allowNeutralRegime: boolean;
  neutralScoreThreshold: number;
}

export interface PerpStrategyGenome {
  id: string;
  generation: number;
  parentIds: string[];
  createdBy: ResearcherId;
  family: PerpFamily;
  thesis: string;
  symbols: string[];
  parameters: PerpStrategyParameters;
}

export interface PerpExecutionAssumptions {
  feeBpsPerSide: number;
  slippageBpsPerSide: number;
  adverseFundingBpsPer8h: number;
  maintenanceMarginRate: number;
}

export interface PerpBar extends Candle1h {}

export interface PerpFundingPoint {
  ts: number;
  rate: number;
}

export interface PerpMarketData {
  startTs: number;
  endTs: number;
  source: "binance-usdm-futures" | "synthetic";
  bySymbol: Record<string, Candle1h[]>;
  fundingBySymbol: Record<string, PerpFundingPoint[]>;
}

export interface PerpTrade {
  tradeId: string;
  symbol: string;
  side: PerpSide;
  entryTs: number;
  exitTs: number;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  notional: number;
  effectiveLeverage: number;
  stopPrice: number;
  takeProfitPrice: number;
  grossPnl: number;
  entryFee: number;
  exitFee: number;
  fundingCost: number;
  netPnl: number;
  holdingBars: number;
  exitReason: string;
  liquidated: boolean;
}

export interface PerpEquityPoint {
  ts: number;
  equity: number;
  balance: number;
  unrealizedPnl: number;
  symbol: string;
  side: PerpSide | "cash";
  effectiveLeverage: number;
}

export interface PerpRiskMetrics {
  liquidationCount: number;
  longTrades: number;
  shortTrades: number;
  maxConsecutiveLosses: number;
  averageHoldingBars: number;
  averageEffectiveLeverage: number;
  maximumEffectiveLeverage: number;
  totalFundingCost: number;
  exposurePct: number;
  endingEquity: number;
}

export interface PerpBacktestResult {
  genomeId: string;
  window: TemporalWindow;
  execution: PerpExecutionAssumptions;
  metrics: ResearchMetrics;
  risk: PerpRiskMetrics;
  trades: PerpTrade[];
  equityCurve: PerpEquityPoint[];
  monthlyReturnsPct: number[];
  annualReturnsPct: number[];
}

export interface PerpStressResult {
  label: string;
  execution: PerpExecutionAssumptions;
  result: PerpBacktestResult;
  passed: boolean;
  reasons: string[];
}

export interface PerpWalkForwardResult {
  label: string;
  window: TemporalWindow;
  result: PerpBacktestResult;
  passed: boolean;
  reasons: string[];
}

export interface PerpValidationReport {
  plan: TemporalValidationPlan;
  train: PerpBacktestResult;
  validation: PerpBacktestResult;
  oos: PerpBacktestResult;
  walkForward: PerpWalkForwardResult[];
  stress: PerpStressResult[];
  oosReturnRetentionRatio: number;
  stressReturnRetentionRatio: number;
  walkForwardPassRatePct: number;
  finalGateReasons: string[];
  passed: boolean;
}

export type PerpVerdict = "rejected" | "survivor" | "final_candidate";

export interface PerpStrategyEvaluation {
  genome: PerpStrategyGenome;
  train: PerpBacktestResult;
  validation?: PerpValidationReport;
  score: number;
  verdict: PerpVerdict;
  reasons: string[];
  evaluatedAt: string;
}

export interface PerpResearchThresholds {
  targetAverageMonthlyReturnPct: number;
  discoveryMinAverageMonthlyReturnPct: number;
  discoveryMaxDrawdownPct: number;
  discoveryMinSharpe: number;
  discoveryMinProfitFactor: number;
  discoveryMinTrades: number;
  targetAverageEffectiveLeverage: number;
  finalMinOosAverageMonthlyReturnPct: number;
  finalMaxOosDrawdownPct: number;
  finalMinOosTrades: number;
  finalMinWalkForwardPassRatePct: number;
  finalMinOosRetentionRatio: number;
  finalMinStressAverageMonthlyReturnPct: number;
  finalMinStressRetentionRatio: number;
  finalMaxConsecutiveLosses: number;
  requireBothDirections: boolean;
  requireZeroLiquidations: boolean;
}

export interface PerpResearchConfig {
  profile: PerpResearchProfile;
  rounds: number;
  populationPerRound: number;
  eliteCount: number;
  finalistCount: number;
  seed: number;
  maxConcurrency: number;
  startTs: number;
  endTs: number;
  symbols: string[];
  baseExecution: PerpExecutionAssumptions;
  stressExecutions: Array<{ label: string; execution: PerpExecutionAssumptions }>;
  walkForwardFolds: number;
  thresholds: PerpResearchThresholds;
}

export interface PerpResearchRound {
  round: number;
  evaluated: number;
  survivors: number;
  best: PerpStrategyEvaluation | null;
}

export interface PerpResearchResult {
  startedAt: string;
  completedAt: string;
  config: PerpResearchConfig;
  rounds: PerpResearchRound[];
  leaderboard: PerpStrategyEvaluation[];
  finalCandidates: PerpStrategyEvaluation[];
  totalEvaluations: number;
  validatedStrategies: number;
}
