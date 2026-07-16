import type { TemporalValidationPlan, TemporalWindow } from "../types";
import { runPerpBacktest } from "./engine";
import type {
  PerpBacktestResult,
  PerpMarketData,
  PerpResearchConfig,
  PerpStrategyGenome,
  PerpValidationReport,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function alignedTs(value: number) {
  return Math.floor(value / DAY_MS) * DAY_MS;
}

function window(label: string, startTs: number, endTs: number): TemporalWindow {
  const start = alignedTs(startTs);
  return { label, startTs: start, endTs: Math.max(start + DAY_MS, alignedTs(endTs)) };
}

export function buildPerpValidationPlan(config: PerpResearchConfig): TemporalValidationPlan {
  const duration = Math.max(360 * DAY_MS, config.endTs - config.startTs);
  const endTs = config.startTs + duration;
  const trainEnd = config.startTs + duration * 0.6;
  const validationEnd = config.startTs + duration * 0.8;
  const folds = Math.max(1, Math.min(8, config.walkForwardFolds));
  const walkForwardStart = config.startTs + duration * 0.4;
  const walkForwardSpan = endTs - walkForwardStart;
  const testSpan = walkForwardSpan / folds;

  return {
    train: window("perp-train", config.startTs, trainEnd),
    validation: window("perp-validation", trainEnd, validationEnd),
    oos: window("perp-oos", validationEnd, endTs),
    walkForward: Array.from({ length: folds }, (_, index) => {
      const testStart = walkForwardStart + testSpan * index;
      const testEnd = index === folds - 1 ? endTs : testStart + testSpan;
      return {
        label: `perp-wf-${index + 1}`,
        train: window(`perp-wf-${index + 1}-train`, config.startTs, testStart),
        test: window(`perp-wf-${index + 1}-test`, testStart, testEnd),
      };
    }),
  };
}

function retentionRatio(current: number, baseline: number) {
  if (baseline <= 0) return current > 0 ? 1 : 0;
  return Math.max(0, Math.min(2, current / baseline));
}

function walkForwardReasons(result: PerpBacktestResult, config: PerpResearchConfig) {
  const reasons: string[] = [];
  const minimumTrades = Math.max(3, Math.ceil(config.thresholds.finalMinOosTrades / config.walkForwardFolds));
  if (result.metrics.averageMonthlyReturnPct < Math.max(1, config.thresholds.discoveryMinAverageMonthlyReturnPct * 0.4)) {
    reasons.push("平均月利不足");
  }
  if (result.metrics.maxDrawdownPct > config.thresholds.finalMaxOosDrawdownPct * 1.25) reasons.push("DD超過");
  if (result.metrics.tradeCount < minimumTrades) reasons.push("取引数不足");
  if (config.thresholds.requireZeroLiquidations && result.risk.liquidationCount > 0) reasons.push("清算発生");
  return reasons;
}

function stressReasons(result: PerpBacktestResult, config: PerpResearchConfig) {
  const reasons: string[] = [];
  if (result.metrics.averageMonthlyReturnPct < config.thresholds.finalMinStressAverageMonthlyReturnPct) {
    reasons.push(`平均月利 ${result.metrics.averageMonthlyReturnPct.toFixed(2)}% < ${config.thresholds.finalMinStressAverageMonthlyReturnPct}%`);
  }
  if (result.metrics.maxDrawdownPct > config.thresholds.finalMaxOosDrawdownPct * 1.2) reasons.push("DD超過");
  if (result.metrics.profitFactor < 1.05) reasons.push("PF不足");
  if (config.thresholds.requireZeroLiquidations && result.risk.liquidationCount > 0) reasons.push("清算発生");
  return reasons;
}

export async function validatePerpStrategy(input: {
  genome: PerpStrategyGenome;
  train: PerpBacktestResult;
  data: PerpMarketData;
  config: PerpResearchConfig;
}): Promise<PerpValidationReport> {
  const { genome, train, data, config } = input;
  const plan = buildPerpValidationPlan(config);
  const target = config.thresholds.targetAverageMonthlyReturnPct;
  const validation = runPerpBacktest({
    genome,
    data,
    window: plan.validation,
    execution: config.baseExecution,
    targetMonthlyReturnPct: target,
  });
  const oos = runPerpBacktest({
    genome,
    data,
    window: plan.oos,
    execution: config.baseExecution,
    targetMonthlyReturnPct: target,
  });
  const walkForward = plan.walkForward.map((fold) => {
    const result = runPerpBacktest({
      genome,
      data,
      window: fold.test,
      execution: config.baseExecution,
      targetMonthlyReturnPct: target,
    });
    const reasons = walkForwardReasons(result, config);
    return {
      label: fold.label,
      window: fold.test,
      result,
      passed: reasons.length === 0,
      reasons,
    };
  });
  const stress = config.stressExecutions.map((scenario) => {
    const result = runPerpBacktest({
      genome,
      data,
      window: plan.oos,
      execution: scenario.execution,
      targetMonthlyReturnPct: target,
    });
    const reasons = stressReasons(result, config);
    return {
      label: scenario.label,
      execution: scenario.execution,
      result,
      passed: reasons.length === 0,
      reasons,
    };
  });

  const oosReturnRetentionRatio = retentionRatio(
    oos.metrics.averageMonthlyReturnPct,
    train.metrics.averageMonthlyReturnPct,
  );
  const worstStressAverage = stress.length
    ? Math.min(...stress.map((item) => item.result.metrics.averageMonthlyReturnPct))
    : Number.NEGATIVE_INFINITY;
  const stressReturnRetentionRatio = retentionRatio(worstStressAverage, oos.metrics.averageMonthlyReturnPct);
  const walkForwardPassRatePct = walkForward.length
    ? (walkForward.filter((item) => item.passed).length / walkForward.length) * 100
    : 0;
  const reasons: string[] = [];
  const thresholds = config.thresholds;

  if (validation.metrics.averageMonthlyReturnPct <= 0) reasons.push("Validation平均月利がプラスではない");
  if (validation.metrics.tradeCount < Math.max(5, Math.ceil(thresholds.finalMinOosTrades * 0.4))) {
    reasons.push("Validation取引数不足");
  }
  if (thresholds.requireZeroLiquidations && validation.risk.liquidationCount > 0) reasons.push("Validation清算発生");
  if (oos.metrics.averageMonthlyReturnPct < thresholds.finalMinOosAverageMonthlyReturnPct) {
    reasons.push(`OOS平均月利 ${oos.metrics.averageMonthlyReturnPct.toFixed(2)}% < ${thresholds.finalMinOosAverageMonthlyReturnPct}%`);
  }
  if (oos.metrics.maxDrawdownPct > thresholds.finalMaxOosDrawdownPct) {
    reasons.push(`OOS MaxDD ${oos.metrics.maxDrawdownPct.toFixed(2)}% > ${thresholds.finalMaxOosDrawdownPct}%`);
  }
  if (oos.metrics.tradeCount < thresholds.finalMinOosTrades) {
    reasons.push(`OOS Trades ${oos.metrics.tradeCount} < ${thresholds.finalMinOosTrades}`);
  }
  if (thresholds.requireZeroLiquidations && oos.risk.liquidationCount > 0) {
    reasons.push(`OOS Liquidations ${oos.risk.liquidationCount} > 0`);
  }
  if (thresholds.requireBothDirections && (oos.risk.longTrades === 0 || oos.risk.shortTrades === 0)) {
    reasons.push(`OOS方向偏り Long=${oos.risk.longTrades} Short=${oos.risk.shortTrades}`);
  }
  if (oos.risk.maxConsecutiveLosses > thresholds.finalMaxConsecutiveLosses) {
    reasons.push(`OOS最大連敗 ${oos.risk.maxConsecutiveLosses} > ${thresholds.finalMaxConsecutiveLosses}`);
  }
  if (oosReturnRetentionRatio < thresholds.finalMinOosRetentionRatio) {
    reasons.push(`OOS維持率 ${(oosReturnRetentionRatio * 100).toFixed(1)}% < ${(thresholds.finalMinOosRetentionRatio * 100).toFixed(1)}%`);
  }
  if (walkForwardPassRatePct < thresholds.finalMinWalkForwardPassRatePct) {
    reasons.push(`Walk-forward通過率 ${walkForwardPassRatePct.toFixed(1)}% < ${thresholds.finalMinWalkForwardPassRatePct}%`);
  }
  for (const scenario of stress.filter((item) => !item.passed)) {
    reasons.push(`${scenario.label}: ${scenario.reasons.join(" / ")}`);
  }
  if (stressReturnRetentionRatio < thresholds.finalMinStressRetentionRatio) {
    reasons.push(`Stress維持率 ${(stressReturnRetentionRatio * 100).toFixed(1)}% < ${(thresholds.finalMinStressRetentionRatio * 100).toFixed(1)}%`);
  }

  return {
    plan,
    train,
    validation,
    oos,
    walkForward,
    stress,
    oosReturnRetentionRatio,
    stressReturnRetentionRatio,
    walkForwardPassRatePct,
    finalGateReasons: reasons,
    passed: reasons.length === 0,
  };
}
