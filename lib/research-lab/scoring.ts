import type {
  Critique,
  ResearchLabThresholds,
  ResearchMetrics,
  ResearchVerdict,
  StrategyEvaluation,
  StrategyGenome,
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
  const returnScore = clamp01(metrics.cagrPct / Math.max(1, thresholds.minCagrPct * 1.75));
  const drawdownScore = clamp01(1 - drawdown / Math.max(1, thresholds.maxDrawdownPct * 2));
  const sharpeScore = clamp01(metrics.sharpe / Math.max(0.1, thresholds.minSharpe * 1.6));
  const sortinoScore = clamp01(metrics.sortino / Math.max(0.1, thresholds.minSortino * 1.6));
  const profitFactorScore = clamp01((metrics.profitFactor - 1) / Math.max(0.1, thresholds.minProfitFactor));
  const sampleScore = clamp01(metrics.tradeCount / Math.max(1, thresholds.minTradeCount * 2));
  const monthlyScore = clamp01(metrics.positiveMonthPct / 75);
  const stabilityScore = clamp01(metrics.temporalStabilityScore);
  const recentScore = clamp01(metrics.recentPeriodScore);

  return Math.round(
    (
      returnScore * 0.19 +
      drawdownScore * 0.19 +
      sharpeScore * 0.15 +
      sortinoScore * 0.1 +
      profitFactorScore * 0.09 +
      sampleScore * 0.07 +
      monthlyScore * 0.06 +
      stabilityScore * 0.09 +
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
  if (metrics.positiveMonthPct < thresholds.minPositiveMonthPct) reasons.push(`Positive months ${metrics.positiveMonthPct.toFixed(1)}% < ${thresholds.minPositiveMonthPct}%`);
  if (metrics.temporalStabilityScore < thresholds.minTemporalStabilityScore) reasons.push("期間安定性が基準未達");
  if (metrics.recentPeriodScore < thresholds.minRecentPeriodScore) reasons.push("直近期間の再現性が基準未達");

  return reasons;
}

export function buildCritiques(metrics: ResearchMetrics, thresholds: ResearchLabThresholds): Critique[] {
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

  if (metrics.tradeCount > 450 || metrics.profitFactor < thresholds.minProfitFactor + 0.15) {
    critiques.push({
      critic: "execution-critic",
      severity: metrics.profitFactor < thresholds.minProfitFactor ? "high" : "medium",
      message: "約定コスト上昇で優位性が消える可能性があるため、手数料・スリッページ耐性を追加検証する。",
    });
  }

  if (!critiques.length) {
    critiques.push({
      critic: "overfit-critic",
      severity: "low",
      message: "重大な欠陥は未検出。ただし最終採用前に独立期間とコストストレス検証が必要。",
    });
  }

  return critiques;
}

export function decideVerdict(rejectionReasons: string[], validationLevel: ValidationLevel): ResearchVerdict {
  if (rejectionReasons.length) return "rejected";
  return validationLevel === "stress_tested" ? "final_candidate" : "candidate";
}

export function evaluateStrategy(input: {
  genome: StrategyGenome;
  metrics: ResearchMetrics;
  thresholds: ResearchLabThresholds;
  validationLevel: ValidationLevel;
}): StrategyEvaluation {
  const rejectionReasons = collectRejectionReasons(input.metrics, input.thresholds);
  const score = calculateResearchScore(input.metrics, input.thresholds);
  const critiques = buildCritiques(input.metrics, input.thresholds);
  return {
    genome: input.genome,
    metrics: input.metrics,
    validationLevel: input.validationLevel,
    score,
    verdict: decideVerdict(rejectionReasons, input.validationLevel),
    rejectionReasons,
    critiques,
    evaluatedAt: new Date().toISOString(),
  };
}
