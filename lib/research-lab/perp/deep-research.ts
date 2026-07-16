import { createInitialPerpPopulation } from "./evolution";
import { runPerpBacktest } from "./engine";
import { perpStrategyLogicFingerprint } from "./fingerprint";
import { evaluatePerpStrategy } from "./scoring";
import type { PerpResearchDeduplicationStats } from "./orchestrator";
import type {
  PerpMarketData,
  PerpResearchConfig,
  PerpResearchProfile,
  PerpResearchResult,
  PerpStrategyEvaluation,
  PerpStrategyGenome,
  PerpStrategyParameters,
} from "./types";
import { buildPerpValidationPlan, validatePerpStrategy } from "./validation";

export type ChampionSlot = "oos" | "stress" | "stability";
export type ChampionRootCause =
  | "low_return"
  | "stable_but_low_return"
  | "oos_decay"
  | "cost_fragility"
  | "drawdown_risk"
  | "direction_bias"
  | "low_sample";

export interface ChampionMetricSnapshot {
  trainMonthlyPct: number;
  oosMonthlyPct: number;
  oosMaxDrawdownPct: number;
  worstStressMonthlyPct: number;
  walkForwardPassRatePct: number;
  oosRetentionPct: number;
  stressRetentionPct: number;
  oosTrades: number;
  longTrades: number;
  shortTrades: number;
  liquidationCount: number;
  maxConsecutiveLosses: number;
  profitFactor: number;
  totalFundingCost: number;
  averageEffectiveLeverage: number;
  score: number;
}

export interface ChampionRecord {
  slot: ChampionSlot;
  genome: PerpStrategyGenome;
  metrics: ChampionMetricSnapshot;
  rootCauses: ChampionRootCause[];
  selectedAt: string;
  noImprovementCycles: number;
}

export interface ChampionExperimentPlan {
  id: string;
  cycle: number;
  championSlot: ChampionSlot;
  parentStrategyId: string;
  childStrategyId: string;
  hypothesisKey: string;
  hypothesis: string;
  rationale: string;
  changedParameter: keyof PerpStrategyParameters;
  beforeValue: number | boolean | string;
  afterValue: number | boolean | string;
  childGenome: PerpStrategyGenome;
}

export interface ChampionExperimentComparison {
  deltaOosMonthlyPct: number;
  deltaWorstStressMonthlyPct: number;
  deltaDrawdownImprovementPct: number;
  deltaWalkForwardPassRatePct: number;
  deltaTradeCount: number;
  compositeImprovement: number;
}

export interface ChampionExperimentResult {
  plan: ChampionExperimentPlan;
  parentMetrics: ChampionMetricSnapshot;
  childMetrics: ChampionMetricSnapshot;
  comparison: ChampionExperimentComparison;
  accepted: boolean;
  reasons: string[];
}

export interface ChampionDeepCycleSummary {
  cycle: number;
  completedAt: string;
  profile: PerpResearchProfile;
  champions: number;
  baselineEvaluations: number;
  experiments: number;
  acceptedExperiments: number;
  retainedChampions: number;
  bestDeltaOosMonthlyPct: number;
  bestDeltaStressMonthlyPct: number;
}

export interface ChampionDeepResearchState {
  version: 1;
  cycle: number;
  updatedAt: string | null;
  champions: ChampionRecord[];
  latestExperiments: ChampionExperimentResult[];
  history: ChampionDeepCycleSummary[];
  nextPlan: string[];
}

export interface ChampionDeepResearchResult {
  startedAt: string;
  completedAt: string;
  cycle: number;
  profile: PerpResearchProfile;
  championsBefore: ChampionRecord[];
  championsAfter: ChampionRecord[];
  baselineEvaluations: PerpStrategyEvaluation[];
  experimentEvaluations: PerpStrategyEvaluation[];
  experiments: ChampionExperimentResult[];
  researchResult: PerpResearchResult;
  state: ChampionDeepResearchState;
  nextPlan: string[];
}

interface PlanCandidate {
  key: string;
  parameter: keyof PerpStrategyParameters;
  hypothesis: string;
  rationale: string;
  apply: (parameters: PerpStrategyParameters) => PerpStrategyParameters;
}

