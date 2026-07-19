import { createHash } from "node:crypto";

import type {
  MainStrategySnapshotReplayArtifact,
  MainStrategySnapshotReplayEvent,
} from "./main-strategy-snapshot-replay";
import type {
  ResearchDiscussionEvidence,
  ResearchDiscussionLog,
  ResearchDiscussionMessage,
  ResearchDiscussionSpeakerRole,
  ResearchDiscussionStance,
} from "../discussion-types";
import { WIN80_ULTRA90_MAIN_STRATEGY } from "@/lib/win80-ultra90-main-strategy";

export const MULTI_AGENT_RESEARCH_PIPELINE_VERSION = 1 as const;

type AgentRole = Extract<
  ResearchDiscussionSpeakerRole,
  "win80_specialist" | "ultra90_specialist" | "synthesis" | "independent_critic" | "cio"
>;

export interface MultiAgentMetrics {
  sampleCount: number;
  winRate72hPct: number | null;
  average72hPct: number | null;
  profitFactor72h: number | null;
  stressAverage72hPct: number | null;
  maxDrawdownPct: number | null;
  worst72hPct: number | null;
  compoundedReturnPct: number | null;
}

export interface MultiAgentSplitMetrics {
  development: MultiAgentMetrics;
  validation: MultiAgentMetrics;
  holdout: MultiAgentMetrics;
  all: MultiAgentMetrics;
}

export interface MultiAgentCandidateReport {
  id: string;
  role: Exclude<AgentRole, "cio">;
  name: string;
  thesis: string;
  filterSummary: string;
  symbols: string[];
  eventCount: number;
  splitMetrics: MultiAgentSplitMetrics;
  status: "FORWARD_PAPER_REQUIRED" | "REPLAY_REQUIRED";
  pass: boolean;
  rejectionReasons: string[];
  evidenceFingerprint: string;
}

export interface MultiAgentResearchReport {
  version: typeof MULTI_AGENT_RESEARCH_PIPELINE_VERSION;
  generatedAt: string;
  cycle: number;
  parentStrategyId: string;
  datasetId: string;
  datasetFingerprint: string;
  protocol: {
    developmentPct: number;
    validationPct: number;
    holdoutPct: number;
    costsIncluded: boolean;
    futureOutcomeUsedAsFilter: false;
    minimumHoldoutSamples: number;
  };
  baseline: MultiAgentSplitMetrics;
  proposals: MultiAgentCandidateReport[];
  selectedCandidateId: string | null;
  decision: "KEEP_BASELINE" | "FORWARD_PAPER_ONLY";
  automaticPromotionToMain: false;
  previousDiscussionId: string | null;
  previousDecision: string | null;
  nextCycleRequirements: string[];
}

interface CandidateDefinition {
  id: string;
  role: Exclude<AgentRole, "cio">;
  name: string;
  thesis: string;
  filterSummary: string;
  filter: (event: MainStrategySnapshotReplayEvent) => boolean;
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function metric(values: MainStrategySnapshotReplayEvent[]): MultiAgentMetrics {
  if (!values.length) {
    return {
      sampleCount: 0,
      winRate72hPct: null,
      average72hPct: null,
      profitFactor72h: null,
      stressAverage72hPct: null,
      maxDrawdownPct: null,
      worst72hPct: null,
      compoundedReturnPct: null,
    };
  }

  const returns = values.map((event) => event.forward72hPct);
  const stress = values.map((event) => event.stress72hPct);
  const wins = returns.filter((value) => value > 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  const gains = wins.reduce((sum, value) => sum + value, 0);
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const value of returns) {
    equity *= Math.max(0.01, 1 + value / 100);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, (equity / peak - 1) * 100);
  }

  return {
    sampleCount: values.length,
    winRate72hPct: round((wins.length / values.length) * 100),
    average72hPct: round(returns.reduce((sum, value) => sum + value, 0) / values.length),
    profitFactor72h: losses > 0 ? round(gains / losses, 3) : gains > 0 ? 999 : null,
    stressAverage72hPct: round(stress.reduce((sum, value) => sum + value, 0) / stress.length),
    maxDrawdownPct: round(maxDrawdown),
    worst72hPct: round(Math.min(...returns)),
    compoundedReturnPct: round((equity - 1) * 100),
  };
}

