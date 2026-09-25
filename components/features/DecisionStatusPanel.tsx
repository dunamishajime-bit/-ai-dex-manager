"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Clock3, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";

import { penguFailureDisplayState } from "@/lib/pengu-failure-display";
import { useProductionRuntime } from "@/hooks/useProductionRuntime";
import type { CurrentProductionRuntime } from "@/lib/server/current-production-runtime";
import type { V52Top2Observability, V52Top2DecisionRow } from "@/lib/server/v52-top2-observability";
import type { PenguRuntimeStatus } from "@/lib/server/pengu-runtime-observability";
import type { Quality102RuntimeStatus } from "@/lib/server/quality102-runtime-observability";

type DecisionLogicPage = "overview" | "v12" | "pengu" | "q102" | "v52";

type Q102GateDiagnostic = {
  name?: string;
  pass?: boolean;
  reason?: string;
  value?: number | string | boolean;
  threshold?: number | string;
};

type Q102S34Diagnostic = {
  key?: string;
  family?: string;
  layer?: string;
  variant?: string;
  gridOpen?: boolean;
  rawDetected?: boolean;
  candidateSide?: number;
  proximityScore?: number;
  rankingScore?: number;
  rankingStage?: string;
  reason?: string;
  metrics?: Record<string, number | string | boolean>;
  gates?: Q102GateDiagnostic[];
};

type Q102HighVolDiagnostic = {
  selectionAvailable?: boolean;
  scannerHealthPass?: boolean;
  marketValid?: boolean;
  rawMatched?: boolean;
  matchedSide?: number;
  proximitySide?: number;
  proximityScore?: number;
  rankingScore?: number;
  legacySelectorScore?: number;
  reason?: string;
  rule?: Record<string, number>;
  metrics?: Record<string, number>;
  features?: Record<string, number | boolean>;
  gateProgress?: Record<string, number>;
};

type Q102SymbolSnapshot = {
  ok: true;
  readOnly: true;
  tradingMutation: 0;
  capturedAt: string;
  rankingCapturedAt?: string;
  observerCommitSha?: string;
  rankingModelVersion?: string;
  rankingAvailable?: boolean;
  snapshotSource?: "ranking" | "decision";
  productionSha: string;
  selectorMode: string;
  referenceTs: number;
  selectedSymbol?: string;
  selectedFamily?: string;
  selectedReason: string;
  items: Array<{
    symbol: string;
    eligible: boolean;
    side: "LONG" | "SHORT" | "WAIT";
    family?: string;
    layer?: string;
    variant?: string;
    requestedGross: number;
    reason: string;
    selected: boolean;
    referenceTs: number;
    rankingScore?: number;
    rankingRank?: number;
    rankingFamily?: string;
    rankingLayer?: string;
    rankingVariant?: string;
    rankingStage?: string;
    rankingReason?: string;
    diagnostics?: {
      highVol?: Q102HighVolDiagnostic;
      s34?: Q102S34Diagnostic[];
    };
  }>;
};

type DecisionStatusItem = {
  symbol: string;
  sleeve: "V12" | "V52";
  rank: number;
  score: number;
  scoreMax: number;
  status: "発火候補" | "候補に近い" | "条件不足" | "対象時間外" | "取得不能";
  side: "LONG" | "SHORT" | "WAIT";
  reason: string;
  checkedAt: string;
  source: string;
  dataUpdatedAt?: string;
};

type RuntimeUnit = {
  id: string;
  label: string;
  status: "LIVE" | "STALE" | "UNAVAILABLE" | "UNCONFIRMED";
  releaseSha: string;
  venue: string;
  timeframe: string;
  entryPolicy: string;
  protection: string;
  note: string;
  reason?: string;
  updatedAt?: number;
};

type CandidateDetail = {
  symbol?: string;
  side?: string;
  rank?: number;
  score?: number;
  momentum?: number;
  volumeRatio?: number;
  volatility?: number;
  atr?: number;
  signalGate?: {
    status: "pass" | "blocked" | "unknown";
    code?: string;
    detail: string;
  };
};

type V12Observability = {
  ok: boolean;
  readOnly: true;
  tradingMutation: 0;
  capturedAt: string;
  decisionDetailsAvailable: boolean;
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
    signalGate?: CandidateDetail["signalGate"];
    candidates: CandidateDetail[];
  } | null;
  runnerState: {
    strategyId?: string;
    mode?: string;
    updatedAt?: number;
    lastReferenceTs?: number;
    lastCompletedIdempotencyKey?: string;
    cooldownUntilTs?: number;
    manualReview?: string;
    active?: { symbol?: string; side?: string; quantity?: number; gross?: number; entryPrice?: number; entrySignalTs?: number; holdingBars?: number };
    pending?: { action?: string; symbol?: string; side?: string; signalTs?: number; expectedPrice?: number; requestedGross?: number; reason?: string };
    killSwitch?: { active: boolean; reason?: string; trippedAt?: number };
  } | null;
  sharedRisk: { lossPct?: number; maximumLossPct?: number; tripped: boolean; updatedAt?: number } | null;
  executionTrace: {
    currentStage: string;
    currentStageLabel: string;
    summary: string;
    nextAction: string;
    steps: Array<{ key: string; label: string; state: "pass" | "blocked" | "pending" | "unknown"; detail: string }>;
  };
  v12Positions: Array<{ symbol: string; side: "LONG" | "SHORT"; quantity: number; entryPrice: number; markPrice: number; unrealizedPnlUsd: number }>;
  recentFills: Array<{ id?: string; executedAt?: string; symbol: string; action: string; side?: string; tradeStatus?: string; positionVerified?: boolean; entryPriceUsd?: number; exitPriceUsd?: number; realizedPnlUsd?: number; netPnlUsd?: number; orderId?: string }>;
  wiring: { runnerStateConfigured: boolean; decisionSnapshotConfigured: boolean };
  errors: string[];
};

type Snapshot = {
  ok: boolean;
  readOnly: true;
  refreshIntervalMinutes: number;
  checkedAt: string;
  source: string;
  runtime: { checkedAt: string; units: RuntimeUnit[] };
  v12: { items: DecisionStatusItem[] };
  v52: { marketOpen: boolean; marketLabel: string; items: DecisionStatusItem[] };
  v12Observability?: V12Observability;
  penguRuntime?: PenguRuntimeStatus;
  v52Top2Observability?: V52Top2Observability;
  quality102Runtime?: Quality102RuntimeStatus;
  error?: string;
};

function statusClass(status: DecisionStatusItem["status"]) {
  if (status === "発火候補") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (status === "候補に近い") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  if (status === "取得不能") return "border-rose-400/35 bg-rose-500/10 text-rose-100";
  if (status === "対象時間外") return "border-slate-400/25 bg-slate-500/10 text-slate-200";
  return "border-white/15 bg-white/[0.04] text-white/75";
}

function rankClass(rank: number) {
  if (rank === 1) return "border-emerald-300/50 bg-emerald-400/15 text-emerald-100";
  if (rank === 2) return "border-cyan-300/50 bg-cyan-400/15 text-cyan-100";
  if (rank === 3) return "border-amber-300/50 bg-amber-400/15 text-amber-100";
  return "border-white/15 bg-white/[0.04] text-white/70";
}

function time(value?: string | number | null) {
  if (value === undefined || value === null || value === "") return "未取得";
  const timestamp = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString("ja-JP") : "未取得";
}

function number(value?: number, digits = 4) { return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits); }
function shortSha(value: string) { return value.slice(0, 8); }

function traceStateClass(state: V12Observability["executionTrace"]["steps"][number]["state"]) {
  if (state === "pass") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (state === "blocked") return "border-rose-400/35 bg-rose-500/10 text-rose-100";
  if (state === "pending") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  return "border-white/15 bg-white/[0.04] text-white/70";
}

function TraceIcon({ state }: { state: V12Observability["executionTrace"]["steps"][number]["state"] }) {
  if (state === "pass") return <CheckCircle2 className="h-4 w-4" />;
  if (state === "blocked") return <AlertCircle className="h-4 w-4" />;
  return <CircleDashed className="h-4 w-4" />;
}

