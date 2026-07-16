import { compactPerpBacktestResult } from "./evidence";
import { createInitialPerpPopulation, createNextPerpPopulation } from "./evolution";
import { runPerpBacktest } from "./engine";
import { perpStrategyLogicFingerprint } from "./fingerprint";
import { evaluatePerpStrategy } from "./scoring";
import type {
  PerpBacktestResult,
  PerpFamily,
  PerpMarketData,
  PerpResearchConfig,
  PerpResearchResult,
  PerpResearchRound,
  PerpStrategyEvaluation,
  PerpStrategyGenome,
} from "./types";
import { buildPerpValidationPlan, validatePerpStrategy } from "./validation";

const MAX_UNIQUE_GENERATION_ATTEMPTS = 80;

export interface PerpResearchDeduplicationStats {
  duplicateStrategiesSkipped: number;
  replacementCandidatesGenerated: number;
  exhaustedPopulationSlots: number;
}

export interface PerpResearchRunOptions {
  initialPopulation?: PerpStrategyGenome[];
  generationOffset?: number;
  excludedLogicFingerprints?: Iterable<string>;
  evaluatedLogicFingerprints?: Set<string>;
  deduplicationStats?: PerpResearchDeduplicationStats;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Math.max(1, Math.min(items.length, concurrency));
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await worker(items[index], index);
      }
    }),
  );
  return results;
}

function failedBacktest(genome: PerpStrategyGenome, config: PerpResearchConfig, error: unknown): PerpBacktestResult {
  const plan = buildPerpValidationPlan(config);
  const message = error instanceof Error ? error.message : String(error);
  return {
    genomeId: genome.id,
    window: plan.train,
    execution: config.baseExecution,
    metrics: {
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
    },
    risk: {
      liquidationCount: 1,
      longTrades: 0,
      shortTrades: 0,
      maxConsecutiveLosses: 0,
      averageHoldingBars: 0,
      averageEffectiveLeverage: 0,
      maximumEffectiveLeverage: 0,
      totalFundingCost: 0,
      exposurePct: 0,
      endingEquity: 0,
    },
    trades: [],
    equityCurve: [
      {
        ts: plan.train.startTs,
        equity: 0,
        balance: 0,
        unrealizedPnl: 0,
        symbol: message,
        side: "cash",
        effectiveLeverage: 0,
      },
    ],
    monthlyReturnsPct: [-100],
    annualReturnsPct: [-100],
  };
}

function sortEvaluations(evaluations: PerpStrategyEvaluation[]) {
  const rank = { final_candidate: 3, survivor: 2, rejected: 1 } as const;
  return [...evaluations].sort((left, right) => {
    if (left.verdict !== right.verdict) return rank[right.verdict] - rank[left.verdict];
    return right.score - left.score || right.train.metrics.averageMonthlyReturnPct - left.train.metrics.averageMonthlyReturnPct;
  });
}

function mergeLeaderboard(current: PerpStrategyEvaluation[], additions: PerpStrategyEvaluation[], limit = 150) {
  const byId = new Map<string, PerpStrategyEvaluation>();
  for (const item of [...current, ...additions]) byId.set(item.genome.id, item);
  return sortEvaluations([...byId.values()]).slice(0, limit);
}

function roundSummary(round: number, evaluations: PerpStrategyEvaluation[]): PerpResearchRound {
  const sorted = sortEvaluations(evaluations);
  return {
    round,
    evaluated: evaluations.length,
    survivors: evaluations.filter((item) => item.verdict !== "rejected").length,
    best: sorted[0] ?? null,
  };
}

function healthyForElite(item: PerpStrategyEvaluation, config: PerpResearchConfig) {
  return (
    item.train.risk.endingEquity > 0 &&
    item.train.risk.liquidationCount === 0 &&
    item.train.metrics.tradeCount > 0 &&
    item.train.metrics.maxDrawdownPct <= config.thresholds.discoveryMaxDrawdownPct * 1.4
  );
}

