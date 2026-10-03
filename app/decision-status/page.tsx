"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, ArrowRight, RefreshCw, ShieldCheck } from "lucide-react";

type Strategy = {
  id: string;
  label: string;
  description: string;
  status: string;
  runtimeSha?: string | null;
  updatedAt?: number | null;
};

type Payload = {
  ok: boolean;
  releaseSha?: string;
  strategies?: Strategy[];
  retiredUiStrategies?: string[];
  updatedAt?: number;
  error?: string;
};

function fmtTime(value?: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function statusTone(status: string) {
  const upper = status.toUpperCase();
  if (upper.includes("HEALTH") || upper.includes("LIVE") || upper.includes("RUN") || upper.includes("OK")) {
    return "text-emerald-300 border-emerald-400/25 bg-emerald-400/10";
  }
  if (upper.includes("BLOCK") || upper.includes("ERROR") || upper.includes("DEAD") || upper.includes("INACTIVE")) {
    return "text-rose-300 border-rose-400/25 bg-rose-400/10";
  }
  return "text-gold-100 border-gold-400/20 bg-gold-400/10";
}

export default function DecisionStatusPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/system/runtime-overview?t=${Date.now()}`, { cache: "no-store" });
      setData(await response.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <main className="space-y-4 p-1 text-white md:p-2">
      <header className="panel-gold rounded-[28px] p-5 md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-100/70">
              <Activity className="h-4 w-4" />
              Production logic monitor
            </div>
            <h1 className="gold-heading mt-2 text-3xl font-black">新ロジック 判定状況</h1>
            <p className="mt-3 max-w-4xl text-sm leading-7 text-white/75">
              V12 / PENGU / Q102 / V52 / FET / HYPE / Idle Priority / Formal Priority を現在のrunner stateとheartbeatから直接表示します。
              旧HP専用データやZEC表示には依存しません。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            更新
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Trading release</div>
            <div className="mt-1 break-all font-mono text-xs text-white/85">{data?.releaseSha || "—"}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">更新</div>
            <div className="mt-1 text-sm font-bold">{fmtTime(data?.updatedAt)}</div>
          </div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">旧UI</div>
            <div className="mt-1 text-sm font-bold text-white/75">ZEC / legacy pages 非表示</div>
          </div>
        </div>
        {!data?.ok ? (
          <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">
            {data?.error || "runtime overviewを取得できませんでした。"}
          </div>
        ) : null}
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(data?.strategies || []).map((strategy) => (
          <Link
            key={strategy.id}
            href={`/decision-status/${strategy.id}`}
            className="panel-gold group rounded-[24px] p-4 transition hover:-translate-y-0.5 hover:border-gold-300/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xl font-black">{strategy.label}</div>
                <div className="mt-1 text-xs leading-5 text-white/55">{strategy.description}</div>
              </div>
              <ArrowRight className="h-4 w-4 text-gold-100/70 transition group-hover:translate-x-0.5" />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black ${statusTone(strategy.status)}`}>
                {strategy.status}
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] text-white/65">
                {strategy.runtimeSha?.slice(0, 12) || "SHA —"}
              </span>
            </div>
            <div className="mt-3 text-[10px] text-white/45">snapshot {fmtTime(strategy.updatedAt)}</div>
          </Link>
        ))}

        <Link href="/decision-status/idle-priority" className="panel-gold group rounded-[24px] p-4 transition hover:-translate-y-0.5 hover:border-gold-300/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xl font-black">Idle Priority</div>
              <div className="mt-1 text-xs leading-5 text-white/55">Idle SHORT + residual LONG。Formal未発火領域を補完。</div>
            </div>
            <ArrowRight className="h-4 w-4 text-gold-100/70" />
          </div>
          <div className="mt-4 inline-flex rounded-full border border-gold-400/20 bg-gold-400/10 px-2.5 py-1 text-[10px] font-black text-gold-100">
            詳細Gate
          </div>
        </Link>

        <Link href="/decision-status/formal-priority" className="panel-gold group rounded-[24px] p-4 transition hover:-translate-y-0.5 hover:border-gold-300/40">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xl font-black"><ShieldCheck className="h-5 w-5 text-gold-100" />Formal Priority</div>
              <div className="mt-1 text-xs leading-5 text-white/55">V12 Gross / Q102 handoff / actual-exit + 2h cooldown。</div>
            </div>
            <ArrowRight className="h-4 w-4 text-gold-100/70" />
          </div>
          <div className="mt-4 inline-flex rounded-full border border-gold-400/20 bg-gold-400/10 px-2.5 py-1 text-[10px] font-black text-gold-100">
            正式契約
          </div>
        </Link>
      </section>
    </main>
  );
}