function candidateOrderStatus(candidate: CandidateDetail, decision: NonNullable<V12Observability["decision"]>) {
  if (decision.selectionConfirmed && decision.symbol === candidate.symbol) return "今回Signal選定済み";
  if (candidate.signalGate?.status === "pass") return "Signal Eligible / 今回未選定";
  if (candidate.signalGate?.status === "blocked") return `BLOCKED${candidate.signalGate.code ? ` / ${candidate.signalGate.code}` : ""}`;
  return "runner判定未取得";
}

function runtimeStatusClass(status: RuntimeUnit["status"]) {
  if (status === "LIVE") return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  if (status === "STALE") return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  if (status === "UNCONFIRMED") return "border-slate-400/30 bg-slate-500/10 text-slate-200";
  return "border-rose-400/30 bg-rose-500/10 text-rose-100";
}

function penguTraceStateClass(state: PenguRuntimeStatus["executionTrace"]["steps"][number]["state"]) {
  if (state === "pass") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (state === "blocked") return "border-rose-400/35 bg-rose-500/10 text-rose-100";
  if (state === "pending") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  return "border-white/15 bg-white/[0.04] text-white/70";
}

function penguStatusClass(status: PenguRuntimeStatus["status"]) {
  if (status === "LIVE") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (status === "STALE") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  return "border-rose-400/35 bg-rose-500/10 text-rose-100";
}

