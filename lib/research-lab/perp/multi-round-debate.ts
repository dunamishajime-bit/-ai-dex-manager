import type {
  ResearchDiscussionEvidence,
  ResearchDiscussionLog,
  ResearchDiscussionMessage,
  ResearchDiscussionSpeakerRole,
  ResearchDiscussionStance,
} from "../discussion-types";
import type {
  MainStrategySnapshotReplayArtifact,
  MainStrategySnapshotReplayEvent,
} from "./main-strategy-snapshot-replay";

type Stat = {
  name: string;
  sample: number;
  win: number;
  average: number;
  profitFactor: number;
  stress: number;
};

function percent(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function evidence(label: string, value: string, assessment: ResearchDiscussionEvidence["assessment"]): ResearchDiscussionEvidence {
  return { label, value, assessment };
}

function calculate(name: string, events: MainStrategySnapshotReplayEvent[]): Stat {
  const returns = events.map((event) => event.forward72hPct);
  const wins = returns.filter((value) => value > 0);
  const gains = wins.reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(returns.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
  return {
    name,
    sample: events.length,
    win: events.length ? (wins.length / events.length) * 100 : 0,
    average: events.length ? returns.reduce((sum, value) => sum + value, 0) / events.length : 0,
    profitFactor: losses ? gains / losses : gains ? 999 : 0,
    stress: events.length ? events.reduce((sum, event) => sum + event.stress72hPct, 0) / events.length : 0,
  };
}

function line(stat: Stat) {
  return `${stat.name}: n=${stat.sample}, 勝率=${percent(stat.win)}, 平均72h=${percent(stat.average)}, PF=${stat.profitFactor.toFixed(2)}, Stress=${percent(stat.stress)}`;
}

function createMessage(input: {
  discussion: ResearchDiscussionLog;
  sequence: number;
  speakerId: string;
  speakerName: string;
  role: ResearchDiscussionSpeakerRole;
  stance: ResearchDiscussionStance;
  content: string;
  evidence: ResearchDiscussionEvidence[];
}) : ResearchDiscussionMessage {
  const base = Date.parse(input.discussion.startedAt);
  return {
    id: `${input.discussion.id}-data-debate-${String(input.sequence).padStart(3, "0")}`,
    sequence: input.sequence,
    createdAt: Number.isFinite(base) ? new Date(base + input.sequence * 1_000).toISOString() : input.discussion.startedAt,
    speakerId: input.speakerId,
    speakerName: input.speakerName,
    role: input.role,
    stance: input.stance,
    strategyId: input.discussion.topStrategyIds[0] ?? null,
    content: input.content,
    evidence: input.evidence,
  };
}

export function appendMultiRoundDebate(
  discussion: ResearchDiscussionLog,
  artifact: MainStrategySnapshotReplayArtifact,
  priorDiscussion?: ResearchDiscussionLog | null,
): ResearchDiscussionMessage[] {
  const parent = calculate("親", artifact.events);
  const score82 = calculate("Score82", artifact.events.filter((event) => event.score >= 82));
  const trigger80 = calculate("Trigger80", artifact.events.filter((event) => event.triggerProgressPct >= 80));
  const combined = calculate("Score82+Trigger80", artifact.events.filter((event) => event.score >= 82 && event.triggerProgressPct >= 80));
  const best = [score82, trigger80, combined].sort((left, right) => right.average - left.average)[0] ?? parent;
  const start = discussion.messages.length + 1;
  const priorText = priorDiscussion ? `前回Cycle ${priorDiscussion.cycle}の棄却理由を継承します。` : "前回の実測議論はありません。";
  const messages: ResearchDiscussionMessage[] = [
    createMessage({
      discussion,
      sequence: start,
      speakerId: "researcher-data-proposal",
      speakerName: "Main Strategy Researcher（実測提案）",
      role: "researcher",
      stance: "proposal",
      content: `同一Snapshotの${artifact.events.length} Signalを再集計しました。${line(parent)}。候補は${line(score82)} / ${line(trigger80)} / ${line(combined)}です。${best.name}を仮の優先候補としますが、固定72h結果であり全決済Portfolio損益ではありません。`,
      evidence: [evidence("親Signal", String(parent.sample), "positive"), evidence("候補実測", "READY", "positive"), evidence("仮優先", best.name, "neutral")],
    }),
    createMessage({
      discussion,
      sequence: start + 1,
      speakerId: "critic-data-proposal",
      speakerName: "AI反対派 / Data & Overfit（反論・対案）",
      role: "overfit_critic",
      stance: "challenge",
      content: `${priorText} 親の72h勝率は${percent(parent.win)}、平均は${percent(parent.average)}、PFは${parent.profitFactor.toFixed(2)}です。Score82やTrigger80だけを上げる案は親を改善していない場合があるため反対します。具体案として、Trigger84%＋次足確認、Score80維持＋RR1.30＋Volume0.80、ULTRA90押し目確認後Rotationを同一Snapshotで比較します。`,
      evidence: [evidence("親勝率", percent(parent.win), "negative"), evidence("親PF", parent.profitFactor.toFixed(2), "negative"), evidence("具体的対案", "3案", "neutral")],
    }),
    createMessage({
      discussion,
      sequence: start + 2,
      speakerId: "researcher-data-reconsideration",
      speakerName: "Main Strategy Researcher（再検討）",
      role: "researcher",
      stance: "support",
      content: `反論を受け、${best.name}が親の勝率・平均利益・PF・Stressを同時に改善しているかを再確認します。改善していない案は棄却し、次Cycleは反対派の3案を前回理由から継続検証します。実売買メインは変更しません。`,
      evidence: [evidence("前回理由継承", "YES", "positive"), evidence("次Cycle", "3案の親子比較", "neutral"), evidence("実売買変更", "なし", "positive")],
    }),
    createMessage({
      discussion,
      sequence: start + 3,
      speakerId: "critic-data-rebuttal",
      speakerName: "AI反対派 / Data & Risk（再反論）",
      role: "tail_risk_critic",
      stance: "challenge",
      content: "勝率だけを改善して利益やPFを落とす案は失敗です。次回は最大連敗、日次損失、RR/Volume帯別成績、急変Stress、Holdoutを追加し、再現しない案を棄却します。",
      evidence: [evidence("追加指標", "最大連敗・日次損失・RR/Volume・Stress", "neutral"), evidence("Holdout", "必須", "positive")],
    }),
    createMessage({
      discussion,
      sequence: start + 4,
      speakerId: "cio-data-decision",
      speakerName: "Research CIO（実測最終判断）",
      role: "cio",
      stance: "decision",
      content: `CIO判断：${discussion.topStrategyIds[0] ?? "現行メイン"}を維持します。親子同一Snapshot比較で勝率・平均利益・PF・Stress・DDの全条件を満たす案だけをHoldoutへ進め、未達なら理由を次回へ引き継ぎます。API、ウォレット、実売買フラグ、メインIDは変更しません。`,
      evidence: [evidence("CIO結論", "親維持・未検証案は継続", "positive"), evidence("採用条件", "5指標＋Holdout", "neutral"), evidence("実売買反映", "NO", "positive")],
    }),
  ];
  return [...discussion.messages, ...messages];
}

