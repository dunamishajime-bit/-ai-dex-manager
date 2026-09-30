"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, CheckCircle2, RefreshCw, ShieldCheck } from "lucide-react";
import type { IdlePriorityRuntimeStatus } from "@/lib/server/idle-priority-runtime-observability";

function time(value?: number) {
  return value && Number.isFinite(value) ? new Date(value).toLocaleString("ja-JP") : "未取得";
}
function shortSha(value?: string) {
  return value ? value.slice(0, 10) + "…" : "未取得";
}
function statusClass(status?: IdlePriorityRuntimeStatus["status"]) {
  if (status === "LIVE") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (status === "STALE") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  return "border-rose-400/35 bg-rose-500/10 text-rose-100";
}

export function IdlePriorityDecisionPanel() {
  const [snapshot, setSnapshot] = useState<IdlePriorityRuntimeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system/idle-priority-status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.ok !== true) throw new Error(data.error || "Idle Priority runtimeを取得できません。");
      setSnapshot(data as IdlePriorityRuntimeStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Idle Priority runtimeを取得できません。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading && !snapshot) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-white/60">Idle Priority LIVE状態を読み込み中…</div>;
  if (!snapshot) return <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-6 text-sm text-rose-100">{error || "Idle Priority runtime未取得"}</div>;

  const d = snapshot.state.lastDecision;
  return <div className="min-w-0 space-y-4 overflow-x-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/65">
      <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />read-only / tradingMutation=0</span>
      <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80">
        <RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />再読込
      </button>
    </div>

    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />Idle Priority SHORT LIVE</div>
          <p className="mt-1 text-xs leading-5 text-white/55">current release SHA / SHA-pinned service / runner-health / durable state / Kill Switchをread-only照合します。</p>
        </div>
        <span className={"rounded-full border px-3 py-1 text-xs font-semibold " + statusClass(snapshot.status)}>{snapshot.status}</span>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        {[
          ["release SHA", shortSha(snapshot.releaseSha)],
          ["heartbeat SHA", shortSha(snapshot.heartbeat.runtimeSha)],
          ["PID", snapshot.heartbeat.mainPid ? String(snapshot.heartbeat.mainPid) : "未取得"],
          ["NRestarts", snapshot.heartbeat.nRestarts === undefined ? "未取得" : String(snapshot.heartbeat.nRestarts)],
          ["systemd Result", snapshot.heartbeat.serviceResult || "未取得"],
          ["state更新", time(snapshot.state.updatedAt)],
          ["Kill Switch", snapshot.sharedKillSwitchActive === null ? "未取得" : snapshot.sharedKillSwitchActive ? "ON" : "OFF"],
          ["保有Idle", String(snapshot.state.positions.length)],
        ].map(([label,value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className="mt-1 break-words text-sm font-semibold text-white">{value}</div></div>)}
      </div>
      <p className="mt-3 text-xs leading-5 text-white/70">{snapshot.reason}</p>
    </section>

    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="text-sm font-bold text-white">現在の判定</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {[
          ["判定時刻", time(d?.decisionTs)],
          ["通貨", d?.symbol || "候補なし"],
          ["route", d?.route || "未選択"],
          ["accepted", d?.accepted === undefined ? "未取得" : d.accepted ? "YES" : "NO"],
          ["reason", d?.reason || "未取得"],
        ].map(([label,value]) => <div key={label} className="rounded-xl border border-white/10 bg-black/20 px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-white/45">{label}</div><div className="mt-1 break-words text-sm font-semibold text-white">{value}</div></div>)}
      </div>
      <div className="mt-3 text-xs text-white/60">pending: {snapshot.state.pending ? `${snapshot.state.pending.action || "?"} / ${snapshot.state.pending.phase || "?"} / ${snapshot.state.pending.symbol || "?"} / ${snapshot.state.pending.reason || ""}` : "なし"} / manualReview: {snapshot.state.manualReview || "なし"}</div>
    </section>

    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="text-sm font-bold text-white">Safety / runtime checks</div>
      <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {snapshot.checks.map((check) => <div key={check.key} className={"flex items-start gap-2 rounded-xl border px-3 py-2 text-xs " + (check.pass === true ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" : check.pass === false ? "border-rose-400/25 bg-rose-500/10 text-rose-100" : "border-amber-400/25 bg-amber-500/10 text-amber-100")}>
          {check.pass === true ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <div><div className="font-semibold">{check.key}</div><div className="mt-1 break-words opacity-80">{check.detail}</div></div>
        </div>)}
      </div>
    </section>

    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="text-sm font-bold text-white">Idle保有建玉</div>
      {snapshot.state.positions.length ? <div className="mt-3 overflow-x-auto"><table className="min-w-[980px] w-full text-left text-xs"><thead className="text-white/45"><tr><th className="px-3 py-2">Symbol</th><th className="px-3 py-2">Route</th><th className="px-3 py-2">Entry</th><th className="px-3 py-2">Exit予定</th><th className="px-3 py-2">Qty</th><th className="px-3 py-2">Gross</th><th className="px-3 py-2">STOP</th><th className="px-3 py-2">TP</th><th className="px-3 py-2">Protection</th></tr></thead><tbody>
        {snapshot.state.positions.map((p,index) => <tr key={(p.symbol || "idle")+"-"+index} className="border-t border-white/5"><td className="px-3 py-2 font-semibold text-white">{p.symbol || "—"}</td><td className="px-3 py-2">{p.route || "—"}</td><td className="px-3 py-2">{time(p.entryTs)}</td><td className="px-3 py-2">{time(p.exitTs)}</td><td className="px-3 py-2">{p.quantity ?? "—"}</td><td className="px-3 py-2">{p.gross ?? "—"}x</td><td className="px-3 py-2">{p.stopPrice ?? "—"}</td><td className="px-3 py-2">{p.takeProfitPrice ?? "—"}</td><td className="px-3 py-2">{p.protectionVerified ? "verified" : "未確認"}</td></tr>)}
      </tbody></table></div> : <div className="mt-3 rounded-xl border border-white/10 bg-black/20 px-3 py-4 text-sm text-white/60">現在Idle保有建玉はありません。</div>}
    </section>
  </div>;
}