function RuntimeSummary({ runtime }: { runtime: Snapshot["runtime"] }) {
  const liveCount = runtime.units.filter((unit) => unit.status === "LIVE").length;
  const verified = liveCount === runtime.units.length;
  const badge = verified ? "全runner LIVE確認済み" : liveCount > 0 ? `${liveCount}/${runtime.units.length} runner LIVE確認` : "LIVE未確認";
  const badgeClass = verified ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : liveCount > 0 ? "border-amber-400/35 bg-amber-500/10 text-amber-100" : "border-rose-400/35 bg-rose-500/10 text-rose-100";
  return <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-lg font-bold text-white"><ServerCog className="h-5 w-5 text-gold-100" />VPS実稼働ロジック</div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badgeClass}`}>{badge}</span></div><p className="mt-2 text-xs leading-5 text-white/55">確認時刻：{time(runtime.checkedAt)} / runnerごとに実stateの更新時刻・mode・保護状態を判定します。1つのrunnerが要確認でも、他runnerのLIVE状態は独立して表示します。ここから発注操作は行いません。</p><div className="mt-4 grid gap-3 xl:grid-cols-3">{runtime.units.map((unit) => <article key={unit.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-start justify-between gap-2"><div><div className="font-bold text-white">{unit.label}</div><div className="mt-1 text-[11px] text-white/45">{unit.venue} / {unit.timeframe}</div></div><span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${runtimeStatusClass(unit.status)}`}>{unit.status === "UNAVAILABLE" ? "未取得" : unit.status === "UNCONFIRMED" ? "未確認" : unit.status === "STALE" ? "要確認" : "LIVE"}</span></div><div className="mt-3 space-y-2 text-xs leading-5 text-white/72"><p><span className="text-white/45">判定：</span>{unit.entryPolicy}</p><p><span className="text-white/45">保護：</span>{unit.protection}</p><p className="text-white/50">{unit.note}</p><p className="text-amber-100/80">状態根拠：{unit.reason || "未取得"}</p></div><div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-white/40">release {shortSha(unit.releaseSha)}… / state更新 {time(unit.updatedAt)}</div></article>)}</div></section>;
}

function V12Detail({ details, production }: { details?: V12Observability; production?: CurrentProductionRuntime | null }) {
  if (!details) return null;
  const decision = details.decision;
  const trace = details.executionTrace;
  const runner = details.runnerState;
  const decisionLabel = decision ? (decision.symbol || "候補未取得") + " " + (decision.side || "WAIT") : "候補未取得";
  const eligibleCount = decision?.candidates.filter((candidate) => candidate.signalGate?.status === "pass").length ?? 0;
  const statusLabel = details.errors.length ? "要確認" : details.decisionDetailsAvailable ? "観測済み" : "未取得";
  const statusClass = details.errors.length ? "border-amber-400/35 bg-amber-500/10 text-amber-100" : details.decisionDetailsAvailable ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : "border-rose-400/35 bg-rose-500/10 text-rose-100";
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />V12 X1.00 ALL 発火経路</div>
          <p className="mt-1 text-xs text-white/55">VPSのV12 runner state / sanitized decision snapshot / 共有riskを読み取り、候補順位から発注・約定までを段階表示</p>
        </div>
        <div className="flex flex-wrap gap-2"><span className={"rounded-full border px-3 py-1 text-xs font-semibold " + statusClass}>V12 {statusLabel}</span><span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">tradingMutation=0</span></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[
          ["判定段階", trace.currentStageLabel],
          ["候補", decisionLabel],
          ["Rank", decision?.rank === undefined ? "—" : String(decision.rank)],
          ["score", number(decision?.score, 4)],
          ["momentum", number(decision?.momentum, 4) + "%"],
          ["volumeRatio", number(decision?.volumeRatio, 4)],
          ["BTC regime", decision?.btcRegime || "未取得"],
          ["Signal", decision?.selectionConfirmed ? "選定済み" : "未成立"],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className={"mt-1 break-words text-sm font-semibold " + (value === "未成立" || value === "未取得" ? "text-rose-200" : "text-white")}>{value}</div></div>)}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-sm font-bold text-white">候補選定から発注・約定まで</div>
          <p className="mt-2 text-sm leading-6 text-white/80">{trace.summary}</p>
          <p className="mt-2 text-xs leading-5 text-gold-100">次の判定：{trace.nextAction}</p>
          <div className="mt-3 space-y-2">{trace.steps.map((step) => <div key={step.key} className={"flex items-start gap-2 rounded-xl border px-3 py-2 text-xs " + traceStateClass(step.state)}><TraceIcon state={step.state} /><div><div className="font-semibold">{step.label}</div><div className="mt-0.5 leading-5 opacity-85">{step.detail}</div></div></div>)}</div>
        </div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="text-sm font-bold text-white">実state / Gate詳細</div>
          <div className="mt-3 space-y-2 text-xs leading-5 text-white/75">
            <p>runner更新：{time(runner?.updatedAt)}</p>
            <p>strategyId：{runner?.strategyId || decision?.strategyId || "未取得"}</p>
            <p>mode：{runner?.mode || "未取得"} / 同一足idempotency：{runner?.lastCompletedIdempotencyKey ? "記録あり" : "未取得"}</p>
            <p>共有risk：{details.sharedRisk ? (details.sharedRisk.tripped ? "停止中" : "通過") + " / loss " + number(details.sharedRisk.lossPct, 2) + "% / 上限 " + number(details.sharedRisk.maximumLossPct, 2) + "%" : "未取得（Fail Closed）"}</p>
            <p>Kill Switch：{runner?.killSwitch ? (runner.killSwitch.active ? "ACTIVE" : "inactive") + (runner.killSwitch.reason ? " / " + runner.killSwitch.reason : "") : "未取得"}</p>
            <p>state接続：{details.wiring.runnerStateConfigured ? "絶対パス設定済み" : "未設定"} / decision snapshot：{details.wiring.decisionSnapshotConfigured ? "絶対パス設定済み" : "未設定"}</p>
            <p>建玉：{runner?.active ? (runner.active.symbol || "—") + " " + (runner.active.side || "—") + " / gross " + number(runner.active.gross, 3) + "x" : "なし"}</p>
            <p>pending：{runner?.pending ? (runner.pending.action || "ORDER") + " " + (runner.pending.symbol || "—") + " / " + (runner.pending.reason || "—") : "なし"}</p>
            <p>観測エラー：{details.errors.length ? details.errors.join(" / ") : "なし"}</p>
          </div>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
        <div className="border-b border-white/10 px-3 py-2"><div className="text-sm font-bold text-white">全候補順位と実runner Gate</div><div className="mt-1 text-[11px] text-white/55">Signal Eligible {eligibleCount}/{decision?.candidates.length ?? 0}。緑はVPS runnerの signalEligible=true のみ。最終発注には建玉枠・共有Gross・重複防止・注文Gateも別途必要です。</div></div>
        {decision?.candidates.length ? <table className="min-w-[980px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">Rank</th><th className="px-3 py-2">候補</th><th className="px-3 py-2">score</th><th className="px-3 py-2">momentum</th><th className="px-3 py-2">volumeRatio</th><th className="px-3 py-2">実runner Gate</th><th className="px-3 py-2">今回の扱い</th></tr></thead><tbody>{decision.candidates.map((candidate, index) => <tr key={(candidate.symbol || "candidate") + "-" + index} className="border-t border-white/5"><td className="px-3 py-2"><span className={"inline-flex min-w-7 justify-center rounded-full border px-2 py-1 font-bold " + rankClass(candidate.rank || 99)}>{candidate.rank ?? "—"}</span></td><td className="px-3 py-2 font-semibold text-white">{candidate.symbol || "—"} <span className="ml-1 text-white/50">{candidate.side || "WAIT"}</span></td><td className="px-3 py-2 text-white/75">{number(candidate.score, 4)}</td><td className="px-3 py-2 text-white/75">{number(candidate.momentum, 4)}%</td><td className="px-3 py-2 text-white/75">{number(candidate.volumeRatio, 4)}</td><td className={"px-3 py-2 font-semibold " + (candidate.signalGate?.status === "pass" ? "text-emerald-200" : candidate.signalGate?.status === "blocked" ? "text-rose-200" : "text-amber-200")}>{candidate.signalGate?.detail || "未取得"}</td><td className="px-3 py-2 text-white/75">{candidateOrderStatus(candidate, decision)}</td></tr>)}</tbody></table> : <div className="px-3 py-4 text-sm text-amber-100">V12 decision snapshotに全候補がありません。順位比較だけでなく発注Signalを確定できないためFail Closedです。</div>}
      </div>
      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-5 text-white/65">{production?.v12 && production?.caps ? <>V12 contract: per-position {production.caps.v12PerPositionGross.toFixed(2)}x / Top{production.v12.maximumPositions} / Base {production.caps.v12BaseGross.toFixed(2)}x / Dynamic {production.caps.v12DynamicGross.toFixed(2)}x / Score&gt;={production.v12.neutralScoreThreshold.toFixed(4)} / Strong {production.v12.strongRegimeQualityScoreMinimum.toFixed(2)}-{production.v12.strongRegimeQualityScoreMaximum.toFixed(2)} + ATR&gt;={(production.v12.strongRegimeQualityMinimumAtrRatio * 100).toFixed(1)}%. Recent fills: {details.recentFills.length} / positions: {details.v12Positions.length}.</> : <>Production runtime unavailable; no static contract fallback.</>}</div>
    </section>
  );
}

function PenguDetail({ details, production }: { details?: PenguRuntimeStatus; production?: CurrentProductionRuntime | null }) {
  if (!details) return null;
  const signal = details.latestSignal;
  const trace = details.executionTrace;
  const decision = signal?.decision;
  const feature = signal?.features || {};
  const penguContract = production?.pengu;
  const caps = production?.caps;
  const recoveryState = signal?.entryVersion === "RECOVERY_V8" ? "成立" : decision?.active ? "通常シグナル優先" : "R_BTC3評価待ち";
  const boolLabel = (value?: boolean) => value === undefined ? "未取得" : value ? "成立" : "未成立";
  const currentFailures = details.failures;
  const resolvedFailures = details.resolvedFailures;
  const failureDisplay = penguFailureDisplayState(details.killSwitchActive === true, currentFailures.length);
  const failurePanelClass = failureDisplay.historyKind === "active" ? "border-rose-400/25 bg-rose-500/5" : "border-amber-400/25 bg-amber-500/5";
  const failureTextClass = failureDisplay.historyKind === "active" ? "text-rose-200" : "text-amber-100";
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />PENGU V2 / Short V20 / Recovery V8 発火経路</div>
          <p className="mt-1 text-xs text-white/55">実PENGU runner-live.jsonの確定H1、通常Long/Short、Recovery V8補助Entry、共有Gate、建玉・注文Windowを読み取り表示</p>
        </div>
        <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${penguStatusClass(details.status)}`}>PENGU {details.status === "LIVE" ? "稼働確認済み" : details.status === "STALE" ? "要確認" : "状態未取得"}</span><span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">tradingMutation=0</span></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">{[["判定段階", trace.currentStageLabel], ["確定足", time(signal?.referenceTs)], ["Side", signal?.side === 1 ? "LONG" : signal?.side === -1 ? "SHORT" : "WAIT"], ["Long", boolLabel(decision?.longEligible)], ["Short", boolLabel(decision?.shortEligible)], ["Recovery V8", recoveryState], ["target gross", signal?.targetGross === undefined ? "—" : `${number(signal.targetGross, 3)}x`], ["volumeRatio", number(feature.volumeRatio6OverPrior36, 3)], ["BTC 24h", `${number(feature.btcReturn24h, 2)}%`]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className={`mt-1 break-words text-sm font-semibold ${value === "未成立" || value === "WAIT" ? "text-rose-200" : "text-white"}`}>{value}</div></div>)}</div>
      <div className="mt-4 rounded-2xl border border-gold-400/20 bg-gold-500/5 p-4"><div className="text-sm font-bold text-gold-100">Current Production PENGU contract</div>{penguContract && caps ? <><p className="mt-2 text-xs leading-6 text-white/75">Gross {caps.penguGross.toFixed(2)}x / Recovery {penguContract.recoveryRule} / {penguContract.recoveryPriority} / initial {penguContract.recoveryInitialGross.toFixed(2)}x / cooldown {penguContract.hardStopCooldownHours}h.</p><p className="mt-1 text-xs leading-6 text-white/75">RSI delta6 &gt;= {penguContract.recoveryRsiDelta6Min.toFixed(2)} / EMA168 distance &gt;= {penguContract.recoveryEma168DistanceMinPct.toFixed(2)}% / BTC 6h &gt;= {penguContract.recoveryBtcReturn6hMinPct.toFixed(2)}%.</p><p className="mt-1 text-xs leading-6 text-white/60">Partial after {penguContract.recoveryPartialAfterHours}h: {penguContract.recoveryPartialGross.toFixed(2)}x / hard stop {(penguContract.recoveryHardStopPct * 100).toFixed(1)}% / trail {(penguContract.recoveryTrailActivationPct * 100).toFixed(1)}% activation / {(penguContract.recoveryTrailRetracePct * 100).toFixed(1)}% retrace / max hold {penguContract.recoveryMaxHoldHours}h.</p><p className="mt-1 text-xs leading-5 text-white/60">Kill Switch: {failureDisplay.killSwitchLabel} / {failureDisplay.historyLabel}: {failureDisplay.failureCount}件 / 解消済み履歴: {resolvedFailures.length}件。</p></> : <p className="mt-2 text-xs text-amber-100">Production runtime unavailable; no static contract fallback.</p>}</div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-sm font-bold text-white">発火から約定まで</div><p className="mt-2 text-sm leading-6 text-white/80">{trace.summary}</p><p className="mt-2 text-xs leading-5 text-gold-100">次の判定：{trace.nextAction}</p><div className="mt-3 space-y-2">{trace.steps.map((step) => <div key={step.key} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${penguTraceStateClass(step.state)}`}><TraceIcon state={step.state === "pass" ? "pass" : step.state === "blocked" ? "blocked" : step.state === "pending" ? "pending" : "unknown"} /><div><div className="font-semibold">{step.label}</div><div className="mt-0.5 leading-5 opacity-85">{step.detail}</div></div></div>)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-sm font-bold text-white">実データ詳細</div><div className="mt-3 space-y-2 text-xs leading-5 text-white/75"><p>runner更新：{time(details.updatedAt)}</p><p>VPS実行release：{shortSha(details.expectedReleaseSha)}…（systemd反映SHA）</p><p>state内release：{details.releaseSha ? `${shortSha(details.releaseSha)}… / ${details.releaseShaVerified === true ? "一致" : "要確認"}` : "stateに未保存（VPS実行SHAを表示）"}</p><p>Kill Switch：{failureDisplay.killSwitchLabel}{details.killSwitchActive && details.reason ? ` / ${details.reason}` : ""}</p><p>共有risk：{details.sharedRisk ? `${details.sharedRisk.tripped ? "停止中" : "通過"} / loss ${number(details.sharedRisk.lossPct, 2)}% / 上限 ${number(details.sharedRisk.maximumLossPct, 2)}%` : "未取得（Fail Closed）"}</p><p>最新判定理由：{signal?.reason || "未取得"}</p><p>BTC EMA168距離：{number(feature.btcEma168Distance, 4)}</p><p>relativeReturn24h：{number(feature.relativeReturn24h, 4)}</p><p>ATR24 ratio：{number(feature.atr24Ratio, 4)}</p><p>RSI14：{number(feature.rsi14, 2)}</p><p>建玉：{details.position ? `side ${details.position.side ?? "—"} qty ${number(details.position.quantity, 6)}` : "なし"}</p><p>pending：{details.pending ? `${details.pending.phase || "ORDER"} / ${details.pending.reason || "—"}` : "なし"}</p></div></div>
      </div>
      {currentFailures.length ? <div className={`mt-4 overflow-x-auto rounded-2xl border ${failurePanelClass}`}><div className="border-b border-white/10 px-3 py-2 text-sm font-bold text-white">{failureDisplay.historyLabel}</div><table className="min-w-[760px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">時刻</th><th className="px-3 py-2">停止理由</th></tr></thead><tbody>{currentFailures.slice().reverse().map((failure, index) => <tr key={`${failure.occurredAt}-${index}`} className="border-t border-white/5"><td className="px-3 py-2 text-white/70">{time(failure.occurredAt)}</td><td className={`px-3 py-2 ${failureTextClass}`}>{failure.message}</td></tr>)}</tbody></table></div> : <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">Kill Switch inactive / 現在のFail-Closed：なし。PENGU/BTCの最新確定H1足は同期済みです。</div>}
      {resolvedFailures.length ? <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">解消済みFail-Closed履歴：{resolvedFailures.length}件。過去のアラインメントエラーは監査用にVPS stateへ保持していますが、現在の停止理由ではありません。</div> : null}
      {details.reason ? <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">観測理由：{details.reason}</div> : null}
    </section>
  );
}

function v52StatusClass(status?: V52Top2Observability["status"] | "UNCONFIRMED") {
  if (status === "LIVE") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (status === "STALE") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  if (status === "UNCONFIRMED") return "border-slate-400/35 bg-slate-500/10 text-slate-100";
  return "border-rose-400/35 bg-rose-500/10 text-rose-100";
}

function gross(value?: number) { return value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}x`; }
function bps(value?: number) { return value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}bps`; }

