"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Clock3, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import type { V52Top2Observability, V52Top2DecisionRow } from "@/lib/server/v52-top2-observability";
import type { PenguRuntimeStatus } from "@/lib/server/pengu-runtime-observability";
import type { Quality102RuntimeStatus } from "@/lib/server/quality102-runtime-observability";

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
  if (decision.selectionConfirmed) return (candidate.rank || 99) <= 2 ? "発注Signal選定済み" : "Top2外";
  if ((candidate.rank || 99) <= 2 && candidate.signalGate?.code === "BTC_REGIME_DIRECTION_BLOCKED") return "候補順位のみ / BTC判定未達";
  return (candidate.rank || 99) <= 2 ? "候補順位のみ / 発注Signal未成立" : "Top2外";
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

function V12Detail({ details }: { details?: V12Observability }) {
  if (!details) return null;
  const decision = details.decision;
  const trace = details.executionTrace;
  const runner = details.runnerState;
  const decisionLabel = decision ? (decision.symbol || "候補未取得") + " " + (decision.side || "WAIT") : "候補未取得";
  const selectedCandidate = decision?.candidates.find((candidate) => candidate.symbol === decision.symbol) || decision?.candidates[0];
  const statusLabel = details.errors.length ? "要確認" : details.decisionDetailsAvailable ? "観測済み" : "未取得";
  const statusClass = details.errors.length ? "border-amber-400/35 bg-amber-500/10 text-amber-100" : details.decisionDetailsAvailable ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : "border-rose-400/35 bg-rose-500/10 text-rose-100";
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />V12 X1.00 ALL Top2 発火経路</div>
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
        <div className="border-b border-white/10 px-3 py-2 text-sm font-bold text-white">全候補順位とSignal Gate</div>
        {decision?.candidates.length ? <table className="min-w-[980px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">Rank</th><th className="px-3 py-2">候補</th><th className="px-3 py-2">score</th><th className="px-3 py-2">momentum</th><th className="px-3 py-2">volumeRatio</th><th className="px-3 py-2">Gate</th><th className="px-3 py-2">発注段階</th></tr></thead><tbody>{decision.candidates.map((candidate, index) => <tr key={(candidate.symbol || "candidate") + "-" + index} className="border-t border-white/5"><td className="px-3 py-2"><span className={"inline-flex min-w-7 justify-center rounded-full border px-2 py-1 font-bold " + rankClass(candidate.rank || 99)}>{candidate.rank ?? "—"}</span></td><td className="px-3 py-2 font-semibold text-white">{candidate.symbol || "—"} <span className="ml-1 text-white/50">{candidate.side || "WAIT"}</span></td><td className="px-3 py-2 text-white/75">{number(candidate.score, 4)}</td><td className="px-3 py-2 text-white/75">{number(candidate.momentum, 4)}%</td><td className="px-3 py-2 text-white/75">{number(candidate.volumeRatio, 4)}</td><td className={"px-3 py-2 font-semibold " + (candidate.signalGate?.status === "pass" ? "text-emerald-200" : candidate.signalGate?.status === "blocked" ? "text-rose-200" : "text-amber-200")}>{candidate.signalGate?.detail || "未取得"}</td><td className="px-3 py-2 text-white/75">{decision.selectionConfirmed && selectedCandidate?.symbol === candidate.symbol ? "Signal選定済み" : candidateOrderStatus(candidate, decision)}</td></tr>)}</tbody></table> : <div className="px-3 py-4 text-sm text-amber-100">V12 decision snapshotに全候補がありません。順位比較だけでなく発注Signalを確定できないためFail Closedです。</div>}
      </div>
      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-5 text-white/65">V12仕様：1建玉最大1.00x / 最大2建玉 / 合計最大1.50x。候補順位1位でも、確定2時間足・BTC regime・score・momentum・volumeRatio・共有risk・容量・注文Gateをすべて通過するまで発注しません。直近約定履歴：{details.recentFills.length}件、現在のV12建玉：{details.v12Positions.length}件。</div>
    </section>
  );
}

