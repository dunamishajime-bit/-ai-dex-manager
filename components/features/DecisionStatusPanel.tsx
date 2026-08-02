"use client";

import { useEffect, useState } from "react";
import { Activity, Clock3, RefreshCw, ShieldCheck } from "lucide-react";
import type { DecisionStatusItem, DecisionStatusSnapshot } from "@/lib/server/disdex-decision-status";

type Snapshot = DecisionStatusSnapshot;
const STATUS_CANDIDATE = "\u767a\u706b\u5019\u88dc";
const STATUS_OUTSIDE_HOURS = "\u5bfe\u8c61\u6642\u9593\u5916";
const STATUS_UNAVAILABLE = "\u53d6\u5f97\u4e0d\u80fd";
const TEXT = {
  long: "\u30ed\u30f3\u30b0",
  short: "\u30b7\u30e7\u30fc\u30c8",
  wait: "\u5f85\u6a5f",
  reason: "\u5224\u5b9a\u7406\u7531\uff1a",
  dataTime: "\u30c7\u30fc\u30bf\u6642\u523b\uff1a",
  checkedTime: "\u78ba\u8a8d\u6642\u523b\uff1a",
  runnerResult: "Runner\u7d50\u679c\uff1a",
  unavailable: "\u672a\u53d6\u5f97",
  loading: "LIVE\u5224\u5b9a\u3092\u53d6\u5f97\u3057\u3066\u3044\u307e\u3059\u2026",
  readonly: "\u5b9fLIVE Runner\u306e\u8aad\u307f\u53d6\u308a\u5c02\u7528\u7d50\u679c\u3002\u6ce8\u6587\u30fb\u53d6\u6d88\u30fb\u5efa\u7389\u5909\u66f4\u306f\u3042\u308a\u307e\u305b\u3093\u3002",
  lastCheck: "\u6700\u7d42\u78ba\u8a8d\uff1a",
  refresh: "\u518d\u78ba\u8a8d",
  everyFive: " / 5\u5206\u3054\u3068\u306b\u66f4\u65b0",
  v96Title: "V96 Crypto \u5b9fLIVE\u5224\u5b9a",
  v52Title: "V52 Stock \u5b9fLIVE\u5224\u5b9a",
  marketOpen: " / \u53d6\u5f15\u6642\u9593\u5185",
  marketClosed: " / \u5bfe\u8c61\u6642\u9593\u5916",
} as const;

function statusClass(status: DecisionStatusItem["status"]) {
  if (status === STATUS_CANDIDATE) return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (status === STATUS_OUTSIDE_HOURS) return "border-slate-400/25 bg-slate-500/10 text-slate-200";
  if (status === STATUS_UNAVAILABLE) return "border-rose-400/35 bg-rose-500/10 text-rose-100";
  return "border-amber-400/35 bg-amber-500/10 text-amber-100";
}

function time(value?: string) { return value ? new Date(value).toLocaleString("ja-JP") : TEXT.unavailable; }

function Sleeve({ title, items, marketLabel }: { title: string; items: DecisionStatusItem[]; marketLabel?: string }) {
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />{title}</div>
        {marketLabel ? <div className="text-xs text-white/55">{marketLabel}</div> : null}
      </div>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <article key={item.symbol} className="rounded-2xl border border-white/10 bg-black/20 p-3 md:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold-400/25 text-sm font-bold text-gold-100">{item.rank || "-"}</span>
                <div><div className="font-bold text-white">{item.symbol}</div><div className="text-xs text-white/50">{item.side === "LONG" ? TEXT.long : item.side === "SHORT" ? TEXT.short : TEXT.wait}{item.scoreMax > 0 ? ` / \u5224\u5b9a ${item.score}/${item.scoreMax}` : ""}</div></div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(item.status)}`}>{item.status}</span>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/80">{TEXT.reason}{item.reason}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45"><span>{TEXT.dataTime}{time(item.dataUpdatedAt)}</span><span>{TEXT.checkedTime}{time(item.checkedAt)}</span>{item.executionStatus ? <span>{TEXT.runnerResult}{item.executionStatus}</span> : null}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DecisionStatusPanel() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/system/decision-status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.readOnly) throw new Error(data?.error || "LIVE\u5224\u5b9a\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3002");
      setSnapshot(data as Snapshot);
      setError(data.error || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "LIVE\u5224\u5b9a\u30c7\u30fc\u30bf\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3002");
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5 * 60 * 1000); return () => window.clearInterval(timer); }, []);
  if (loading && !snapshot) return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/60">{TEXT.loading}</div>;
  if (!snapshot) return <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-8 text-center text-sm text-rose-100">{error || "LIVE\u5224\u5b9a\u3092\u53d6\u5f97\u3067\u304d\u307e\u305b\u3093\u3002"}</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
        <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />{TEXT.readonly}</span>
        <span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />{TEXT.lastCheck}{time(snapshot.checkedAt)}{TEXT.everyFive}</span>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:bg-white/[0.08]"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{TEXT.refresh}</button>
      </div>
      {error ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}
      <div className="grid gap-4 xl:grid-cols-2"><Sleeve title={TEXT.v96Title} items={snapshot.v96.items} /><Sleeve title={TEXT.v52Title} items={snapshot.v52.items} marketLabel={snapshot.v52.marketLabel + (snapshot.v52.marketOpen ? TEXT.marketOpen : TEXT.marketClosed)} /></div>
    </div>
  );
}