function selectFrontierElites(
  evaluations: PerpStrategyEvaluation[],
  config: PerpResearchConfig,
): PerpStrategyGenome[] {
  const eligible = evaluations.filter((item) => healthyForElite(item, config));
  const fallback = eligible.length ? eligible : evaluations.filter((item) => item.train.risk.endingEquity > 0);
  const selected = new Map<string, PerpStrategyEvaluation>();
  const add = (item?: PerpStrategyEvaluation | null) => {
    if (item) selected.set(item.genome.id, item);
  };
  const bestBy = (getter: (item: PerpStrategyEvaluation) => number) =>
    [...fallback].sort((left, right) => getter(right) - getter(left))[0] ?? null;

  add(sortEvaluations(fallback)[0]);
  add(bestBy((item) => item.train.metrics.averageMonthlyReturnPct));
  add(bestBy((item) => item.train.risk.averageEffectiveLeverage));
  add(bestBy((item) => item.train.metrics.sharpe));
  add(bestBy((item) => item.train.metrics.profitFactor));
  add(bestBy((item) => item.train.metrics.targetMonthlyHitRatePct));

  const families: PerpFamily[] = ["regime_momentum", "breakout", "relative_strength", "dual_direction"];
  for (const family of families) {
    add(sortEvaluations(fallback.filter((item) => item.genome.family === family))[0]);
  }

  for (const item of sortEvaluations(fallback)) {
    if (selected.size >= config.eliteCount) break;
    add(item);
  }

  return [...selected.values()]
    .slice(0, Math.max(1, config.eliteCount))
    .map((item) => item.genome);
}