function V52Top2Detail({ details, marketOpen, production }: { details?: V52Top2Observability; marketOpen?: boolean; production?: CurrentProductionRuntime | null }) {
  const v52Contract = production?.v52;
  const caps = production?.caps;
  if (!details) return null;
  const marketClosed = marketOpen === false;
  const displayStatus = marketClosed ? "UNCONFIRMED" : details.status;
  const telemetryRows: Array<{ window: string; kind: string; row: V52Top2DecisionRow }> = details.windows.flatMap((window) => [
    ...window.entries.map((row) => ({ window: window.window, kind: "結果", row })),
    ...window.rejections.map((row) => ({ window: window.window, kind: "拒否", row })),
  ]).slice(-12).reverse();
  const hasTelemetry = details.telemetryState === "CURRENT_DAY" && details.windows.some((window) => window.candidates.length || window.entries.length || window.rejections.length || window.transientRetryCount > 0);
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />V52 Top2 発火候補 → 発注判断</div>
          <p className="mt-1 text-xs text-white/55">VPSのrunner-live.jsonを読み取り専用で観測。候補の再生成・注文操作は行いません。</p>
        </div>
        <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${v52StatusClass(displayStatus)}`}>V52 {marketClosed ? "市場時間外・意図的停止" : details.status === "LIVE" ? "稼働確認済み" : details.status === "STALE" ? "状態はあるが要確認" : "状態未取得"}</span><span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">tradingMutation=0</span></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {v52Contract && caps ? [["Policy", v52Contract.policyId], ["Slot / Stock", `${caps.v52V50Gross.toFixed(2)}x / ${caps.stockGross.toFixed(2)}x`], ["basis Gate", `>=${bps(v52Contract.minimumEntryBasisBps)}`], ["net edge Gate", `>=${bps(v52Contract.minimumNetEdgeBps)}`], ["NY day", `${details.currentNyDay}${details.dailyDiagnosticsFresh ? " / fresh" : " / stale"}`], ["orders", details.referenceOrdersAllowed === true ? "allowed" : "Fail Closed"], ["Kill Switch", details.killSwitchActive ? "ACTIVE" : "inactive"]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className={`mt-1 break-words text-sm font-semibold ${label === "Kill Switch" && value === "ACTIVE" ? "text-rose-200" : "text-white"}`}>{value}</div></div>) : <div className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-100">Production runtime unavailable</div>}
      </div>
      <div className="mt-4 rounded-2xl border border-gold-400/20 bg-gold-500/5 p-4">
        <div className="text-sm font-bold text-gold-100">V52 Top2の確定仕様</div>
        {v52Contract && caps ? <p className="mt-2 text-xs leading-6 text-white/75">NY {v52Contract.windowsNy.join(" / ")} / Slot {caps.v52V50Gross.toFixed(2)}x / Stock {caps.stockGross.toFixed(2)}x / Total {caps.totalGross.toFixed(2)}x.</p> : <p className="mt-2 text-xs text-amber-100">Production runtime unavailable; no static contract fallback.</p>}
        {v52Contract ? <p className="mt-1 text-xs leading-6 text-white/60">Basis &gt;={bps(v52Contract.minimumEntryBasisBps)} / Convergence {bps(v52Contract.convergenceBps)} / Stop {v52Contract.basisStopMultiple.toFixed(2)}x / Net Edge &gt;={bps(v52Contract.minimumNetEdgeBps)} / Max Cost {bps(v52Contract.maximumRoundTripCostBps)} / Spread {bps(v52Contract.maximumSpreadBps)} / Hold &lt;={v52Contract.maximumHoldingHours}h.</p> : null}
      </div>
      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-5 text-white/70">V52 runner state更新：{time(details.updatedAt)} / LIVE判定理由：{details.reason || "未取得"} / reference={details.referenceStatus || "未取得"} / reference health={details.referenceHealth ? (details.referenceHealth.ready ? "ready" : "blocked / " + details.referenceHealth.reason) : "未接続"} / orders={details.referenceOrdersAllowed === true ? "許可条件内" : "Fail Closed"}。キー未設定・state stale・reference品質未達のいずれでも実注文へ進みません。</div>
      {details.telemetryState !== "CURRENT_DAY" ? <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">{details.telemetryState === "STALE" ? "STALE / 発注不可：V52 daily diagnosticsが当日NY日付へ更新されていません。前日のGate拒否を現在の理由として表示していません。" : "Runner telemetry未取得：当日の判定stateをまだ取得できません。"}</div> : !hasTelemetry ? <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 p-4 text-sm leading-6 text-emerald-100">本日判定済み / 条件適合候補なし：現在NY day {details.currentNyDay} のstateはfreshですが、条件を満たすV50候補はありません。発注は行いません。</div> : <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20"><div className="border-b border-white/10 px-3 py-2 text-sm font-bold text-white">直近Top2 telemetry</div><table className="min-w-[1250px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">窓</th><th className="px-3 py-2">種別</th><th className="px-3 py-2">Rank /候補</th><th className="px-3 py-2">要求/配分</th><th className="px-3 py-2">空き/Global</th><th className="px-3 py-2">Rank2</th><th className="px-3 py-2">送信</th><th className="px-3 py-2">結果/阻止理由</th></tr></thead><tbody>{telemetryRows.map(({ window, kind, row }, index) => <tr key={`${window}-${kind}-${row.symbol || "none"}-${index}`} className="border-t border-white/5"><td className="px-3 py-2 text-white/75">{window} NY</td><td className={`px-3 py-2 font-semibold ${kind === "拒否" ? "text-rose-200" : "text-white"}`}>{kind}</td><td className="px-3 py-2 text-white">R{row.candidateRank ?? "—"} / {row.symbol || "—"}<span className="ml-1 text-white/45">(qualified {row.qualifiedRank ?? "—"})</span></td><td className="px-3 py-2 text-white/75">{gross(row.requestedGross)} → {gross(row.allocatedGross)}</td><td className="px-3 py-2 text-white/75">{gross(row.availableGrossBeforeEntry)} / {gross(row.globalGrossBeforeReservation)} → {gross(row.globalGrossAfterReservation)}</td><td className="px-3 py-2 text-white/75">{row.rank2Accepted === true ? "accepted" : row.rank2RejectedReason || "—"}</td><td className="px-3 py-2 text-white/75">{row.orderSendAttempted === true ? "attempted" : "なし"}</td><td className="px-3 py-2 text-rose-200">{row.orderResult || row.orderBlockedReason || row.rank2RejectedReason || "—"}</td></tr>)}</tbody></table></div>}
      {details.lastDecision ? <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-5 text-white/70">直近V50判断：{details.lastDecision.symbol || "—"} / {details.lastDecision.window || "—"} / basis {bps(details.lastDecision.currentBasisBps)} / estimated cost {bps(details.lastDecision.estimatedRoundTripCostBps)} / net edge {bps(details.lastDecision.calculatedNetEdgeBps)} / spread {bps(details.lastDecision.spreadBps)} / {details.lastDecision.accepted ? "accepted" : `rejected: ${(details.lastDecision.rejectionReasons || []).join(" / ") || "理由未取得"}`} / timestamp {time(details.lastDecision.timestamp)}</div> : null}
      {details.errors.length ? <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">V52観測上の注意：{details.errors.join(" / ")}</div> : null}
    </section>
  );
}

function Quality102Detail({ details, production }: { details?: Quality102RuntimeStatus; production?: CurrentProductionRuntime | null }) {
  if (!details) return null;
  const statusLabel = details.status === "LIVE" ? "稼働確認済み（derived）" : details.status === "STALE" ? "要確認" : "状態未取得";
  const statusClass = details.status === "LIVE" ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : details.status === "STALE" ? "border-amber-400/35 bg-amber-500/10 text-amber-100" : "border-rose-400/35 bg-rose-500/10 text-rose-100";
  const q102Contract = production?.quality102;
  const caps = production?.caps;
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />Quality102 derived HIGH_VOL 独立スリーブ</div>
          <p className="mt-1 text-xs text-white/55">V12・PENGU・V52を優先し、余剰Crypto/Total Grossだけを使う1-slot補完ロジック。HPは読み取り専用です。</p>
        </div>
        <div className="flex flex-wrap gap-2"><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass}`}>Q102 {statusLabel}</span><span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">tradingMutation=0</span></div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["selector", q102Contract?.selectorMode ?? details.selectorMode],
          ["strategy cap", caps ? `${caps.quality102Gross.toFixed(2)}x` : "runtime unavailable"],
          ["Crypto / Total", caps ? `${caps.cryptoGross.toFixed(2)}x / ${caps.totalGross.toFixed(2)}x` : "runtime unavailable"],
          ["position", details.position ? `${details.position.symbol || "—"} ${details.position.side || "—"}` : "なし"],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className="mt-1 break-words text-sm font-semibold text-white">{value}</div></div>)}
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3 text-xs leading-5 text-white/75">
          <div className="text-sm font-bold text-white">実state / 安全Gate</div>
          <p className="mt-2">runner更新：{time(details.updatedAt)} / state：{time(details.stateUpdatedAt)} / heartbeat：{time(details.heartbeatUpdatedAt)}</p>
          <p>mode：{details.mode || "未取得"} / safety：{details.safetyState || "未取得"}</p>
          <p>release：{details.runtimeSha ? `${shortSha(details.runtimeSha)}… / ${details.releaseShaVerified === true ? "一致" : "要確認"}` : "未取得"}</p>
          <p>建玉：{details.position ? `${details.position.symbol || "—"} ${details.position.side || "—"} / gross ${number(details.position.gross, 3)}x` : "なし"}</p>
          <p>pending：{details.pending ? `${details.pending.phase || "ORDER"} / ${details.pending.symbol || "—"} / ${details.pending.reason || "—"}` : "なし"}</p>
          <p className="mt-2 text-amber-100/85">状態根拠：{details.reason}</p>
          {details.errors.length ? <p className="mt-2 text-amber-100/75">観測注意：{details.errors.join(" / ")}</p> : null}
        </div>
        <div className="rounded-2xl border border-amber-400/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-100/85">
          <div className="text-sm font-bold text-amber-100">適用対象通貨</div>
          <p className="mt-2 break-words">{details.symbols.join(" / ")}</p>
          <p className="mt-2">歴史的102件selector parity：{details.historicalSelectorParity ? "確認済み" : "未証明（該当経路はFAIL CLOSED）"} / BRK live式：{details.brkLiveEnabled ? "有効" : "未証明（FAIL CLOSED）"}</p>
          {q102Contract && caps ? <p className="mt-2">Q102 {q102Contract.selectorMode} / 1 Slot / max {caps.quality102Gross.toFixed(2)}x / HIGH_VOL {q102Contract.familyGross.HIGH_VOL.toFixed(3)}x / MR {q102Contract.familyGross.MR.toFixed(2)}x / BRK {q102Contract.familyGross.BRK.toFixed(3)}x / REV {q102Contract.familyGross.REV.toFixed(2)}x / PB {q102Contract.familyGross.PB.toFixed(2)}x / Crypto {caps.cryptoGross.toFixed(2)}x / Total {caps.totalGross.toFixed(2)}x.</p> : <p className="mt-2">Production runtime unavailable; no static contract fallback.</p>}
        </div>
      </div>
    </section>
  );
}


