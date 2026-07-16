import type {
  Critique,
  ResearchLabThresholds,
  ResearchMetrics,
  ResearchVerdict,
  StrategyEvaluation,
  StrategyGenome,
  StrategyValidationReport,
  ValidationLevel,
} from "./types";

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function finite(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function calculateResearchScore(metrics: ResearchMetrics, thresholds: ResearchLabThresholds) {
  const drawdown = Math.abs(finite(metrics.maxDrawdownPct, 100));
  const monthlyTargetScore = clamp01(metrics.averageMonthlyReturnPct / Math.max(1, thresholds.targetAverageMonthlyReturnPct));
  const targetHitScore = clamp01(metrics.targetMonthlyHitRatePct / Math.max(1, thresholds.minTargetMonthlyHitRatePct * 2));
  const returnScore = clamp01(metrics.cagrPct / Math.max(1, thresholds.minCagrPct * 2));
  const drawdownScore = clamp01(1 - drawdown / Math.max(1, thresholds.maxDrawdownPct * 2));
  const sharpeScore = clamp01(metrics.sharpe / Math.max(0.1, thresholds.minSharpe * 1.6));
  const sortinoScore = clamp01(metrics.sortino / Math.max(0.1, thresholds.minSortino * 1.6));
  const profitFactorScore = clamp01((metrics.profitFactor - 1) / Math.max(0.1, thresholds.minProfitFactor));
  const sampleScore = clamp01(metrics.tradeCount / Math.max(1, thresholds.minTradeCount * 2));
  const stabilityScore = clamp01(metrics.temporalStabilityScore);
  const recentScore = clamp01(metrics.recentPeriodScore);

  return Math.round(
    (
      monthlyTargetScore * 0.16 +
      targetHitScore * 0.08 +
      returnScore * 0.1 +
      drawdownScore * 0.18 +
      sharpeScore * 0.12 +
      sortinoScore * 0.08 +
      profitFactorScore * 0.08 +
      sampleScore * 0.06 +
      stabilityScore * 0.08 +
      recentScore * 0.06
    ) * 10000,
  ) / 100;
}

export function collectRejectionReasons(metrics: ResearchMetrics, thresholds: ResearchLabThresholds) {
  const reasons: string[] = [];
  const drawdown = Math.abs(metrics.maxDrawdownPct);

  if (metrics.cagrPct < thresholds.minCagrPct) reasons.push(`CAGR ${metrics.cagrPct.toFixed(2)}% < ${thresholds.minCagrPct}%`);
  if (drawdown > thresholds.maxDrawdownPct) reasons.push(`MaxDD ${drawdown.toFixed(2)}% > ${thresholds.maxDrawdownPct}%`);
  if (metrics.sharpe < thresholds.minSharpe) reasons.push(`Sharpe ${metrics.sharpe.toFixed(2)} < ${thresholds.minSharpe}`);
  if (metrics.sortino < thresholds.minSortino) reasons.push(`Sortino ${metrics.sortino.toFixed(2)} < ${thresholds.minSortino}`);
  if (metrics.profitFactor < thresholds.minProfitFactor) reasons.push(`PF ${metrics.profitFactor.toFixed(2)} < ${thresholds.minProfitFactor}`);
  if (metrics.tradeCount < thresholds.minTradeCount) reasons.push(`Trades ${metrics.tradeCount} < ${thresholds.minTradeCount}`);
  if (metrics.averageMonthlyReturnPct < thresholds.minAverageMonthlyReturnPct) {
    reasons.push(`平均月利 ${metrics.averageMonthlyReturnPct.toFixed(2)}% < ${thresholds.minAverageMonthlyReturnPct}%`);
  }
  if (metrics.medianMonthlyReturnPct < thresholds.minMedianMonthlyReturnPct) {
    reasons.push(`中央値月利 ${metrics.medianMonthlyReturnPct.toFixed(2)}% < ${thresholds.minMedianMonthlyReturnPct}%`);
  }
  if (metrics.positiveMonthPct < thresholds.minPositiveMonthPct) reasons.push(`Positive months ${metrics.positiveMonthPct.toFixed(1)}% < ${thresholds.minPositiveMonthPct}%`);
  if (metrics.temporalStabilityScore < thresholds.minTemporalStabilityScore) reasons.push("期間安定性が基準未達");
  if (metrics.recentPeriodScore < thresholds.minRecentPeriodScore) reasons.push("直近期間の再現性が基準未達");

  return reasons;
}

export function buildCritiques(
  metrics: ResearchMetrics,
  thresholds: ResearchLabThresholds,
  validation?: StrategyValidationReport,
): Critique[] {
  const critiques: Critique[] = [];
  const drawdown = Math.abs(metrics.maxDrawdownPct);

  if (metrics.tradeCount < thresholds.minTradeCount * 1.5 || metrics.temporalStabilityScore < 0.65) {
    critiques.push({
      critic: "overfit-critic",
      severity: metrics.tradeCount < thresholds.minTradeCount ? "high" : "medium",
      message: "取引サンプル数または期間安定性が弱く、特定期間への過適合を疑う。",
    });
  }

  if (drawdown > thresholds.maxDrawdownPct * 0.8 || metrics.worstMonthPct < -12) {
    critiques.push({
      critic: "tail-risk-critic",
      severity: drawdown > thresholds.maxDrawdownPct ? "high" : "medium",
      message: `下方リスクを警戒。MaxDD=${drawdown.toFixed(2)}%、WorstMonth=${metrics.worstMonthPct.toFixed(2)}%。`,
    });
  }

  if (metrics.averageMonthlyReturnPct < thresholds.targetAverageMonthlyReturnPct) {
    critiques.push({
      critic: "overfit-critic",
      severity: metrics.averageMonthlyReturnPct < thresholds.targetAverageMonthlyReturnPct * 0.5 ? "medium" : "low",
      message: `研究目標の平均月利${thresholds.targetAverageMonthlyReturnPct}%には未達。現在=${metrics.averageMonthlyReturnPct.toFixed(2)}%。`,
    });
  }

  if (metrics.tradeCount > 450 || metrics.profitFactor < thresholds.minProfitFactor + 0.15) {
    critiques.push({
      critic: "execution-critic",
      severity: metrics.profitFactor < thresholds.minProfitFactor ? "high" : "medium",
      message: "約定コスト上昇で優位性が消える可能性があるため、手数料・スリッページ耐性を追加検証する。",
    });
  }

  if (validation && validation.finalGateReasons.length) {
    critiques.push({
      critic: validation.passedTemporalValidation ? "execution-critic" : "overfit-critic",
      severity: "high",
      message: `最終検証未通過: ${validation.finalGateReasons.slice(0, 3).join(" / ")}`,
    });
  }

  if (!critiques.length) {
    critiques.push({
      critic: "overfit-critic",
      severity: "low",
      message: "重大な欠陥は未検出。独立期間とコストストレスの継続監視は必要。",
    });
  }

  return critiques;
}

export function decideVerdict(
  rejectionReasons: string[],
  validationLevel: ValidationLevel,
  validation?: StrategyValidationReport,
): ResearchVerdict {
  if (rejectionReasons.length) return "rejected";
  if (
    validationLevel === "stress_tested" &&
    validation?.passedTemporalValidation &&
    validation.passedStressTest &&
    validation.finalGateReasons.length === 0
  ) {
    return "final_candidate";
  }
  return "candidate";
}

export function evaluateStrategy(input: {
  genome: StrategyGenome;
  metrics: ResearchMetrics;
  thresholds: ResearchLabThresholds;
  validationLevel: ValidationLevel;
  validation?: StrategyValidationReport;
}): StrategyEvaluation {
  const rejectionReasons = collectRejectionReasons(input.metrics, input.thresholds);
  const baseScore = calculateResearchScore(input.metrics, input.thresholds);
  const validationAdjustment = input.validation
    ? input.validation.oosRetentionRatio * 2 +
      input.validation.stressRetentionRatio * 2 +
      (input.validation.walkForwardPassRatePct / 100) * 2 -
      input.validation.finalGateReasons.length * 0.5
    : 0;
  const score = Math.round(Math.max(0, Math.min(100, baseScore + validationAdjustment)) * 100) / 100;
  const critiques = buildCritiques(input.metrics, input.thresholds, input.validation);
  return {
    genome: input.genome,
    metrics: input.metrics,
    validationLevel: input.validationLevel,
    validation: input.validation,
    score,
    verdict: decideVerdict(rejectionReasons, input.validationLevel, input.validation),
    rejectionReasons,
    critiques,
    evaluatedAt: new Date().toISOString(),
  };
}
