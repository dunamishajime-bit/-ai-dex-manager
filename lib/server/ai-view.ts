import { buildDecisionViewModel } from "@/lib/ui/disterminal-ui-view-model";
import type { DecisionStatusSurface } from "@/lib/server/disdex-observability-surface";
import type { PublicPortfolioSummary } from "@/lib/server/live-portfolio";

export const AI_VIEW_STATUS_VOCABULARY = ["PASS", "FAIL", "WAIT", "BLOCKED", "UNKNOWN"] as const;
export type AiViewStatusToken = typeof AI_VIEW_STATUS_VOCABULARY[number];

type SafeStep = {
  label: string;
  state: AiViewStatusToken;
  detail: string;
};

export type AiViewDocument = {
  system: {
    status: string;
    state: AiViewStatusToken;
    detail: string;
  };
  readOnly: true;
  tradingMutation: 0;
  checkedAt: string;
  source: string;
  strategies: Array<{
    id: string;
    label: string;
    runtimeStatus: string;
    state: AiViewStatusToken;
    stage: string;
    detail: string;
    blocker?: string;
    observedCandidates: number | null;
    eligibleDirections: number | null;
    positionCount: number | null;
  }>;
  attention: Array<{
    strategyId: string;
    symbol: string;
    side: string;
    state: AiViewStatusToken;
    stage: string;
    detail: string;
    blocker?: string;
    rank?: number;
  }>;
  v12: {
    selected: {
      symbol: string;
      side: string;
      rank: number | null;
      score: number | null;
      momentum: number | null;
      volumeRatio: number | null;
      btcRegime: string;
      gate: AiViewStatusToken;
      reason: string;
    };
    candidates: Array<{
      rank: number | null;
      symbol: string;
      side: string;
      score: number | null;
      momentum: number | null;
      volumeRatio: number | null;
      btcRegime: string;
      gate: AiViewStatusToken;
      reason: string;
    }>;
    steps: SafeStep[];
  };
  pengu: {
    runtimeStatus: string;
    state: AiViewStatusToken;
    stage: string;
    detail: string;
    latestReference: string;
    long: { state: AiViewStatusToken; detail: string };
    short: { state: AiViewStatusToken; detail: string };
    features: Array<{ key: string; value: number }>;
    steps: SafeStep[];
    failureCount: number;
    resolvedFailureCount: number;
    failureReasons: string[];
  };
  v52: {
    runtimeStatus: string;
    state: AiViewStatusToken;
    referenceStatus: string;
    referenceGate: AiViewStatusToken;
    referenceReason: string;
    killSwitch: AiViewStatusToken;
    windows: Array<{
      window: string;
      entered: boolean;
      capture: boolean;
      retryCount: number;
      candidates: Array<{ rank: number | null; symbol: string; basisBps: number | null }>;
      decisions: Array<{ rank: number | null; symbol: string; state: AiViewStatusToken; detail: string }>;
    }>;
    errors: string[];
  };
  portfolio: PublicPortfolioSummary;
  statusVocabulary: readonly AiViewStatusToken[];
};

function safeText(value: unknown, fallback = "UNKNOWN") {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const redacted = value
    .replace(/[A-Za-z]:[\\/][^\s]+/g, "[REDACTED]")
    .replace(/\/(?:home|etc|var|tmp|root|Users)\/[^\s]+/g, "[REDACTED]")
    .replace(/\b(?:api[_-]?key|private[_-]?key|secret|password|cookie|token|process\.env|order[_-]?id|trade[_-]?id|balance|available|quantity|entry[_-]?price|mark[_-]?price)\b/gi, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 360);
  return redacted || fallback;
}

function safeNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenFromRuntime(status: string | undefined): AiViewStatusToken {
  if (status === "LIVE") return "PASS";
  if (status === "STALE") return "BLOCKED";
  return "UNKNOWN";
}

function tokenFromTraceState(state: "pass" | "blocked" | "pending" | "unknown"): AiViewStatusToken {
  if (state === "pass") return "PASS";
  if (state === "blocked") return "BLOCKED";
  if (state === "pending") return "WAIT";
  return "UNKNOWN";
}

function tokenFromBoolean(value: boolean | undefined): AiViewStatusToken {
  if (value === true) return "PASS";
  if (value === false) return "WAIT";
  return "UNKNOWN";
}

