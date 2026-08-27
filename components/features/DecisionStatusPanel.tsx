"use client";

import { useMemo, useState } from "react";
import { Activity, ChevronDown, Clock3, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";

import { AttentionList, PenguDirectionCards, RuntimeBadge, StageIndicator, StateBadge, StrategyOverviewCards } from "@/components/features/DecisionUi";
import { useDecisionStatus, type DecisionStatusPayload } from "@/hooks/useDecisionStatus";
import { buildDecisionViewModel, type UiDecisionState } from "@/lib/ui/disterminal-ui-view-model";

type Trace = {
  currentStage: string;
  currentStageLabel: string;
  summary: string;
  nextAction: string;
  steps: Array<{ key: string; label: string; state: "pass" | "blocked" | "pending" | "unknown"; detail: string }>;
};

type V12Details = {
  decision: {
    strategyId?: string;
    symbol?: string;
    side?: string;
    regime?: string;
    btcRegime?: string;
    rank?: number;
    score?: number;
    momentum?: number;
    volumeRatio?: number;
    requestedGross?: number;
    referenceTs?: number;
    entryTs?: number;
    selectedAt?: string | number;
    rationale?: string;
    selectionConfirmed?: boolean;
    signalGate?: { status: "pass" | "blocked" | "unknown"; code?: string; detail: string };
    candidates: Array<{ symbol?: string; side?: string; rank?: number; score?: number; momentum?: number; volumeRatio?: number; volatility?: number; atr?: number; signalGate?: { status: "pass" | "blocked" | "unknown"; code?: string; detail: string } }>;
  } | null;
  runnerState?: { strategyId?: string; mode?: string; updatedAt?: number; lastReferenceTs?: number; manualReview?: string; active?: { symbol?: string; side?: string; quantity?: number; gross?: number; entryPrice?: number; holdingBars?: number }; pending?: { action?: string; symbol?: string; side?: string; signalTs?: number; expectedPrice?: number; requestedGross?: number; reason?: string }; killSwitch?: { active: boolean; reason?: string } } | null;
  sharedRisk?: { lossPct?: number; maximumLossPct?: number; tripped: boolean; updatedAt?: number } | null;
  executionTrace: Trace;
  v12Positions: Array<{ symbol: string; side: string; quantity: number; entryPrice: number; markPrice: number; unrealizedPnlUsd: number }>;
  recentFills: Array<{ id?: string; executedAt?: string; symbol: string; action: string; side?: string; tradeStatus?: string; positionVerified?: boolean; entryPriceUsd?: number; exitPriceUsd?: number; realizedPnlUsd?: number; netPnlUsd?: number; orderId?: string }>;
  wiring: { runnerStateConfigured: boolean; decisionSnapshotConfigured: boolean };
  errors: string[];
};

type PenguDetails = {
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  capturedAt: string;
  updatedAt?: number;
  mode?: string;
  killSwitchActive?: boolean;
  reason: string;
  latestSignal?: { referenceTs?: number; entryTs?: number; side?: number; targetGross?: number; reason?: string; features: Record<string, number>; decision: { longEligible?: boolean; shortEligible?: boolean; active?: boolean }; diagnostics: { latestCompletedPenguTs?: number; latestCompletedBtcTs?: number; edgeTriggered?: boolean; shortSetupActive?: boolean; shortSetupArmed?: boolean; cooldownBlocked?: boolean } };
  executionTrace: Trace;
  failures: Array<{ occurredAt?: number; message: string }>;
  resolvedFailures: Array<{ occurredAt?: number; message: string }>;
  position?: { side?: number; quantity?: number; gross?: number; entryPrice?: number };
  pending?: { phase?: string; side?: string; targetGross?: number; reason?: string };
};

type V52Details = {
  status: "LIVE" | "STALE" | "UNAVAILABLE";
  capturedAt: string;
  updatedAt?: number;
  mode?: string;
  referenceStatus?: string;
  referenceOrdersAllowed?: boolean;
  killSwitchActive: boolean;
  killSwitchReason?: string;
  activeV50Slots: number;
  v50DailyEntries: number;
  positions: Array<{ slot: string; symbol?: string; side?: string; gross?: number }>;
  windows: Array<{ window: string; decisionWindowEntered: boolean; signalCaptureSucceeded: boolean; transientRetryCount: number; candidates: Array<{ candidateRank?: number; qualifiedRank?: number; symbol?: string; basisBps?: number }>; entries: Array<V52Row>; rejections: Array<V52Row> }>;
  errors: string[];
};

type V52Row = { candidateRank?: number; qualifiedRank?: number; symbol?: string; requestedGross?: number; allocatedGross?: number; availableGrossBeforeEntry?: number; globalGrossBeforeReservation?: number; globalGrossAfterReservation?: number; rank2Accepted?: boolean | null; rank2RejectedReason?: string | null; orderBlockedReason?: string | null; orderSendAttempted?: boolean; orderResult?: string; attemptIndex?: number };

type Snapshot = Omit<DecisionStatusPayload, "v12Observability" | "penguRuntime" | "v52Top2Observability"> & { v12Observability?: V12Details; penguRuntime?: PenguDetails; v52Top2Observability?: V52Details };

function time(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "未取得";
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("ja-JP") : "未取得";
}

function number(value?: number, digits = 4) {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function stepState(state: Trace["steps"][number]["state"]): UiDecisionState {
  return state === "pass" ? "SIGNAL" : state === "pending" ? "WAITING" : state === "blocked" ? "BLOCKED" : "WATCH";
}

function StepList({ trace }: { trace: Trace }) {
  return <div className="space-y-2">{trace.steps.map((step) => <div key={step.key} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="min-w-0"><div className="text-xs font-bold text-white">{step.label}</div><div className="mt-1 text-[11px] leading-5 text-white/55">{step.detail}</div></div><StateBadge state={stepState(step.state)} /></div>)}</div>;
}

function FinalGate({ trace, detail, state: stateOverride }: { trace?: Trace; detail?: string; state?: UiDecisionState }) {
  const step = trace?.steps.slice().reverse().find((item) => item.key === "execution" || /発注|Entry|Final/i.test(item.label));
  const detailState: UiDecisionState | undefined = detail && /拒否|阻止|blocked|reject|fail|失敗/i.test(detail) ? "BLOCKED" : undefined;
  const state = stateOverride || (step ? stepState(step.state) : detailState || "WATCH");
  const authoritativeDetail = step?.detail || detail;
  return <div className="rounded-2xl border border-gold-300/25 bg-gold-400/8 p-3"><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-gold-100/75">FINAL GATE / ENTRY</div><div className="mt-2 flex flex-wrap items-center gap-2"><StateBadge state={state} /><span className="text-xs font-semibold text-white/80">{step?.label || "実Runnerの専用Final Gate項目"}</span></div><p className="mt-2 text-xs leading-5 text-white/62">{authoritativeDetail || "専用Final Gateの状態はsnapshotにありません。推測表示はしません。"}</p></div>;
}

function RuntimeSummary({ snapshot, model }: { snapshot: Snapshot; model: ReturnType<typeof buildDecisionViewModel> }) {
  const liveCount = snapshot.runtime.units.filter((unit) => unit.status === "LIVE").length;
  return <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ServerCog className="h-5 w-5 text-gold-100" /><div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-100/70">RUNTIME</div><h2 className="text-lg font-black">VPS実稼働ロジック</h2></div></div><div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/20 px-3 py-1.5 text-xs font-bold"><span className={model.systemStatus === "LIVE / HEALTHY" ? "text-emerald-200" : "text-amber-200"}>{liveCount}/{snapshot.runtime.units.length} LIVE</span><span className="text-white/35">/</span><span className="text-white/65">{model.systemStatus}</span></div></div><p className="mt-2 text-[11px] leading-5 text-white/45">確認時刻：{time(snapshot.checkedAt)}。実stateの更新時刻・mode・保護状態に基づく表示です。</p><div className="mt-4 grid gap-2 md:grid-cols-3">{snapshot.runtime.units.map((unit) => { const card = model.strategyCards.find((item) => item.id === (unit.id.startsWith("V12") ? "V12" : unit.id.startsWith("PENGU") ? "PENGU" : "V52")); return <article key={unit.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-center justify-between gap-2"><div className="font-bold text-white">{unit.label}</div><RuntimeBadge status={unit.status} /></div><div className="mt-2 text-xs text-white/60">{card?.stageLabel || unit.reason || "状態根拠未取得"}</div><div className="mt-2 text-[10px] text-white/40">更新：{time(unit.updatedAt)}</div></article>; })}</div></section>;
}

function V12Detail({ details }: { details?: V12Details }) {
  if (!details) return <section className="rounded-2xl border border-dashed border-white/12 px-4 py-7 text-center text-sm text-white/50">V12の実Runner詳細を取得できません。</section>;
  const decision = details.decision;
  const trace = details.executionTrace;
  return <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-gold-100" /><h2 className="text-xl font-black">V12 判定経路</h2></div><p className="mt-1 text-[11px] text-white/45">実V12 decision snapshot / runner state / Aster照合</p></div><span className="rounded-full border border-emerald-300/25 bg-emerald-400/8 px-3 py-1 text-[10px] font-bold text-emerald-100">tradingMutation=0</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">候補</div><div className="mt-1 font-bold text-white">{decision?.symbol || "未取得"} / {decision?.side || "WAIT"}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">Rank / score</div><div className="mt-1 font-bold text-white">{decision?.rank ?? "—"} / {number(decision?.score)}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">BTC regime</div><div className="mt-1 font-bold text-white">{decision?.btcRegime || "未取得"}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">確定足</div><div className="mt-1 font-bold text-white">{time(decision?.referenceTs)}</div></div></div><div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-bold text-white">現在の段階：{trace.currentStageLabel}</div><span className="text-[11px] text-white/45">次：{trace.nextAction}</span></div><div className="mt-3"><StageIndicator steps={trace.steps} /></div><div className="mt-4"><StepList trace={trace} /></div><div className="mt-3"><FinalGate trace={trace} detail={decision?.signalGate?.detail} /></div></div><details className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-white"><ChevronDown className="h-4 w-4 text-gold-100" />全候補順位・記録指標</summary><div className="mt-3 overflow-x-auto"><table className="min-w-[760px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-2 py-2">Rank</th><th className="px-2 py-2">Symbol</th><th className="px-2 py-2">Side</th><th className="px-2 py-2">Score</th><th className="px-2 py-2">Momentum</th><th className="px-2 py-2">Volume</th><th className="px-2 py-2">Gate</th></tr></thead><tbody>{(decision?.candidates || []).map((candidate, index) => <tr key={`${candidate.symbol || "candidate"}-${index}`} className="border-t border-white/5"><td className="px-2 py-2 font-bold text-white">{candidate.rank ?? index + 1}</td><td className="px-2 py-2 text-white/80">{candidate.symbol || "—"}</td><td className="px-2 py-2 text-white/70">{candidate.side || "WAIT"}</td><td className="px-2 py-2 text-white/70">{number(candidate.score)}</td><td className="px-2 py-2 text-white/70">{number(candidate.momentum)}</td><td className="px-2 py-2 text-white/70">{number(candidate.volumeRatio, 3)}</td><td className="px-2 py-2 text-white/70">{candidate.signalGate?.detail || "未取得"}</td></tr>)}</tbody></table></div></details><div className="mt-3 grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/60"><div>runner更新：{time(details.runnerState?.updatedAt)}</div><div>mode：{details.runnerState?.mode || "未取得"}</div><div>共有risk：{details.sharedRisk ? `${number(details.sharedRisk.lossPct, 2)}% / 上限 ${number(details.sharedRisk.maximumLossPct, 2)}%` : "未取得"}</div><div>建玉照合：{details.v12Positions.length}件</div></div><div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/60"><div className="font-semibold text-white/80">直近約定</div>{details.recentFills.slice(0, 4).map((fill, index) => <div key={`${fill.id || fill.symbol}-${index}`} className="mt-1">{time(fill.executedAt)} / {fill.symbol} / {fill.action} / {fill.tradeStatus || "—"}</div>)}{!details.recentFills.length ? <div className="mt-1">約定履歴なし</div> : null}</div></div>{details.errors.length ? <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-100">観測上の注意：{details.errors.join(" / ")}</div> : null}</section>;
}

function PenguDetail({ details: sourceDetails }: { details?: PenguDetails }) {
  if (!sourceDetails) return <section className="rounded-2xl border border-dashed border-white/12 px-4 py-7 text-center text-sm text-white/50">PENGUの実Runner詳細を取得できません。</section>;
  const details: PenguDetails = sourceDetails.status === "UNAVAILABLE"
    ? { ...sourceDetails, failures: sourceDetails.failures.length ? sourceDetails.failures : [{ message: sourceDetails.reason }] }
    : sourceDetails.killSwitchActive && sourceDetails.failures.length === 0
      ? { ...sourceDetails, failures: [{ message: `共有Kill Switchが有効です。${sourceDetails.reason}` }] }
      : sourceDetails;
  const signal = details.latestSignal;
  const features = signal?.features || {};
  const blockedStep = details.executionTrace.steps.find((step) => step.state === "blocked");
  const blocker = blockedStep ? `${blockedStep.label}: ${blockedStep.detail}` : signal?.reason;
  const directionState = (eligible?: boolean) => details.status !== "LIVE" ? "ERROR" as const : details.killSwitchActive ? "OFF" as const : eligible === true ? "SIGNAL" as const : eligible === false ? "OFF" as const : "ERROR" as const;
  const directions = [
    { direction: "LONG" as const, state: directionState(signal?.decision.longEligible), stageLabel: details.status !== "LIVE" ? "実state未確認" : signal?.decision.longEligible ? details.executionTrace.currentStageLabel : "条件未成立", blocker: details.status !== "LIVE" ? details.reason : details.killSwitchActive ? "共有Kill Switchが有効です。" : signal?.decision.longEligible === false ? blocker : undefined, detail: signal?.decision.longEligible && details.status === "LIVE" && !details.killSwitchActive ? "PENGU runnerのLong条件が成立しています。" : "PENGU runnerからLong成立を確認できません。" },
    { direction: "SHORT" as const, state: directionState(signal?.decision.shortEligible), stageLabel: details.status !== "LIVE" ? "実state未確認" : signal?.decision.shortEligible ? details.executionTrace.currentStageLabel : "条件未成立", blocker: details.status !== "LIVE" ? details.reason : details.killSwitchActive ? "共有Kill Switchが有効です。" : signal?.decision.shortEligible === false ? blocker : undefined, detail: signal?.decision.shortEligible && details.status === "LIVE" && !details.killSwitchActive ? "PENGU runnerのShort条件が成立しています。" : "PENGU runnerからShort成立を確認できません。" },
  ];
  return <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-gold-100" /><h2 className="text-xl font-black">PENGU Dual LS V2 / Short V20</h2></div><p className="mt-1 text-[11px] text-white/45">Long / Shortを分離した実Runner判定</p></div><div className="flex items-center gap-2"><RuntimeBadge status={details.status} /><span className="rounded-full border border-emerald-300/25 bg-emerald-400/8 px-3 py-1 text-[10px] font-bold text-emerald-100">tradingMutation=0</span></div></div><div className="mt-4"><div className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-white/45">DIRECTION</div><div className="max-w-2xl"><PenguDirectionCards directions={directions} /></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">確定H1</div><div className="mt-1 font-bold text-white">{time(signal?.referenceTs)}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">Side</div><div className="mt-1 font-bold text-white">{signal?.side === 1 ? "LONG" : signal?.side === -1 ? "SHORT" : "WAIT"}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">volumeRatio</div><div className="mt-1 font-bold text-white">{number(features.volumeRatio6OverPrior36, 3)}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">BTC 24h</div><div className="mt-1 font-bold text-white">{number(features.btcReturn24h, 2)}%</div></div></div><div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-sm font-bold text-white">現在の段階：{details.executionTrace.currentStageLabel}</div><div className="mt-3"><StageIndicator steps={details.executionTrace.steps} /></div><div className="mt-4"><StepList trace={details.executionTrace} /></div><div className="mt-3"><FinalGate trace={details.executionTrace} detail={signal?.reason || details.reason} /></div></div><div className="mt-3 grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/60"><div>BTC EMA168距離：{number(features.btcEma168Distance)}</div><div>relativeReturn24h：{number(features.relativeReturn24h)}</div><div>ATR24 ratio：{number(features.atr24Ratio)}</div><div>RSI14：{number(features.rsi14, 2)}</div><div>建玉：{details.position ? `side ${details.position.side ?? "—"} / qty ${number(details.position.quantity, 6)}` : "なし"}</div></div><div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/60"><div>最新判定理由：{signal?.reason || "未取得"}</div><div>runner更新：{time(details.updatedAt)}</div><div>current failures：{details.failures.length}件</div><div>resolved failures：{details.resolvedFailures.length}件</div></div></div>{details.failures.length ? <div className="mt-3 rounded-xl border border-rose-300/25 bg-rose-400/8 px-3 py-2 text-xs leading-5 text-rose-100">現在のFail-Closed：{details.failures.map((failure) => failure.message).join(" / ")}</div> : <div className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-400/8 px-3 py-2 text-xs text-emerald-100">現在のFail-Closed：なし</div>}</section>;
}

function V52Detail({ details: sourceDetails }: { details?: V52Details }) {
  if (!sourceDetails) return <section className="rounded-2xl border border-dashed border-white/12 px-4 py-7 text-center text-sm text-white/50">V52の実Runner詳細を取得できません。</section>;
  const details: V52Details = sourceDetails.status === "UNAVAILABLE"
    ? { ...sourceDetails, errors: [...sourceDetails.errors, "V52 runner state未取得のため、Kill Switch状態は未確認です。"] }
    : sourceDetails;
  const rows = details.windows.flatMap((window) => [...window.entries, ...window.rejections].map((row) => ({ ...row, window: window.window }))).sort((left, right) => (left.attemptIndex ?? -1) - (right.attemptIndex ?? -1));
  return <section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Activity className="h-5 w-5 text-gold-100" /><h2 className="text-xl font-black">V52 Top2 / STOCK</h2></div><p className="mt-1 text-[11px] text-white/45">株式候補の実telemetryと発注判断</p></div><div className="flex items-center gap-2"><RuntimeBadge status={details.status} /><span className="rounded-full border border-emerald-300/25 bg-emerald-400/8 px-3 py-1 text-[10px] font-bold text-emerald-100">tradingMutation=0</span></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">市場区分</div><div className="mt-1 font-bold text-cyan-100">EQUITY / STOCK</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">建玉</div><div className="mt-1 font-bold text-white">{details.activeV50Slots}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">reference</div><div className="mt-1 font-bold text-white">{details.referenceStatus || "未取得"}</div></div><div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/40">Kill Switch</div><div className={`mt-1 font-bold ${details.killSwitchActive ? "text-rose-200" : "text-emerald-200"}`}>{details.killSwitchActive ? "ACTIVE" : "inactive"}</div></div></div><div className="mt-4 space-y-2">{details.windows.map((window) => <details key={window.window} className="rounded-2xl border border-white/10 bg-black/20 p-3"><summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm font-bold text-white"><ChevronDown className="h-4 w-4 text-gold-100" />{window.window} NY<span className="text-[11px] font-normal text-white/45">候補 {window.candidates.length} / retry {window.transientRetryCount}</span></summary><div className="mt-3 space-y-2">{window.candidates.map((candidate, index) => <div key={`${candidate.symbol || "candidate"}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/8 bg-black/20 px-3 py-2 text-xs"><span className="font-bold text-white">R{candidate.candidateRank ?? "—"} / {candidate.symbol || "—"}</span><span className="text-white/60">basis {number(candidate.basisBps, 2)}bps</span><StateBadge state="WATCH" /></div>)}{!window.candidates.length ? <div className="text-xs text-white/45">この窓の候補snapshotはありません。</div> : null}</div></details>)}</div><div className="mt-4"><FinalGate detail={rows[rows.length - 1]?.orderBlockedReason || rows[rows.length - 1]?.orderResult || "V52の発注判断telemetryはまだありません。"} /></div>{rows.length ? <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20"><table className="min-w-[980px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">窓</th><th className="px-3 py-2">候補</th><th className="px-3 py-2">要求→配分</th><th className="px-3 py-2">空き/Global</th><th className="px-3 py-2">送信</th><th className="px-3 py-2">結果/阻止理由</th></tr></thead><tbody>{rows.slice(-12).reverse().map((row, index) => <tr key={`${row.window}-${row.symbol || "row"}-${index}`} className="border-t border-white/5"><td className="px-3 py-2 text-white/75">{row.window} NY</td><td className="px-3 py-2 font-bold text-white">R{row.candidateRank ?? "—"} / {row.symbol || "—"}</td><td className="px-3 py-2 text-white/70">{number(row.requestedGross, 2)}x → {number(row.allocatedGross, 2)}x</td><td className="px-3 py-2 text-white/70">{number(row.availableGrossBeforeEntry, 2)}x / {number(row.globalGrossBeforeReservation, 2)}x</td><td className="px-3 py-2 text-white/70">{row.orderSendAttempted ? "attempted" : "なし"}</td><td className="px-3 py-2 text-rose-100">{row.orderResult || row.orderBlockedReason || row.rank2RejectedReason || "—"}</td></tr>)}</tbody></table></div> : null}{details.errors.length ? <div className="mt-3 rounded-xl border border-amber-300/25 bg-amber-400/8 px-3 py-2 text-xs text-amber-100">観測上の注意：{details.errors.join(" / ")}</div> : null}</section>;
}

type Tab = "ALL" | "V12" | "PENGU" | "V52";

export function DecisionStatusPanel() {
  const { snapshot: rawSnapshot, loading, error, refresh } = useDecisionStatus();
  const [tab, setTab] = useState<Tab>("ALL");
  const snapshot = rawSnapshot as Snapshot | null;
  const model = useMemo(() => snapshot ? buildDecisionViewModel(snapshot) : null, [snapshot]);
  if (loading && !snapshot) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-10 text-center text-sm text-white/55">判定状況を取得しています…</div>;
  if (!snapshot || !model) return <div className="rounded-2xl border border-rose-300/25 bg-rose-400/8 px-4 py-10 text-center text-sm text-rose-100">{error || "判定データを取得できません。"}</div>;
  const counts = ["FIRE", "SIGNAL", "WAITING", "BLOCKED", "WATCH", "OFF", "ERROR"].map((state) => ({ state: state as UiDecisionState, count: model.strategyCards.filter((card) => card.state === state).length }));
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3"><div className="flex items-center gap-2 text-xs text-white/62"><ShieldCheck className="h-4 w-4 text-emerald-300" />HPは読み取り専用 / tradingMutation=0<span className="hidden text-white/30 md:inline">·</span><span className="hidden md:inline">確認：{time(snapshot.checkedAt)}</span></div><button type="button" onClick={() => void refresh(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"><RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />{loading ? "更新中" : "再確認"}</button></div><div className="grid grid-cols-3 gap-2 sm:grid-cols-6">{counts.map((item) => <div key={item.state} className="rounded-2xl border border-white/10 bg-black/20 p-3 text-center"><div className="flex justify-center"><StateBadge state={item.state} /></div><div className="mt-2 text-2xl font-black text-white">{item.count}</div></div>)}</div>{error ? <div className="rounded-xl border border-amber-300/25 bg-amber-400/8 px-4 py-3 text-xs text-amber-100">一部データを取得できません：{error}</div> : null}<RuntimeSummary snapshot={snapshot} model={model} /><div className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-2">{(["ALL", "V12", "PENGU", "V52"] as Tab[]).map((item) => <button key={item} type="button" onClick={() => setTab(item)} className={`shrink-0 rounded-xl px-4 py-2 text-xs font-bold tracking-[0.12em] ${tab === item ? "bg-gold-400/15 text-gold-100" : "text-white/55 hover:bg-white/[0.04]"}`}>{item === "PENGU" ? "PENGU V2" : item}</button>)}</div>{tab === "ALL" ? <><section className="panel-gold rounded-[26px] p-4 md:p-5"><div className="mb-3 flex items-center justify-between gap-2"><div><div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-100/70">ALL / ATTENTION</div><h2 className="text-xl font-black">発火段階が進んでいる順</h2></div><span className="text-[11px] text-white/45">最大3件 / 実データのみ</span></div><AttentionList items={model.attentionItems} /></section><StrategyOverviewCards cards={model.strategyCards} /></> : null}{tab === "V12" ? <V12Detail details={snapshot.v12Observability} /> : null}{tab === "PENGU" ? <PenguDetail details={snapshot.penguRuntime} /> : null}{tab === "V52" ? <V52Detail details={snapshot.v52Top2Observability} /> : null}<div className="flex items-center gap-2 rounded-xl border border-white/8 bg-black/15 px-3 py-2 text-[11px] text-white/45"><Clock3 className="h-3.5 w-3.5" />自動再確認：30秒ごと / 手動の再確認は読み取り専用です。</div></div>;
}
