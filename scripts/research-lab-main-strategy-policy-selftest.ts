import assert from "node:assert/strict";

import { createEmptyChampionDeepState } from "../lib/research-lab/perp/deep-research";
import {
  buildMainStrategyResearchAnchors,
  focusChampionStateOnMainStrategyLineage,
  focusPreviousResultOnMainStrategyLineage,
  isMainStrategyLineageGenome,
  MAIN_STRATEGY_RESEARCH_LINEAGE_MARKER,
  MAIN_STRATEGY_RESEARCH_POLICY,
} from "../lib/research-lab/perp/main-strategy-research-policy";
import type { PerpResearchResult } from "../lib/research-lab/perp/types";

const anchors = buildMainStrategyResearchAnchors({
  profile: "attack",
  symbols: ["BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "AVAX", "LINK", "AAVE", "INJ", "NEAR"],
});

assert.equal(MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyId, "WIN80_ULTRA90_TOP1_V1");
assert.equal(MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyLocked, true);
assert.equal(MAIN_STRATEGY_RESEARCH_POLICY.autoPromotionToMain, false);
assert.equal(anchors.length, 3);
assert.equal(new Set(anchors.map((item) => item.id)).size, 3);
assert.ok(anchors.every((item) => item.parentIds.includes(MAIN_STRATEGY_RESEARCH_POLICY.mainStrategyId)));
assert.ok(anchors.every((item) => item.thesis.includes(MAIN_STRATEGY_RESEARCH_LINEAGE_MARKER)));
assert.ok(anchors.every(isMainStrategyLineageGenome));

const unrelated = {
  ...anchors[0],
  id: "old-unrelated-champion",
  parentIds: [],
  thesis: "旧方式のランダムChampion",
};
assert.equal(isMainStrategyLineageGenome(unrelated), false);

const state = createEmptyChampionDeepState();
state.champions = [
  {
    slot: "oos",
    genome: unrelated,
    metrics: {
      trainMonthlyPct: 1,
      oosMonthlyPct: 1,
      oosMaxDrawdownPct: 5,
      worstStressMonthlyPct: 0,
      walkForwardPassRatePct: 50,
      oosRetentionPct: 50,
      stressRetentionPct: 50,
      oosTrades: 20,
      longTrades: 10,
      shortTrades: 10,
      liquidationCount: 0,
      maxConsecutiveLosses: 3,
      profitFactor: 1.1,
      totalFundingCost: 0,
      averageEffectiveLeverage: 1,
      score: 1,
    },
    rootCauses: ["low_return"],
    selectedAt: new Date(0).toISOString(),
    noImprovementCycles: 0,
  },
];

const focusedState = focusChampionStateOnMainStrategyLineage(state);
assert.equal(focusedState.champions.length, 0);
assert.ok(focusedState.nextPlan.some((item) => item.includes("Win80")));

const mixedResult = {
  startedAt: new Date(0).toISOString(),
  completedAt: new Date(0).toISOString(),
  config: {},
  rounds: [{ round: 1, evaluated: 2, survivors: 2, best: { genome: unrelated } }],
  leaderboard: [
    { genome: unrelated, verdict: "survivor" },
    { genome: anchors[0], verdict: "survivor", validation: {} },
  ],
  finalCandidates: [{ genome: unrelated, verdict: "final_candidate" }],
  totalEvaluations: 2,
  validatedStrategies: 2,
} as unknown as PerpResearchResult;

const focusedResult = focusPreviousResultOnMainStrategyLineage(mixedResult);
assert.ok(focusedResult);
assert.equal(focusedResult?.leaderboard.length, 1);
assert.equal(focusedResult?.leaderboard[0].genome.id, anchors[0].id);
assert.equal(focusedResult?.finalCandidates.length, 0);

console.log("MAIN_STRATEGY_RESEARCH_POLICY_SELFTEST_OK");