function safeSteps(trace: { steps?: Array<{ label: string; state: "pass" | "blocked" | "pending" | "unknown"; detail: string }> } | undefined): SafeStep[] {
  return (trace?.steps || []).map((step) => ({
    label: safeText(step.label),
    state: tokenFromTraceState(step.state),
    detail: safeText(step.detail),
  }));
}

function safePositionSummary(portfolio: PublicPortfolioSummary): PublicPortfolioSummary {
  return {
    status: portfolio.status,
    capturedAt: portfolio.capturedAt,
    positionCount: portfolio.positionCount,
    positions: portfolio.positions.map((position) => ({
      symbol: safeText(position.symbol, "UNKNOWN"),
      side: position.side === "SHORT" ? "SHORT" : "LONG",
      protected: position.protected === true,
    })),
    openOrderCount: portfolio.openOrderCount,
    protectedOrderCount: portfolio.protectedOrderCount,
  };
}

function v12CandidateRow(candidate: NonNullable<NonNullable<DecisionStatusSurface["v12Observability"]["decision"]>["candidates"]>[number], btcRegime: string) {
  const gate = candidate.signalGate?.status === "pass" ? "PASS" : candidate.signalGate?.status === "blocked" ? "BLOCKED" : "UNKNOWN";
  return {
    rank: safeNumber(candidate.rank),
    symbol: safeText(candidate.symbol),
    side: safeText(candidate.side, "WAIT"),
    score: safeNumber(candidate.score),
    momentum: safeNumber(candidate.momentum),
    volumeRatio: safeNumber(candidate.volumeRatio),
    btcRegime: safeText(btcRegime),
    gate: gate as AiViewStatusToken,
    reason: safeText(candidate.signalGate?.detail, "Signal Gate理由未取得"),
  };
}

function publicDecisionInput(surface: DecisionStatusSurface) {
  return { ...surface, portfolio: { positions: [] as Array<{ symbol: string; side?: string }> } };
}

