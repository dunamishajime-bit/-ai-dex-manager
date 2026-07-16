import assert from "node:assert/strict";

import { DEFAULT_RESEARCH_THRESHOLDS } from "../lib/research-lab/default-config";
import { runResearchLab } from "../lib/research-lab/orchestrator";
import type { StrategyBacktestAdapter } from "../lib/research-lab/types";

const adapter: StrategyBacktestAdapter = {
  async evaluate(genome) {
    const efficiency = genome.parameters.trendMinEfficiencyRatio;
    const drawdown = 16 + genome.parameters.rangeAlloc * 8;
    return {
      validationLevel: "single_pass",
      metrics: {
        cagrPct: 45 + efficiency * 20,
        maxDrawdownPct: drawdown,
        sharpe: 1.45 + efficiency * 0.4,
        sortino: 1.7 + efficiency * 0.5,
        profitFactor: 1.45,
        winRatePct: 56,
        tradeCount: 48,
        exposurePct: 72,
        positiveMonthPct: 61,
        worstMonthPct: -8,
        temporalStabilityScore: 0.68,
        recentPeriodScore: 0.62,
      },
    };
  },
};

async function main() {
  const result = await runResearchLab(
    {
      rounds: 3,
      populationPerRound: 4,
      eliteCount: 2,
      maxConcurrency: 2,
      seed: 5601,
      thresholds: DEFAULT_RESEARCH_THRESHOLDS,
    },
    adapter,
  );

  assert.equal(result.rounds.length, 3);
  assert.equal(result.totalEvaluations, 12);
  assert.ok(result.leaderboard.length > 0);
  assert.ok(result.leaderboard.some((item) => item.verdict === "candidate"));
  assert.equal(result.finalCandidates.length, 0, "single-pass evaluations must never become final candidates");
  assert.equal(result.rounds[1]?.best?.genome.generation, 1);
  assert.ok((result.rounds[1]?.best?.genome.parentIds.length ?? 0) >= 1);

  console.log("Research Lab self-test passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
