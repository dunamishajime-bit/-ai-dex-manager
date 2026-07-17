import type {
  AutonomousCycleSummary,
  AutonomousFailureProfile,
  AutonomousReflection,
  PerpAutonomousState,
} from "./autonomous";
import type { ChampionDeepResearchResult } from "./deep-research";
import type { PerpStrategyEvaluation } from "./types";

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

function allReasons(item: PerpStrategyEvaluation) {
  return [
    ...item.reasons,
    ...(item.validation?.finalGateReasons ?? []),
    ...(item.validation?.stress.flatMap((stress) => stress.reasons.map((reason) => `${stress.label}: ${reason}`)) ?? []),
  ];
}

function classifyFailures(items: PerpStrategyEvaluation[]): AutonomousFailureProfile {
  const failures = emptyFailures();
  for (const reason of items.flatMap(allReasons)) {
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
  return values.length ? Math.min(...values) : null;
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

export function reflectChampionDeepResearchRun(
  previous: PerpAutonomousState,
  deep: ChampionDeepResearchResult,
): AutonomousReflection {
  const result = deep.researchResult;
  const failures = classifyFailures(result.leaderboard);
  const bestTrain = result.leaderboard.length
    ? Math.max(...result.leaderboard.map((item) => item.train.metrics.averageMonthlyReturnPct))
    : -100;
  const validated = result.leaderboard.filter((item) => item.validation);
  const bestOosItem = [...validated].sort(
    (left, right) => (right.validation?.oos.metrics.averageMonthlyReturnPct ?? -100) -
      (left.validation?.oos.metrics.averageMonthlyReturnPct ?? -100),
  )[0];
  const bestOos = bestOosItem?.validation?.oos.metrics.averageMonthlyReturnPct ?? null;
  const bestOosDd = bestOosItem?.validation?.oos.metrics.maxDrawdownPct ?? null;
  const bestStress = bestOosItem ? worstStressMonthly(bestOosItem) : null;
  const accepted = deep.experiments.filter((item) => item.accepted).length;
  const summary: AutonomousCycleSummary = {
    cycle: deep.cycle,
    completedAt: deep.completedAt,
    profile: deep.profile,
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
    version: previous.version,
    cycle: deep.cycle,
    seed: previous.seed + 104_729,
    generationOffset: previous.generationOffset + 1,
    nextProfile: deep.profile,
    consecutiveNoCandidate: result.finalCandidates.length ? 0 : previous.consecutiveNoCandidate + 1,
    bestTrainMonthlyPct: Math.max(finiteOr(previous.bestTrainMonthlyPct, -100), bestTrain),
    bestOosMonthlyPct: Math.max(finiteOr(previous.bestOosMonthlyPct, -100), bestOos ?? -100),
    bestScore: Math.max(finiteOr(previous.bestScore, 0), result.leaderboard[0]?.score ?? 0),
    eliteGenomes: deep.championsAfter.map((item) => item.genome),
    paperCandidateIds: result.finalCandidates.map((item) => item.genome.id),
    failureProfile: failures,
    nextPlan: deep.nextPlan,
    lastRunAt: deep.completedAt,
    history: [...previous.history, summary].slice(-30),
  };
  const markdown = [
    `# Win80 / Ultra90 Main-Lineage Research Cycle ${summary.cycle}`,
    "",
    `- Fixed production main: WIN80_ULTRA90_TOP1_V1`,
    `- Production auto-promotion: disabled`,
    `- Profile: ${summary.profile}`,
    `- Champions re-evaluated: ${deep.baselineEvaluations.length}`,
    `- Single-parameter experiments: ${deep.experiments.length}`,
    `- Accepted improvements: ${accepted}`,
    `- Parent strategies retained: ${deep.championsAfter.length - accepted}`,
    `- Total full validations: ${summary.validated}`,
    `- Final candidates: ${summary.finalCandidates}`,
    `- Best Train average monthly: ${summary.bestTrainMonthlyPct.toFixed(2)}%`,
    `- Best OOS average monthly: ${summary.bestOosMonthlyPct == null ? "none" : `${summary.bestOosMonthlyPct.toFixed(2)}%`}`,
    `- Best OOS MaxDD: ${summary.bestOosDrawdownPct == null ? "none" : `${summary.bestOosDrawdownPct.toFixed(2)}%`}`,
    `- Worst stress monthly of best OOS: ${summary.bestWorstStressMonthlyPct == null ? "none" : `${summary.bestWorstStressMonthlyPct.toFixed(2)}%`}`,
    "",
    "## Parent / Child Decisions",
    "",
    ...deep.experiments.map((item) => (
      `- ${item.plan.championSlot} / ${String(item.plan.changedParameter)} ${String(item.plan.beforeValue)} → ${String(item.plan.afterValue)}: ${item.accepted ? "ACCEPT" : "REJECT"}; OOS ${item.comparison.deltaOosMonthlyPct >= 0 ? "+" : ""}${item.comparison.deltaOosMonthlyPct.toFixed(2)}pt, Stress ${item.comparison.deltaWorstStressMonthlyPct >= 0 ? "+" : ""}${item.comparison.deltaWorstStressMonthlyPct.toFixed(2)}pt, DD improvement ${item.comparison.deltaDrawdownImprovementPct.toFixed(2)}pt`
    )),
    "",
    "## Next Deep Research Plan",
    "",
    ...deep.nextPlan.map((item) => `- ${item}`),
    "",
    "## Safety",
    "",
    "- Research and Forward Paper candidates only",
    "- Real orders, wallets and API keys remain disconnected",
    "- Any liquidation rejects the child strategy",
    "- A child is inherited only when it improves its own parent",
    "- Inheritance applies to the research lineage only and never replaces the production main strategy",
    "",
  ].join("\n");
  return { state, summary, markdown };
}