function splitMetrics(events: MainStrategySnapshotReplayEvent[]): MultiAgentSplitMetrics {
  const ordered = [...events].sort((left, right) => left.snapshotTs - right.snapshotTs);
  const first = Math.floor(ordered.length * 0.6);
  const second = Math.floor(ordered.length * 0.8);
  return {
    development: metric(ordered.slice(0, first)),
    validation: metric(ordered.slice(first, second)),
    holdout: metric(ordered.slice(second)),
    all: metric(ordered),
  };
}

function evidence(label: string, value: string, assessment: ResearchDiscussionEvidence["assessment"]): ResearchDiscussionEvidence {
  return { label, value, assessment };
}

function message(input: {
  sequence: number;
  startedAt: string;
  speakerId: string;
  speakerName: string;
  role: AgentRole;
  stance: ResearchDiscussionStance;
  strategyId: string | null;
  content: string;
  evidence: ResearchDiscussionEvidence[];
}): ResearchDiscussionMessage {
  const started = Date.parse(input.startedAt);
  return {
    id: `multi-agent-${String(input.sequence).padStart(3, "0")}`,
    sequence: input.sequence,
    createdAt: Number.isFinite(started)
      ? new Date(started + input.sequence * 1_000).toISOString()
      : input.startedAt,
    speakerId: input.speakerId,
    speakerName: input.speakerName,
    role: input.role,
    stance: input.stance,
    strategyId: input.strategyId,
    content: input.content,
    evidence: input.evidence,
  };
}

function candidateDefinitions(cycle: number): CandidateDefinition[] {
  const version = (Math.max(1, cycle) % 3) + 1;
  return [
    {
      id: `WIN80_SPECIALIST_CHILD_V${version}`,
      role: "win80_specialist",
      name: "WIN80専門AI",
      thesis: "WIN80のScore直上シグナルを減らし、Trigger・RR・Volumeを同時に高めてコスト後期待値を検証する。",
      filterSummary: "tier=WIN80, Score>=82, Trigger>=80%, RR>=1.25, Volume>=0.80",
      filter: (event) => event.tier === "WIN80" && event.score >= 82 && event.triggerProgressPct >= 80 && event.rr >= 1.25 && event.volumeRatio >= 0.8,
    },
    {
      id: `ULTRA90_SPECIALIST_CHILD_V${version}`,
      role: "ultra90_specialist",
      name: "ULTRA90専門AI",
      thesis: "ULTRA90をさらに高品質な候補に限定し、強シグナルの勝率とStress耐性を検証する。",
      filterSummary: "tier=ULTRA90, Score>=92, Confidence>=92%, Trigger>=90%, RR>=1.55, Volume>=1.00",
      filter: (event) => event.tier === "ULTRA90" && event.score >= 92 && event.confidencePct >= 92 && event.triggerProgressPct >= 90 && event.rr >= 1.55 && event.volumeRatio >= 1,
    },
    {
      id: `INTEGRATED_EDGE_CHILD_V${version}`,
      role: "synthesis",
      name: "統合改善AI",
      thesis: "WIN80とULTRA90の改善案を、Entry品質・RR・出来高・コスト耐性の共通ゲートへ統合する。",
      filterSummary: "WIN80: Score>=82/Trigger>=80%/RR>=1.30/Volume>=0.80; ULTRA90: Score>=92/Trigger>=90%/RR>=1.55/Volume>=1.00",
      filter: (event) => event.tier === "ULTRA90"
        ? event.score >= 92 && event.triggerProgressPct >= 90 && event.rr >= 1.55 && event.volumeRatio >= 1
        : event.tier === "WIN80" && event.score >= 82 && event.triggerProgressPct >= 80 && event.rr >= 1.3 && event.volumeRatio >= 0.8,
    },
    {
      id: `ORTHOGONAL_REGIME_CHILD_V${version}`,
      role: "independent_critic",
      name: "異角度・反対検証AI",
      thesis: "勝率だけを追わず、Triggerの確定度・RR・出来高を軸に、別の切り口で逆行と過学習を検証する。",
      filterSummary: "Score>=84, Trigger>=84%, RR>=1.30, Volume>=0.85",
      filter: (event) => event.score >= 84 && event.triggerProgressPct >= 84 && event.rr >= 1.3 && event.volumeRatio >= 0.85,
    },
  ];
}

