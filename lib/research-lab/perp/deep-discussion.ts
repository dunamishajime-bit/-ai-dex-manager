import type {
  ResearchDiscussionEvidence,
  ResearchDiscussionLog,
  ResearchDiscussionMessage,
} from "../discussion-types";
import { RESEARCHERS } from "../roles";
import type {
  ChampionDeepResearchResult,
  ChampionExperimentResult,
  ChampionMetricSnapshot,
  ChampionRecord,
  ChampionSlot,
} from "./deep-research";

function pct(value: number) {
  return `${value.toFixed(2)}%`;
}

function number(value: number, digits = 2) {
  return value.toFixed(digits);
}

function evidence(label: string, value: string, assessment: ResearchDiscussionEvidence["assessment"]): ResearchDiscussionEvidence {
  return { label, value, assessment };
}

function metricEvidence(metrics: ChampionMetricSnapshot): ResearchDiscussionEvidence[] {
  return [
    evidence("Train平均月利", pct(metrics.trainMonthlyPct), metrics.trainMonthlyPct >= 8 ? "positive" : "neutral"),
    evidence("OOS平均月利", pct(metrics.oosMonthlyPct), metrics.oosMonthlyPct >= 30 ? "positive" : "negative"),
    evidence("OOS MaxDD", pct(metrics.oosMaxDrawdownPct), metrics.oosMaxDrawdownPct <= 25 ? "positive" : "negative"),
    evidence("最悪Stress月利", pct(metrics.worstStressMonthlyPct), metrics.worstStressMonthlyPct >= 20 ? "positive" : "negative"),
    evidence("Walk-forward", pct(metrics.walkForwardPassRatePct), metrics.walkForwardPassRatePct >= 60 ? "positive" : "negative"),
    evidence("OOS取引数", String(metrics.oosTrades), metrics.oosTrades >= 20 ? "positive" : "negative"),
  ];
}

function message(input: Omit<ResearchDiscussionMessage, "id" | "sequence" | "createdAt"> & {
  sequence: number;
  baseTime: number;
}): ResearchDiscussionMessage {
  return {
    id: `m-${String(input.sequence).padStart(3, "0")}`,
    sequence: input.sequence,
    createdAt: new Date(input.baseTime + input.sequence * 1000).toISOString(),
    speakerId: input.speakerId,
    speakerName: input.speakerName,
    role: input.role,
    stance: input.stance,
    strategyId: input.strategyId,
    content: input.content,
    evidence: input.evidence,
  };
}

function researcherName(champion: ChampionRecord) {
  return RESEARCHERS.find((item) => item.id === champion.genome.createdBy)?.name ?? champion.genome.createdBy;
}

function experimentsFor(result: ChampionDeepResearchResult, champion: ChampionRecord) {
  return result.experiments.filter((item) => item.plan.championSlot === champion.slot);
}

function inheritedWinners(experiments: ChampionExperimentResult[]) {
  const winners = new Map<ChampionSlot, ChampionExperimentResult>();
  for (const experiment of experiments.filter((item) => item.accepted)) {
    const current = winners.get(experiment.plan.championSlot);
    if (!current || experiment.comparison.compositeImprovement > current.comparison.compositeImprovement) {
      winners.set(experiment.plan.championSlot, experiment);
    }
  }
  return winners;
}

function experimentSummary(experiments: ChampionExperimentResult[]) {
  if (!experiments.length) return "重複済みロジックを除外した結果、新しい単一変更案を生成できませんでした。";
  return experiments.map((item) => (
    `${item.plan.changedParameter}: ${String(item.plan.beforeValue)}→${String(item.plan.afterValue)}（${item.plan.hypothesis}）`
  )).join(" / ");
}

function comparisonEvidence(item: ChampionExperimentResult): ResearchDiscussionEvidence[] {
  return [
    evidence("OOS月利差", `${item.comparison.deltaOosMonthlyPct >= 0 ? "+" : ""}${pct(item.comparison.deltaOosMonthlyPct)}`, item.comparison.deltaOosMonthlyPct > 0 ? "positive" : "negative"),
    evidence("Stress月利差", `${item.comparison.deltaWorstStressMonthlyPct >= 0 ? "+" : ""}${pct(item.comparison.deltaWorstStressMonthlyPct)}`, item.comparison.deltaWorstStressMonthlyPct > 0 ? "positive" : "negative"),
    evidence("DD改善量", `${item.comparison.deltaDrawdownImprovementPct >= 0 ? "+" : ""}${pct(item.comparison.deltaDrawdownImprovementPct)}`, item.comparison.deltaDrawdownImprovementPct > 0 ? "positive" : "negative"),
    evidence("Walk-forward差", `${item.comparison.deltaWalkForwardPassRatePct >= 0 ? "+" : ""}${pct(item.comparison.deltaWalkForwardPassRatePct)}`, item.comparison.deltaWalkForwardPassRatePct > 0 ? "positive" : "negative"),
    evidence("総合改善Score", number(item.comparison.compositeImprovement, 3), item.accepted ? "positive" : "negative"),
  ];
}