const Q102_S34_MODELS: Record<string, string[]> = {
  AAVEUSDT: ["MR48_Z2.5_H24 / MR / S3"],
  APTUSDT: ["REV24_T0.05_H24 / REV / S3", "REV6_T0.03_H24 / REV / S3"],
  AVAXUSDT: ["MR24_Z1.5_H24 / MR / S3", "PB168_0.1_P24_0.04_H24 / PB / S3", "REV12_T0.03_H12 / REV / S3", "REV12_T0.03_H8 / REV / S3", "REV12_T0.08_H24 / REV / S3"],
  DOGEUSDT: ["BRK24_H48_V1.0 / BRK / S3", "BRK72_H48_V0.8 / BRK / S3", "MR48_Z2.0_H12 / MR / S4", "MR72_Z1.5_H12 / MR / S4", "MR72_Z2.5_H12 / MR / S4"],
  DOTUSDT: ["BRK72_H48_V0.8 / BRK / S3"],
  FETUSDT: ["BRK24_H48_V1.2 / BRK / S3", "PB168_0.1_P24_0.02_H12 / PB / S3", "PB72_0.1_P12_0.04_H12 / PB / S3", "REV12_T0.05_H12 / REV / S3", "REV12_T0.08_H24 / REV / S3", "REV24_T0.05_H8 / REV / S3", "REV24_T0.08_H8 / REV / S3"],
  LDOUSDT: ["BRK24_H24_V1.0 / BRK / S3", "BRK48_H24_V1.0 / BRK / S3"],
  NEARUSDT: ["BRK168_H24_V1.2 / BRK / S3", "BRK48_H48_V1.2 / BRK / S3"],
  RENDERUSDT: ["BRK168_H12_V1.2 / BRK / S4"],
  SOLUSDT: ["BRK24_H48_V1.2 / BRK / S3", "BRK72_H48_V1.2 / BRK / S3"],
  UNIUSDT: ["MR24_Z2.0_H24 / MR / S4", "MR48_Z1.5_H24 / MR / S4", "MR72_Z1.5_H24 / MR / S4"],
};

function q102ReasonText(reason: string) {
  if (reason === "QUALITY102_CAUSAL_V4_NO_SIGNAL") return "今回の判定時刻では HIGH_VOL / S34 のどちらからも最終候補が生成されていません。";
  if (reason === "QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL") return "REV Long候補は生成されましたが、14日リターン +24% 条件を満たさず棄却。別候補へのbackfillはしません。";
  if (reason === "QUALITY102_CAUSAL_V4_NATURAL_SIGNAL") return "Causal V4の自然シグナルが全Gateを通過しています。";
  if (reason.startsWith("OBSERVER_ERROR:")) return "read-only判定の取得中にエラー: " + reason.slice("OBSERVER_ERROR:".length);
  return reason || "理由未取得";
}


