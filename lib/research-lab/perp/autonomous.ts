import { createInitialPerpPopulation } from "./evolution";
import type {
  PerpResearchConfig,
  PerpResearchProfile,
  PerpResearchResult,
  PerpStrategyEvaluation,
  PerpStrategyGenome,
} from "./types";

const STATE_VERSION = 1;
const MAX_ELITES = 12;
const MAX_HISTORY = 30;

export interface AutonomousFailureProfile {
  lowReturn: number;
  drawdown: number;
  lowSample: number;
  liquidation: number;
  directionBias: number;
  oosDecay: number;
  costFragility: number;
  walkForward: number;
  executionFailure: number;
}

export interface AutonomousCycleSummary {
  cycle: number;
  completedAt: string;
  profile: PerpResearchProfile;
  evaluations: number;
  validated: number;
  finalCandidates: number;
  bestTrainMonthlyPct: number;
  bestOosMonthlyPct: number | null;
  bestOosDrawdownPct: number | null;
  bestWorstStressMonthlyPct: number | null;
  failureProfile: AutonomousFailureProfile;
}

export interface PerpAutonomousState {
  version: number;
  cycle: number;
  seed: number;
  generationOffset: number;
  nextProfile: PerpResearchProfile;
  consecutiveNoCandidate: number;
  bestTrainMonthlyPct: number;
  bestOosMonthlyPct: number;
  bestScore: number;
  eliteGenomes: PerpStrategyGenome[];
  paperCandidateIds: string[];
  failureProfile: AutonomousFailureProfile;
  nextPlan: string[];
  lastRunAt: string | null;
  history: AutonomousCycleSummary[];
}

export interface AutonomousReflection {
  state: PerpAutonomousState;
  summary: AutonomousCycleSummary;
  markdown: string;
}

function emptyFailures(): AutonomousFailureProfile {
  return {
    lowReturn: 0,
    drawdown: 0,
    lowSample: 0,
    liquidation: 0,
    directionBias: 0,
    oosDecay: 0,
    costFragility: 0,
    walkForward: 0,
    executionFailure: 0,
  };
}

export function createDefaultAutonomousState(): PerpAutonomousState {
  return {
    version: STATE_VERSION,
    cycle: 0,
    seed: 5613,
    generationOffset: 0,
    nextProfile: "attack",
    consecutiveNoCandidate: 0,
    bestTrainMonthlyPct: Number.NEGATIVE_INFINITY,
    bestOosMonthlyPct: Number.NEGATIVE_INFINITY,
    bestScore: 0,
    eliteGenomes: [],
    paperCandidateIds: [],
    failureProfile: emptyFailures(),
    nextPlan: ["USD-M Futures Attack探索を開始する"],
    lastRunAt: null,
    history: [],
  };
}

