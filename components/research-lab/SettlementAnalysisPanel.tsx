"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, Sparkles } from "lucide-react";

type Analysis = {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT" | "UNKNOWN";
  outcome: "PROFIT" | "LOSS" | "FLAT" | "INCOMPLETE";
  entryPrice: number | null;
  exitPrice: number | null;
  quantity: number;
  grossPnlUsd: number | null;
  netPnlEstimateUsd: number | null;
  returnPct: number | null;
  holdingMs: number | null;
  marketGranularity: "1h" | "12h" | "none";
  mfePct: number | null;
  maePct: number | null;
  capturedMfePct: number | null;
  opportunityLeftPct: number | null;
  signalReason: string;
  whatWorked: string[];
  whatFailed: string[];
  moreProfitPotential: string;
  improvementProposal: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  evidence: string[];
  completedAt: string;
  generatedAt: string;
};

type Payload = { generatedAt: string; trigger: string; latest: Analysis | null; items: Analysis[] };

function money(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}$${value.toFixed(4)}`;
}

function pct(value: number | null) {
  return value == null || !Number.isFinite(value) ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(date);
}

function outcomeClass(outcome: Analysis["outcome"]) {
  if (outcome === "PROFIT") return "border-emerald-400/25 bg-emerald-500/10 text-emerald-100";
  if (outcome === "LOSS") return "border-rose-400/25 bg-rose-500/10 text-rose-100";
  return "border-white/15 bg-white/5 text-white/70";
}

export default function SettlementAnalysisPanel() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/research-lab/settlement-analysis", { cache: "no-store" });
      if (response.ok) setPayload(await response.json() as Payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const latest = payload?.latest;
  return (
    <section className="rounded-[26px] border border-cyan-400/22 bg-[linear-gradient(180deg,rgba(6,34,43,0.65),rgba(5,10,16,0.94))] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-cyan-300/20 bg-cyan-400/10 p-2.5 text-cyan-100"><Sparkles className="h-5 w-5" /></div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-100/60">Post-Settlement AI Research</div>
            <h2 className="mt-1 text-xl font-black text-white">決済後自動分析</h2>
            <p className="mt-2 max-w-3xl text-xs leading-6 text-cyan-50/70">V35 Core＋PENGU V46のreduce-only約定を検知した直後に、実約定・決済前の値動き・シグナル理由から、利益を伸ばせた可能性と改善案を生成します。時間ごとの研究実行ではありません。</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-2 text-[11px] font-bold text-cyan-50"><Activity className="h-3.5 w-3.5" />決済イベント駆動</div>
      </div>

      {loading ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-4 py-5 text-xs text-white/50"><RefreshCw className="h-4 w-4 animate-spin" />決済分析を読み込み中…</div>
      ) : !latest ? (
        <div className="mt-4 rounded-xl border border-dashed border-white/12 bg-black/20 px-4 py-5 text-sm leading-6 text-white/55"><Clock3 className="mr-2 inline h-4 w-4" />まだ決済完了イベントがありません。次のV46決済完了後にここへ自動表示されます。</div>
      ) : (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/55"><span>{dateTime(latest.completedAt)} JST</span><span>・</span><span className="font-mono text-cyan-100">{latest.symbol}</span><span>{latest.direction}</span><span className={`rounded-full border px-2 py-1 font-bold ${outcomeClass(latest.outcome)}`}>{latest.outcome}</span><span className="ml-auto">Confidence {latest.confidence}</span></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-white/45">Net estimate</div><div className="mt-2 text-lg font-black text-white">{money(latest.netPnlEstimateUsd)}</div></div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-white/45">Return</div><div className="mt-2 text-lg font-black text-white">{pct(latest.returnPct)}</div></div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-white/45">MFE / MAE</div><div className="mt-2 text-lg font-black text-white">{pct(latest.mfePct)} / {pct(latest.maePct)}</div></div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-white/45">Captured MFE</div><div className="mt-2 text-lg font-black text-white">{pct(latest.capturedMfePct)}</div></div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] uppercase tracking-widest text-white/45">Missed upside</div><div className="mt-2 text-lg font-black text-white">{pct(latest.opportunityLeftPct)}</div></div>
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            <div className="rounded-xl border border-emerald-400/15 bg-emerald-500/[0.06] p-4"><div className="flex items-center gap-2 text-xs font-black text-emerald-100"><CheckCircle2 className="h-4 w-4" />良かった点</div><ul className="mt-2 space-y-1 text-xs leading-5 text-emerald-50/75">{latest.whatWorked.length ? latest.whatWorked.map((item) => <li key={item}>・{item}</li>) : <li>・追加評価待ち</li>}</ul></div>
            <div className="rounded-xl border border-rose-400/15 bg-rose-500/[0.06] p-4"><div className="flex items-center gap-2 text-xs font-black text-rose-100"><AlertTriangle className="h-4 w-4" />悪かった点</div><ul className="mt-2 space-y-1 text-xs leading-5 text-rose-50/75">{latest.whatFailed.length ? latest.whatFailed.map((item) => <li key={item}>・{item}</li>) : <li>・明確な失敗要因は未検出</li>}</ul></div>
            <div className="rounded-xl border border-violet-400/15 bg-violet-500/[0.06] p-4"><div className="flex items-center gap-2 text-xs font-black text-violet-100"><Sparkles className="h-4 w-4" />利益を伸ばせた可能性</div><p className="mt-2 text-xs leading-5 text-violet-50/75">{latest.moreProfitPotential}</p></div>
          </div>
          <div className="rounded-xl border border-sky-400/15 bg-sky-500/[0.055] p-4"><div className="flex items-center gap-2 text-xs font-black text-sky-100"><Database className="h-4 w-4" />次回検証する改善案</div><p className="mt-2 text-sm leading-6 text-sky-50/80">{latest.improvementProposal}</p><p className="mt-2 text-[11px] leading-5 text-white/45">シグナル理由: {latest.signalReason || "記録なし"} ・ {latest.marketGranularity}足 ・ 決済後生成: {dateTime(latest.generatedAt)} JST</p></div>
        </div>
      )}
    </section>
  );
}
