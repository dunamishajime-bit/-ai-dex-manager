import assert from "node:assert/strict";

import { buildResearchDiscussion, discussionIndexEntry } from "../lib/research-lab/perp/discussion";
import type { AutonomousCycleSummary, AutonomousFailureProfile } from "../lib/research-lab/perp/autonomous";
import type { PerpResearchResult, PerpStrategyEvaluation } from "../lib/research-lab/perp/types";

const metrics = {
  cagrPct: 120,
  maxDrawdownPct: 8,
  sharpe: 1.8,
  sortino: 2.1,
  profitFactor: 1.6,
  winRatePct: 56,
  tradeCount: 42,
  exposurePct: 50,
  averageMonthlyReturnPct: 12,
  medianMonthlyReturnPct: 8,
  positiveMonthPct: 65,
  targetMonthlyHitRatePct: 10,
  rolling3MonthTargetHitRatePct: 12,
  bestMonthPct: 25,
  worstMonthPct: -7,
  temporalStabilityScore: 70,
  recentPeriodScore: 75,
};

const risk = {
  liquidationCount: 0,
  longTrades: 22,
  shortTrades: 20,
  maxConsecutiveLosses: 4,
  averageHoldingBars: 12,
  averageEffectiveLeverage: 2.2,
  maximumEffectiveLeverage: 3.1,
  totalFundingCost: 0.12,
  exposurePct: 50,
  endingEquity: 160,
};

const backtest = {
  genomeId: "fixture-01",
  window: { label: "fixture", startTs: 0, endTs: 1 },
  execution: { feeBpsPerSide: 3, slippageBpsPerSide: 2, adverseFundingBpsPer8h: 1, maintenanceMarginRate: 0.005 },
  metrics,
  risk,
  trades: [],
  equityCurve: [],
  monthlyReturnsPct: [8, 12],
  annualReturnsPct: [120],
};

const evaluation: PerpStrategyEvaluation = {
  genome: {
    id: "fixture-01",
    generation: 1,
    parentIds: [],
    createdBy: "alpha-trend",
    family: "breakout",
    thesis: "出来高を伴うブレイクをLong/Shortする",
    symbols: ["BTC", "ETH"],
    parameters: {
      timeframeHours: 4,
      leverage: 2.5,
      riskPerTradePct: 2,
      maxMarginUsagePct: 70,
      btcRegimeSmaBars: 40,
      btcRegimeMomentumBars: 10,
      regimeThresholdPct: 0.01,
      momentumBars: 20,
      breakoutBars: 24,
      breakoutBufferPct: 0.005,
      minimumMomentumPct: 0.02,
      minimumVolumeRatio: 1.1,
      minimumEdgeToCostRatio: 4,
      volatilityLookbackBars: 12,
      volatilityPenalty: 0.5,
      atrBars: 10,
      stopAtr: 2,
      takeProfitAtr: 5,
      trailingAtr: 1,
      maxHoldBars: 36,
      rebalanceBars: 8,
      cooldownBars: 4,
      allowLong: true,
      allowShort: true,
      allowNeutralRegime: false,
      neutralScoreThreshold: 0.8,
    },
  },
  train: backtest,
  validation: {
    plan: { train: backtest.window, validation: backtest.window, oos: backtest.window, walkForward: [] },
    train: backtest,
    validation: { ...backtest, metrics: { ...metrics, averageMonthlyReturnPct: 9 } },
    oos: { ...backtest, metrics: { ...metrics, averageMonthlyReturnPct: 6, maxDrawdownPct: 9 } },
    walkForward: [{ label: "WF1", window: backtest.window, result: backtest, passed: true, reasons: [] }],
    stress: [{
      label: "Extreme Cost",
      execution: backtest.execution,
      result: { ...backtest, metrics: { ...metrics, averageMonthlyReturnPct: 2 } },
      passed: false,
      reasons: ["Stress平均月利不足"],
    }],
    oosReturnRetentionRatio: 0.5,
    stressReturnRetentionRatio: 0.17,
    walkForwardPassRatePct: 100,
    finalGateReasons: ["OOS平均月利30%未満"],
    passed: false,
  },
  score: 58,
  verdict: "survivor",
  reasons: ["目標月利未達"],
  evaluatedAt: "2026-07-17T00:10:00.000Z",
};

const result = {
  startedAt: "2026-07-17T00:00:00.000Z",
  completedAt: "2026-07-17T00:15:00.000Z",
  leaderboard: [evaluation],
  finalCandidates: [],
  totalEvaluations: 25,
  validatedStrategies: 1,
} as unknown as PerpResearchResult;

const failures: AutonomousFailureProfile = {
  lowReturn: 4,
  drawdown: 0,
  lowSample: 0,
  liquidation: 0,
  directionBias: 0,
  oosDecay: 1,
  costFragility: 2,
  walkForward: 0,
  executionFailure: 0,
};

const summary: AutonomousCycleSummary = {
  cycle: 10,
  completedAt: result.completedAt,
  profile: "attack",
  evaluations: 25,
  validated: 1,
  finalCandidates: 0,
  bestTrainMonthlyPct: 12,
  bestOosMonthlyPct: 6,
  bestOosDrawdownPct: 9,
  bestWorstStressMonthlyPct: 2,
  failureProfile: failures,
};

const log = buildResearchDiscussion({
  result,
  summary,
  failures,
  nextPlan: ["Edge/Cost比率を上げる", "OOS劣化を抑える"],
});

assert.equal(log.version, 1);
assert.equal(log.cycle, 10);
assert.equal(log.messages.length, 6);
assert.deepEqual(log.messages.map((item) => item.role), [
  "moderator",
  "researcher",
  "overfit_critic",
  "tail_risk_critic",
  "execution_critic",
  "cio",
]);
assert.ok(log.messages.every((item, index) => item.sequence === index + 1));
assert.ok(log.messages.every((item) => item.content.length > 20));
assert.ok(log.summary.includes("fixture-01"));
assert.ok(log.decision.includes("昇格見送り"));

const serialized = JSON.stringify(log);
assert.equal(serialized.includes("NaN"), false);
assert.equal(serialized.includes("Infinity"), false);

const index = discussionIndexEntry(log, "discussions/2026/07/17/cycle-000010.json");
assert.equal(index.messageCount, 6);
assert.equal(index.path, "discussions/2026/07/17/cycle-000010.json");

console.log("Research discussion self-test passed");
