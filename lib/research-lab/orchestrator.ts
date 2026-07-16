import { createInitialPopulation, createNextPopulation } from "./evolution";
import { evaluateStrategy } from "./scoring";
import type {
  ResearchLabConfig,
  ResearchLabResult,
  ResearchMetrics,
  ResearchRound,
  StrategyBacktestAdapter,
  StrategyEvaluation,
  StrategyGenome,
} from "./types";

const FAILED_METRICS: ResearchMetrics = {
  cagrPct: -100,
  maxDrawdownPct: 100,
  sharpe: -10,
  sortino: -10,
  profitFactor: 0,
  winRatePct: 0,
  tradeCount: 0,
  exposurePct: 0,
  averageMonthlyReturnPct: -100,
  medianMonthlyReturnPct: -100,
  positiveMonthPct: 0,
  targetMonthlyHitRatePct: 0,
  rolling3MonthTargetHitRatePct: 0,
  bestMonthPct: 0,
  worstMonthPct: -100,
  temporalStabilityScore: 0,
  recentPeriodScore: 0,
};

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );

  return results;
}

function failedEvaluation(genome: StrategyGenome, error: unknown): StrategyEvaluation {
  const message = error instanceof Error ? error.message : String(error);
  return {
    genome,
    metrics: FAILED_METRICS,
    validationLevel: "single_pass",
    score: 0,
    verdict: "rejected",
    rejectionReasons: [`バックテスト失敗: ${message}`],
    critiques: [
      {
        critic: "execution-critic",
        severity: "high",
        message: "検証を完走できない戦略は採用対象外。データ、実行時間、パラメータ互換性を確認する。",
      },
    ],
    evaluatedAt: new Date().toISOString(),
  };
}

async function evaluatePopulation(
  population: StrategyGenome[],
  config: ResearchLabConfig,
  adapter: StrategyBacktestAdapter,
) {
  return mapWithConcurrency(population, config.maxConcurrency, async (genome) => {
    try {
      const result = await adapter.evaluate(genome, config);
      return evaluateStrategy({
        genome,
        metrics: result.metrics,
        thresholds: config.thresholds,
        validationLevel: result.validationLevel,
      });
    } catch (error) {
      return failedEvaluation(genome, error);
    }
  });
}

function sortEvaluations(evaluations: StrategyEvaluation[]) {
  return [...evaluations].sort((left, right) => {
    if (left.verdict !== right.verdict) {
      const rank = { final_candidate: 3, candidate: 2, rejected: 1 } as const;
      return rank[right.verdict] - rank[left.verdict];
    }
    return right.score - left.score || right.metrics.averageMonthlyReturnPct - left.metrics.averageMonthlyReturnPct;
  });
}

function mergeLeaderboard(current: StrategyEvaluation[], additions: StrategyEvaluation[], limit = 100) {
  const byId = new Map<string, StrategyEvaluation>();
  for (const item of [...current, ...additions]) byId.set(item.genome.id, item);
  return sortEvaluations([...byId.values()]).slice(0, limit);
}

function summarizeRound(round: number, evaluations: StrategyEvaluation[]): ResearchRound {
  const sorted = sortEvaluations(evaluations);
  return {
    round,
    generated: evaluations.length,
    evaluated: evaluations.length,
    rejected: evaluations.filter((item) => item.verdict === "rejected").length,
    candidates: evaluations.filter((item) => item.verdict !== "rejected").length,
    best: sorted[0] ?? null,
  };
}

function isDiagnosticValidationEligible(item: StrategyEvaluation) {
  const executionFailed = item.rejectionReasons.some((reason) => reason.startsWith("バックテスト失敗:"));
  return !executionFailed && item.score > 0 && item.metrics.tradeCount > 0 && item.metrics.cagrPct > 0;
}

async function validateLeaderboard(
  leaderboard: StrategyEvaluation[],
  config: ResearchLabConfig,
  adapter: StrategyBacktestAdapter,
) {
  if (!adapter.validate) return { leaderboard, validatedStrategies: 0 };
  const finalists = leaderboard
    .filter(isDiagnosticValidationEligible)
    .slice(0, Math.max(1, config.finalValidationCount));
  if (!finalists.length) return { leaderboard, validatedStrategies: 0 };

  const validated = await mapWithConcurrency(
    finalists,
    Math.min(config.maxConcurrency, 2),
    async (item) => {
      try {
        const validation = await adapter.validate!(item.genome, config, item.metrics);
        return evaluateStrategy({
          genome: item.genome,
          metrics: item.metrics,
          thresholds: config.thresholds,
          validationLevel: validation.passedStressTest ? "stress_tested" : "temporal_validation",
          validation,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ...item,
          validationLevel: "temporal_validation" as const,
          critiques: [
            ...item.critiques,
            {
              critic: "execution-critic" as const,
              severity: "high" as const,
              message: `最終検証失敗: ${message}`,
            },
          ],
          evaluatedAt: new Date().toISOString(),
        };
      }
    },
  );

  const replacements = new Map(validated.map((item) => [item.genome.id, item]));
  return {
    leaderboard: sortEvaluations(leaderboard.map((item) => replacements.get(item.genome.id) ?? item)),
    validatedStrategies: validated.length,
  };
}

export async function runResearchLab(
  config: ResearchLabConfig,
  adapter: StrategyBacktestAdapter,
): Promise<ResearchLabResult> {
  const startedAt = new Date().toISOString();
  const rounds: ResearchRound[] = [];
  let leaderboard: StrategyEvaluation[] = [];
  let totalEvaluations = 0;
  let population = createInitialPopulation(config.populationPerRound, config.seed);

  for (let round = 1; round <= config.rounds; round += 1) {
    const evaluations = await evaluatePopulation(population, config, adapter);
    totalEvaluations += evaluations.length;
    leaderboard = mergeLeaderboard(leaderboard, evaluations);
    rounds.push(summarizeRound(round, evaluations));

    const elites = sortEvaluations(evaluations)
      .slice(0, Math.max(1, config.eliteCount))
      .map((item) => item.genome);

    population = createNextPopulation({
      elites,
      count: config.populationPerRound,
      generation: round,
      seed: config.seed,
    });
  }

  const validationResult = await validateLeaderboard(leaderboard, config, adapter);
  leaderboard = validationResult.leaderboard;
  const completedAt = new Date().toISOString();
  return {
    startedAt,
    completedAt,
    config,
    rounds,
    leaderboard,
    finalCandidates: leaderboard.filter((item) => item.verdict === "final_candidate"),
    totalEvaluations,
    validatedStrategies: validationResult.validatedStrategies,
    cacheStats: adapter.getCacheStats?.(),
  };
}