export function buildChampionDeepDiscussion(result: ChampionDeepResearchResult): ResearchDiscussionLog {
  const baseTime = Date.parse(result.startedAt);
  const messages: ResearchDiscussionMessage[] = [];
  let sequence = 1;
  const passingCount = result.experiments.filter((item) => item.accepted).length;
  const winners = inheritedWinners(result.experiments);
  const inheritedCount = winners.size;

  messages.push(message({
    sequence: sequence++,
    baseTime,
    speakerId: "research-moderator",
    speakerName: "Research Moderator",
    role: "moderator",
    stance: "context",
    strategyId: null,
    content: `Champion Deep Research Cycle ${result.cycle}を開始します。新規ロジックの大量生成は行わず、OOS・Stress・安定性の3 Championを親として再評価し、各Championに最大2件の単一パラメータ変更だけを検証します。同じChampionで複数案が改善基準を通っても、総合改善Scoreが最も高い子1件だけを継承します。`,
    evidence: [
      evidence("Champion数", String(result.championsBefore.length), "positive"),
      evidence("親の再評価", String(result.baselineEvaluations.length), "positive"),
      evidence("単一変更実験", String(result.experiments.length), "positive"),
    ],
  }));

  for (const champion of result.championsBefore) {
    const experiments = experimentsFor(result, champion);
    messages.push(message({
      sequence: sequence++,
      baseTime,
      speakerId: champion.genome.createdBy,
      speakerName: researcherName(champion),
      role: "researcher",
      stance: "proposal",
      strategyId: champion.genome.id,
      content: `${champion.slot.toUpperCase()} Champion ${champion.genome.id}を深掘りします。根本原因は${champion.rootCauses.join("・") || "明確な失敗なし"}です。今回の仮説は ${experimentSummary(experiments)}。複数パラメータを同時に動かさず、何が効いたかを親子比較で特定します。`,
      evidence: metricEvidence(champion.metrics),
    }));

    messages.push(message({
      sequence: sequence++,
      baseTime,
      speakerId: "overfit-critic",
      speakerName: "AI反対派 / Overfit",
      role: "overfit_critic",
      stance: "challenge",
      strategyId: champion.genome.id,
      content: `Train月利${pct(champion.metrics.trainMonthlyPct)}に対しOOS月利${pct(champion.metrics.oosMonthlyPct)}、OOS維持率${pct(champion.metrics.oosRetentionPct)}、Walk-forward${pct(champion.metrics.walkForwardPassRatePct)}です。子ロジックはTrainの上昇ではなく、親に対するOOS・Walk-forwardの実改善で判断してください。`,
      evidence: [
        evidence("OOS維持率", pct(champion.metrics.oosRetentionPct), champion.metrics.oosRetentionPct >= 50 ? "positive" : "negative"),
        evidence("Walk-forward", pct(champion.metrics.walkForwardPassRatePct), champion.metrics.walkForwardPassRatePct >= 60 ? "positive" : "negative"),
        evidence("変更パラメータ数/実験", "1", "positive"),
      ],
    }));

    messages.push(message({
      sequence: sequence++,
      baseTime,
      speakerId: "tail-risk-critic",
      speakerName: "AI反対派 / Tail Risk",
      role: "tail_risk_critic",
      stance: "challenge",
      strategyId: champion.genome.id,
      content: `親のOOS MaxDDは${pct(champion.metrics.oosMaxDrawdownPct)}、清算${champion.metrics.liquidationCount}件、最大連敗${champion.metrics.maxConsecutiveLosses}回、最悪Stress月利${pct(champion.metrics.worstStressMonthlyPct)}です。月利改善と引き換えにDD・清算・Stressが悪化する子は拒否します。`,
      evidence: [
        evidence("OOS MaxDD", pct(champion.metrics.oosMaxDrawdownPct), champion.metrics.oosMaxDrawdownPct <= 25 ? "positive" : "negative"),
        evidence("清算", `${champion.metrics.liquidationCount}件`, champion.metrics.liquidationCount === 0 ? "positive" : "negative"),
        evidence("最悪Stress月利", pct(champion.metrics.worstStressMonthlyPct), champion.metrics.worstStressMonthlyPct >= 20 ? "positive" : "negative"),
      ],
    }));

    messages.push(message({
      sequence: sequence++,
      baseTime,
      speakerId: "execution-critic",
      speakerName: "AI反対派 / Execution",
      role: "execution_critic",
      stance: "challenge",
      strategyId: champion.genome.id,
      content: `親のOOS取引数${champion.metrics.oosTrades}、PF ${number(champion.metrics.profitFactor)}、Funding合計${number(champion.metrics.totalFundingCost, 4)}、平均実効レバレッジ${number(champion.metrics.averageEffectiveLeverage)}倍です。単に取引数を消して見かけのStressを改善した子や、12取引未満の子は拒否します。`,
      evidence: [
        evidence("OOS取引数", String(champion.metrics.oosTrades), champion.metrics.oosTrades >= 20 ? "positive" : "negative"),
        evidence("Profit Factor", number(champion.metrics.profitFactor), champion.metrics.profitFactor >= 1.2 ? "positive" : "negative"),
        evidence("Funding合計", number(champion.metrics.totalFundingCost, 4), "neutral"),
      ],
    }));

    const inherited = winners.get(champion.slot);
    const best = inherited ?? [...experiments].sort((left, right) => right.comparison.compositeImprovement - left.comparison.compositeImprovement)[0];
    messages.push(message({
      sequence: sequence++,
      baseTime,
      speakerId: "research-cio",
      speakerName: "Research CIO",
      role: "cio",
      stance: "decision",
      strategyId: best?.plan.childStrategyId ?? champion.genome.id,
      content: inherited
        ? `${champion.slot.toUpperCase()} Championでは${String(inherited.plan.changedParameter)}の単一変更を継承採用します。OOS差${inherited.comparison.deltaOosMonthlyPct >= 0 ? "+" : ""}${pct(inherited.comparison.deltaOosMonthlyPct)}、Stress差${inherited.comparison.deltaWorstStressMonthlyPct >= 0 ? "+" : ""}${pct(inherited.comparison.deltaWorstStressMonthlyPct)}、DD改善${inherited.comparison.deltaDrawdownImprovementPct >= 0 ? "+" : ""}${pct(inherited.comparison.deltaDrawdownImprovementPct)}。同じChampion内で他案も基準を通った場合でも、この最上位子だけを次Cycleの親にします。`
        : `${champion.slot.toUpperCase()} Championの子は継承しません。親${champion.genome.id}を維持します。${best ? best.reasons.join(" / ") : "新しい重複なし仮説を生成できませんでした。"}`,
      evidence: best ? comparisonEvidence(best) : metricEvidence(champion.metrics),
    }));
  }

  messages.push(message({
    sequence: sequence++,
    baseTime,
    speakerId: "research-cio",
    speakerName: "Research CIO",
    role: "cio",
    stance: "decision",
    strategyId: null,
    content: `Cycle ${result.cycle}は${result.experiments.length}件の単一変更を親子比較し、${passingCount}件が改善基準を通過、Championごとの最上位${inheritedCount}件を次の親として継承しました。残りのChampionは親を維持します。目標30%に届かなくても、親より再現性を保って改善した変更だけを累積し、改善履歴が追跡できない広範囲変異は行いません。次回方針: ${result.nextPlan.join(" / ")}`,
    evidence: [
      evidence("単一変更実験", String(result.experiments.length), "positive"),
      evidence("改善基準通過", String(passingCount), passingCount ? "positive" : "neutral"),
      evidence("継承採用", String(inheritedCount), inheritedCount ? "positive" : "neutral"),
      evidence("親維持", String(result.championsAfter.length - inheritedCount), "neutral"),
      evidence("最終候補", String(result.researchResult.finalCandidates.length), result.researchResult.finalCandidates.length ? "positive" : "neutral"),
    ],
  }));

  const bestOos = Math.max(...result.championsAfter.map((item) => item.metrics.oosMonthlyPct));
  const bestStress = Math.max(...result.championsAfter.map((item) => item.metrics.worstStressMonthlyPct));
  const bestDdChampion = [...result.championsAfter].sort((left, right) => left.metrics.oosMaxDrawdownPct - right.metrics.oosMaxDrawdownPct)[0];
  const topIds = result.championsAfter.map((item) => item.genome.id);
  return {
    version: 1,
    id: `cycle-${String(result.cycle).padStart(6, "0")}-${result.completedAt.replace(/[:.]/g, "-")}`,
    cycle: result.cycle,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    profile: result.profile,
    title: `Cycle ${result.cycle} Champion深掘り会議`,
    summary: `3 Championを親として${result.experiments.length}件の単一変更を比較し、${passingCount}件が改善基準を通過、最上位${inheritedCount}件を継承。Best OOS月利${pct(bestOos)}、Best Stress月利${pct(bestStress)}。`,
    decision: inheritedCount
      ? `${inheritedCount}件の最上位改善子を次Cycleの親として継承し、残りは親ロジックを維持する。`
      : "全ての子を却下し、3 Championの親ロジックを維持して別仮説を再検証する。",
    methodology: "新規ロジックの大量生成ではなく、OOS・Cost Stress・安定性で選んだ上位3 Championを毎回同条件で再評価する。各実験は1パラメータだけを変更し、親とのOOS・Stress・MaxDD・Walk-forward・取引数差を比較する。改善基準を通過した案が複数あっても、各Championで総合改善Scoreが最も高い子1件だけを次Cycleへ継承する決定論的なEvidence付き研究会議です。",
    finalCandidates: result.researchResult.finalCandidates.length,
    bestTrainMonthlyPct: Math.max(...result.championsAfter.map((item) => item.metrics.trainMonthlyPct)),
    bestOosMonthlyPct: bestOos,
    bestOosDrawdownPct: bestDdChampion?.metrics.oosMaxDrawdownPct ?? null,
    bestWorstStressMonthlyPct: bestStress,
    topStrategyIds: topIds,
    messages,
  };
}