const MAX_HISTORY = 60;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finite(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function copyGenome(genome: PerpStrategyGenome): PerpStrategyGenome {
  return {
    ...genome,
    parentIds: [...genome.parentIds],
    symbols: [...genome.symbols],
    parameters: { ...genome.parameters },
  };
}

function worstStressMonthly(item: PerpStrategyEvaluation) {
  const values = item.validation?.stress.map((stress) => stress.result.metrics.averageMonthlyReturnPct) ?? [];
  return values.length ? Math.min(...values) : -100;
}

export function championMetricSnapshot(item: PerpStrategyEvaluation): ChampionMetricSnapshot {
  const validation = item.validation;
  const oos = validation?.oos ?? item.train;
  return {
    trainMonthlyPct: finite(item.train.metrics.averageMonthlyReturnPct, -100),
    oosMonthlyPct: finite(oos.metrics.averageMonthlyReturnPct, -100),
    oosMaxDrawdownPct: finite(oos.metrics.maxDrawdownPct, 100),
    worstStressMonthlyPct: validation ? worstStressMonthly(item) : -100,
    walkForwardPassRatePct: finite(validation?.walkForwardPassRatePct, 0),
    oosRetentionPct: finite(validation?.oosReturnRetentionRatio, 0) * 100,
    stressRetentionPct: finite(validation?.stressReturnRetentionRatio, 0) * 100,
    oosTrades: finite(oos.metrics.tradeCount, 0),
    longTrades: finite(oos.risk.longTrades, 0),
    shortTrades: finite(oos.risk.shortTrades, 0),
    liquidationCount: finite(oos.risk.liquidationCount, 0),
    maxConsecutiveLosses: finite(oos.risk.maxConsecutiveLosses, 0),
    profitFactor: finite(oos.metrics.profitFactor, 0),
    totalFundingCost: finite(oos.risk.totalFundingCost, 0),
    averageEffectiveLeverage: finite(oos.risk.averageEffectiveLeverage, 0),
    score: finite(item.score, 0),
  };
}

export function diagnoseChampion(metrics: ChampionMetricSnapshot): ChampionRootCause[] {
  const causes: ChampionRootCause[] = [];
  if (metrics.oosMonthlyPct < 30) causes.push("low_return");
  if (
    metrics.oosMonthlyPct < 10 &&
    metrics.oosMaxDrawdownPct <= 12 &&
    metrics.liquidationCount === 0 &&
    metrics.oosTrades >= 20
  ) causes.push("stable_but_low_return");
  if (metrics.oosRetentionPct < 50 || metrics.walkForwardPassRatePct < 60) causes.push("oos_decay");
  if (metrics.worstStressMonthlyPct < 20 || metrics.stressRetentionPct < 50) causes.push("cost_fragility");
  if (metrics.oosMaxDrawdownPct > 25 || metrics.liquidationCount > 0 || metrics.maxConsecutiveLosses > 10) {
    causes.push("drawdown_risk");
  }
  const directions = metrics.longTrades + metrics.shortTrades;
  const directionRatio = directions ? Math.min(metrics.longTrades, metrics.shortTrades) / directions : 0;
  if (!metrics.longTrades || !metrics.shortTrades || directionRatio < 0.15) causes.push("direction_bias");
  if (metrics.oosTrades < 20) causes.push("low_sample");
  return [...new Set(causes)];
}

function planCandidates(causes: ChampionRootCause[]): PlanCandidate[] {
  const candidates: PlanCandidate[] = [];
  const add = (candidate: PlanCandidate) => {
    if (!candidates.some((item) => item.key === candidate.key)) candidates.push(candidate);
  };

  if (causes.includes("cost_fragility")) {
    add({
      key: "edge-cost-up",
      parameter: "minimumEdgeToCostRatio",
      hypothesis: "低期待値Entryを減らせば、取引回数を大きく失わずCost Stressが改善する",
      rationale: "最小Edge/Cost比だけを15%引き上げ、コスト負けするEntryを除外する",
      apply: (parameters) => ({ ...parameters, minimumEdgeToCostRatio: round(clamp(parameters.minimumEdgeToCostRatio * 1.15, 1, 12), 2) }),
    });
    add({
      key: "rebalance-slower",
      parameter: "rebalanceBars",
      hypothesis: "再評価間隔を延ばせば不要な回転が減り、手数料とSlippage耐性が改善する",
      rationale: "rebalanceBarsだけを2本延長する",
      apply: (parameters) => ({ ...parameters, rebalanceBars: Math.round(clamp(parameters.rebalanceBars + 2, 1, 48)) }),
    });
    add({
      key: "cooldown-up",
      parameter: "cooldownBars",
      hypothesis: "連続Entryを抑制すればダマシと往復コストを減らせる",
      rationale: "cooldownBarsだけを1本増やす",
      apply: (parameters) => ({ ...parameters, cooldownBars: Math.round(clamp(parameters.cooldownBars + 1, 0, 40)) }),
    });
  }

  if (causes.includes("oos_decay")) {
    add({
      key: "neutral-off",
      parameter: "allowNeutralRegime",
      hypothesis: "方向感のないBTCレジームを停止すればOOS劣化とWalk-forward不安定性が下がる",
      rationale: "allowNeutralRegimeだけをfalseへ変更する",
      apply: (parameters) => ({ ...parameters, allowNeutralRegime: false }),
    });
    add({
      key: "btc-sma-slower",
      parameter: "btcRegimeSmaBars",
      hypothesis: "BTCレジーム判定を少し長期化すれば期間依存のノイズを減らせる",
      rationale: "btcRegimeSmaBarsだけを4本増やす",
      apply: (parameters) => ({ ...parameters, btcRegimeSmaBars: Math.round(clamp(parameters.btcRegimeSmaBars + 4, 8, 200)) }),
    });
    add({
      key: "regime-threshold-up",
      parameter: "regimeThresholdPct",
      hypothesis: "弱いレジーム判定を除外すればOOSの再現性が改善する",
      rationale: "regimeThresholdPctだけを10%引き上げる",
      apply: (parameters) => ({ ...parameters, regimeThresholdPct: round(clamp(parameters.regimeThresholdPct * 1.1, 0, 0.12)) }),
    });
  }

  if (causes.includes("low_return") || causes.includes("stable_but_low_return")) {
    add({
      key: "take-profit-up",
      parameter: "takeProfitAtr",
      hypothesis: "低DDと高PFを維持したまま利幅を広げればOOS月利を改善できる",
      rationale: "takeProfitAtrだけを10%広げる",
      apply: (parameters) => ({ ...parameters, takeProfitAtr: round(clamp(parameters.takeProfitAtr * 1.1, 1, 18)) }),
    });
    add({
      key: "max-hold-up",
      parameter: "maxHoldBars",
      hypothesis: "勝ちトレードの保有余地を少し増やせば平均利益を伸ばせる",
      rationale: "maxHoldBarsだけを4本増やす",
      apply: (parameters) => ({ ...parameters, maxHoldBars: Math.round(clamp(parameters.maxHoldBars + 4, 2, 200)) }),
    });
    add({
      key: "leverage-step-up",
      parameter: "leverage",
      hypothesis: "清算0・低DDを維持できる範囲で小幅にレバレッジを上げれば月利を改善できる",
      rationale: "leverageだけを0.20倍上げる",
      apply: (parameters) => ({ ...parameters, leverage: round(clamp(parameters.leverage + 0.2, 1, 5), 2) }),
    });
  }

  if (causes.includes("drawdown_risk")) {
    add({
      key: "leverage-down",
      parameter: "leverage",
      hypothesis: "レバレッジを下げれば清算リスクとOOS DDを改善できる",
      rationale: "leverageだけを10%下げる",
      apply: (parameters) => ({ ...parameters, leverage: round(clamp(parameters.leverage * 0.9, 1, 5), 2) }),
    });
    add({
      key: "risk-down",
      parameter: "riskPerTradePct",
      hypothesis: "1取引リスクを下げれば最大連敗時のDDを抑制できる",
      rationale: "riskPerTradePctだけを10%下げる",
      apply: (parameters) => ({ ...parameters, riskPerTradePct: round(clamp(parameters.riskPerTradePct * 0.9, 0.25, 5), 2) }),
    });
    add({
      key: "stop-wider",
      parameter: "stopAtr",
      hypothesis: "Stopをわずかに広げればノイズ損切りを減らし、連敗を抑えられる",
      rationale: "stopAtrだけを8%広げる",
      apply: (parameters) => ({ ...parameters, stopAtr: round(clamp(parameters.stopAtr * 1.08, 0.4, 8)) }),
    });
  }

  if (causes.includes("direction_bias")) {
    add({
      key: "enable-long",
      parameter: "allowLong",
      hypothesis: "Long側を有効化すれば上昇局面を取り逃さず方向偏りを解消できる",
      rationale: "allowLongだけをtrueへ変更する",
      apply: (parameters) => ({ ...parameters, allowLong: true }),
    });
    add({
      key: "enable-short",
      parameter: "allowShort",
      hypothesis: "Short側を有効化すれば下落局面を収益源にできる",
      rationale: "allowShortだけをtrueへ変更する",
      apply: (parameters) => ({ ...parameters, allowShort: true }),
    });
  }

  if (causes.includes("low_sample")) {
    add({
      key: "momentum-threshold-down",
      parameter: "minimumMomentumPct",
      hypothesis: "Momentum閾値を少し緩めれば、コストGateを維持したまま検証サンプルを増やせる",
      rationale: "minimumMomentumPctだけを8%下げる",
      apply: (parameters) => ({ ...parameters, minimumMomentumPct: round(clamp(parameters.minimumMomentumPct * 0.92, 0, 0.2)) }),
    });
    add({
      key: "volume-threshold-down",
      parameter: "minimumVolumeRatio",
      hypothesis: "出来高条件をわずかに緩めればOOS取引数を増やせる",
      rationale: "minimumVolumeRatioだけを5%下げる",
      apply: (parameters) => ({ ...parameters, minimumVolumeRatio: round(clamp(parameters.minimumVolumeRatio * 0.95, 0.25, 3)) }),
    });
  }

  add({
    key: "trailing-tighter",
    parameter: "trailingAtr",
    hypothesis: "利益追随幅を少し狭めれば含み益消失を減らせる",
    rationale: "trailingAtrだけを5%狭める",
    apply: (parameters) => ({ ...parameters, trailingAtr: round(clamp(parameters.trailingAtr * 0.95, 0.3, 8)) }),
  });
  add({
    key: "breakout-buffer-up",
    parameter: "breakoutBufferPct",
    hypothesis: "Breakout確認幅を少し増やせばダマシEntryを減らせる",
    rationale: "breakoutBufferPctだけを0.1%増やす",
    apply: (parameters) => ({ ...parameters, breakoutBufferPct: round(clamp(parameters.breakoutBufferPct + 0.001, 0, 0.08)) }),
  });

  return candidates;
}

function parameterValue(parameters: PerpStrategyParameters, key: keyof PerpStrategyParameters) {
  return parameters[key] as number | boolean | string;
}

export function buildChampionExperimentPlans(input: {
  champion: ChampionRecord;
  cycle: number;
  count: number;
  blockedFingerprints?: Iterable<string>;
  reservedFingerprints?: Set<string>;
  stats?: PerpResearchDeduplicationStats;
}): ChampionExperimentPlan[] {
  const blocked = new Set(input.blockedFingerprints ?? []);
  const reserved = input.reservedFingerprints ?? new Set<string>();
  const stats = input.stats;
  const plans: ChampionExperimentPlan[] = [];
  const candidates = planCandidates(input.champion.rootCauses);

  for (const candidate of candidates) {
    if (plans.length >= input.count) break;
    const childParameters = candidate.apply({ ...input.champion.genome.parameters });
    const beforeValue = parameterValue(input.champion.genome.parameters, candidate.parameter);
    const afterValue = parameterValue(childParameters, candidate.parameter);
    if (beforeValue === afterValue) continue;
    const childGenome: PerpStrategyGenome = {
      ...copyGenome(input.champion.genome),
      id: `deep-c${input.cycle}-${input.champion.slot}-e${plans.length + 1}`,
      generation: input.champion.genome.generation + 1,
      parentIds: [input.champion.genome.id],
      thesis: `${input.champion.genome.thesis}／Deep hypothesis: ${candidate.hypothesis}`,
      parameters: childParameters,
    };
    const fingerprint = perpStrategyLogicFingerprint(childGenome);
    if (blocked.has(fingerprint) || reserved.has(fingerprint)) {
      if (stats) stats.duplicateStrategiesSkipped += 1;
      continue;
    }
    reserved.add(fingerprint);
    plans.push({
      id: `deep-c${input.cycle}-${input.champion.slot}-${candidate.key}`,
      cycle: input.cycle,
      championSlot: input.champion.slot,
      parentStrategyId: input.champion.genome.id,
      childStrategyId: childGenome.id,
      hypothesisKey: candidate.key,
      hypothesis: candidate.hypothesis,
      rationale: candidate.rationale,
      changedParameter: candidate.parameter,
      beforeValue,
      afterValue,
      childGenome,
    });
  }

  if (plans.length < input.count && stats) stats.exhaustedPopulationSlots += input.count - plans.length;
  return plans;
}

export function compareChampionExperiment(
  parent: ChampionMetricSnapshot,
  child: ChampionMetricSnapshot,
): { comparison: ChampionExperimentComparison; accepted: boolean; reasons: string[] } {
  const comparison: ChampionExperimentComparison = {
    deltaOosMonthlyPct: round(child.oosMonthlyPct - parent.oosMonthlyPct, 4),
    deltaWorstStressMonthlyPct: round(child.worstStressMonthlyPct - parent.worstStressMonthlyPct, 4),
    deltaDrawdownImprovementPct: round(parent.oosMaxDrawdownPct - child.oosMaxDrawdownPct, 4),
    deltaWalkForwardPassRatePct: round(child.walkForwardPassRatePct - parent.walkForwardPassRatePct, 4),
    deltaTradeCount: child.oosTrades - parent.oosTrades,
    compositeImprovement: 0,
  };
  comparison.compositeImprovement = round(
    comparison.deltaOosMonthlyPct * 1.5 +
    comparison.deltaWorstStressMonthlyPct * 0.8 +
    comparison.deltaDrawdownImprovementPct * 0.25 +
    comparison.deltaWalkForwardPassRatePct * 0.02,
    4,
  );

  const reasons: string[] = [];
  const meaningful =
    comparison.deltaOosMonthlyPct >= 0.25 ||
    comparison.deltaWorstStressMonthlyPct >= 0.25 ||
    (comparison.deltaDrawdownImprovementPct >= 0.5 && comparison.deltaOosMonthlyPct >= -0.1) ||
    comparison.deltaWalkForwardPassRatePct >= 10;
  const ddLimit = Math.max(parent.oosMaxDrawdownPct + 2, parent.oosMaxDrawdownPct * 1.25);
  const safe =
    child.liquidationCount === 0 &&
    child.oosMonthlyPct >= parent.oosMonthlyPct - 0.5 &&
    child.worstStressMonthlyPct >= parent.worstStressMonthlyPct - 1 &&
    child.oosMaxDrawdownPct <= ddLimit &&
    child.oosTrades >= 12;

  if (!meaningful) reasons.push("親ロジックに対する有意な改善量が不足");
  if (comparison.compositeImprovement <= 0.15) reasons.push("OOS・Stress・DD・Walk-forwardの総合改善が不足");
  if (child.liquidationCount > 0) reasons.push("清算が発生");
  if (child.oosMonthlyPct < parent.oosMonthlyPct - 0.5) reasons.push("OOS月利が親より大幅に悪化");
  if (child.worstStressMonthlyPct < parent.worstStressMonthlyPct - 1) reasons.push("Cost Stressが親より大幅に悪化");
  if (child.oosMaxDrawdownPct > ddLimit) reasons.push("OOS MaxDDが許容範囲を超えて悪化");
  if (child.oosTrades < 12) reasons.push("OOS取引数が不足");

  const accepted = meaningful && safe && comparison.compositeImprovement > 0.15;
  if (accepted) reasons.push("親ロジックより再現性を保った改善を確認");
  return { comparison, accepted, reasons };
}

async function evaluateFully(
  genome: PerpStrategyGenome,
  data: PerpMarketData,
  config: PerpResearchConfig,
): Promise<PerpStrategyEvaluation> {
  const train = runPerpBacktest({
    genome,
    data,
    window: buildPerpValidationPlan(config).train,
    execution: config.baseExecution,
    targetMonthlyReturnPct: config.thresholds.targetAverageMonthlyReturnPct,
  });
  const validation = await validatePerpStrategy({ genome, train, data, config });
  return evaluatePerpStrategy({ genome, train, validation, thresholds: config.thresholds });
}

function sortEvaluations(items: PerpStrategyEvaluation[]) {
  const rank = { final_candidate: 3, survivor: 2, rejected: 1 } as const;
  return [...items].sort((left, right) => {
    if (left.verdict !== right.verdict) return rank[right.verdict] - rank[left.verdict];
    const leftMetrics = championMetricSnapshot(left);
    const rightMetrics = championMetricSnapshot(right);
    return (
      rightMetrics.oosMonthlyPct - leftMetrics.oosMonthlyPct ||
      rightMetrics.worstStressMonthlyPct - leftMetrics.worstStressMonthlyPct ||
      leftMetrics.oosMaxDrawdownPct - rightMetrics.oosMaxDrawdownPct ||
      right.score - left.score
    );
  });
}

function championSeedsFromEvaluations(evaluations: PerpStrategyEvaluation[], completedAt: string): ChampionRecord[] {
  const valid = evaluations.filter((item) => item.validation && item.train.risk.endingEquity > 0 && item.train.risk.liquidationCount === 0);
  if (!valid.length) return [];
  const selected = new Map<string, ChampionRecord>();
  const add = (slot: ChampionSlot, item?: PerpStrategyEvaluation) => {
    if (!item || selected.has(item.genome.id)) return;
    const metrics = championMetricSnapshot(item);
    selected.set(item.genome.id, {
      slot,
      genome: copyGenome(item.genome),
      metrics,
      rootCauses: diagnoseChampion(metrics),
      selectedAt: completedAt,
      noImprovementCycles: 0,
    });
  };
  add("oos", [...valid].sort((a, b) => championMetricSnapshot(b).oosMonthlyPct - championMetricSnapshot(a).oosMonthlyPct)[0]);
  add("stress", [...valid].sort((a, b) => championMetricSnapshot(b).worstStressMonthlyPct - championMetricSnapshot(a).worstStressMonthlyPct)[0]);
  add("stability", [...valid].sort((a, b) => {
    const left = championMetricSnapshot(a);
    const right = championMetricSnapshot(b);
    const leftScore = left.oosMonthlyPct - left.oosMaxDrawdownPct * 0.25 + left.walkForwardPassRatePct * 0.03;
    const rightScore = right.oosMonthlyPct - right.oosMaxDrawdownPct * 0.25 + right.walkForwardPassRatePct * 0.03;
    return rightScore - leftScore;
  })[0]);
  for (const item of sortEvaluations(valid)) {
    if (selected.size >= 3) break;
    add(selected.size === 0 ? "oos" : selected.size === 1 ? "stress" : "stability", item);
  }
  return [...selected.values()].slice(0, 3);
}

export function createEmptyChampionDeepState(): ChampionDeepResearchState {
  return {
    version: 1,
    cycle: 0,
    updatedAt: null,
    champions: [],
    latestExperiments: [],
    history: [],
    nextPlan: ["既存上位ロジックからOOS・Stress・安定性Championを選定する"],
  };
}

export function normalizeChampionDeepState(value: unknown): ChampionDeepResearchState {
  const fallback = createEmptyChampionDeepState();
  if (!value || typeof value !== "object") return fallback;
  const input = value as Partial<ChampionDeepResearchState>;
  return {
    version: 1,
    cycle: finite(input.cycle, 0),
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
    champions: Array.isArray(input.champions) ? input.champions.slice(0, 3) : [],
    latestExperiments: Array.isArray(input.latestExperiments) ? input.latestExperiments.slice(0, 12) : [],
    history: Array.isArray(input.history) ? input.history.slice(-MAX_HISTORY) : [],
    nextPlan: Array.isArray(input.nextPlan) ? input.nextPlan.filter((item): item is string => typeof item === "string") : fallback.nextPlan,
  };
}

function nextPlanFromExperiments(experiments: ChampionExperimentResult[], champions: ChampionRecord[]) {
  const accepted = experiments.filter((item) => item.accepted);
  const plan: string[] = [];
  for (const item of accepted) {
    plan.push(`${item.plan.championSlot} Championで${String(item.plan.changedParameter)}変更を継承し、別の単一変更を追加検証する`);
  }
  for (const champion of champions) {
    if (!accepted.some((item) => item.plan.championSlot === champion.slot)) {
      plan.push(`${champion.slot} Championは親を維持し、${champion.rootCauses.slice(0, 2).join("・") || "未特定原因"}を別仮説で再検証する`);
    }
  }
  return plan.slice(0, 6);
}

export async function runChampionDeepResearch(input: {
  cycle: number;
  previousState: ChampionDeepResearchState;
  previousResult: PerpResearchResult | null;
  fallbackGenomes: PerpStrategyGenome[];
  data: PerpMarketData;
  config: PerpResearchConfig;
  championCount?: number;
  experimentsPerChampion?: number;
  excludedLogicFingerprints?: Iterable<string>;
  evaluatedLogicFingerprints?: Set<string>;
  deduplicationStats?: PerpResearchDeduplicationStats;
}): Promise<ChampionDeepResearchResult> {
  const startedAt = new Date().toISOString();
  const championCount = Math.min(3, Math.max(1, input.championCount ?? 3));
  const experimentsPerChampion = Math.min(3, Math.max(1, input.experimentsPerChampion ?? 2));
  const stats = input.deduplicationStats ?? {
    duplicateStrategiesSkipped: 0,
    replacementCandidatesGenerated: 0,
    exhaustedPopulationSlots: 0,
  };
  const evaluatedFingerprints = input.evaluatedLogicFingerprints ?? new Set<string>();
  const blocked = new Set(input.excludedLogicFingerprints ?? []);

  let seedGenomes = input.previousState.champions.map((item) => copyGenome(item.genome));
  if (!seedGenomes.length && input.previousResult) {
    seedGenomes = championSeedsFromEvaluations(input.previousResult.leaderboard, input.previousResult.completedAt).map((item) => copyGenome(item.genome));
  }
  for (const genome of input.fallbackGenomes) {
    if (seedGenomes.length >= championCount) break;
    if (!seedGenomes.some((item) => perpStrategyLogicFingerprint(item) === perpStrategyLogicFingerprint(genome))) {
      seedGenomes.push(copyGenome(genome));
    }
  }
  if (seedGenomes.length < championCount) {
    const fresh = createInitialPerpPopulation(championCount * 3, input.config.seed, input.config.profile);
    for (const genome of fresh) {
      if (seedGenomes.length >= championCount) break;
      seedGenomes.push(copyGenome(genome));
    }
  }
  seedGenomes = seedGenomes.slice(0, championCount).map((genome, index) => ({
    ...copyGenome(genome),
    id: `deep-c${input.cycle}-baseline-${index + 1}`,
    parentIds: [genome.id],
  }));

  const baselineEvaluations = await Promise.all(seedGenomes.map((genome) => evaluateFully(genome, input.data, input.config)));
  let championsBefore = championSeedsFromEvaluations(baselineEvaluations, startedAt);
  if (championsBefore.length < championCount) {
    championsBefore = sortEvaluations(baselineEvaluations).slice(0, championCount).map((item, index) => {
      const metrics = championMetricSnapshot(item);
      return {
        slot: (index === 0 ? "oos" : index === 1 ? "stress" : "stability") as ChampionSlot,
        genome: copyGenome(item.genome),
        metrics,
        rootCauses: diagnoseChampion(metrics),
        selectedAt: startedAt,
        noImprovementCycles: 0,
      };
    });
  }

  const reserved = new Set<string>();
  const plans = championsBefore.flatMap((champion) => buildChampionExperimentPlans({
    champion,
    cycle: input.cycle,
    count: experimentsPerChampion,
    blockedFingerprints: blocked,
    reservedFingerprints: reserved,
    stats,
  }));
  stats.replacementCandidatesGenerated += Math.max(0, plans.length - championCount);

  const experimentEvaluations = await Promise.all(plans.map(async (plan) => {
    const evaluation = await evaluateFully(plan.childGenome, input.data, input.config);
    evaluatedFingerprints.add(perpStrategyLogicFingerprint(plan.childGenome));
    return evaluation;
  }));
  const evaluationById = new Map(experimentEvaluations.map((item) => [item.genome.id, item]));
  const baselineBySlot = new Map(championsBefore.map((item) => [item.slot, item]));
  const experiments: ChampionExperimentResult[] = plans.map((plan) => {
    const parent = baselineBySlot.get(plan.championSlot);
    const child = evaluationById.get(plan.childStrategyId);
    if (!parent || !child) throw new Error(`Deep experiment evidence missing: ${plan.id}`);
    const childMetrics = championMetricSnapshot(child);
    const decision = compareChampionExperiment(parent.metrics, childMetrics);
    return {
      plan,
      parentMetrics: parent.metrics,
      childMetrics,
      comparison: decision.comparison,
      accepted: decision.accepted,
      reasons: decision.reasons,
    };
  });

  const completedAt = new Date().toISOString();
  const championsAfter = championsBefore.map((parent) => {
    const accepted = experiments
      .filter((item) => item.plan.championSlot === parent.slot && item.accepted)
      .sort((left, right) => right.comparison.compositeImprovement - left.comparison.compositeImprovement)[0];
    if (!accepted) {
      return {
        ...parent,
        selectedAt: completedAt,
        noImprovementCycles: parent.noImprovementCycles + 1,
      };
    }
    const evaluation = evaluationById.get(accepted.plan.childStrategyId);
    if (!evaluation) return parent;
    return {
      slot: parent.slot,
      genome: copyGenome(evaluation.genome),
      metrics: accepted.childMetrics,
      rootCauses: diagnoseChampion(accepted.childMetrics),
      selectedAt: completedAt,
      noImprovementCycles: 0,
    };
  });

  const leaderboard = sortEvaluations([...baselineEvaluations, ...experimentEvaluations]);
  const researchResult: PerpResearchResult = {
    startedAt,
    completedAt,
    config: { ...input.config, rounds: 1, populationPerRound: leaderboard.length, finalistCount: leaderboard.length },
    rounds: [{
      round: 1,
      evaluated: leaderboard.length,
      survivors: leaderboard.filter((item) => item.verdict !== "rejected").length,
      best: leaderboard[0] ?? null,
    }],
    leaderboard,
    finalCandidates: leaderboard.filter((item) => item.verdict === "final_candidate"),
    totalEvaluations: leaderboard.length,
    validatedStrategies: leaderboard.length,
  };
  const nextPlan = nextPlanFromExperiments(experiments, championsAfter);
  const summary: ChampionDeepCycleSummary = {
    cycle: input.cycle,
    completedAt,
    profile: input.config.profile,
    champions: championsAfter.length,
    baselineEvaluations: baselineEvaluations.length,
    experiments: experiments.length,
    acceptedExperiments: experiments.filter((item) => item.accepted).length,
    retainedChampions: experiments.filter((item) => item.accepted).length,
    bestDeltaOosMonthlyPct: experiments.length ? Math.max(...experiments.map((item) => item.comparison.deltaOosMonthlyPct)) : 0,
    bestDeltaStressMonthlyPct: experiments.length ? Math.max(...experiments.map((item) => item.comparison.deltaWorstStressMonthlyPct)) : 0,
  };
  const state: ChampionDeepResearchState = {
    version: 1,
    cycle: input.cycle,
    updatedAt: completedAt,
    champions: championsAfter,
    latestExperiments: experiments,
    history: [...input.previousState.history, summary].slice(-MAX_HISTORY),
    nextPlan,
  };

  return {
    startedAt,
    completedAt,
    cycle: input.cycle,
    profile: input.config.profile,
    championsBefore,
    championsAfter,
    baselineEvaluations,
    experimentEvaluations,
    experiments,
    researchResult,
    state,
    nextPlan,
  };
}
