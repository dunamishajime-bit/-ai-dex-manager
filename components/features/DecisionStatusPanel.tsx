"use client";

import { useEffect, useState } from "react";
import { Activity, Clock3, RefreshCw, ShieldCheck } from "lucide-react";

type DecisionStatusItem = {
  symbol: string;
  sleeve: "V96" | "V52";
  rank: number;
  score: number;
  scoreMax: number;
  status: "発火候補" | "条件不足" | "対象時間外" | "取得不能" | "判定未出力" | "停止中";
  side: "LONG" | "SHORT" | "WAIT";
  reason: string;
  checkedAt: string;
  source: string;
  dataUpdatedAt?: string;
};

type Snapshot = {
  ok: boolean;
  readOnly: true;
  refreshIntervalMinutes: number;
  checkedAt: string;
  source: string;
  service: { active: boolean; state: "ACTIVE" | "STOPPED" | "UNKNOWN"; label: string; mainPid: number | null };
  v96: { items: DecisionStatusItem[] };
  v52: {
    marketOpen: boolean;
    marketLabel: string;
    items: DecisionStatusItem[];
    runtime: {
      status: "ACTIVE" | "WAITING_MARKET_CLOSED" | "BLOCKED_DATA_UNAVAILABLE" | "STALE" | "UNAVAILABLE" | "STOPPED";
      ordersAllowed: boolean;
      updatedAt?: string;
      failureCode?: string;
      source: string;
    };
  };
  error?: string;
};

function statusClass(status: DecisionStatusItem["status"]) {
  if (status === "発火候補") return "border-emerald-400/35 bg-emerald-500/10 text-emerald-100";
  if (status === "取得不能") return "border-rose-400/35 bg-rose-500/10 text-rose-100";
  if (status === "判定未出力") return "border-sky-400/35 bg-sky-500/10 text-sky-100";
  if (status === "停止中") return "border-amber-400/35 bg-amber-500/10 text-amber-100";
  if (status === "対象時間外") return "border-slate-400/25 bg-slate-500/10 text-slate-200";
  return "border-white/15 bg-white/[0.04] text-white/75";
}

function time(value?: string) {
  return value ? new Date(value).toLocaleString("ja-JP") : "未取得";
}

function Sleeve({ title, items, marketLabel }: { title: string; items: DecisionStatusItem[]; marketLabel?: string }) {
  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-lg font-bold text-white">
          <Activity className="h-5 w-5 text-gold-100" />
          {title}
        </div>
        {marketLabel ? <div className="text-xs text-white/55">{marketLabel}</div> : null}
      </div>
      <div className="mt-4 space-y-2">
        {items.map((item) => (
          <article key={item.symbol} className="rounded-2xl border border-white/10 bg-black/20 p-3 md:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-gold-400/25 text-sm font-bold text-gold-100">
                  {item.rank || "-"}
                </span>
                <div>
                  <div className="font-bold text-white">{item.symbol}</div>
                  <div className="text-xs text-white/50">
                    {item.side === "LONG" ? "ロング" : item.side === "SHORT" ? "ショート" : "待機"}
                    {" / 実Runner判定 "}{item.score}/{item.scoreMax}
                  </div>
                </div>
              </div>
              <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusClass(item.status)}`}>
                {item.status}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-white/80">判定理由：{item.reason}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45">
              <span>データ時刻：{time(item.dataUpdatedAt)}</span>
              <span>確認時刻：{time(item.checkedAt)}</span>
              <span>取得元：{item.source}</span>
            </div>
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
      if (!response.ok || !data?.readOnly) throw new Error(data?.error || "判定データを取得できません。");
      setSnapshot(data as Snapshot);
      setError(data.error || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "判定データを取得できません。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading && !snapshot) {
    return <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-8 text-center text-sm text-white/60">実Runner判定を取得しています…</div>;
  }
  if (!snapshot) {
    return <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-8 text-center text-sm text-rose-100">{error || "判定データを取得できません。"}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-300" />
          注文・取消・建玉変更なし / 実Runnerスナップショット専用
        </span>
        <span className="flex items-center gap-2">
          <Clock3 className="h-4 w-4" />
          {snapshot.service.label} / 最終確認：{time(snapshot.checkedAt)}
        </span>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-white/80 hover:bg-white/[0.08]">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          再確認
        </button>
      </div>
      {error ? <div className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">{error}</div> : null}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>V52実Runner：{snapshot.v52.runtime.status}</span>
          <span>新規注文許可：{snapshot.v52.runtime.ordersAllowed ? "可（他の安全Gate確認が必要）" : "不可"}</span>
          <span>Runner更新：{time(snapshot.v52.runtime.updatedAt)}</span>
          <span>画面更新：1分ごと</span>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Sleeve title="V96 Crypto / PENGU V2 判定状況" items={snapshot.v96.items} />
        <Sleeve
          title="V52 Stock 判定状況"
          items={snapshot.v52.items}
          marketLabel={`${snapshot.v52.marketLabel} / ${snapshot.v52.marketOpen ? "対象時間内" : "対象時間外"}`}
        />
      </div>
    </div>
  );
}
