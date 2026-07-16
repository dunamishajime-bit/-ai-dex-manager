import type {
  ResearchDiscussionEvidence,
  ResearchDiscussionIndexEntry,
  ResearchDiscussionLog,
  ResearchDiscussionMessage,
  ResearchDiscussionSpeakerRole,
  ResearchDiscussionStance,
} from "../discussion-types";
import { CRITICS, RESEARCHERS } from "../roles";
import type { AutonomousCycleSummary, AutonomousFailureProfile } from "./autonomous";
import type { PerpResearchResult, PerpStrategyEvaluation } from "./types";

const METHODOLOGY =
  "外部LLM同士の自由会話ではなく、Researcher・3種類のCritic・CIOという役割が、同一Cycleの実測バックテスト、OOS、Walk-forward、Cost Stress、不合格理由を根拠に発言する決定論的な議論ログです。数値のない主張は採用判断に使用しません。";

function finiteOrNull(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pct(value: number | null | undefined) {
  const normalized = finiteOrNull(value);
  return normalized == null ? "未検証" : `${normalized.toFixed(2)}%`;
}

function number(value: number | null | undefined, digits = 2) {
  const normalized = finiteOrNull(value);
  return normalized == null ? "未検証" : normalized.toFixed(digits);
}

function worstStressMonthly(item: PerpStrategyEvaluation) {
  const values = item.validation?.stress
    .map((stress) => finiteOrNull(stress.result.metrics.averageMonthlyReturnPct))
    .filter((value): value is number => value != null) ?? [];
  return values.length ? Math.min(...values) : null;
}

function allReasons(item: PerpStrategyEvaluation) {
  return [
    ...item.reasons,
    ...(item.validation?.finalGateReasons ?? []),
    ...(item.validation?.walkForward.flatMap((fold) => fold.reasons.map((reason) => `${fold.label}: ${reason}`)) ?? []),
    ...(item.validation?.stress.flatMap((stress) => stress.reasons.map((reason) => `${stress.label}: ${reason}`)) ?? []),
  ].filter(Boolean);
}

function evidence(
  label: string,
  value: string,
  assessment: ResearchDiscussionEvidence["assessment"],
): ResearchDiscussionEvidence {
  return { label, value, assessment };
}

function researcherName(item: PerpStrategyEvaluation) {
  return RESEARCHERS.find((profile) => profile.id === item.genome.createdBy)?.name ?? item.genome.createdBy;
}

function criticName(role: ResearchDiscussionSpeakerRole) {
  if (role === "overfit_critic") return CRITICS.find((critic) => critic.id === "overfit-critic")?.name ?? "AI反対派 / Overfit";
  if (role === "tail_risk_critic") return CRITICS.find((critic) => critic.id === "tail-risk-critic")?.name ?? "AI反対派 / Tail Risk";
  if (role === "execution_critic") return CRITICS.find((critic) => critic.id === "execution-critic")?.name ?? "AI反対派 / Execution";
  return role;
}

function timedAt(startedAt: string, sequence: number) {
  const base = Date.parse(startedAt);
  if (!Number.isFinite(base)) return startedAt;
  return new Date(base + sequence * 1_000).toISOString();
}

function message(input: {
  sequence: number;
  startedAt: string;
  speakerId: string;
  speakerName: string;
  role: ResearchDiscussionSpeakerRole;
  stance: ResearchDiscussionStance;
  strategyId?: string | null;
  content: string;
  evidence?: ResearchDiscussionEvidence[];
}): ResearchDiscussionMessage {
  return {
    id: `m-${String(input.sequence).padStart(3, "0")}`,
    sequence: input.sequence,
    createdAt: timedAt(input.startedAt, input.sequence),
    speakerId: input.speakerId,
    speakerName: input.speakerName,
    role: input.role,
    stance: input.stance,
    strategyId: input.strategyId ?? null,
    content: input.content,
    evidence: input.evidence ?? [],
  };
}

function overfitCritique(item: PerpStrategyEvaluation) {
  const train = item.train.metrics;
  const validation = item.validation;
  if (!validation) {
    return {
      content: `この戦略はTrain探索では上位ですが、OOS・Walk-forward・Stressへ進んでいません。Train月利${pct(train.averageMonthlyReturnPct)}を再現可能な成績として扱うことには反対します。不合格理由: ${allReasons(item).join(" / ") || "最終検証対象外"}`,
      evidence: [
        evidence("Train平均月利", pct(train.averageMonthlyReturnPct), "neutral"),
        evidence("Train取引数", String(train.tradeCount), train.tradeCount >= 30 ? "positive" : "negative"),
        evidence("OOS", "未検証", "negative"),
      ],
    };
  }
  const retention = validation.oosReturnRetentionRatio * 100;
  const reasons = validation.finalGateReasons.length ? validation.finalGateReasons.join(" / ") : "Gate理由なし";
  return {
    content: `Train平均月利${pct(train.averageMonthlyReturnPct)}に対しOOS平均月利は${pct(validation.oos.metrics.averageMonthlyReturnPct)}、収益維持率は${pct(retention)}です。Walk-forward通過率は${pct(validation.walkForwardPassRatePct)}。期間依存と過学習を否定できるかを重視します。最終Gate: ${reasons}`,
    evidence: [
      evidence("Train平均月利", pct(train.averageMonthlyReturnPct), "neutral"),
      evidence("OOS平均月利", pct(validation.oos.metrics.averageMonthlyReturnPct), validation.oos.metrics.averageMonthlyReturnPct >= 30 ? "positive" : "negative"),
      evidence("OOS維持率", pct(retention), retention >= 60 ? "positive" : "negative"),
      evidence("Walk-forward", pct(validation.walkForwardPassRatePct), validation.walkForwardPassRatePct >= 60 ? "positive" : "negative"),
      evidence("OOS取引数", String(validation.oos.metrics.tradeCount), validation.oos.metrics.tradeCount >= 20 ? "positive" : "negative"),
    ],
  };
}

function tailRiskCritique(item: PerpStrategyEvaluation) {
  const validation = item.validation;
  const risk = validation?.oos.risk ?? item.train.risk;
  const metrics = validation?.oos.metrics ?? item.train.metrics;
  const stressMonthly = worstStressMonthly(item);
  const stressReasons = validation?.stress.flatMap((stress) => stress.reasons.map((reason) => `${stress.label}: ${reason}`)) ?? [];
  const content = [
    `最大DDは${pct(metrics.maxDrawdownPct)}、清算${risk.liquidationCount}件、最大連敗${risk.maxConsecutiveLosses}回です。`,
    `最悪Cost Stress月利は${pct(stressMonthly)}。`,
    stressReasons.length ? `Stress指摘: ${stressReasons.join(" / ")}` : "Stress指摘はありません。",
    risk.liquidationCount > 0 ? "清算が1件でもあるため採用に反対します。" : "清算0は維持されています。",
  ].join(" ");
  return {
    content,
    evidence: [
      evidence("OOS/Train MaxDD", pct(metrics.maxDrawdownPct), metrics.maxDrawdownPct <= 25 ? "positive" : "negative"),
      evidence("清算", `${risk.liquidationCount}件`, risk.liquidationCount === 0 ? "positive" : "negative"),
      evidence("最大連敗", `${risk.maxConsecutiveLosses}回`, risk.maxConsecutiveLosses <= 8 ? "positive" : "negative"),
      evidence("最悪Stress月利", pct(stressMonthly), stressMonthly != null && stressMonthly >= 20 ? "positive" : "negative"),
    ],
  };
}

function executionCritique(item: PerpStrategyEvaluation) {
  const validation = item.validation;
  const result = validation?.oos ?? item.train;
  const stressMonthly = worstStressMonthly(item);
  const parameters = item.genome.parameters;
  const costReasons = allReasons(item).filter((reason) => {
    const normalized = reason.toLowerCase();
    return normalized.includes("cost") || normalized.includes("stress") || normalized.includes("pf") || normalized.includes("funding");
  });
  return {
    content: `利益率だけでなく実運用再現性を確認します。Profit Factor ${number(result.metrics.profitFactor)}、取引数${result.metrics.tradeCount}、平均実効レバレッジ${number(result.risk.averageEffectiveLeverage)}倍、Funding合計${number(result.risk.totalFundingCost, 4)}、最小Edge/Cost比${number(parameters.minimumEdgeToCostRatio)}です。最悪Stress月利${pct(stressMonthly)}。${costReasons.length ? `コスト指摘: ${costReasons.join(" / ")}` : "追加のコスト指摘はありません。"}`,
    evidence: [
      evidence("Profit Factor", number(result.metrics.profitFactor), result.metrics.profitFactor >= 1.25 ? "positive" : "negative"),
      evidence("取引数", String(result.metrics.tradeCount), result.metrics.tradeCount >= 20 ? "positive" : "negative"),
      evidence("平均実効レバレッジ", `${number(result.risk.averageEffectiveLeverage)}x`, result.risk.averageEffectiveLeverage <= 4 ? "positive" : "negative"),
      evidence("Edge / Cost", number(parameters.minimumEdgeToCostRatio), parameters.minimumEdgeToCostRatio >= 3 ? "positive" : "negative"),
      evidence("Funding合計", number(result.risk.totalFundingCost, 4), "neutral"),
    ],
  };
}

function failureHighlights(failures: AutonomousFailureProfile) {
  const labels: Array<[keyof AutonomousFailureProfile, string]> = [
    ["lowReturn", "月利不足"],
    ["costFragility", "コスト耐性不足"],
    ["oosDecay", "OOS劣化"],
    ["walkForward", "Walk-forward不安定"],
    ["drawdown", "DD超過"],
    ["directionBias", "Long/Short偏り"],
    ["lowSample", "取引数不足"],
    ["liquidation", "清算"],
    ["executionFailure", "実行失敗"],
  ];
  return labels
    .map(([key, label]) => ({ label, count: failures[key] }))
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count);
}