function q102StageText(stage?: string) {
  switch (stage) {
    case "SIGNAL_READY": return "発火条件到達";
    case "IMPROVEMENT_PASS": return "最終Gate直前";
    case "FEATURE_PASS": return "V4追加条件通過";
    case "QUALITY_PASS": return "過去成績・品質条件通過";
    case "RAW_REJECTED": return "基本シグナル発生・後段で不通過";
    case "GRID_WAIT": return "4時間判定待ち";
    case "HIGH_VOL_RAW_READY": return "HIGH_VOL Raw到達";
    case "HIGH_VOL_APPROACH": return "HIGH_VOL接近中";
    case "NO_RAW": return "Raw条件へ接近中";
    case "NO_MODEL": return "観測モデルなし";
    case "OBSERVER_ERROR": return "観測エラー";
    default: return stage || "未評価";
  }
}


function q102GateName(name?: string) {
  switch (name) {
    case "S34_4H_GRID": return "S34 4時間判定タイミング";
    case "RAW_DETECTOR": return "基本シグナル条件";
    case "HISTORICAL_QUALITY": return "過去成績・品質条件";
    case "V4_FEATURE": return "V4追加条件（14日リターン・Margin・Development）";
    case "V4_IMPROVEMENT": return "V4最終改善条件";
    default: return name || "判定条件";
  }
}

function q102GateResult(pass?: boolean) {
  return pass ? "通過" : "不通過";
}

function q102GateReasonText(reason?: string) {
  switch (reason) {
    case "UTC_HOUR_MOD4_EQ1": return "4時間ごとのS34判定時刻に一致";
    case "UTC_HOUR_MOD4_NOT1": return "4時間ごとのS34判定時刻ではない";
    case "RAW_SIGNAL_DETECTED": return "基本シグナル条件を満たした";
    case "RAW_THRESHOLD_NOT_REACHED": return "基本シグナル条件の閾値に未到達";
    case "V4_FEATURE_GATE_PASS": return "V4追加条件をすべて通過";
    case "V4_RET14_WINDOW_REJECT": return "14日リターンがV4の許容範囲外";
    case "V4_BRK_VARIANT_WINDOW_REJECT": return "BRKの通貨・Variant・14日リターン条件がV4許容範囲外";
    case "V4_DEVELOPMENT_GATE_REJECT": return "Development条件が不足";
    case "V4_MARGIN_GATE_REJECT": return "MarginがV4の許容範囲外";
    case "INVALID_V4_FEATURE_SIDE": return "売買方向の入力が不正";
    case "INVALID_V4_FEATURE_INPUT": return "V4追加条件に必要な実測値が不足または不正";
    case "QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL":
      return "REV Longの最終条件で14日リターン+24%以上を満たしていない";
    default: return reason || "";
  }
}

function q102FeatureGateDescription(family?: string, variant?: string, symbol?: string) {
  if (family === "MR") return "MRでは、方向補正14日リターン -15%以上〜-8%未満、Development N 20以上、Dev SPF 0以上、Dev Avg 0以上、Margin 1.05以上〜1.70未満を確認します。";
  if (family === "PB") return "PBでは、方向補正14日リターン -50%以上〜+20%未満、Development各値 0以上、Margin 1.00以上〜1.70未満を確認します。";
  if (family === "REV") return "REVでは、方向補正14日リターン +10%以上〜+30%未満、Development各値 0以上、Margin 1.00以上〜3.00未満を確認します。REV Longはこの後さらに14日リターン+24%以上の最終条件があります。";
  if (family === "BRK") {
    if (symbol === "FETUSDT" && variant === "BRK24_H48_V1.2") return "FET BRK24_H48_V1.2では、方向補正14日リターン +15%以上〜+30%未満を確認します。";
    if (symbol === "NEARUSDT" && variant === "BRK48_H48_V1.2") return "NEAR BRK48_H48_V1.2では、方向補正14日リターン -5%以上〜+2%未満を確認します。";
    if (symbol === "RENDERUSDT" && variant === "BRK168_H12_V1.2") return "RENDER BRK168_H12_V1.2では、方向補正14日リターン +15%以上〜+30%未満を確認します。";
    return "このBRK通貨・VariantはV4追加条件の許可対象外です。BRKは通貨とVariantごとに固定された14日リターン条件を確認します。";
  }
  return "V4追加条件は、基本シグナルと過去品質条件を通過した後に、14日リターン・Margin・DevelopmentなどがV4で固定した許容範囲内かを確認する絞り込み条件です。";
}

function q102GateValueText(gate: Q102GateDiagnostic) {
  if (gate.name === "S34_4H_GRID" && typeof gate.value === "number") {
    return `UTC ${gate.value}時 / 4時間ごとの判定時刻`;
  }
  if (gate.value === undefined) return "";
  return `${String(gate.value)}${gate.threshold !== undefined ? " / 基準 " + String(gate.threshold) : ""}`;
}

function q102MetricName(key: string) {
  const names: Record<string, string> = {
    zScore: "Z-score",
    zThreshold: "必要Z",
    move: "短期Move",
    threshold: "必要Move",
    longRet: "Trend return",
    pullRet: "Pullback return",
    trendThreshold: "Trend閾値",
    pullThreshold: "Pullback閾値",
    ret14: "14日return",
    breakoutDistance: "Breakout距離",
    volumeRatio: "Volume比",
    volumeThreshold: "必要Volume比",
    strength: "Strength",
    margin: "Margin",
    close: "Close",
    priorHigh: "直近High",
    priorLow: "直近Low",
    developmentN: "Dev N",
    developmentSpf: "Dev SPF",
    developmentAvg: "Dev Avg",
    ret24: "24h return",
    ret14d: "14日return",
    rsi14: "RSI14",
    atrPct: "ATR%",
    barUp: "陽線",
    barDown: "陰線",
  };
  return names[key] || key;
}

function q102MetricValue(key: string, value: number | string | boolean) {
  if (typeof value === "boolean") return value ? "YES" : "NO";
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  if (["ret14", "ret14d", "ret24", "move", "longRet", "pullRet", "breakoutDistance", "atrPct"].includes(key)) {
    return (value * 100).toFixed(2) + "%";
  }
  return Math.abs(value) >= 100 ? value.toFixed(2) : value.toFixed(4);
}

