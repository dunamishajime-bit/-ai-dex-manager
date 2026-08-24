"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, CircleDashed, Clock3, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";

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
  status: "LIVE";
  releaseSha: string;
  venue: string;
  timeframe: string;
  entryPolicy: string;
  protection: string;
  note: string;
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
  return (candidate.rank || 99) <= 2 ? "候補順位のみ / 発注Signal未成立" : "Top2外";
}

function RuntimeSummary({ runtime }: { runtime: Snapshot["runtime"] }) {
  return <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-lg font-bold text-white"><ServerCog className="h-5 w-5 text-gold-100" />VPS実稼働ロジック</div><span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">3 runner LIVE</span></div><p className="mt-2 text-xs leading-5 text-white/55">確認時刻：{time(runtime.checkedAt)} / release SHAはVPS反映記録。ここから発注操作は行いません。</p><div className="mt-4 grid gap-3 xl:grid-cols-3">{runtime.units.map((unit) => <article key={unit.id} className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="flex items-start justify-between gap-2"><div><div className="font-bold text-white">{unit.label}</div><div className="mt-1 text-[11px] text-white/45">{unit.venue} / {unit.timeframe}</div></div><span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">{unit.status}</span></div><div className="mt-3 space-y-2 text-xs leading-5 text-white/72"><p><span className="text-white/45">判定：</span>{unit.entryPolicy}</p><p><span className="text-white/45">保護：</span>{unit.protection}</p><p className="text-white/50">{unit.note}</p></div><div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-white/40">release {shortSha(unit.releaseSha)}…</div></article>)}</div></section>;
}