function PenguDetail({ details }: { details?: PenguRuntimeStatus }) {
  if (!details) return null;
  const signal = details.latestSignal;
  const trace = details.executionTrace;
  const decision = signal?.decision;
  const feature = signal?.features || {};
  const recovery = config.penguRecoveryV8;
  const recoveryState = signal?.entryVersion === "RECOVERY_V8" ? "成立" : decision?.active ? "通常シグナル優先" : "R_BTC3評価待ち";
  const boolLabel = (value?: boolean) => value === undefined ? "未取得" : value ? "成立" : "未成立";
  const currentFailures = details.failures;
  const resolvedFailures = details.resolvedFailures;
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
      <div className="mt-4 rounded-2xl border border-gold-400/20 bg-gold-500/5 p-4"><div className="text-sm font-bold text-gold-100">現在の配分仕様</div><p className="mt-2 text-xs leading-6 text-white/75">通常系はLong最大0.9375x（base0.75x × 1.25）、Short V20最大0.75x（base0.75x × 1.00）。通常Short / Base Longを先に判定し、成立時はそれを優先します。Recovery V8は通常シグナル不成立時だけ、R_BTC3・{recovery.priority}で補助Long 0.50xとして評価します。</p><p className="mt-1 text-xs leading-6 text-white/75">R_BTC3は3% recovery cross、RSIΔ6≥{recovery.rsiDelta6Min.toFixed(2)}、EMA168距離≥{recovery.ema168DistanceMinPct.toFixed(2)}%、BTC 6h変化≥{recovery.btcReturn6hMinPct.toFixed(2)}%を全て満たす必要があります。成立後は共有risk・建玉容量・entry window・account lock・最小Notional・同一注文防止を通過した場合だけAsterへ進みます。</p><p className="mt-1 text-xs leading-6 text-white/60">Recovery V8は24時間後にentry×0.96のSTOP_MARKETで0.25xを部分撤退、残り0.25xを継続します。hard stopは-6%、trailは+6% activation / 3% retrace、max hold 72h。同一バーはpartial-defense先行→残りhard stopです。LIVEの実fill価格はslippage込みで照合し、Fail-Closedを維持します。</p><p className="mt-1 text-xs leading-6 text-white/60">PENGU/BTC足の時刻ずれ・取得失敗はFail-Closedで発注しません。現在の停止理由：{currentFailures.length ? `${currentFailures.length}件` : "なし"}。{resolvedFailures.length ? `過去の同種履歴${resolvedFailures.length}件は最新の確定足同期後に解消済みです（監査用にVPSへ保持）。` : "解消済み履歴：なし。"}</p></div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-sm font-bold text-white">発火から約定まで</div><p className="mt-2 text-sm leading-6 text-white/80">{trace.summary}</p><p className="mt-2 text-xs leading-5 text-gold-100">次の判定：{trace.nextAction}</p><div className="mt-3 space-y-2">{trace.steps.map((step) => <div key={step.key} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${penguTraceStateClass(step.state)}`}><TraceIcon state={step.state === "pass" ? "pass" : step.state === "blocked" ? "blocked" : step.state === "pending" ? "pending" : "unknown"} /><div><div className="font-semibold">{step.label}</div><div className="mt-0.5 leading-5 opacity-85">{step.detail}</div></div></div>)}</div></div>
        <div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-sm font-bold text-white">実データ詳細</div><div className="mt-3 space-y-2 text-xs leading-5 text-white/75"><p>runner更新：{time(details.updatedAt)}</p><p>VPS実行release：{shortSha(details.expectedReleaseSha)}…（systemd反映SHA）</p><p>state内release：{details.releaseSha ? `${shortSha(details.releaseSha)}… / ${details.releaseShaVerified === true ? "一致" : "要確認"}` : "stateに未保存（VPS実行SHAを表示）"}</p><p>共有risk：{details.sharedRisk ? `${details.sharedRisk.tripped ? "停止中" : "通過"} / loss ${number(details.sharedRisk.lossPct, 2)}% / 上限 ${number(details.sharedRisk.maximumLossPct, 2)}%` : "未取得（Fail Closed）"}</p><p>最新判定理由：{signal?.reason || "未取得"}</p><p>BTC EMA168距離：{number(feature.btcEma168Distance, 4)}</p><p>relativeReturn24h：{number(feature.relativeReturn24h, 4)}</p><p>ATR24 ratio：{number(feature.atr24Ratio, 4)}</p><p>RSI14：{number(feature.rsi14, 2)}</p><p>建玉：{details.position ? `side ${details.position.side ?? "—"} qty ${number(details.position.quantity, 6)}` : "なし"}</p><p>pending：{details.pending ? `${details.pending.phase || "ORDER"} / ${details.pending.reason || "—"}` : "なし"}</p></div></div>
      </div>
      {currentFailures.length ? <div className="mt-4 overflow-x-auto rounded-2xl border border-rose-400/25 bg-rose-500/5"><div className="border-b border-rose-400/15 px-3 py-2 text-sm font-bold text-rose-100">現在のfail-closed履歴</div><table className="min-w-[760px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">時刻</th><th className="px-3 py-2">停止理由</th></tr></thead><tbody>{currentFailures.slice().reverse().map((failure, index) => <tr key={`${failure.occurredAt}-${index}`} className="border-t border-white/5"><td className="px-3 py-2 text-white/70">{time(failure.occurredAt)}</td><td className="px-3 py-2 text-rose-200">{failure.message}</td></tr>)}</tbody></table></div> : <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100">現在のFail-Closed：なし。PENGU/BTCの最新確定H1足は同期済みです。</div>}
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

function V52Top2Detail({ details, marketOpen }: { details?: V52Top2Observability; marketOpen?: boolean }) {
  const policy = config.v52Top2Policy;
  if (!details) return null;
  const marketClosed = marketOpen === false;
  const displayStatus = marketClosed ? "UNCONFIRMED" : details.status;
  const telemetryRows: Array<{ window: string; kind: string; row: V52Top2DecisionRow }> = details.windows.flatMap((window) => [
    ...window.entries.map((row) => ({ window: window.window, kind: "結果", row })),
    ...window.rejections.map((row) => ({ window: window.window, kind: "拒否", row })),
  ]).slice(-12).reverse();
  const hasTelemetry = details.windows.some((window) => window.candidates.length || window.entries.length || window.rejections.length || window.transientRetryCount > 0);
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
        {[["Top2配分", `R1 ${gross(policy.rank1RequestedGross)} / R2 ${gross(policy.rank2RequestedGross)}`], ["建玉", `${details.activeV50Slots}/${policy.maxConcurrentPositions}`], ["日次entry", `${details.v50DailyEntries}/${policy.maxDailyEntries}`], ["basis Gate", `≥${policy.minEntryBasisBps}bps`], ["net edge Gate", `≥${policy.minNetEdgeBps}bps`], ["reference", details.referenceStatus || "未取得"], ["orders", details.referenceOrdersAllowed === true ? "許可条件内" : "Fail Closed"], ["Kill Switch", details.killSwitchActive ? "ACTIVE" : "inactive"]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className={`mt-1 break-words text-sm font-semibold ${label === "Kill Switch" && value === "ACTIVE" ? "text-rose-200" : "text-white"}`}>{value}</div></div>)}
      </div>
      <div className="mt-4 rounded-2xl border border-gold-400/20 bg-gold-500/5 p-4">
        <div className="text-sm font-bold text-gold-100">V52 Top2の確定仕様</div>
        <p className="mt-2 text-xs leading-6 text-white/75">NY {policy.windowsNy.join(" / ")} の各{policy.entryWindowSeconds}秒窓で、同じ固定signal snapshotを再評価します。Rank1は{gross(policy.rank1RequestedGross)}、Rank2は{gross(policy.rank2RequestedGross)}を要求し、Rank2は{gross(policy.rank2RequestedGross)}未満の空き容量ならINSUFFICIENT_AVAILABLE_GROSSで拒否します。</p>
        <p className="mt-1 text-xs leading-6 text-white/60">窓内retry対象：{policy.retryableReasons.join(" / ")}。最終拒否：{policy.finalRejectReasons.join(" / ")}。Stock Gross上限 {policy.stockGrossCap.toFixed(1)}x / Global Gross上限 {policy.globalGrossCap.toFixed(1)}x。</p>
      </div>
      <div className="mt-4 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-xs leading-5 text-white/70">V52 runner state更新：{time(details.updatedAt)} / LIVE判定理由：{details.reason || "未取得"} / reference={details.referenceStatus || "未取得"} / reference health={details.referenceHealth ? (details.referenceHealth.ready ? "ready" : "blocked / " + details.referenceHealth.reason) : "未接続"} / orders={details.referenceOrdersAllowed === true ? "許可条件内" : "Fail Closed"}。キー未設定・state stale・reference品質未達のいずれでも実注文へ進みません。</div>
      {!hasTelemetry ? <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100">V52 runner stateは読み取り済みですが、今回のTop2 telemetryはまだありません。市場時間外または自然シグナル待ちの状態です。市場時間外は意図的停止として表示し、発注は行いません。</div> : <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20"><div className="border-b border-white/10 px-3 py-2 text-sm font-bold text-white">直近Top2 telemetry</div><table className="min-w-[1250px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">窓</th><th className="px-3 py-2">種別</th><th className="px-3 py-2">Rank /候補</th><th className="px-3 py-2">要求/配分</th><th className="px-3 py-2">空き/Global</th><th className="px-3 py-2">Rank2</th><th className="px-3 py-2">送信</th><th className="px-3 py-2">結果/阻止理由</th></tr></thead><tbody>{telemetryRows.map(({ window, kind, row }, index) => <tr key={`${window}-${kind}-${row.symbol || "none"}-${index}`} className="border-t border-white/5"><td className="px-3 py-2 text-white/75">{window} NY</td><td className={`px-3 py-2 font-semibold ${kind === "拒否" ? "text-rose-200" : "text-white"}`}>{kind}</td><td className="px-3 py-2 text-white">R{row.candidateRank ?? "—"} / {row.symbol || "—"}<span className="ml-1 text-white/45">(qualified {row.qualifiedRank ?? "—"})</span></td><td className="px-3 py-2 text-white/75">{gross(row.requestedGross)} → {gross(row.allocatedGross)}</td><td className="px-3 py-2 text-white/75">{gross(row.availableGrossBeforeEntry)} / {gross(row.globalGrossBeforeReservation)} → {gross(row.globalGrossAfterReservation)}</td><td className="px-3 py-2 text-white/75">{row.rank2Accepted === true ? "accepted" : row.rank2RejectedReason || "—"}</td><td className="px-3 py-2 text-white/75">{row.orderSendAttempted === true ? "attempted" : "なし"}</td><td className="px-3 py-2 text-rose-200">{row.orderResult || row.orderBlockedReason || row.rank2RejectedReason || "—"}</td></tr>)}</tbody></table></div>}
      {details.errors.length ? <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">V52観測上の注意：{details.errors.join(" / ")}</div> : null}
    </section>
  );
}

function Quality102Detail({ details }: { details?: Quality102RuntimeStatus }) {
  if (!details) return null;
  const statusLabel = details.status === "LIVE" ? "稼働確認済み（derived）" : details.status === "STALE" ? "要確認" : "状態未取得";
  const statusClass = details.status === "LIVE" ? "border-emerald-400/35 bg-emerald-500/10 text-emerald-100" : details.status === "STALE" ? "border-amber-400/35 bg-amber-500/10 text-amber-100" : "border-rose-400/35 bg-rose-500/10 text-rose-100";
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
          ["selector", details.selectorMode],
          ["strategy cap", `${details.caps.strategyGrossCap.toFixed(2)}x`],
          ["Crypto / Total", `${details.caps.cryptoGrossCap.toFixed(2)}x / ${details.caps.totalGrossCap.toFixed(2)}x`],
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
          <p className="mt-2">Q102は最大0.50x、Crypto最大2.00x、Total最大2.50x。主力発火時はQ102だけを残余Grossまで縮小し、主力の注文機会をblockしません。</p>
        </div>
      </div>
    </section>
  );
}

function Sleeve({ title, items, marketLabel }: { title: string; items: DecisionStatusItem[]; marketLabel?: string }) {
  return <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />{title}</div>{marketLabel ? <div className="text-xs text-white/55">{marketLabel}</div> : null}</div><p className="mt-2 text-xs leading-5 text-white/50">公開データによる補助ランキングです。V12の実Runner詳細は上の実スナップショットを参照します。</p><div className="mt-4 space-y-2">{items.map((item) => <article key={item.symbol} className="rounded-2xl border border-white/10 bg-black/20 p-3 md:p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><span className={`flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-sm font-bold ${rankClass(item.rank)}`}>{item.rank || "-"}</span><div><div className="font-bold text-white">{item.symbol}</div><div className="text-xs text-white/50">{item.side === "LONG" ? "ロング候補" : item.side === "SHORT" ? "ショート候補" : "待機"} / 判定スコア {item.score}/{item.scoreMax}</div></div></div><span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span></div><p className="mt-3 text-sm leading-6 text-white/80">判定理由：{item.reason}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45"><span>データ時刻：{time(item.dataUpdatedAt)}</span><span>確認時刻：{time(item.checkedAt)}</span></div></article>)}</div></section>;
}

export function DecisionStatusPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load(force = false) {
    setLoading(true);
    try {
      const response = await fetch(`/api/system/decision-status${force ? "?refresh=1" : ""}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.readOnly) throw new Error(data?.error || "判定データを取得できません。");
      setSnapshot(data as Snapshot);
      setError(data.error || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "判定データを取得できません。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 3 * 60 * 60 * 1000); return () => window.clearInterval(timer); }, []);
  if (loading && !snapshot) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/60">判定状況を取得しています…</div>;
  if (!snapshot) return <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-8 text-center text-sm text-rose-100">{error || "判定データを取得できません。"}</div>;
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />HPは読み取り専用 / 発注・取消・決済操作なし</span><span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />最終確認：{time(snapshot.checkedAt)} / 自動再確認：3時間ごと</span><button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{loading ? "更新中" : "再確認"}</button></div>{error ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">一部データを取得できません：{error}</div> : null}<RuntimeSummary runtime={snapshot.runtime} /><V12Detail details={snapshot.v12Observability} /><PenguDetail details={snapshot.penguRuntime} /><Quality102Detail details={snapshot.quality102Runtime} /><V52Top2Detail details={snapshot.v52Top2Observability} marketOpen={snapshot.v52.marketOpen} /><div className="grid gap-4 xl:grid-cols-2"><Sleeve title="V12 Top2 補助候補ランキング" items={snapshot.v12.items} /><Sleeve title="V52 Stock 補助候補ランキング" items={snapshot.v52.items} marketLabel={snapshot.v52.marketLabel + (snapshot.v52.marketOpen ? " / 取引時間内" : " / 対象時間外")} /></div></div>;
}