function fingerprint(input: object) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function gate(candidate: MultiAgentSplitMetrics, baseline: MultiAgentSplitMetrics, minimumHoldoutSamples: number) {
  const reasons: string[] = [];
  const c = candidate.holdout;
  const b = baseline.holdout;
  if (b.sampleCount < minimumHoldoutSamples) reasons.push("BASELINE_HOLDOUT_SAMPLE_TOO_SMALL");
  if (c.sampleCount < minimumHoldoutSamples) reasons.push("CANDIDATE_HOLDOUT_SAMPLE_TOO_SMALL");
  if (c.average72hPct == null || c.average72hPct <= 0) reasons.push("OOS_AVERAGE_NOT_POSITIVE");
  if (c.profitFactor72h == null || c.profitFactor72h < 1.05) reasons.push("OOS_PF_BELOW_1_05");
  if (b.average72hPct != null && c.average72hPct != null && c.average72hPct < b.average72hPct + 0.1) reasons.push("NO_CLEAR_IMPROVEMENT_VS_BASELINE");
  if (b.maxDrawdownPct != null && c.maxDrawdownPct != null && c.maxDrawdownPct < b.maxDrawdownPct - 1.5) reasons.push("HOLDOUT_DD_WORSE_THAN_BASELINE");
  if (c.stressAverage72hPct == null || c.stressAverage72hPct < -1.5) reasons.push("STRESS_NOT_ACCEPTABLE");
  return reasons;
}

function metricsLine(label: string, value: MultiAgentMetrics) {
  return `${label}: n=${value.sampleCount}, 勝率=${pct(value.winRate72hPct)}, 平均72h=${pct(value.average72hPct)}, PF=${value.profitFactor72h == null ? "—" : value.profitFactor72h.toFixed(2)}, DD=${pct(value.maxDrawdownPct)}, Stress=${pct(value.stressAverage72hPct)}`;
}

function reportLine(report: MultiAgentCandidateReport) {
  const all = report.splitMetrics.all;
  const holdout = report.splitMetrics.holdout;
  return `${report.name} ${report.id}: ${metricsLine("全期間", all)} / ${metricsLine("Holdout", holdout)} / 判定=${report.pass ? "PASS" : "REJECT"}`;
}

