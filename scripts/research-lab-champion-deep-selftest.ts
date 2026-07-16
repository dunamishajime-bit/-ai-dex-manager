import assert from "assert/strict";

import {
  buildChampionExperimentPlans,
  compareChampionExperiment,
  diagnoseChampion,
  normalizeChampionDeepState,
  type ChampionMetricSnapshot,
  type ChampionRecord,
} from "../lib/research-lab/perp/deep-research";
import type { PerpStrategyGenome } from "../lib/research-lab/perp/types";

const parentMetrics: ChampionMetricSnapshot = {
  trainMonthlyPct: 5,
  oosMonthlyPct: 2,
  oosMaxDrawdownPct: 4,
  worstStressMonthlyPct: 0.2,
  walkForwardPassRatePct: 0,
  oosRetentionPct: 40,
  stressRetentionPct: 10,
  oosTrades: 58,
  longTrades: 31,
  shortTrades: 27,
  liquidationCount: 0,
  maxConsecutiveLosses: 5,
  profitFactor: 2.1,
  totalFundingCost: 20,
  averageEffectiveLeverage: 0.6,
  score: 45,
};

const genome: PerpStrategyGenome = {
  id: "champion-parent",
  generation: 10,
  parentIds: [],
  createdBy: "alpha-breakout",
  family: "breakout",
  thesis: "deep research self-test",
  symbols: ["BTC", "ETH", "SOL"],
  parameters: {
    timeframeHours: 4,
    leverage: 2.5,
    riskPerTradePct: 2,
    maxMarginUsagePct: 60,
    btcRegimeSmaBars: 40,
    btcRegimeMomentumBars: 12,
    regimeThresholdPct: 0.02,
    momentumBars: 20,
    breakoutBars: 15,
    breakoutBufferPct: 0.005,
    minimumMomentumPct: 0.02,
    minimumVolumeRatio: 1,
    minimumEdgeToCostRatio: 4,
    volatilityLookbackBars: 20,
    volatilityPenalty: 0.5,
    atrBars: 14,
    stopAtr: 2,
    takeProfitAtr: 6,
    trailingAtr: 1.5,
    maxHoldBars: 48,
    rebalanceBars: 8,
    cooldownBars: 2,
    allowLong: true,
    allowShort: true,
    allowNeutralRegime: true,
    neutralScoreThreshold: 0.5,
  },
};

const champion: ChampionRecord = {
  slot: "oos",
  genome,
  metrics: parentMetrics,
  rootCauses: diagnoseChampion(parentMetrics),
  selectedAt: new Date(0).toISOString(),
  noImprovementCycles: 0,
};

assert(champion.rootCauses.includes("low_return"));
assert(champion.rootCauses.includes("stable_but_low_return"));
assert(champion.rootCauses.includes("oos_decay"));
assert(champion.rootCauses.includes("cost_fragility"));

const plans = buildChampionExperimentPlans({
  champion,
  cycle: 7,
  count: 2,
  blockedFingerprints: [],
});
assert.equal(plans.length, 2, "two targeted experiments must be generated");
for (const plan of plans) {
  const changed = Object.keys(genome.parameters).filter((key) => (
    genome.parameters[key as keyof typeof genome.parameters] !==
    plan.childGenome.parameters[key as keyof typeof genome.parameters]
  ));
  assert.deepEqual(changed, [plan.changedParameter], "each experiment must change exactly one parameter");
  assert.equal(plan.childGenome.parentIds.length, 1);
  assert.equal(plan.childGenome.parentIds[0], genome.id);
}

const improved = compareChampionExperiment(parentMetrics, {
  ...parentMetrics,
  oosMonthlyPct: 3,
  worstStressMonthlyPct: 1,
  oosMaxDrawdownPct: 3.8,
  walkForwardPassRatePct: 20,
});
assert.equal(improved.accepted, true, "a safe multi-metric parent improvement should be accepted");
assert(improved.comparison.deltaOosMonthlyPct > 0);

const overfit = compareChampionExperiment(parentMetrics, {
  ...parentMetrics,
  trainMonthlyPct: 15,
  oosMonthlyPct: 0.5,
  worstStressMonthlyPct: -2,
  oosMaxDrawdownPct: 8,
});
assert.equal(overfit.accepted, false, "Train-only improvement must be rejected");
assert(overfit.reasons.length > 0);

const normalized = normalizeChampionDeepState({
  version: 99,
  cycle: 7,
  updatedAt: new Date().toISOString(),
  champions: [champion, champion, champion, champion],
  latestExperiments: [],
  history: [],
  nextPlan: ["continue"],
});
assert.equal(normalized.version, 1);
assert.equal(normalized.champions.length, 3);

console.log("Champion deep research self-test passed");
