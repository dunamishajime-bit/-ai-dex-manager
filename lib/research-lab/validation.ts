import type {
  ResearchLabConfig,
  ResearchLabThresholds,
  ResearchMetrics,
  StrategyValidationReport,
  TemporalValidationPlan,
  TemporalWindow,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_START_TS = Date.UTC(2023, 0, 1);

function boundedRatio(numerator: number, denominator: number) {
  if (denominator <= 0) return numerator > 0 ? 1 : 0;
  return Math.max(0, Math.min(2, numerator / denominator));
}

function alignedTs(value: number) {
  return Math.floor(value / DAY_MS) * DAY_MS;
}

function window(label: string, startTs: number, endTs: number): TemporalWindow {
  return {
    label,
    startTs: alignedTs(startTs),
    endTs: Math.max(alignedTs(startTs) + DAY_MS, alignedTs(endTs)),
  };
}

export function buildTemporalValidationPlan(config: ResearchLabConfig): TemporalValidationPlan {
  const startTs = config.startTs ?? DEFAULT_START_TS;
  const endTs = config.endTs ?? Date.now();
  const safeEndTs = Math.max(endTs, startTs + 360 * DAY_MS);
  const duration = safeEndTs - startTs;
  const trainEnd = startTs + duration * 0.6;
  const validationEnd = startTs + duration * 0.8;
  const folds = Math.max(1, Math.min(8, config.walkForwardFolds));
  const walkForwardStart = startTs + duration * 0.4;
  const walkForwardSpan = safeEndTs - walkForwardStart;
  const testSpan = walkForwardSpan / folds;

  return {
    train: window("train", startTs, trainEnd),
    validation: window("validation", trainEnd, validationEnd),
    oos: window("oos", validationEnd, safeEndTs),
    walkForward: Array.from({ length: folds }, (_, index) => {
      const testStart = walkForwardStart + testSpan * index;
      const testEnd = index === folds - 1 ? safeEndTs : testStart + testSpan;
      return {
        label: `wf-${index + 1}`,
        train: window(`wf-${index + 1}-train`, startTs, testStart),
        test: window(`wf-${index + 1}-test`, testStart, testEnd),
      };
    }),
  };
}

export function walkForwardGateReasons(metrics: ResearchMetrics, thresholds: ResearchLabThresholds) {
  const reasons: string[] = [];
  if (metrics.cagrPct <= 0) reasons.push("CAGR<=0");
  if (metrics.averageMonthlyReturnPct < thresholds.minAverageMonthlyReturnPct) reasons.push("平均月利が探索基準未達");
  if (metrics.maxDrawdownPct > thresholds.maxOosDrawdownPct) reasons.push("DD超過");
  if (metrics.sharpe < Math.max(0.5, thresholds.minSharpe * 0.5)) reasons.push("Sharpe低下");
  return reasons;
}

export function stressGateReasons(metrics: ResearchMetrics, thresholds: ResearchLabThresholds) {
  const reasons: string[] = [];
  if (metrics.averageMonthlyReturnPct < thresholds.finalMinStressAverageMonthlyReturnPct) {
    reasons.push(`ストレス後平均月利 ${metrics.averageMonthlyReturnPct.toFixed(2)}% < ${thresholds.finalMinStressAverageMonthlyReturnPct}%`);
  }
  if (metrics.maxDrawdownPct > thresholds.maxOosDrawdownPct * 1.2) reasons.push("ストレス後DD超過");
  if (metrics.profitFactor < 1.05) reasons.push("ストレス後PF不足");
  return reasons;
}

export function completeValidationReport(
  report: Omit<
    StrategyValidationReport,
    | "oosRetentionRatio"
    | "stressRetentionRatio"
    | "walkForwardPassRatePct"
    | "passedTemporalValidation"
    | "passedStressTest"
    | "finalGateReasons"
  >,
  thresholds: ResearchLabThresholds,
): StrategyValidationReport {
  const trainAverage = report.train.metrics.averageMonthlyReturnPct;
  const oosAverage = report.oos.metrics.averageMonthlyReturnPct;
  const worstStressAverage = report.stress.length
    ? Math.min(...report.stress.map((item) => item.metrics.averageMonthlyReturnPct))
    : Number.NEGATIVE_INFINITY;
  const oosRetentionRatio = boundedRatio(oosAverage, trainAverage);
  const stressRetentionRatio = boundedRatio(worstStressAverage, oosAverage);
  const walkForwardPassRatePct = report.walkForward.length
    ? (report.walkForward.filter((item) => item.passed).length / report.walkForward.length) * 100
    : 0;

  const temporalReasons: string[] = [];
  if (report.validation.metrics.averageMonthlyReturnPct <= 0) temporalReasons.push("Validation平均月利がプラスではない");
  if (oosAverage < thresholds.finalMinOosAverageMonthlyReturnPct) {
    temporalReasons.push(`OOS平均月利 ${oosAverage.toFixed(2)}% < ${thresholds.finalMinOosAverageMonthlyReturnPct}%`);
  }
  if (report.oos.metrics.medianMonthlyReturnPct < thresholds.minMedianMonthlyReturnPct) {
    temporalReasons.push(`OOS中央値月利 ${report.oos.metrics.medianMonthlyReturnPct.toFixed(2)}% < ${thresholds.minMedianMonthlyReturnPct}%`);
  }
  if (report.oos.metrics.maxDrawdownPct > thresholds.maxOosDrawdownPct) {
    temporalReasons.push(`OOS MaxDD ${report.oos.metrics.maxDrawdownPct.toFixed(2)}% > ${thresholds.maxOosDrawdownPct}%`);
  }
  if (report.oos.metrics.targetMonthlyHitRatePct < thresholds.minTargetMonthlyHitRatePct) {
    temporalReasons.push(
      `月利${thresholds.targetAverageMonthlyReturnPct}%到達率 ${report.oos.metrics.targetMonthlyHitRatePct.toFixed(1)}% < ${thresholds.minTargetMonthlyHitRatePct}%`,
    );
  }
  if (oosRetentionRatio < thresholds.minOosRetentionRatio) {
    temporalReasons.push(`OOS維持率 ${(oosRetentionRatio * 100).toFixed(1)}% < ${(thresholds.minOosRetentionRatio * 100).toFixed(1)}%`);
  }
  if (walkForwardPassRatePct < thresholds.minWalkForwardPassRatePct) {
    temporalReasons.push(`Walk-forward通過率 ${walkForwardPassRatePct.toFixed(1)}% < ${thresholds.minWalkForwardPassRatePct}%`);
  }

  const failedStress = report.stress.filter((item) => !item.passed);
  const stressReasons = failedStress.map((item) => `${item.label}: ${item.reasons.join(" / ")}`);
  if (stressRetentionRatio < thresholds.minStressRetentionRatio) {
    stressReasons.push(`ストレス維持率 ${(stressRetentionRatio * 100).toFixed(1)}% < ${(thresholds.minStressRetentionRatio * 100).toFixed(1)}%`);
  }

  const passedTemporalValidation = temporalReasons.length === 0;
  const passedStressTest = report.stress.length > 0 && stressReasons.length === 0;
  return {
    ...report,
    oosRetentionRatio,
    stressRetentionRatio,
    walkForwardPassRatePct,
    passedTemporalValidation,
    passedStressTest,
    finalGateReasons: [...temporalReasons, ...stressReasons],
  };
}