function discussionSummary(summary: AutonomousCycleSummary, top: PerpStrategyEvaluation | undefined, failures: AutonomousFailureProfile) {
  const topFailure = failureHighlights(failures)[0];
  if (!top) return `Cycle ${summary.cycle}は評価対象を生成できず、CIO判断は採用見送りです。`;
  const oos = top.validation?.oos.metrics.averageMonthlyReturnPct ?? null;
  const status = summary.finalCandidates > 0 ? `${summary.finalCandidates}件をForward Paper候補へ昇格` : "最終候補なし";
  return `Cycle ${summary.cycle}の最有力は${top.genome.id}（${top.genome.family}）。Train月利${pct(top.train.metrics.averageMonthlyReturnPct)}、OOS月利${pct(oos)}で、${status}。${topFailure ? `最多の反対理由は${topFailure.label}（${topFailure.count}件）です。` : "重大な反対理由は集計されませんでした。"}`;
}

export function buildResearchDiscussion(input: {
  result: PerpResearchResult;
  summary: AutonomousCycleSummary;
  failures: AutonomousFailureProfile;
  nextPlan: string[];
}): ResearchDiscussionLog {
  const selected = [
    ...input.result.leaderboard.filter((item) => item.validation),
    ...input.result.leaderboard,
  ].filter((item, index, array) => array.findIndex((candidate) => candidate.genome.id === item.genome.id) === index)
    .slice(0, 3);
  const top = selected[0];
  const id = `cycle-${String(input.summary.cycle).padStart(6, "0")}-${input.result.completedAt.replace(/[:.]/g, "-")}`;
  const messages: ResearchDiscussionMessage[] = [];
  let sequence = 1;

  messages.push(message({
    sequence: sequence++,
    startedAt: input.result.startedAt,
    speakerId: "research-moderator",
    speakerName: "Research Moderator",
    role: "moderator",
    stance: "context",
    content: `Cycle ${input.summary.cycle}の研究会議を開始します。Profile=${input.summary.profile}、評価${input.summary.evaluations}件、OOS検証${input.summary.validated}件、最終候補${input.summary.finalCandidates}件です。数値証拠のない主張はCIO判断から除外します。`,
    evidence: [
      evidence("評価数", String(input.summary.evaluations), "neutral"),
      evidence("OOS検証数", String(input.summary.validated), input.summary.validated > 0 ? "positive" : "negative"),
      evidence("最終候補", String(input.summary.finalCandidates), input.summary.finalCandidates > 0 ? "positive" : "neutral"),
    ],
  }));

  for (const item of selected) {
    const oos = item.validation?.oos;
    messages.push(message({
      sequence: sequence++,
      startedAt: input.result.startedAt,
      speakerId: item.genome.createdBy,
      speakerName: researcherName(item),
      role: "researcher",
      stance: "proposal",
      strategyId: item.genome.id,
      content: `${item.genome.id}を提案します。仮説は「${item.genome.thesis}」。対象は${item.genome.symbols.join(", ")}、${item.genome.parameters.timeframeHours}時間足、レバレッジ${item.genome.parameters.leverage.toFixed(2)}倍、1取引リスク${item.genome.parameters.riskPerTradePct.toFixed(2)}%。TrainだけでなくOOSとStressを前提に評価してください。現在の判定は${item.verdict}、Score=${item.score.toFixed(2)}です。`,
      evidence: [
        evidence("Train平均月利", pct(item.train.metrics.averageMonthlyReturnPct), item.train.metrics.averageMonthlyReturnPct >= 30 ? "positive" : "neutral"),
        evidence("Train MaxDD", pct(item.train.metrics.maxDrawdownPct), item.train.metrics.maxDrawdownPct <= 25 ? "positive" : "negative"),
        evidence("OOS平均月利", pct(oos?.metrics.averageMonthlyReturnPct), oos && oos.metrics.averageMonthlyReturnPct >= 30 ? "positive" : oos ? "negative" : "neutral"),
        evidence("Score", item.score.toFixed(2), item.score >= 70 ? "positive" : "neutral"),
      ],
    }));

    const overfit = overfitCritique(item);
    messages.push(message({
      sequence: sequence++,
      startedAt: input.result.startedAt,
      speakerId: "overfit-critic",
      speakerName: criticName("overfit_critic"),
      role: "overfit_critic",
      stance: "challenge",
      strategyId: item.genome.id,
      ...overfit,
    }));

    const tailRisk = tailRiskCritique(item);
    messages.push(message({
      sequence: sequence++,
      startedAt: input.result.startedAt,
      speakerId: "tail-risk-critic",
      speakerName: criticName("tail_risk_critic"),
      role: "tail_risk_critic",
      stance: "challenge",
      strategyId: item.genome.id,
      ...tailRisk,
    }));

    const execution = executionCritique(item);
    messages.push(message({
      sequence: sequence++,
      startedAt: input.result.startedAt,
      speakerId: "execution-critic",
      speakerName: criticName("execution_critic"),
      role: "execution_critic",
      stance: "challenge",
      strategyId: item.genome.id,
      ...execution,
    }));
  }

  const highlights = failureHighlights(input.failures);
  const decision = input.summary.finalCandidates > 0
    ? `${input.summary.finalCandidates}件をForward Paper候補として承認。実売買への接続は行わない。`
    : "全戦略を実売買・Forward Paper候補への昇格見送り。改善後に新しいロジックとして再検証する。";
  messages.push(message({
    sequence: sequence++,
    startedAt: input.result.startedAt,
    speakerId: "research-cio",
    speakerName: "Research CIO",
    role: "cio",
    stance: "decision",
    content: `${decision} 主な反対理由は${highlights.length ? highlights.map((item) => `${item.label}${item.count}件`).join("、") : "なし"}。次Cycleの改善方針は「${input.nextPlan.join("」「") || "現行Eliteを再交配"}」です。`,
    evidence: [
      evidence("最終候補", String(input.summary.finalCandidates), input.summary.finalCandidates > 0 ? "positive" : "neutral"),
      evidence("Best OOS月利", pct(input.summary.bestOosMonthlyPct), (input.summary.bestOosMonthlyPct ?? -Infinity) >= 30 ? "positive" : "negative"),
      evidence("Best OOS MaxDD", pct(input.summary.bestOosDrawdownPct), (input.summary.bestOosDrawdownPct ?? Infinity) <= 25 ? "positive" : "negative"),
      evidence("Worst Stress月利", pct(input.summary.bestWorstStressMonthlyPct), (input.summary.bestWorstStressMonthlyPct ?? -Infinity) >= 20 ? "positive" : "negative"),
    ],
  }));

  return {
    version: 1,
    id,
    cycle: input.summary.cycle,
    startedAt: input.result.startedAt,
    completedAt: input.result.completedAt,
    profile: input.summary.profile,
    title: `Cycle ${input.summary.cycle} 研究会議`,
    summary: discussionSummary(input.summary, top, input.failures),
    decision,
    methodology: METHODOLOGY,
    finalCandidates: input.summary.finalCandidates,
    bestTrainMonthlyPct: finiteOrNull(input.summary.bestTrainMonthlyPct),
    bestOosMonthlyPct: finiteOrNull(input.summary.bestOosMonthlyPct),
    bestOosDrawdownPct: finiteOrNull(input.summary.bestOosDrawdownPct),
    bestWorstStressMonthlyPct: finiteOrNull(input.summary.bestWorstStressMonthlyPct),
    topStrategyIds: selected.map((item) => item.genome.id),
    messages,
  };
}

export function discussionIndexEntry(log: ResearchDiscussionLog, path: string): ResearchDiscussionIndexEntry {
  return {
    id: log.id,
    path,
    cycle: log.cycle,
    completedAt: log.completedAt,
    profile: log.profile,
    title: log.title,
    summary: log.summary,
    decision: log.decision,
    messageCount: log.messages.length,
    finalCandidates: log.finalCandidates,
    bestOosMonthlyPct: log.bestOosMonthlyPct,
    bestOosDrawdownPct: log.bestOosDrawdownPct,
    bestWorstStressMonthlyPct: log.bestWorstStressMonthlyPct,
    topStrategyIds: log.topStrategyIds,
  };
}
