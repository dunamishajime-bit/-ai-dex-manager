import type {
  PerpBacktestResult,
  PerpResearchThresholds,
  PerpStrategyEvaluation,
  PerpStrategyGenome,
  PerpValidationReport,
  PerpVerdict,
} from "./types";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function perpDiscoveryReasons(result: PerpBacktestResult, thresholds: PerpResearchThresholds) {
  const reasons: string[] = [];
  const metrics = result.metrics;
  const risk = result.risk;

  if (metrics.averageMonthlyReturnPct < thresholds.discoveryMinAverageMonthlyReturnPct) {
    reasons.push(`平均月利 ${metrics.averageMonthlyReturnPct.toFixed(2)}% < ${thresholds.discoveryMinAverageMonthlyReturnPct}%`);
  }
  if (metrics.maxDrawdownPct > thresholds.discoveryMaxDrawdownPct) {
    reasons.push(`MaxDD ${metrics.maxDrawdownPct.toFixed(2)}% > ${thresholds.discoveryMaxDrawdownPct}%`);
  }
  if (metrics.sharpe < thresholds.discoveryMinSharpe) {
    reasons.push(`Sharpe ${metrics.sharpe.toFixed(2)} < ${thresholds.discoveryMinSharpe}`);
  }
  if (metrics.profitFactor < thresholds.discoveryMinProfitFactor) {
    reasons.push(`PF ${metrics.profitFactor.toFixed(2)} < ${thresholds.discoveryMinProfitFactor}`);
  }
  if (metrics.tradeCount < thresholds.discoveryMinTrades) {
    reasons.push(`Trades ${metrics.tradeCount} < ${thresholds.discoveryMinTrades}`);
  }
  if (thresholds.requireZeroLiquidations && risk.liquidationCount > 0) {
    reasons.push(`Liquidations ${risk.liquidationCount} > 0`);
  }
  if (risk.endingEquity <= 0) reasons.push("口座破綻");
  if (thresholds.requireBothDirections && (risk.longTrades === 0 || risk.shortTrades === 0)) {
    reasons.push(`方向偏り Long=${risk.longTrades} Short=${risk.shortTrades}`);
  }

  return reasons;
}

export function calculatePerpScore(result: PerpBacktestResult, thresholds: PerpResearchThresholds) {
  const metrics = result.metrics;
  const risk = result.risk;
  const monthlyScore = clamp01(metrics.averageMonthlyReturnPct / Math.max(1, thresholds.targetAverageMonthlyReturnPct));
  const medianScore = clamp01((metrics.medianMonthlyReturnPct + 5) / 20);
  const drawdownScore = clamp01(1 - metrics.maxDrawdownPct / Math.max(1, thresholds.discoveryMaxDrawdownPct * 1.5));
  const sharpeScore = clamp01(metrics.sharpe / 2.5);
  const profitFactorScore = clamp01((metrics.profitFactor - 1) / 2);
  const sampleScore = clamp01(metrics.tradeCount / Math.max(1, thresholds.discoveryMinTrades * 3));
  const directionTotal = risk.longTrades + risk.shortTrades;
  const directionBalance = directionTotal
    ? 1 - Math.abs(risk.longTrades - risk.shortTrades) / directionTotal
    : 0;
  const consistencyScore = clamp01(1 - risk.maxConsecutiveLosses / Math.max(1, thresholds.finalMaxConsecutiveLosses * 2));
  const liquidationPenalty = risk.liquidationCount > 0 ? Math.min(0.8, risk.liquidationCount * 0.25) : 0;

  const score =
    monthlyScore * 0.24 +
    medianScore * 0.08 +
    drawdownScore * 0.18 +
    sharpeScore * 0.13 +
    profitFactorScore * 0.1 +
    sampleScore * 0.09 +
    directionBalance * 0.1 +
    consistencyScore * 0.08 -
    liquidationPenalty;

  return Math.round(clamp01(score) * 10000) / 100;
}

function verdictFor(reasons: string[], validation?: PerpValidationReport): PerpVerdict {
  if (validation?.passed) return "final_candidate";
  return reasons.length ? "rejected" : "survivor";
}

export function evaluatePerpStrategy(input: {
  genome: PerpStrategyGenome;
  train: PerpBacktestResult;
  thresholds: PerpResearchThresholds;
  validation?: PerpValidationReport;
}): PerpStrategyEvaluation {
  const reasons = perpDiscoveryReasons(input.train, input.thresholds);
  const validationAdjustment = input.validation
    ? input.validation.oosReturnRetentionRatio * 2 +
      input.validation.stressReturnRetentionRatio * 2 +
      (input.validation.walkForwardPassRatePct / 100) * 3 -
      input.validation.finalGateReasons.length * 0.5
    : 0;
  const score = Math.max(0, Math.min(100, calculatePerpScore(input.train, input.thresholds) + validationAdjustment));

  return {
    genome: input.genome,
    train: input.train,
    validation: input.validation,
    score: Math.round(score * 100) / 100,
    verdict: verdictFor(reasons, input.validation),
    reasons,
    evaluatedAt: new Date().toISOString(),
  };
}