export function normalizeAutonomousState(value: unknown): PerpAutonomousState {
  const fallback = createDefaultAutonomousState();
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<PerpAutonomousState>;
  return {
    ...fallback,
    ...input,
    version: STATE_VERSION,
    eliteGenomes: Array.isArray(input.eliteGenomes) ? input.eliteGenomes.slice(0, MAX_ELITES) : [],
    paperCandidateIds: Array.isArray(input.paperCandidateIds) ? input.paperCandidateIds : [],
    failureProfile: { ...emptyFailures(), ...(input.failureProfile ?? {}) },
    nextPlan: Array.isArray(input.nextPlan) ? input.nextPlan : fallback.nextPlan,
    history: Array.isArray(input.history) ? input.history.slice(-MAX_HISTORY) : [],
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function uniqueGenomes(genomes: PerpStrategyGenome[]) {
  const bySignature = new Map<string, PerpStrategyGenome>();
  for (const genome of genomes) {
    const signature = JSON.stringify({
      family: genome.family,
      symbols: [...genome.symbols].sort(),
      parameters: genome.parameters,
    });
    if (!bySignature.has(signature)) bySignature.set(signature, genome);
  }
  return [...bySignature.values()];
}

export function buildAutonomousInitialPopulation(
  state: PerpAutonomousState,
  config: PerpResearchConfig,
): PerpStrategyGenome[] {
  const resumed = state.eliteGenomes.map((genome, index) => ({
    ...genome,
    id: `auto-c${state.cycle}-resume-${String(index + 1).padStart(2, "0")}`,
    generation: state.generationOffset,
    parentIds: [genome.id],
    symbols: [...genome.symbols],
    parameters: { ...genome.parameters },
  }));
  const fresh = createInitialPerpPopulation(
    Math.max(config.populationPerRound, config.populationPerRound - resumed.length),
    config.seed,
    config.profile,
  ).map((genome, index) => ({
    ...genome,
    id: `auto-c${state.cycle}-fresh-${String(index + 1).padStart(2, "0")}`,
  }));
  return uniqueGenomes([...resumed, ...fresh]).slice(0, config.populationPerRound);
}

function allReasons(item: PerpStrategyEvaluation) {
  return [
    ...item.reasons,
    ...(item.validation?.finalGateReasons ?? []),
    ...(item.validation?.stress.flatMap((stress) => stress.reasons.map((reason) => `${stress.label}: ${reason}`)) ?? []),
  ];
}

function classifyFailures(result: PerpResearchResult): AutonomousFailureProfile {
  const failures = emptyFailures();
  const reasons = result.leaderboard.slice(0, 50).flatMap(allReasons);
  for (const reason of reasons) {
    const normalized = reason.toLowerCase();
    if (normalized.includes("月利") || normalized.includes("average monthly")) failures.lowReturn += 1;
    if (normalized.includes("dd") || normalized.includes("drawdown")) failures.drawdown += 1;
    if (normalized.includes("取引数") || normalized.includes("trades")) failures.lowSample += 1;
    if (normalized.includes("清算") || normalized.includes("liquidation")) failures.liquidation += 1;
    if (normalized.includes("方向偏り") || normalized.includes("long=") || normalized.includes("short=")) failures.directionBias += 1;
    if (normalized.includes("維持率") || normalized.includes("validation平均月利")) failures.oosDecay += 1;
    if (normalized.includes("stress") || normalized.includes("cost") || normalized.includes("pf不足")) failures.costFragility += 1;
    if (normalized.includes("walk-forward")) failures.walkForward += 1;
    if (normalized.includes("バックテスト失敗") || normalized.includes("最終検証失敗")) failures.executionFailure += 1;
  }
  return failures;
}

function worstStressMonthly(item: PerpStrategyEvaluation) {
  const values = item.validation?.stress.map((stress) => stress.result.metrics.averageMonthlyReturnPct) ?? [];
  return values.length ? Math.min(...values) : Number.NEGATIVE_INFINITY;
}

function selectAutonomousElites(result: PerpResearchResult) {
  const candidates = result.leaderboard.filter((item) => (
    item.train.risk.endingEquity > 0 &&
    item.train.risk.liquidationCount === 0 &&
    item.train.metrics.tradeCount > 0
  ));
  const selected = new Map<string, PerpStrategyEvaluation>();
  const add = (item?: PerpStrategyEvaluation | null) => {
    if (item) selected.set(item.genome.id, item);
  };
  const topBy = (getter: (item: PerpStrategyEvaluation) => number, count: number) => {
    [...candidates]
      .sort((left, right) => getter(right) - getter(left))
      .slice(0, count)
      .forEach(add);
  };

  result.finalCandidates.slice(0, 4).forEach(add);
  topBy((item) => item.validation?.oos.metrics.averageMonthlyReturnPct ?? Number.NEGATIVE_INFINITY, 3);
  topBy(worstStressMonthly, 2);
  topBy((item) => item.train.metrics.averageMonthlyReturnPct, 3);
  topBy((item) => item.score, 3);
  topBy((item) => item.train.metrics.sharpe, 2);
  topBy((item) => -item.train.metrics.maxDrawdownPct, 2);
  return [...selected.values()].slice(0, MAX_ELITES);
}

function reflectGenome(
  item: PerpStrategyEvaluation,
  failures: AutonomousFailureProfile,
  nextCycle: number,
  profile: PerpResearchProfile,
  index: number,
): PerpStrategyGenome {
  const parameters = { ...item.genome.parameters };
  const riskFailure = failures.drawdown + failures.liquidation;
  const returnFailure = failures.lowReturn;

  if (failures.costFragility > 0) {
    parameters.minimumEdgeToCostRatio = clamp(parameters.minimumEdgeToCostRatio * 1.15, 1, 8);
    parameters.minimumMomentumPct = clamp(parameters.minimumMomentumPct * 1.05, 0, 0.2);
    parameters.rebalanceBars = Math.round(clamp(parameters.rebalanceBars + 2, 1, 48));
    parameters.maxHoldBars = Math.round(clamp(parameters.maxHoldBars + 4, 2, 200));
  }
  if (returnFailure > riskFailure) {
    parameters.leverage = clamp(parameters.leverage + (profile === "attack" ? 0.4 : 0.2), 1, 5);
    parameters.riskPerTradePct = clamp(parameters.riskPerTradePct + (profile === "attack" ? 0.3 : 0.15), 0.25, 5);
    parameters.maxMarginUsagePct = clamp(parameters.maxMarginUsagePct + 5, 20, 100);
    parameters.takeProfitAtr = clamp(parameters.takeProfitAtr + 0.4, 1, 18);
  }
  if (riskFailure > 0) {
    parameters.leverage = clamp(parameters.leverage * 0.85, 1, 5);
    parameters.riskPerTradePct = clamp(parameters.riskPerTradePct * 0.8, 0.25, 5);
    parameters.maxMarginUsagePct = clamp(parameters.maxMarginUsagePct * 0.9, 20, 100);
    parameters.stopAtr = clamp(parameters.stopAtr * 1.1, 0.5, 8);
    parameters.cooldownBars = Math.round(clamp(parameters.cooldownBars + 1, 0, 40));
  }
  if (failures.lowSample > failures.costFragility) {
    parameters.minimumMomentumPct = clamp(parameters.minimumMomentumPct * 0.9, 0, 0.2);
    parameters.minimumVolumeRatio = clamp(parameters.minimumVolumeRatio * 0.95, 0.25, 3);
    parameters.regimeThresholdPct = clamp(parameters.regimeThresholdPct * 0.9, 0, 0.12);
  }
  if (failures.oosDecay > 0 || failures.walkForward > 0) {
    parameters.allowNeutralRegime = false;
    parameters.regimeThresholdPct = clamp(parameters.regimeThresholdPct * 1.1, 0, 0.12);
    parameters.btcRegimeSmaBars = Math.round(clamp(parameters.btcRegimeSmaBars + 4, 8, 200));
  }
  if (failures.directionBias > 0) {
    parameters.allowLong = true;
    parameters.allowShort = true;
  }

  return {
    ...item.genome,
    id: `auto-c${nextCycle}-elite-${String(index + 1).padStart(2, "0")}`,
    generation: item.genome.generation + 1,
    parentIds: [item.genome.id],
    symbols: [...item.genome.symbols],
    parameters: {
      ...parameters,
      leverage: round(parameters.leverage, 2),
      riskPerTradePct: round(parameters.riskPerTradePct, 2),
      maxMarginUsagePct: round(parameters.maxMarginUsagePct, 1),
      minimumEdgeToCostRatio: round(parameters.minimumEdgeToCostRatio, 2),
      minimumMomentumPct: round(parameters.minimumMomentumPct),
      minimumVolumeRatio: round(parameters.minimumVolumeRatio),
      regimeThresholdPct: round(parameters.regimeThresholdPct),
      stopAtr: round(parameters.stopAtr),
      takeProfitAtr: round(parameters.takeProfitAtr),
    },
  };
}

function nextProfileForCycle(nextCycle: number): PerpResearchProfile {
  return nextCycle % 4 === 0 ? "balanced" : "attack";
}

function planFromFailures(failures: AutonomousFailureProfile, profile: PerpResearchProfile) {
  const plan: string[] = [];
  if (failures.costFragility > 0) plan.push("Edge/Cost比率を上げ、回転頻度を下げる");
  if (failures.lowReturn > failures.drawdown + failures.liquidation) plan.push("清算0を維持しながら実効レバレッジと利幅を段階的に上げる");
  if (failures.drawdown + failures.liquidation > 0) plan.push("リスク率・証拠金使用率・レバレッジを縮小する");
  if (failures.lowSample > failures.costFragility) plan.push("コストGateを維持しつつシグナル閾値を少し緩める");
  if (failures.oosDecay + failures.walkForward > 0) plan.push("Neutral Entryを止め、BTCレジーム確認を強化する");
  if (failures.directionBias > 0) plan.push("Long/Short両方向を必須化する");
  if (!plan.length) plan.push(`${profile}プロファイルで現在のEliteを再交配する`);
  return plan;
}

export function reflectAutonomousRun(
  previous: PerpAutonomousState,
  result: PerpResearchResult,
): AutonomousReflection {
  const failures = classifyFailures(result);
  const elites = selectAutonomousElites(result);
  const nextCycle = previous.cycle + 1;
  const nextProfile = nextProfileForCycle(nextCycle);
  const reflectedElites = elites.map((item, index) => reflectGenome(item, failures, nextCycle, nextProfile, index));
  const bestTrain = result.leaderboard.reduce(
    (best, item) => Math.max(best, item.train.metrics.averageMonthlyReturnPct),
    Number.NEGATIVE_INFINITY,
  );
  const validated = result.leaderboard.filter((item) => item.validation);
  const bestOosItem = [...validated].sort(
    (left, right) => (right.validation?.oos.metrics.averageMonthlyReturnPct ?? -Infinity) -
      (left.validation?.oos.metrics.averageMonthlyReturnPct ?? -Infinity),
  )[0];
  const bestOos = bestOosItem?.validation?.oos.metrics.averageMonthlyReturnPct ?? null;
  const bestOosDd = bestOosItem?.validation?.oos.metrics.maxDrawdownPct ?? null;
  const bestStress = bestOosItem ? worstStressMonthly(bestOosItem) : null;
  const summary: AutonomousCycleSummary = {
    cycle: nextCycle,
    completedAt: result.completedAt,
    profile: result.config.profile,
    evaluations: result.totalEvaluations,
    validated: result.validatedStrategies,
    finalCandidates: result.finalCandidates.length,
    bestTrainMonthlyPct: bestTrain,
    bestOosMonthlyPct: bestOos,
    bestOosDrawdownPct: bestOosDd,
    bestWorstStressMonthlyPct: bestStress != null && Number.isFinite(bestStress) ? bestStress : null,
    failureProfile: failures,
  };
  const state: PerpAutonomousState = {
    version: STATE_VERSION,
    cycle: nextCycle,
    seed: previous.seed + 104_729,
    generationOffset: previous.generationOffset + result.config.rounds,
    nextProfile,
    consecutiveNoCandidate: result.finalCandidates.length ? 0 : previous.consecutiveNoCandidate + 1,
    bestTrainMonthlyPct: Math.max(previous.bestTrainMonthlyPct, bestTrain),
    bestOosMonthlyPct: Math.max(previous.bestOosMonthlyPct, bestOos ?? Number.NEGATIVE_INFINITY),
    bestScore: Math.max(previous.bestScore, result.leaderboard[0]?.score ?? 0),
    eliteGenomes: reflectedElites,
    paperCandidateIds: result.finalCandidates.map((item) => item.genome.id),
    failureProfile: failures,
    nextPlan: planFromFailures(failures, nextProfile),
    lastRunAt: result.completedAt,
    history: [...previous.history, summary].slice(-MAX_HISTORY),
  };
  const markdown = [
    `# Autonomous Research Cycle ${summary.cycle}`,
    "",
    `- Profile: ${summary.profile}`,
    `- Evaluations: ${summary.evaluations}`,
    `- Validated: ${summary.validated}`,
    `- Final candidates: ${summary.finalCandidates}`,
    `- Best Train average monthly: ${summary.bestTrainMonthlyPct.toFixed(2)}%`,
    `- Best OOS average monthly: ${summary.bestOosMonthlyPct == null ? "none" : `${summary.bestOosMonthlyPct.toFixed(2)}%`}`,
    `- Best OOS MaxDD: ${summary.bestOosDrawdownPct == null ? "none" : `${summary.bestOosDrawdownPct.toFixed(2)}%`}`,
    `- Worst stress monthly: ${summary.bestWorstStressMonthlyPct == null ? "none" : `${summary.bestWorstStressMonthlyPct.toFixed(2)}%`}`,
    `- Next profile: ${state.nextProfile}`,
    "",
    "## Automatic Reflection",
    "",
    ...state.nextPlan.map((item) => `- ${item}`),
    "",
    "## Safety",
    "",
    "- Research and Forward Paper candidates only",
    "- Real orders, wallets and API keys remain disconnected",
    "- Any liquidation rejects the strategy",
    "",
  ].join("\n");
  return { state, summary, markdown };
}