function V12Detail({ details }: { details?: V12Observability }) {
  if (!details) return null;
  const decision = details.decision;
  const trace = details.executionTrace;
  return <section className="panel-gold rounded-[28px] p-4 md:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />V12 発火候補 → 発注・約定 詳細</div><p className="mt-1 text-xs text-white/55">VPS実Runnerのdecision-snapshot / runner / risk / Aster照合を読み取り表示</p></div><div className="flex flex-wrap gap-2"><span className="rounded-full border border-gold-400/35 bg-gold-500/10 px-3 py-1 text-xs font-semibold text-gold-100">{trace.currentStageLabel}</span><span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">tradingMutation=0</span></div></div>{!details.decisionDetailsAvailable || !decision ? <div className="mt-4 rounded-2xl border border-amber-400/25 bg-amber-500/10 p-4 text-sm text-amber-100">候補スナップショット未取得です。{details.errors.length ? ` ${details.errors[0]}` : ""}</div> : <><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">{[["選定候補", `${decision.symbol || "—"} ${decision.side || "WAIT"}`], ["Rank", decision.rank ?? "—"], ["score", number(decision.score)], ["momentum", number(decision.momentum)], ["volumeRatio", number(decision.volumeRatio, 3)], ["BTC regime", decision.btcRegime || "—"], ["確定足", time(decision.referenceTs)], ["発注Signal", decision.selectionConfirmed ? "成立" : "未成立"], ["要求gross", decision.requestedGross === undefined ? "—" : `${number(decision.requestedGross, 3)}x`]].map(([label, value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className={`mt-1 break-words text-sm font-semibold ${label === "発注Signal" && value === "未成立" ? "text-rose-200" : "text-white"}`}>{value}</div></div>)}</div><div className="mt-4 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]"><div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-sm font-bold text-white">判定の流れ</div><p className="mt-2 text-sm leading-6 text-white/80">{trace.summary}</p><p className="mt-2 text-xs leading-5 text-gold-100">次の判定：{trace.nextAction}</p><div className="mt-3 space-y-2">{trace.steps.map((step) => <div key={step.key} className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-xs ${traceStateClass(step.state)}`}><TraceIcon state={step.state} /><div><div className="font-semibold">{step.label}</div><div className="mt-0.5 leading-5 opacity-85">{step.detail}</div></div></div>)}</div></div><div className="rounded-2xl border border-white/10 bg-black/20 p-3"><div className="text-sm font-bold text-white">実行照合</div><div className="mt-3 space-y-2 text-xs leading-5 text-white/75"><p>runner更新：{time(details.runnerState?.updatedAt)}</p><p>最後の確定足：{time(details.runnerState?.lastReferenceTs)}</p><p>共有risk：{details.sharedRisk ? details.sharedRisk.tripped ? "停止中" : `通過 (${number(details.sharedRisk.lossPct, 2)}% / 上限 ${number(details.sharedRisk.maximumLossPct, 2)}%)` : "未取得"}</p><p>V12建玉：{details.v12Positions.length ? details.v12Positions.map((position) => `${position.symbol} ${position.side} qty ${number(position.quantity, 6)}`).join(" / ") : "なし"}</p><p>注文処理：{details.runnerState?.pending ? `${details.runnerState.pending.action || "ORDER"} ${details.runnerState.pending.symbol || "—"}` : "待機中"}</p><p className="text-white/45">観測取得：{time(details.capturedAt)}</p></div></div></div><div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20"><div className="border-b border-white/10 px-3 py-2 text-sm font-bold text-white">全候補順位（実V12 snapshot）</div><table className="min-w-[900px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">Rank</th><th className="px-3 py-2">候補</th><th className="px-3 py-2">Side</th><th className="px-3 py-2">score</th><th className="px-3 py-2">momentum</th><th className="px-3 py-2">volumeRatio</th><th className="px-3 py-2">発注判定</th></tr></thead><tbody>{decision.candidates.map((candidate) => { const orderStatus = candidateOrderStatus(candidate, decision); return <tr key={`${candidate.rank}-${candidate.symbol}`} className="border-t border-white/5"><td className="px-3 py-2"><span className={`inline-flex min-w-7 justify-center rounded-full border px-2 py-1 font-semibold ${rankClass(candidate.rank || 0)}`}>{candidate.rank ?? "—"}</span></td><td className="px-3 py-2 font-semibold text-white">{candidate.symbol || "—"}</td><td className="px-3 py-2 text-white/70">{candidate.side || "WAIT"}</td><td className="px-3 py-2 text-white/80">{number(candidate.score)}</td><td className="px-3 py-2 text-white/80">{number(candidate.momentum)}</td><td className="px-3 py-2 text-white/80">{number(candidate.volumeRatio, 3)}</td><td className={`px-3 py-2 font-semibold ${(orderStatus.includes("未成立")) ? "text-rose-200" : orderStatus === "Top2外" ? "text-white/45" : "text-emerald-200"}`}>{orderStatus}</td></tr>; })}</tbody></table></div><div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20"><div className="border-b border-white/10 px-3 py-2 text-sm font-bold text-white">直近Aster約定照合</div>{details.recentFills.length ? <table className="min-w-[820px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">時刻</th><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Side</th><th className="px-3 py-2">価格</th><th className="px-3 py-2">net PnL</th><th className="px-3 py-2">建玉照合</th></tr></thead><tbody>{details.recentFills.slice(0, 12).map((fill, index) => <tr key={fill.id || `${fill.symbol}-${fill.executedAt}-${index}`} className="border-t border-white/5"><td className="px-3 py-2 text-white/70">{time(fill.executedAt)}</td><td className="px-3 py-2 font-semibold text-white">{fill.symbol}</td><td className="px-3 py-2 text-white/80">{fill.action}</td><td className="px-3 py-2 text-white/70">{fill.side || "—"}</td><td className="px-3 py-2 text-white/80">{number(fill.exitPriceUsd ?? fill.entryPriceUsd, 6)}</td><td className={`px-3 py-2 ${(fill.netPnlUsd ?? fill.realizedPnlUsd ?? 0) >= 0 ? "text-emerald-200" : "text-rose-200"}`}>{fill.netPnlUsd === undefined && fill.realizedPnlUsd === undefined ? "—" : number(fill.netPnlUsd ?? fill.realizedPnlUsd, 4)}</td><td className="px-3 py-2 text-white/70">{fill.positionVerified ? "確認" : fill.tradeStatus === "open" ? "未照合" : fill.tradeStatus || "—"}</td></tr>)}</tbody></table> : <div className="px-3 py-4 text-sm text-white/55">V12対象の約定履歴はありません。</div>}</div></>}{details.errors.length ? <div className="mt-3 rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">観測上の注意：{details.errors.join(" / ")}</div> : null}</section>;
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

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 60 * 60 * 1000); return () => window.clearInterval(timer); }, []);
  if (loading && !snapshot) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/60">判定状況を取得しています…</div>;
  if (!snapshot) return <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-8 text-center text-sm text-rose-100">{error || "判定データを取得できません。"}</div>;
  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />HPは読み取り専用 / 発注・取消・決済操作なし</span><span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />最終確認：{time(snapshot.checkedAt)} / 通常更新：1時間ごと</span><button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{loading ? "更新中" : "再確認"}</button></div>{error ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">一部データを取得できません：{error}</div> : null}<RuntimeSummary runtime={snapshot.runtime} /><V12Detail details={snapshot.v12Observability} /><div className="grid gap-4 xl:grid-cols-2"><Sleeve title="V12 Top2 補助候補ランキング" items={snapshot.v12.items} /><Sleeve title="V52 Stock 補助候補ランキング" items={snapshot.v52.items} marketLabel={snapshot.v52.marketLabel + (snapshot.v52.marketOpen ? " / 取引時間内" : " / 対象時間外")} /></div></div>;
}