async function evaluatePopulation(
  population: PerpStrategyGenome[],
  data: PerpMarketData,
  config: PerpResearchConfig,
) {
  const trainWindow = buildPerpValidationPlan(config).train;
  return mapWithConcurrency(population, config.maxConcurrency, async (genome) => {
    try {
      const train = compactPerpBacktestResult(runPerpBacktest({
        genome,
        data,
        window: trainWindow,
        execution: config.baseExecution,
        targetMonthlyReturnPct: config.thresholds.targetAverageMonthlyReturnPct,
      }));
      return evaluatePerpStrategy({ genome, train, thresholds: config.thresholds });
    } catch (error) {
      const train = failedBacktest(genome, config, error);
      const evaluation = evaluatePerpStrategy({ genome, train, thresholds: config.thresholds });
      return {
        ...evaluation,
        reasons: [`バックテスト失敗: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  });
}

async function validateFinalists(
  leaderboard: PerpStrategyEvaluation[],
  data: PerpMarketData,
  config: PerpResearchConfig,
) {
  const finalists = leaderboard
    .filter((item) => item.train.metrics.tradeCount > 0 && item.score > 0 && item.train.risk.endingEquity > 0)
    .slice(0, Math.max(1, config.finalistCount));
  const validated = await mapWithConcurrency(finalists, Math.min(2, config.maxConcurrency), async (item) => {
    try {
      const validation = await validatePerpStrategy({
        genome: item.genome,
        train: item.train,
        data,
        config,
      });
      return evaluatePerpStrategy({
        genome: item.genome,
        train: item.train,
        validation,
        thresholds: config.thresholds,
      });
    } catch (error) {
      return {
        ...item,
        reasons: [...item.reasons, `最終検証失敗: ${error instanceof Error ? error.message : String(error)}`],
        evaluatedAt: new Date().toISOString(),
      };
    }
  });
  const replacements = new Map(validated.map((item) => [item.genome.id, item]));
  return {
    leaderboard: sortEvaluations(leaderboard.map((item) => replacements.get(item.genome.id) ?? item)),
    validatedStrategies: validated.length,
  };
}

function copyGenome(genome: PerpStrategyGenome, id: string) {
  return {
    ...genome,
    id,
    parentIds: [...genome.parentIds],
    symbols: [...genome.symbols],
    parameters: { ...genome.parameters },
  };
}

function fillUniquePopulation(input: {
  count: number;
  generation: number;
  idPrefix: string;
  blocked: ReadonlySet<string>;
  stats: PerpResearchDeduplicationStats;
  candidateFactory: (attempt: number, remaining: number) => PerpStrategyGenome[];
}) {
  const accepted: PerpStrategyGenome[] = [];
  const reserved = new Set<string>();

  for (let attempt = 0; attempt < MAX_UNIQUE_GENERATION_ATTEMPTS && accepted.length < input.count; attempt += 1) {
    const remaining = input.count - accepted.length;
    const candidates = input.candidateFactory(attempt, remaining);
    if (attempt > 0) input.stats.replacementCandidatesGenerated += candidates.length;

    for (const candidate of candidates) {
      const fingerprint = perpStrategyLogicFingerprint(candidate);
      if (input.blocked.has(fingerprint) || reserved.has(fingerprint)) {
        input.stats.duplicateStrategiesSkipped += 1;
        continue;
      }
      reserved.add(fingerprint);
      accepted.push(copyGenome(
        candidate,
        `${input.idPrefix}-${String(accepted.length + 1).padStart(4, "0")}`,
      ));
      if (accepted.length >= input.count) break;
    }
  }

  if (accepted.length < input.count) {
    input.stats.exhaustedPopulationSlots += input.count - accepted.length;
    throw new Error(
      `Unique strategy generation exhausted: generation=${input.generation} requested=${input.count} generated=${accepted.length}`,
    );
  }

  return accepted;
}

function prepareInitialPopulation(
  config: PerpResearchConfig,
  options: PerpResearchRunOptions,
  blocked: ReadonlySet<string>,
  stats: PerpResearchDeduplicationStats,
) {
  const supplied = (options.initialPopulation ?? [])
    .filter((genome) => genome && genome.parameters)
    .map((genome) => copyGenome(genome, genome.id));

  return fillUniquePopulation({
    count: config.populationPerRound,
    generation: Math.max(0, options.generationOffset ?? 0),
    idPrefix: `unique-g${Math.max(0, options.generationOffset ?? 0)}`,
    blocked,
    stats,
    candidateFactory: (attempt, remaining) => {
      const fresh = createInitialPerpPopulation(
        Math.max(remaining * 6, config.populationPerRound * 3),
        config.seed + attempt * 1_000_003 + supplied.length * 97,
        config.profile,
      );
      return attempt === 0 ? [...supplied, ...fresh] : fresh;
    },
  });
}

function prepareNextPopulation(input: {
  elites: PerpStrategyGenome[];
  config: PerpResearchConfig;
  generation: number;
  blocked: ReadonlySet<string>;
  stats: PerpResearchDeduplicationStats;
}) {
  return fillUniquePopulation({
    count: input.config.populationPerRound,
    generation: input.generation,
    idPrefix: `unique-g${input.generation}`,
    blocked: input.blocked,
    stats: input.stats,
    candidateFactory: (attempt, remaining) => createNextPerpPopulation({
      elites: input.elites,
      count: Math.max(remaining * 8, input.config.populationPerRound * 4),
      generation: input.generation,
      seed: input.config.seed + attempt * 1_000_003,
      profile: input.config.profile,
    }),
  });
}

export async function runPerpResearch(
  config: PerpResearchConfig,
  data: PerpMarketData,
  options: PerpResearchRunOptions = {},
): Promise<PerpResearchResult> {
  const startedAt = new Date().toISOString();
  const rounds: PerpResearchRound[] = [];
  const generationOffset = Math.max(0, options.generationOffset ?? 0);
  const blockedLogicFingerprints = new Set(options.excludedLogicFingerprints ?? []);
  const evaluatedLogicFingerprints = options.evaluatedLogicFingerprints ?? new Set<string>();
  const deduplicationStats = options.deduplicationStats ?? {
    duplicateStrategiesSkipped: 0,
    replacementCandidatesGenerated: 0,
    exhaustedPopulationSlots: 0,
  };
  let totalEvaluations = 0;
  let leaderboard: PerpStrategyEvaluation[] = [];
  let population = prepareInitialPopulation(config, options, blockedLogicFingerprints, deduplicationStats);

  for (let round = 1; round <= config.rounds; round += 1) {
    const evaluations = await evaluatePopulation(population, data, config);
    for (const item of evaluations) {
      const fingerprint = perpStrategyLogicFingerprint(item.genome);
      blockedLogicFingerprints.add(fingerprint);
      evaluatedLogicFingerprints.add(fingerprint);
    }
    totalEvaluations += evaluations.length;
    leaderboard = mergeLeaderboard(leaderboard, evaluations);
    rounds.push(roundSummary(round, evaluations));
    const elites = selectFrontierElites(evaluations, config);
    population = prepareNextPopulation({
      elites,
      config,
      generation: generationOffset + round,
      blocked: blockedLogicFingerprints,
      stats: deduplicationStats,
    });
  }

  const validation = await validateFinalists(leaderboard, data, config);
  leaderboard = validation.leaderboard;
  return {
    startedAt,
    completedAt: new Date().toISOString(),
    config,
    rounds,
    leaderboard,
    finalCandidates: leaderboard.filter((item) => item.verdict === "final_candidate"),
    totalEvaluations,
    validatedStrategies: validation.validatedStrategies,
  };
}
