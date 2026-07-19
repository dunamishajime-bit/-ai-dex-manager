import type {
  ResearchDiscussionEvidence,
  ResearchDiscussionLog,
  ResearchDiscussionSnapshotReplay,
} from "@/lib/research-lab/discussion-types";

import type { MainStrategySnapshotReplayArtifact } from "./main-strategy-snapshot-replay";
import { appendMultiRoundDebate } from "./multi-round-debate";

function pct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
}

function numberValue(value: number | null, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function evidence(
  label: string,
  value: string,
  assessment: ResearchDiscussionEvidence["assessment"],
): ResearchDiscussionEvidence {
  return { label, value, assessment };
}

function compactReplay(artifact: MainStrategySnapshotReplayArtifact): ResearchDiscussionSnapshotReplay {
  return {
    datasetId: artifact.datasetId,
    strategyId: artifact.strategyId,
    source: artifact.source,
    generatedAt: artifact.generatedAt,
    period: {
      startIso: artifact.period.startIso,
      endIso: artifact.period.endIso,
    },
    symbols: [...artifact.symbols],
    intervalHours: artifact.intervalHours,
    snapshotCount: artifact.snapshotCount,
    selectedSignalCount: artifact.selectedSignalCount,
    noSignalSnapshotCount: artifact.noSignalSnapshotCount,
    costs: { ...artifact.costs },
    metrics: { ...artifact.metrics },
    signalCountsBySymbol: { ...artifact.signalCountsBySymbol },
    limitations: [...artifact.limitations],
    fingerprint: artifact.fingerprint,
    events: artifact.events.slice(0, 12).map((event) => ({
      snapshotIso: event.snapshotIso,
      symbol: event.symbol,
      tier: event.tier,
      score: event.score,
      triggerProgressPct: event.triggerProgressPct,
      forward24hPct: event.forward24hPct,
      forward72hPct: event.forward72hPct,
      forward168hPct: event.forward168hPct,
      stress72hPct: event.stress72hPct,
      mfe72hPct: event.mfe72hPct,
      mae72hPct: event.mae72hPct,
      snapshotFingerprint: event.snapshotFingerprint,
    })),
  };
}

export function attachMainStrategySnapshotReplay(
  discussion: ResearchDiscussionLog,
  artifact: MainStrategySnapshotReplayArtifact,
  priorDiscussion?: ResearchDiscussionLog | null,
): ResearchDiscussionLog {
  const metrics = artifact.metrics;
  const datasetSummary = `${artifact.period.startIso.slice(0, 10)}〜${artifact.period.endIso.slice(0, 10)} / ${artifact.symbols.length}銘柄 / ${artifact.intervalHours}時間間隔`;
  const outcomeSummary = `${artifact.snapshotCount} Snapshot、${artifact.selectedSignalCount} Signal、72h勝率${pct(metrics.winRate72hPct)}、72h平均${pct(metrics.average72hPct)}、PF${numberValue(metrics.profitFactor72h, 2)}`;
  const stressSummary = `Stress 72h平均${pct(metrics.stressAverage72hPct)}、Event列DD${pct(metrics.eventSequenceMaxDrawdownPct)}、72h最悪${pct(metrics.worst72hPct)}`;

  const messages = discussion.messages.map((item) => {
    if (item.speakerId === "main-strategy-researcher") {
      return {
        ...item,
        content: `${item.content}\n\n保存済みBT元データからStrategyEngineInputを時系列復元しました。${datasetSummary}。EntryはSnapshot確定後の次1時間足始値で、24h・72h・7日後を固定評価しています。${outcomeSummary}。`,
        evidence: [
          ...item.evidence.filter((entry) => !entry.label.startsWith("Snapshot")),
          evidence("Snapshotデータ", artifact.datasetId, "positive"),
          evidence("Snapshot数", String(artifact.snapshotCount), "positive"),
          evidence("選定Signal", String(artifact.selectedSignalCount), artifact.selectedSignalCount >= 20 ? "positive" : "neutral"),
          evidence("72h勝率", pct(metrics.winRate72hPct), (metrics.winRate72hPct ?? 0) >= 60 ? "positive" : "negative"),
          evidence("72h平均", pct(metrics.average72hPct), (metrics.average72hPct ?? 0) > 0 ? "positive" : "negative"),
        ],
      };
    }
    if (item.speakerId === "execution-critic") {
      return {
        ...item,
        content: `再現可能なBT Snapshot Artifactを確認しました。${datasetSummary}、Fingerprint ${artifact.fingerprint.slice(0, 16)}…。${outcomeSummary}、${stressSummary}です。これで現行ロジックの過去時点における選定理由とForward Outcomeを議論できます。ただしAster過去Order BookではなくBinance USD-M 1h OHLCV/Fundingを変換した証拠であり、固定72h Outcomeは現行runnerの全決済ライフサイクル月利ではありません。子案の採否には同一Snapshot上の親子比較とForward Paperが必要です。`,
        evidence: [
          evidence("再現BT Artifact", "LOADED", "positive"),
          evidence("Fingerprint", artifact.fingerprint.slice(0, 20), "positive"),
          evidence("72h Stress平均", pct(metrics.stressAverage72hPct), (metrics.stressAverage72hPct ?? 0) > 0 ? "positive" : "negative"),
          evidence("Aster過去Order Book", "未収録", "negative"),
          evidence("全決済Portfolio BT", "別途必要", "neutral"),
        ],
      };
    }
    if (item.speakerId === "research-cio") {
      return {
        ...item,
        content: `${item.content}\n\n現行親ロジックのSnapshot Replayは保存済みです。今後の議論はReference値だけでなく、各SnapshotのScore・Trigger・RR・Volumeと24h/72h/168h実績を必須証拠にします。ただし子案を改善済みとはまだ判定せず、同一Snapshotで親子比較が完了するまでREPLAY_REQUIREDを維持します。`,
        evidence: [
          ...item.evidence,
          evidence("親Snapshot Replay", "READY", "positive"),
          evidence("子案親子比較", "REPLAY_REQUIRED", "neutral"),
          evidence("実売買自動反映", "禁止", "positive"),
        ],
      };
    }
    return item;
  });

  const debateMessages = appendMultiRoundDebate({ ...discussion, messages }, artifact, priorDiscussion);
  const carryMessage = priorDiscussion ? { id: discussion.id + "-carry-forward", sequence: debateMessages.length + 1, createdAt: new Date().toISOString(), speakerId: "research-continuity", speakerName: "Research Continuity（前回引継ぎ）", role: "moderator" as const, stance: "context" as const, strategyId: priorDiscussion.topStrategyIds[0] ?? null, content: "前回Cycle " + priorDiscussion.cycle + "（" + priorDiscussion.id + ")のCIO判断と候補を引き継ぎます。前回候補：" + priorDiscussion.topStrategyIds.join(", ") + "。前回判断：" + priorDiscussion.decision, evidence: [{ label: "前回Cycle", value: String(priorDiscussion.cycle), assessment: "positive" as const }, { label: "前回候補", value: priorDiscussion.topStrategyIds.join(", "), assessment: "neutral" as const }, { label: "引継ぎ", value: "構造化保存済み", assessment: "positive" as const }] } : null;
  return {
    ...discussion,
    summary: `${discussion.summary} 保存済みBT元データから${artifact.snapshotCount}件のStrategyEngineInput Snapshotを復元し、${artifact.selectedSignalCount}件の選定Signalに24h/72h/168h実績を付与しました。`,
    decision: `${discussion.decision} 現行親のSnapshot証拠はREADY。子案は同一Snapshot親子比較完了までREPLAY_REQUIREDです。`,
    methodology: `${discussion.methodology} 追加Evidence: ${artifact.source}の1h OHLCV/FundingキャッシュからStrategyEngineInputを${artifact.intervalHours}時間ごとに再構築し、次1h足始値Entry・固定24h/72h/168h Outcome・Fee/Slippage/Funding控除で検証。Artifact fingerprint=${artifact.fingerprint}。`,
    messages: carryMessage ? [...debateMessages, carryMessage] : debateMessages,
    snapshotReplay: compactReplay(artifact),
  };
}
