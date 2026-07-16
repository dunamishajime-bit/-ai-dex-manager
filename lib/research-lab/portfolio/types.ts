import type { ResearchMetrics, TemporalValidationPlan, TemporalWindow } from "../types";
import type {
  PerpBacktestResult,
  PerpExecutionAssumptions,
  PerpMarketData,
  PerpResearchProfile,
  PerpStrategyGenome,
} from "../perp/types";

export interface PortfolioSleeve {
  id: string;
  weight: number;
  strategy: PerpStrategyGenome;
}

export interface PortfolioGenome {
  id: string;
  generation: number;
  parentIds: string[];
  profile: PerpResearchProfile;
  thesis: string;
  sleeves: PortfolioSleeve[];
  maxPairCorrelation: number;
  maxGrossExposure: number;
  maxNetExposure: number;
  minimumAverageGrossExposure: number;
}

export interface PortfolioEquityPoint {
  ts: number;
  equity: number;
  grossExposure: number;
  netExposure: number;
  activePositions: number;
}

export interface PortfolioTrade {
  sleeveId: string;
  tradeId: string;
  symbol: string;
  side: "long" | "short";
  entryTs: number;
  exitTs: number;
  weightedNetPnl: number;
  weightedFundingCost: number;
  liquidated: boolean;
}

export interface PortfolioRiskMetrics {
  liquidationCount: number;
  longTrades: number;
  shortTrades: number;
  maxConsecutiveLosses: number;
  averageActivePositions: number;
  maximumActivePositions: number;
  averageGrossExposure: number;
  maximumGrossExposure: number;
  averageAbsoluteNetExposure: number;
  maximumAbsoluteNetExposure: number;
  maximumPairCorrelation: number;
  totalFundingCost: number;
  endingEquity: number;
}

export interface PortfolioBacktestResult {
  genomeId: string;
  window: TemporalWindow;
  execution: PerpExecutionAssumptions;
  metrics: ResearchMetrics;
  risk: PortfolioRiskMetrics;
  equityCurve: PortfolioEquityPoint[];
  trades: PortfolioTrade[];
  monthlyReturnsPct: number[];
  annualReturnsPct: number[];
  sleeveResults: PerpBacktestResult[];
}

export interface PortfolioStressResult {
  label: string;
  execution: PerpExecutionAssumptions;
  result: PortfolioBacktestResult;
  passed: boolean;
  reasons: string[];
}

export interface PortfolioWalkForwardResult {
  label: string;
  window: TemporalWindow;
  result: PortfolioBacktestResult;
  passed: boolean;
  reasons: string[];
}

export interface PortfolioValidationReport {
  plan: TemporalValidationPlan;
  train: PortfolioBacktestResult;
  validation: PortfolioBacktestResult;
  oos: PortfolioBacktestResult;
  walkForward: PortfolioWalkForwardResult[];
  stress: PortfolioStressResult[];
  oosReturnRetentionRatio: number;
  stressReturnRetentionRatio: number;
  walkForwardPassRatePct: number;
  finalGateReasons: string[];
  passed: boolean;
}

export type PortfolioVerdict = "rejected" | "survivor" | "final_candidate";

export interface PortfolioEvaluation {
  genome: PortfolioGenome;
  train: PortfolioBacktestResult;
  validation?: PortfolioValidationReport;
  score: number;
  verdict: PortfolioVerdict;
  reasons: string[];
  evaluatedAt: string;
}

export interface PortfolioThresholds {
  targetAverageMonthlyReturnPct: number;
  discoveryMinAverageMonthlyReturnPct: number;
  discoveryMaxDrawdownPct: number;
  discoveryMinSharpe: number;
  discoveryMinProfitFactor: number;
  discoveryMinTrades: number;
  discoveryMinAverageGrossExposure: number;
  finalMinOosAverageMonthlyReturnPct: number;
  finalMaxOosDrawdownPct: number;
  finalMinOosTrades: number;
  finalMinWalkForwardPassRatePct: number;
  finalMinOosRetentionRatio: number;
  finalMinStressAverageMonthlyReturnPct: number;
  finalMinStressRetentionRatio: number;
  finalMaxConsecutiveLosses: number;
  finalMinAverageActivePositions: number;
  requireBothDirections: boolean;
  requireZeroLiquidations: boolean;
}

export interface PortfolioResearchConfig {
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
  minimumSleeves: 2 | 3;
  maximumSleeves: 2 | 3;
  baseExecution: PerpExecutionAssumptions;
  stressExecutions: Array<{ label: string; execution: PerpExecutionAssumptions }>;
  walkForwardFolds: number;
  thresholds: PortfolioThresholds;
}

export interface PortfolioResearchRound {
  round: number;
  evaluated: number;
  survivors: number;
  best: PortfolioEvaluation | null;
}

export interface PortfolioResearchResult {
  startedAt: string;
  completedAt: string;
  config: PortfolioResearchConfig;
  marketDataSource: PerpMarketData["source"];
  rounds: PortfolioResearchRound[];
  leaderboard: PortfolioEvaluation[];
  finalCandidates: PortfolioEvaluation[];
  totalEvaluations: number;
  validatedPortfolios: number;
}
