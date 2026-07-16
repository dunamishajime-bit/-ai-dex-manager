import type { TemporalValidationPlan, TemporalWindow } from "../types";
import { compactPerpBacktestResult } from "./evidence";
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
  const validationFull = runPerpBacktest({
    genome,
    data,
    window: plan.validation,
    execution: config.baseExecution,
    targetMonthlyReturnPct: target,
  });
  const oosFull = runPerpBacktest({
    genome,
    data,
    window: plan.oos,
    execution: config.baseExecution,
    targetMonthlyReturnPct: target,
  });
  const walkForward = plan.walkForward.map((fold) => {
    const fullResult = runPerpBacktest({
      genome,
      data,
      window: fold.test,
      execution: config.baseExecution,
      targetMonthlyReturnPct: target,
    });
    const reasons = walkForwardReasons(fullResult, config);
    return {
      label: fold.label,
      window: fold.test,
      result: compactPerpBacktestResult(fullResult, 50),
      passed: reasons.length === 0,
      reasons,
    };
  });
  const stress = config.stressExecutions.map((scenario) => {
    const fullResult = runPerpBacktest({
      genome,
      data,
      window: plan.oos,
      execution: scenario.execution,
      targetMonthlyReturnPct: target,
    });
    const reasons = stressReasons(fullResult, config);
    return {
      label: scenario.label,
      execution: scenario.execution,
      result: compactPerpBacktestResult(fullResult, 50),
      passed: reasons.length === 0,
      reasons,
    };
  });

  const oosReturnRetentionRatio = retentionRatio(
    oosFull.metrics.averageMonthlyReturnPct,
    train.metrics.averageMonthlyReturnPct,
  );
  const worstStressAverage = stress.length
    ? Math.min(...stress.map((item) => item.result.metrics.averageMonthlyReturnPct))
    : Number.NEGATIVE_INFINITY;
  const stressReturnRetentionRatio = retentionRatio(worstStressAverage, oosFull.metrics.averageMonthlyReturnPct);
  const walkForwardPassRatePct = walkForward.length
    ? (walkForward.filter((item) => item.passed).length / walkForward.length) * 100
    : 0;
  const reasons: string[] = [];
  const thresholds = config.thresholds;

  if (validationFull.metrics.averageMonthlyReturnPct <= 0) reasons.push("Validation平均月利がプラスではない");
  if (validationFull.metrics.tradeCount < Math.max(5, Math.ceil(thresholds.finalMinOosTrades * 0.4))) {
    reasons.push("Validation取引数不足");
  }
  if (thresholds.requireZeroLiquidations && validationFull.risk.liquidationCount > 0) reasons.push("Validation清算発生");
  if (oosFull.metrics.averageMonthlyReturnPct < thresholds.finalMinOosAverageMonthlyReturnPct) {
    reasons.push(`OOS平均月利 ${oosFull.metrics.averageMonthlyReturnPct.toFixed(2)}% < ${thresholds.finalMinOosAverageMonthlyReturnPct}%`);
  }
  if (oosFull.metrics.maxDrawdownPct > thresholds.finalMaxOosDrawdownPct) {
    reasons.push(`OOS MaxDD ${oosFull.metrics.maxDrawdownPct.toFixed(2)}% > ${thresholds.finalMaxOosDrawdownPct}%`);
  }
  if (oosFull.metrics.tradeCount < thresholds.finalMinOosTrades) {
    reasons.push(`OOS Trades ${oosFull.metrics.tradeCount} < ${thresholds.finalMinOosTrades}`);
  }
  if (thresholds.requireZeroLiquidations && oosFull.risk.liquidationCount > 0) {
    reasons.push(`OOS Liquidations ${oosFull.risk.liquidationCount} > 0`);
  }
  if (thresholds.requireBothDirections && (oosFull.risk.longTrades === 0 || oosFull.risk.shortTrades === 0)) {
    reasons.push(`OOS方向偏り Long=${oosFull.risk.longTrades} Short=${oosFull.risk.shortTrades}`);
  }
  if (oosFull.risk.maxConsecutiveLosses > thresholds.finalMaxConsecutiveLosses) {
    reasons.push(`OOS最大連敗 ${oosFull.risk.maxConsecutiveLosses} > ${thresholds.finalMaxConsecutiveLosses}`);
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
    validation: compactPerpBacktestResult(validationFull, 100),
    oos: compactPerpBacktestResult(oosFull, 100),
    walkForward,
    stress,
    oosReturnRetentionRatio,
    stressReturnRetentionRatio,
    walkForwardPassRatePct,
    finalGateReasons: reasons,
    passed: reasons.length === 0,
  };
}