export function buildMultiAgentResearchCycle(input: {
  artifact: MainStrategySnapshotReplayArtifact;
  cycle: number;
  startedAt: string;
  startSequence: number;
  previousDiscussion?: ResearchDiscussionLog | null;
  previousReport?: MultiAgentResearchReport | null;
}): { messages: ResearchDiscussionMessage[]; report: MultiAgentResearchReport } {
  const minimumHoldoutSamples = 8;
  const baseline = splitMetrics(input.artifact.events);
  const definitions = candidateDefinitions(input.cycle);
  const proposals: MultiAgentCandidateReport[] = definitions.map((definition) => {
    const events = input.artifact.events.filter(definition.filter);
    const split = splitMetrics(events);
    const rejectionReasons = gate(split, baseline, minimumHoldoutSamples);
    const evidenceFingerprint = fingerprint({
      dataset: input.artifact.fingerprint,
      candidate: definition.id,
      filter: definition.filterSummary,
      events: events.map((event) => event.snapshotFingerprint),
    });
    return {
      id: definition.id,
      role: definition.role,
      name: definition.name,
      thesis: definition.thesis,
      filterSummary: definition.filterSummary,
      symbols: [...new Set(events.map((event) => event.symbol))].sort(),
      eventCount: events.length,
      splitMetrics: split,
      status: rejectionReasons.length ? "REPLAY_REQUIRED" : "FORWARD_PAPER_REQUIRED",
      pass: rejectionReasons.length === 0,
      rejectionReasons,
      evidenceFingerprint,
    };
  });
  const passed = proposals.filter((proposal) => proposal.pass).sort((left, right) => {
    return (right.splitMetrics.holdout.average72hPct ?? -Infinity) - (left.splitMetrics.holdout.average72hPct ?? -Infinity);
  });
  const selectedCandidateId = passed[0]?.id ?? null;
  const report: MultiAgentResearchReport = {
    version: MULTI_AGENT_RESEARCH_PIPELINE_VERSION,
    generatedAt: input.startedAt,
    cycle: input.cycle,
    parentStrategyId: WIN80_ULTRA90_MAIN_STRATEGY.id,
    datasetId: input.artifact.datasetId,
    datasetFingerprint: input.artifact.fingerprint,
    protocol: {
      developmentPct: 60,
      validationPct: 20,
      holdoutPct: 20,
      costsIncluded: true,
      futureOutcomeUsedAsFilter: false,
      minimumHoldoutSamples,
    },
    baseline,
    proposals,
    selectedCandidateId,
    decision: selectedCandidateId ? "FORWARD_PAPER_ONLY" : "KEEP_BASELINE",
    automaticPromotionToMain: false,
    previousDiscussionId: input.previousDiscussion?.id ?? null,
    previousDecision: input.previousReport?.decision ?? input.previousDiscussion?.decision ?? null,
    nextCycleRequirements: [
      "前回CIOの棄却理由を次回の必須検証項目として再評価する",
      "同じ固定Holdoutを見てパラメータを選び直さず、次回は新しい期間のForward Paperを追加する",
      "候補がPASSしても実売買メインへ自動昇格せず、Paper結果と手動承認を要求する",
    ],
  };

  const prior = input.previousReport
    ? `前回Cycle ${input.previousReport.cycle}の判断は${input.previousReport.decision}、前回選定候補は${input.previousReport.selectedCandidateId ?? "なし"}でした。前回の棄却理由を今回の必須条件として引き継ぎます。`
    : "前回の役割別BTレポートはありません。今回を基準Cycleとして保存します。";
  const messages: ResearchDiscussionMessage[] = [];
  const seq = (offset: number) => input.startSequence + offset;
  const commonEvidence = [
    evidence("親メイン", WIN80_ULTRA90_MAIN_STRATEGY.id, "positive"),
    evidence("Dataset", input.artifact.datasetId, "neutral"),
    evidence("Dataset Fingerprint", input.artifact.fingerprint.slice(0, 20), "positive"),
    evidence("BT分割", "Development 60% / Validation 20% / Holdout 20%", "positive"),
  ];

  messages.push(message({
    sequence: seq(0),
    startedAt: input.startedAt,
    speakerId: "win80-specialist-ai",
    speakerName: "WIN80専門AI",
    role: "win80_specialist",
    stance: "proposal",
    strategyId: proposals[0]?.id ?? null,
    content: `Round 1。WIN80の改善案を独立検証します。${proposals[0]?.thesis ?? "候補なし"} 提案条件は${proposals[0]?.filterSummary ?? "—"}。${proposals[0] ? reportLine(proposals[0]) : "候補データなし"}。勝率だけでなく、PF・平均利益・DD・Stressを同時に見ます。`,
    evidence: [...commonEvidence, evidence("WIN80候補通貨", proposals[0]?.symbols.join(", ") || "なし", "neutral"), evidence("WIN80 BT結果", proposals[0] ? (proposals[0].pass ? "PASS" : proposals[0].rejectionReasons.join(", ")) : "なし", proposals[0]?.pass ? "positive" : "negative")],
  }));
  messages.push(message({
    sequence: seq(1),
    startedAt: input.startedAt,
    speakerId: "ultra90-specialist-ai",
    speakerName: "ULTRA90専門AI",
    role: "ultra90_specialist",
    stance: "proposal",
    strategyId: proposals[1]?.id ?? null,
    content: `Round 1。ULTRA90の改善案を独立検証します。${proposals[1]?.thesis ?? "候補なし"} 提案条件は${proposals[1]?.filterSummary ?? "—"}。${proposals[1] ? reportLine(proposals[1]) : "候補データなし"}。ULTRA90は取引数が少なくなりやすいため、サンプル不足を改善成功と扱いません。`,
    evidence: [...commonEvidence, evidence("ULTRA90候補通貨", proposals[1]?.symbols.join(", ") || "なし", "neutral"), evidence("ULTRA90 BT結果", proposals[1] ? (proposals[1].pass ? "PASS" : proposals[1].rejectionReasons.join(", ")) : "なし", proposals[1]?.pass ? "positive" : "negative")],
  }));
  messages.push(message({
    sequence: seq(2),
    startedAt: input.startedAt,
    speakerId: "synthesis-ai",
    speakerName: "統合改善AI",
    role: "synthesis",
    stance: "proposal",
    strategyId: proposals[2]?.id ?? null,
    content: `Round 2。WIN80とULTRA90の改善案を統合します。${proposals[2]?.thesis ?? "候補なし"} 統合条件は${proposals[2]?.filterSummary ?? "—"}。${proposals[2] ? reportLine(proposals[2]) : "候補データなし"}。両方の案が親を上回らない限り、統合案は採用しません。`,
    evidence: [...commonEvidence, evidence("統合BT結果", proposals[2] ? (proposals[2].pass ? "PASS" : proposals[2].rejectionReasons.join(", ")) : "なし", proposals[2]?.pass ? "positive" : "negative")],
  }));
  messages.push(message({
    sequence: seq(3),
    startedAt: input.startedAt,
    speakerId: "independent-critic-ai",
    speakerName: "異角度・反対検証AI",
    role: "independent_critic",
    stance: "challenge",
    strategyId: proposals[3]?.id ?? null,
    content: `Round 2。別角度から現行案と統合案を反証します。${proposals[3]?.thesis ?? "候補なし"} 具体的な対案条件は${proposals[3]?.filterSummary ?? "—"}。${proposals[3] ? reportLine(proposals[3]) : "候補データなし"}。勝率が上がっても利益・PF・Stress・DDが悪化する案は反対します。`,
    evidence: [...commonEvidence, evidence("反対検証BT結果", proposals[3] ? (proposals[3].pass ? "PASS" : proposals[3].rejectionReasons.join(", ")) : "なし", proposals[3]?.pass ? "positive" : "negative"), evidence("将来結果をフィルタ使用", "NO", "positive")],
  }));
  messages.push(message({
    sequence: seq(4),
    startedAt: input.startedAt,
    speakerId: "win80-specialist-reconsideration",
    speakerName: "WIN80専門AI（再検討）",
    role: "win80_specialist",
    stance: "support",
    strategyId: proposals[0]?.id ?? null,
    content: `${prior} WIN80案を再検討します。Holdoutの最低件数・PF1.05以上・平均利益プラス・親との差分・DD・Stressをすべて満たさないため、今回のWIN80案は${proposals[0]?.pass ? "Forward Paperへ進めます" : "棄却し、次Cycleへ継続します"}。`,
    evidence: [...commonEvidence, evidence("WIN80再判断", proposals[0]?.pass ? "FORWARD_PAPER_REQUIRED" : "REPLAY_REQUIRED", proposals[0]?.pass ? "positive" : "negative")],
  }));
  messages.push(message({
    sequence: seq(5),
    startedAt: input.startedAt,
    speakerId: "ultra90-specialist-reconsideration",
    speakerName: "ULTRA90専門AI（再検討）",
    role: "ultra90_specialist",
    stance: "support",
    strategyId: proposals[1]?.id ?? null,
    content: `ULTRA90案を再検討します。サンプル不足を勝率の高さと誤認せず、固定Holdoutと新しいForward Paperで再確認します。今回のULTRA90案は${proposals[1]?.pass ? "Forward Paper候補" : "Replay継続"}であり、実売買ロットや本番条件は変更しません。`,
    evidence: [...commonEvidence, evidence("ULTRA90再判断", proposals[1]?.pass ? "FORWARD_PAPER_REQUIRED" : "REPLAY_REQUIRED", proposals[1]?.pass ? "positive" : "negative")],
  }));
  messages.push(message({
    sequence: seq(6),
    startedAt: input.startedAt,
    speakerId: "research-cio",
    speakerName: "Research CIO",
    role: "cio",
    stance: "decision",
    strategyId: selectedCandidateId ?? WIN80_ULTRA90_MAIN_STRATEGY.id,
    content: selectedCandidateId
      ? `CIO最終判断：${selectedCandidateId}は同一SnapshotのBTゲートを通過しましたが、実売買メインへは昇格させません。Forward Paperを実施し、別期間でも再現した場合だけ手動承認へ進めます。${WIN80_ULTRA90_MAIN_STRATEGY.id}は本番メインとして維持します。`
      : `CIO最終判断：現行${WIN80_ULTRA90_MAIN_STRATEGY.id}を維持します。WIN80・ULTRA90・統合・異角度の候補は、固定Holdoutのサンプル数、利益、PF、DD、Stressのいずれかが不足しているため採用しません。前回の棄却理由を次Cycleへ引き継ぎ、新しいForward Paperが得られるまで改善成功とは判定しません。`,
    evidence: [
      evidence("CIO決定", report.decision, selectedCandidateId ? "neutral" : "positive"),
      evidence("選定候補", selectedCandidateId ?? "なし", selectedCandidateId ? "neutral" : "negative"),
      evidence("自動メイン昇格", "NO", "positive"),
      evidence("実売買設定", "変更なし", "positive"),
    ],
  }));

  return { messages, report };
}

