import assert from "node:assert/strict";

import { DEFAULT_RESEARCH_THRESHOLDS } from "../lib/research-lab/default-config";
import { runResearchLab } from "../lib/research-lab/orchestrator";
import type {
  ResearchLabConfig,
  ResearchMetrics,
  StrategyBacktestAdapter,
  ValidationSegmentResult,
} from "../lib/research-lab/types";
import { buildTemporalValidationPlan, completeValidationReport } from "../lib/research-lab/validation";

const baseMetrics: ResearchMetrics = {
  cagrPct: 2400,
  maxDrawdownPct: 20,
  sharpe: 1.8,
  sortino: 2.2,
  profitFactor: 1.65,
  winRatePct: 58,
  tradeCount: 72,
  exposurePct: 78,
  averageMonthlyReturnPct: 35,
  medianMonthlyReturnPct: 12,
  positiveMonthPct: 68,
  targetMonthlyHitRatePct: 30,
  rolling3MonthTargetHitRatePct: 35,
  bestMonthPct: 65,
  worstMonthPct: -9,
  temporalStabilityScore: 0.72,
  recentPeriodScore: 0.7,
};

function withMetrics(overrides: Partial<ResearchMetrics>): ResearchMetrics {
  return { ...baseMetrics, ...overrides };
}

function segment(label: string, window: ValidationSegmentResult["window"], metrics: ResearchMetrics): ValidationSegmentResult {
  return { label, window, metrics };
}

const adapter: StrategyBacktestAdapter = {
  async evaluate(genome) {
    const efficiency = genome.parameters.trendMinEfficiencyRatio;
    return {
      validationLevel: "single_pass",
      metrics: withMetrics({
        cagrPct: 2200 + efficiency * 500,
        averageMonthlyReturnPct: 33 + efficiency * 5,
        maxDrawdownPct: 18 + genome.parameters.rangeAlloc * 4,
      }),
    };
  },
  async validate(_genome, config) {
    const plan = buildTemporalValidationPlan(config);
    const train = withMetrics({ averageMonthlyReturnPct: 35 });
    const validation = withMetrics({ averageMonthlyReturnPct: 32, cagrPct: 2100 });
    const oos = withMetrics({ averageMonthlyReturnPct: 31, cagrPct: 1900, targetMonthlyHitRatePct: 25 });
    const stress = withMetrics({ averageMonthlyReturnPct: 22, cagrPct: 950, profitFactor: 1.3, maxDrawdownPct: 25 });
    return completeValidationReport(
      {
        plan,
        train: segment("train", plan.train, train),
        validation: segment("validation", plan.validation, validation),
        oos: segment("oos", plan.oos, oos),
        walkForward: plan.walkForward.map((fold) => ({
          label: fold.label,
          trainWindow: fold.train,
          test: segment(fold.label, fold.test, withMetrics({ averageMonthlyReturnPct: 8 })),
          passed: true,
          reasons: [],
        })),
        stress: [
          {
            label: "oos-extra-cost-100bps",
            extraRoundTripCostBps: 100,
            metrics: stress,
            passed: true,
            reasons: [],
          },
        ],
      },
      config.thresholds,
    );
  },
};

async function main() {
  const config: ResearchLabConfig = {
    rounds: 3,
    populationPerRound: 4,
    eliteCount: 2,
    finalValidationCount: 3,
    maxConcurrency: 2,
    seed: 5601,
    walkForwardFolds: 2,
    stressExtraRoundTripCostBps: [100],
    thresholds: DEFAULT_RESEARCH_THRESHOLDS,
  };
  const result = await runResearchLab(config, adapter);

  assert.equal(result.rounds.length, 3);
  assert.equal(result.totalEvaluations, 12);
  assert.ok(result.leaderboard.length > 0);
  assert.ok(result.validatedStrategies > 0);
  assert.ok(result.leaderboard.some((item) => item.verdict === "final_candidate"));
  assert.ok(result.finalCandidates.length > 0);
  assert.equal(result.rounds[1]?.best?.genome.generation, 1);
  assert.ok((result.rounds[1]?.best?.genome.parentIds.length ?? 0) >= 1);
  assert.ok(result.finalCandidates[0]?.validation?.passedStressTest);

  console.log("Research Lab Phase 2 self-test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