export function buildAiViewDocument(surface: DecisionStatusSurface, portfolio: PublicPortfolioSummary = { status: "UNAVAILABLE", positionCount: null, positions: [], openOrderCount: null, protectedOrderCount: null }) : AiViewDocument {
  const model = buildDecisionViewModel(publicDecisionInput(surface));
  const v12Decision = surface.v12Observability.decision;
  const btcRegime = safeText(v12Decision?.btcRegime, "UNKNOWN");
  const candidates = (v12Decision?.candidates || []).map((candidate) => v12CandidateRow(candidate, btcRegime));
  const selected = v12Decision
    ? v12CandidateRow({
      symbol: v12Decision.symbol,
      side: v12Decision.side,
      rank: v12Decision.rank,
      score: v12Decision.score,
      momentum: v12Decision.momentum,
      volumeRatio: v12Decision.volumeRatio,
      signalGate: v12Decision.signalGate,
    }, btcRegime)
    : {
      rank: null,
      symbol: "UNKNOWN",
      side: "WAIT",
      score: null,
      momentum: null,
      volumeRatio: null,
      btcRegime,
      gate: "UNKNOWN" as const,
      reason: "V12 decision snapshot未取得",
    };

  const pengu = surface.penguRuntime;
  const penguSignal = pengu.latestSignal;
  const penguFailureReasons = pengu.failures.map((failure) => safeText(failure.message));
  const penguFeatures = Object.entries(penguSignal?.features || {})
    .map(([key, value]) => ({ key: safeText(key), value: Number(value) }))
    .filter((item) => Number.isFinite(item.value));
  const v52 = surface.v52Top2Observability;
  const v52ReferenceReady = v52.referenceHealth?.ready === true && v52.referenceOrdersAllowed !== false;
  const v52Windows = v52.windows.map((window) => ({
    window: safeText(window.window),
    entered: window.decisionWindowEntered,
    capture: window.signalCaptureSucceeded,
    retryCount: window.transientRetryCount,
    candidates: window.candidates.map((candidate) => ({
      rank: safeNumber(candidate.candidateRank ?? candidate.qualifiedRank),
      symbol: safeText(candidate.symbol),
      basisBps: safeNumber(candidate.basisBps),
    })),
    decisions: [...window.entries, ...window.rejections].map((row) => ({
      rank: safeNumber(row.candidateRank ?? row.qualifiedRank),
      symbol: safeText(row.symbol),
      state: row.orderSendAttempted ? "PASS" as const : row.orderBlockedReason || row.rank2RejectedReason ? "BLOCKED" as const : "WAIT" as const,
      detail: safeText(row.orderResult || row.orderBlockedReason || row.rank2RejectedReason, "発注判断記録なし"),
    })),
  }));

  const strategies = model.strategyCards.map((strategy) => ({
    id: strategy.id,
    label: safeText(strategy.label),
    runtimeStatus: safeText(strategy.runtimeStatus),
    state: tokenFromRuntime(strategy.runtimeStatus === "LIVE" ? "LIVE" : strategy.runtimeStatus === "STALE" ? "STALE" : undefined),
    stage: safeText(strategy.stageLabel),
    detail: safeText(strategy.detail),
    blocker: strategy.blocker ? safeText(strategy.blocker) : undefined,
    observedCandidates: strategy.observedCandidates,
    eligibleDirections: strategy.eligibleDirections,
    positionCount: strategy.positionCount,
  }));

  return {
    system: {
      status: model.systemStatus,
      state: model.systemStatus === "LIVE / HEALTHY" ? "PASS" : model.systemStatus === "DEGRADED" ? "WAIT" : "FAIL",
      detail: model.systemStatus === "LIVE / HEALTHY" ? "全ロジックの実stateがLIVEとして確認されています。" : "1つ以上のロジックまたはデータソースがLIVE確認条件を満たしていません。",
    },
    readOnly: true,
    tradingMutation: 0,
    checkedAt: safeText(surface.checkedAt, "UNKNOWN"),
    source: safeText(surface.source, "VPS runner state / sanitized decision snapshot"),
    strategies,
    attention: model.attentionItems.map((item) => ({
      strategyId: item.strategyId,
      symbol: safeText(item.symbol),
      side: safeText(item.side, "WAIT"),
      state: item.state === "FIRE" || item.state === "SIGNAL" ? "PASS" : item.state === "WAITING" ? "WAIT" : item.state === "BLOCKED" ? "BLOCKED" : item.state === "ERROR" ? "UNKNOWN" : "WAIT",
      stage: safeText(item.stageLabel),
      detail: safeText(item.detail),
      blocker: item.blocker ? safeText(item.blocker) : undefined,
      rank: item.rank,
    })),
    v12: {
      selected,
      candidates,
      steps: safeSteps(surface.v12Observability.executionTrace),
    },
    pengu: {
      runtimeStatus: pengu.status,
      state: tokenFromRuntime(pengu.status),
      stage: safeText(pengu.executionTrace.currentStageLabel),
      detail: safeText(pengu.executionTrace.summary),
      latestReference: penguSignal?.referenceTs ? new Date(penguSignal.referenceTs).toISOString() : "UNKNOWN",
      long: { state: tokenFromBoolean(penguSignal?.decision.longEligible), detail: penguSignal?.decision.longEligible === true ? "PENGU Long条件成立" : "PENGU Long条件未成立または未取得" },
      short: { state: tokenFromBoolean(penguSignal?.decision.shortEligible), detail: penguSignal?.decision.shortEligible === true ? "PENGU Short条件成立" : "PENGU Short条件未成立または未取得" },
      features: penguFeatures,
      steps: safeSteps(pengu.executionTrace),
      failureCount: pengu.failures.length,
      resolvedFailureCount: pengu.resolvedFailures.length,
      failureReasons: penguFailureReasons,
    },
    v52: {
      runtimeStatus: v52.status,
      state: tokenFromRuntime(v52.status),
      referenceStatus: safeText(v52.referenceStatus),
      referenceGate: v52ReferenceReady ? "PASS" : v52.referenceHealth ? "BLOCKED" : "UNKNOWN",
      referenceReason: safeText(v52.referenceHealth?.reason || v52.reason, "V52参照状態未取得"),
      killSwitch: v52.killSwitchActive ? "BLOCKED" : v52.status === "UNAVAILABLE" ? "UNKNOWN" : "PASS",
      windows: v52Windows,
      errors: v52.errors.map((error) => safeText(error)),
    },
    portfolio: safePositionSummary(portfolio),
    statusVocabulary: AI_VIEW_STATUS_VOCABULARY,
  };
}