function q102RankingScoreText(value?: number) {
  return value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function q102ScoreFormula(stage?: string, family?: string) {
  switch (stage) {
    case "RAW_REJECTED": return "60 + 接近度×0.10";
    case "QUALITY_PASS": return "70 + 接近度×0.10";
    case "FEATURE_PASS": return "80 + 接近度×0.10";
    case "IMPROVEMENT_PASS": return "90 + 接近度×0.10";
    case "SIGNAL_READY": return "全Gate通過 = 100.00";
    case "GRID_WAIT": return "改善条件まで通過していても4h Grid外は89.00";
    case "HIGH_VOL_RAW_READY": return "HIGH_VOL raw成立 + scanner健全 = 100.00";
    case "HIGH_VOL_APPROACH":
      return family === "HIGH_VOL"
        ? "scanner健全: 40 + 接近度×0.40 / 不健全: 20 + 接近度×0.20"
        : "HIGH_VOL接近度";
    default: return "observerの実測接近度";
  }
}

function Quality102SymbolTable({ snapshot, error }: { snapshot: Q102SymbolSnapshot | null; error: string | null }) {
  if (error) return <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="text-sm font-bold text-white">Q102 通貨別 Causal V4 判定</div><div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div></section>;
  if (!snapshot) return <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="text-sm font-bold text-white">Q102 通貨別 Causal V4 判定</div><div className="mt-3 text-sm text-white/60">Production selectorをread-only評価中…</div></section>;

  const eligible = snapshot.items.filter((item) => item.eligible);
  const referenceHourUtc = Number.isFinite(snapshot.referenceTs) ? new Date(snapshot.referenceTs).getUTCHours() : -1;
  const s34GridOpen = referenceHourUtc >= 0 && referenceHourUtc % 4 === 1;
  const ranked = [...snapshot.items].sort((a, b) =>
    (a.rankingRank ?? 999) - (b.rankingRank ?? 999)
    || (b.rankingScore ?? -1) - (a.rankingScore ?? -1)
    || a.symbol.localeCompare(b.symbol)
  );
  const topFive = ranked.filter((item) => Number.isFinite(item.rankingScore)).slice(0, 5);

  return <section className="panel-gold rounded-[28px] p-4 md:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-lg font-bold text-white">Q102 通貨別 Causal V4 判定</div>
        <p className="mt-1 text-xs text-white/55">実測featureを保存し、発火条件への接近度を0〜100でランキングします。スコアはobserverの実分解能で小数2桁まで表示し、Stage・未通過Gate・正式未発火理由を分離して表示します。ランキングは観測・検証専用で、発注条件には使用しません。</p>
      </div>
      <div className="text-right text-xs text-white/60">
        <div>Eligible {eligible.length}/{snapshot.items.length}</div>
        <div className="mt-1">Global selected: {snapshot.selectedSymbol || "なし"} {snapshot.selectedFamily ? "/ " + snapshot.selectedFamily : ""}</div>
        <div className="mt-1">UTC {referenceHourUtc >= 0 ? String(referenceHourUtc).padStart(2, "0") + ":00" : "不明"} / S34 4h Grid: {s34GridOpen ? "対象" : "対象外"}</div>
        <div className="mt-1">Ranking: {snapshot.rankingAvailable ? snapshot.rankingModelVersion || "ON" : "次回observer更新待ち"}</div>
      </div>
    </div>

    {topFive.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      {topFive.map((item) => <div key={"rank-" + item.symbol} className="rounded-2xl border border-gold-100/15 bg-gold-100/[0.04] p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-gold-100">#{item.rankingRank ?? "-"}</span>
          <span className="text-xl font-black text-white">{q102RankingScoreText(item.rankingScore)}</span>
        </div>
        <div className="mt-1 font-bold text-white">{item.symbol}</div>
        <div className="mt-1 text-[11px] text-white/55">{item.rankingFamily || "—"} / {q102StageText(item.rankingStage)}</div>
      </div>)}
    </div> : <div className="mt-4 rounded-2xl border border-sky-400/20 bg-sky-400/[0.05] px-4 py-3 text-xs text-sky-100">ランキング実測値はobserver snapshot生成後に表示されます。現在の売買判定には影響しません。</div>}

    <div className="mt-4 space-y-2">
      {ranked.map((item) => {
        const models = Q102_S34_MODELS[item.symbol] || [];
        const highVol = item.diagnostics?.highVol;
        const s34 = item.diagnostics?.s34 || [];
        const bestS34 = s34[0];
        const score = item.rankingScore;
        const firstFailedGate = bestS34?.gates?.find((gate) => gate.pass === false);
        const formalNoFireReason = item.selected
          ? "Global selectorで選定済み。実発注はRunner側のexecution Gateを別途確認します。"
          : item.eligible
            ? snapshot.selectedSymbol
              ? `Signal条件は成立。ただしQ102は1-slotのため、Global selectorで ${snapshot.selectedSymbol} が優先され今回は未選定です。`
              : "Signal条件は成立していますが、Global selectorで今回の選定はありません。"
            : q102ReasonText(item.reason);
        const observedBlockReason = firstFailedGate
          ? `${q102GateName(firstFailedGate.name)}: ${q102GateReasonText(firstFailedGate.reason) || "不通過"}${q102GateValueText(firstFailedGate) ? ` (${q102GateValueText(firstFailedGate)})` : ""}`
          : item.rankingStage === "GRID_WAIT"
            ? "改善条件まで到達していますが、S34 4時間Gridの対象時刻待ちです。"
            : item.rankingReason || "追加の未通過観測Gateはありません。";
        const scoreClass = score === undefined ? "text-white/35" : score >= 90 ? "text-emerald-200" : score >= 70 ? "text-gold-100" : score >= 50 ? "text-amber-200" : "text-white/55";
        return <details key={item.symbol} className="group rounded-2xl border border-white/10 bg-black/20">
          <summary className="grid cursor-pointer list-none grid-cols-[42px_90px_62px_64px_1fr_84px] items-center gap-2 px-3 py-3 text-xs md:grid-cols-[48px_110px_72px_72px_110px_1fr_100px]">
            <span className="font-black text-gold-100">#{item.rankingRank ?? "—"}</span>
            <span className="font-bold text-white">{item.symbol}</span>
            <span className={"text-lg font-black " + scoreClass}>{q102RankingScoreText(score)}</span>
            <span className={"font-semibold " + (item.eligible ? "text-emerald-200" : "text-rose-200")}>{item.eligible ? "PASS" : "BLOCK"}</span>
            <span className="hidden text-white/75 md:block">{item.rankingFamily || item.family || "候補なし"}</span>
            <span className="truncate text-white/55">{q102StageText(item.rankingStage)} / {item.rankingReason || q102ReasonText(item.reason)}</span>
            <span className={"text-right font-semibold " + (item.selected ? "text-gold-100" : "text-white/45")}>{item.selected ? "SELECTED" : "詳細 ▼"}</span>
          </summary>

          <div className="border-t border-white/10 px-3 py-4 text-xs leading-5 text-white/70 md:px-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="font-semibold text-white">ランキング</div>
                <div className="mt-1 text-2xl font-black text-white">{q102RankingScoreText(score)}<span className="text-xs font-normal text-white/45"> / 100</span></div>
                <div className="mt-1">#{item.rankingRank ?? "—"} / {item.rankingFamily || "—"} / {q102StageText(item.rankingStage)}</div>
                <div className="mt-1 break-all text-white/45">{item.rankingVariant || "Variant未取得"}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="font-semibold text-white">今回の正式判定</div>
                <div className="mt-1">{q102ReasonText(item.reason)}</div>
                <div className="mt-2">Side: {item.side} / Gross: {item.requestedGross > 0 ? item.requestedGross.toFixed(3) + "x" : "候補未生成"}</div>
                <div className="mt-1 text-white/45">Reference: {new Date(item.referenceTs).toLocaleString("ja-JP")}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="font-semibold text-white">S34 4時間Grid / 1-slot</div>
                <div className="mt-1">{s34GridOpen ? "Grid対象: UTC hour % 4 == 1" : "Grid対象外: 次の評価時刻待ち"}</div>
                <div className="mt-1">Global selector: {item.selected ? "この通貨を選択" : snapshot.selectedSymbol ? snapshot.selectedSymbol + " を優先" : "選択候補なし"}</div>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                <div className="font-semibold text-white">観測保存</div>
                <div className="mt-1">Ranking snapshot: {snapshot.rankingAvailable ? "保存中" : "未取得"}</div>
                <div className="mt-1">観測時刻: {snapshot.rankingCapturedAt ? new Date(snapshot.rankingCapturedAt).toLocaleString("ja-JP") : "—"}</div>
                <div className="mt-1 text-white/45">Observer SHA: {snapshot.observerCommitSha ? snapshot.observerCommitSha.slice(0, 8) : "—"}</div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-3">
              <div className="font-semibold text-amber-100">なぜ発火しない？</div>
              <div className="mt-2 text-white/80"><span className="text-white/45">正式判定：</span>{formalNoFireReason}</div>
              <div className="mt-1 text-white/80"><span className="text-white/45">最有力観測Gate：</span>{observedBlockReason}</div>
              <div className="mt-1 text-white/80"><span className="text-white/45">Score算式：</span>{q102ScoreFormula(item.rankingStage, item.rankingFamily)}</div>
              <div className="mt-1 text-[10px] text-white/45">Scoreはobserverが保存した小数2桁をそのまま表示します。同じStageでは基準点が共通のため近い値になり、完全同点の場合はsymbol名で順位を確定します。</div>
            </div>

            {highVol ? <div className="mt-3 rounded-xl border border-violet-400/20 bg-violet-400/[0.04] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-white">HIGH_VOL 実測</span><span className="text-white/50">接近度 {highVol.proximityScore?.toFixed(2) ?? "—"} / scanner {highVol.scannerHealthPass ? "PASS" : "BLOCK"} / raw {highVol.rawMatched ? "MATCH" : "WAIT"}</span></div>
              {highVol.features ? <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">{Object.entries(highVol.features).map(([key, value]) => <div key={key} className="rounded-lg bg-black/20 px-2 py-1"><div className="text-[10px] text-white/40">{q102MetricName(key)}</div><div className="font-semibold text-white/80">{q102MetricValue(key, value)}</div></div>)}</div> : null}
              {highVol.rule ? <div className="mt-2 text-[11px] text-white/50">Monthly rule: {Object.entries(highVol.rule).map(([key, value]) => key + "=" + value).join(" / ")}</div> : null}
            </div> : null}

            {bestS34 ? <div className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/[0.04] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-white">最有力 S34: {bestS34.family} / {bestS34.variant}</span><span className="text-white/50">接近度 {bestS34.proximityScore?.toFixed(2) ?? "—"} / Rank score {bestS34.rankingScore?.toFixed(2) ?? "—"}</span></div>
              {bestS34.metrics ? <div className="mt-2 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">{Object.entries(bestS34.metrics).map(([key, value]) => <div key={key} className="rounded-lg bg-black/20 px-2 py-1"><div className="text-[10px] text-white/40">{q102MetricName(key)}</div><div className="font-semibold text-white/80">{q102MetricValue(key, value)}</div></div>)}</div> : null}
              {bestS34.gates?.length ? <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{bestS34.gates.map((gate, index) => <div key={(gate.name || "gate") + index} className={"rounded-xl border px-3 py-2 " + (gate.pass ? "border-emerald-400/30 bg-emerald-500/10" : "border-rose-400/30 bg-rose-500/10")}>
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold text-white">{q102GateName(gate.name)}</span>
                  <span className={gate.pass ? "font-bold text-emerald-200" : "font-bold text-rose-200"}>{q102GateResult(gate.pass)}</span>
                </div>
                {q102GateValueText(gate) ? <div className="mt-1 text-[10px] text-white/55">{q102GateValueText(gate)}</div> : null}
                {gate.reason ? <div className="mt-1 text-[10px] text-white/65">{q102GateReasonText(gate.reason)}</div> : null}
              </div>)}</div> : null}
              {bestS34.gates?.some((gate) => gate.name === "V4_FEATURE") ? <div className="mt-3 rounded-xl border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-[11px] leading-5 text-white/65">
                <span className="font-semibold text-amber-100">V4追加条件とは：</span>
                {q102FeatureGateDescription(bestS34.family, bestS34.variant, item.symbol)}
              </div> : null}
            </div> : null}

            {!highVol && !bestS34 ? <div className="mt-3 rounded-xl border border-white/10 p-3 text-white/55">実測diagnosticsは次回ranking observer更新後に表示されます。対象S34モデル: {models.length ? models.join(" / ") : "固定S34モデルなし（HIGH_VOL経路）"}</div> : null}

            <div className="mt-3 rounded-xl border border-sky-400/15 bg-sky-400/[0.05] px-3 py-2 text-[11px] text-white/55">
              この0〜100は「現在の発火条件への接近度」です。利益予測スコアではありません。保存履歴に将来リターンを後付けして、スコア帯別PF・勝率・DDを検証してからロジック利用を判断します。
            </div>
          </div>
        </details>;
      })}
    </div>
  </section>;
}

function Sleeve({ title, items, marketLabel }: { title: string; items: DecisionStatusItem[]; marketLabel?: string }) {
  return <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />{title}</div>{marketLabel ? <div className="text-xs text-white/55">{marketLabel}</div> : null}</div><p className="mt-2 text-xs leading-5 text-white/50">公開データによる補助ランキングです。V12の実Runner詳細は上の実スナップショットを参照します。</p><div className="mt-4 space-y-2">{items.map((item) => <article key={item.symbol} className="rounded-2xl border border-white/10 bg-black/20 p-3 md:p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className={`flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-sm font-bold ${rankClass(item.rank)}`}>{item.rank || "-"}</span><div><div className="font-bold text-white">{item.symbol}</div><div className="text-xs text-white/50">{item.side === "LONG" ? "ロング候補" : item.side === "SHORT" ? "ショート候補" : "待機"} / 判定スコア {item.score}/{item.scoreMax}</div></div></div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span></div><p className="mt-3 text-sm leading-6 text-white/80">判定理由：{item.reason}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45"><span>データ時刻：{time(item.dataUpdatedAt)}</span><span>確認時刻：{time(item.checkedAt)}</span></div></article>)}</div></section>;
}

export function DecisionStatusPanel({ logic = "overview" }: { logic?: DecisionLogicPage }) {
  const { snapshot: productionRuntime } = useProductionRuntime();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [q102Symbols, setQ102Symbols] = useState<Q102SymbolSnapshot | null>(null);
  const [q102SymbolError, setQ102SymbolError] = useState<string | null>(null);

  async function load(force = false) {
    setLoading(true);
    try {
      const response = await fetch("/api/system/decision-status" + (force ? "?refresh=1" : ""), { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.readOnly) throw new Error(data?.error || "判定状況を取得できませんでした");
      setSnapshot(data as Snapshot);
      setError(data.error || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "判定状況を取得できませんでした");
    } finally {
      setLoading(false);
    }
  }

  async function loadQ102Symbols() {
    if (logic !== "q102") return;
    try {
      const response = await fetch("/api/system/q102-symbol-status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Q102通貨別判定を取得できませんでした");
      setQ102Symbols(data as Q102SymbolSnapshot);
      setQ102SymbolError(null);
    } catch (loadError) {
      setQ102SymbolError(loadError instanceof Error ? loadError.message : "Q102通貨別判定を取得できませんでした");
    }
  }

  useEffect(() => { void load(true); const timer = window.setInterval(() => void load(true), 30_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (logic !== "q102") return;
    void loadQ102Symbols();
    const timer = window.setInterval(() => void loadQ102Symbols(), 30_000);
    return () => window.clearInterval(timer);
  }, [logic]);

  if (loading && !snapshot) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/60">判定状況を読み込み中…</div>;
  if (!snapshot) return <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-8 text-center text-sm text-rose-100">{error || "判定状況を取得できませんでした"}</div>;

  const toolbar = <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />HP読み取り専用 / 発注・取消・建玉変更なし</span><span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />確認時刻：{time(snapshot.checkedAt)} / 自動更新30秒</span><button type="button" onClick={() => { void load(true); if (logic === "q102") void loadQ102Symbols(); }} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"><RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />{loading ? "更新中" : "再読込"}</button></div>;
  const warning = error ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">一部観測に注意：{error}</div> : null;

  if (logic === "overview") {
    const cards = [
      { key: "v12", title: "V12", href: "/decision-status/v12", detail: "候補Rank / signalEligible / Entry Quality / 共有risk" },
      { key: "pengu", title: "PENGU", href: "/decision-status/pengu", detail: "Long V2 / Short V20 / Recovery V8 / cooldown / 保護状態" },
      { key: "q102", title: "Q102 Causal V4", href: "/decision-status/q102", detail: "通貨別Gate / Family / 1-slot selector / 実state" },
      { key: "v52", title: "V52", href: "/decision-status/v52", detail: "V50 / V11_EQ / Stock window / basis・net-edge Gate" },
    ] as const;
    return <div className="space-y-4">{toolbar}{warning}<RuntimeSummary runtime={snapshot.runtime} /><section className="grid gap-4 md:grid-cols-2">{cards.map((card) => <Link key={card.key} href={card.href} className="panel-gold group rounded-[28px] p-5 transition hover:-translate-y-0.5 hover:border-gold-300/40"><div className="flex items-center justify-between gap-3"><div className="text-xl font-black text-white">{card.title}</div><span className="text-xs text-gold-100">詳細を見る →</span></div><p className="mt-3 text-sm leading-6 text-white/65">{card.detail}</p></Link>)}</section></div>;
  }

  return <div className="space-y-4">
    {toolbar}
    {warning}
    <div><Link href="/decision-status" className="inline-flex rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/75 hover:bg-white/[0.08]">← 判定状況一覧</Link></div>
    {logic === "v12" ? <><V12Detail details={snapshot.v12Observability} production={productionRuntime} /><Sleeve title="V12 補助ランキング" items={snapshot.v12.items} /></> : null}
    {logic === "pengu" ? <PenguDetail details={snapshot.penguRuntime} production={productionRuntime} /> : null}
    {logic === "q102" ? <><Quality102Detail details={snapshot.quality102Runtime} production={productionRuntime} /><Quality102SymbolTable snapshot={q102Symbols} error={q102SymbolError} /></> : null}
    {logic === "v52" ? <><V52Top2Detail details={snapshot.v52Top2Observability} marketOpen={snapshot.v52.marketOpen} production={productionRuntime} /><Sleeve title="V52 Stock 補助ランキング" items={snapshot.v52.items} marketLabel={snapshot.v52.marketLabel + (snapshot.v52.marketOpen ? " / 市場時間内" : " / 市場時間外")} /></> : null}
  </div>;
}
