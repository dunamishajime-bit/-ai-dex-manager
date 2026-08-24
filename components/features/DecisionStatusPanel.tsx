"use client";

import { useEffect, useState } from "react";
import { Activity, Clock3, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";

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

type Snapshot = {
  ok: boolean;
  readOnly: true;
  refreshIntervalMinutes: number;
  checkedAt: string;
  source: string;
  runtime: { checkedAt: string; units: RuntimeUnit[] };
  v12: { items: DecisionStatusItem[] };
  v52: { marketOpen: boolean; marketLabel: string; items: DecisionStatusItem[] };
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

function time(value?: string) { return value ? new Date(value).toLocaleString("ja-JP") : "未取得"; }
function shortSha(value: string) { return value.slice(0, 8); }

function RuntimeSummary({ runtime }: { runtime: Snapshot["runtime"] }) {
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-bold text-white"><ServerCog className="h-5 w-5 text-gold-100" />VPS実稼働ロジック</div>
        <span className="rounded-full border border-emerald-400/35 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-100">3 runner LIVE</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-white/55">確認時刻：{time(runtime.checkedAt)} / release SHAはVPS反映記録。ここから発注操作は行いません。</p>
      <div className="mt-4 grid gap-3 xl:grid-cols-3">
        {runtime.units.map((unit) => (
          <article key={unit.id} className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-start justify-between gap-2">
              <div><div className="font-bold text-white">{unit.label}</div><div className="mt-1 text-[11px] text-white/45">{unit.venue} / {unit.timeframe}</div></div>
              <span className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold text-emerald-100">{unit.status}</span>
            </div>
            <div className="mt-3 space-y-2 text-xs leading-5 text-white/72">
              <p><span className="text-white/45">判定：</span>{unit.entryPolicy}</p>
              <p><span className="text-white/45">保護：</span>{unit.protection}</p>
              <p className="text-white/50">{unit.note}</p>
            </div>
            <div className="mt-3 border-t border-white/10 pt-2 text-[10px] text-white/40">release {shortSha(unit.releaseSha)}…</div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Sleeve({ title, items, marketLabel }: { title: string; items: DecisionStatusItem[]; marketLabel?: string }) {
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-lg font-bold text-white"><Activity className="h-5 w-5 text-gold-100" />{title}</div>{marketLabel ? <div className="text-xs text-white/55">{marketLabel}</div> : null}</div>
      <p className="mt-2 text-xs leading-5 text-white/50">公開データによる補助ランキングです。実runnerは確定足・共有risk・建玉照合・Kill Switchを別途確認します。</p>
      <div className="mt-4 space-y-2">{items.map((item) => (
        <article key={item.symbol} className="rounded-2xl border border-white/10 bg-black/20 p-3 md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3"><span className={"flex h-8 min-w-8 items-center justify-center rounded-full border px-2 text-sm font-bold " + rankClass(item.rank)}>{item.rank || "-"}</span><div><div className="font-bold text-white">{item.symbol}</div><div className="text-xs text-white/50">{item.side === "LONG" ? "ロング候補" : item.side === "SHORT" ? "ショート候補" : "待機"} / 判定スコア {item.score}/{item.scoreMax}</div></div></div>
            <span className={"rounded-full border px-3 py-1 text-xs font-semibold " + statusClass(item.status)}>{item.status}</span>
          </div>
          <p className="mt-3 text-sm leading-6 text-white/80">判定理由：{item.reason}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45"><span>データ時刻：{time(item.dataUpdatedAt)}</span><span>確認時刻：{time(item.checkedAt)}</span></div>
        </article>
      ))}</div>
    </section>
  );
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
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60"><span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-emerald-300" />HPは読み取り専用 / 発注・取消・決済操作なし</span><span className="flex items-center gap-2"><Clock3 className="h-4 w-4" />最終確認：{time(snapshot.checkedAt)} / 通常更新：1時間ごと</span><button type="button" onClick={() => void load(true)} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:bg-white/[0.08] disabled:cursor-wait disabled:opacity-60"><RefreshCw className={"h-4 w-4 " + (loading ? "animate-spin" : "")} />{loading ? "更新中" : "再確認"}</button></div>
      {error ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">一部データを取得できません：{error}</div> : null}
      <RuntimeSummary runtime={snapshot.runtime} />
      <div className="grid gap-4 xl:grid-cols-2"><Sleeve title="V12 Top2 補助候補ランキング" items={snapshot.v12.items} /><Sleeve title="V52 Stock 補助候補ランキング" items={snapshot.v52.items} marketLabel={snapshot.v52.marketLabel + (snapshot.v52.marketOpen ? " / 取引時間内" : " / 対象時間外")} /></div>
    </div>
  );
}
