"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, RefreshCw } from "lucide-react";

type Strategy = {
  id: string;
  label: string;
  description: string;
  status: string;
  runtimeSha?: string | null;
  updatedAt?: number | null;
  heartbeat?: unknown;
  heartbeatMtimeMs?: number | null;
  states?: Record<string, unknown>;
  stateMtimes?: Record<string, number | null>;
};

type Payload = { ok: boolean; releaseSha?: string; strategies?: Strategy[]; error?: string };

function fmtTime(value?: number | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function compact(value: unknown) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value.length > 180 ? value.slice(0, 177) + "..." : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function topLevelRows(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item === null || ["string", "number", "boolean"].includes(typeof item))
    .slice(0, 40);
}

export default function StrategyDecisionPage() {
  const params = useParams<{ logic: string }>();
  const logic = String(params?.logic || "").toLowerCase();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/system/runtime-overview?t=${Date.now()}`, { cache: "no-store" });
      setPayload(await response.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const strategy = useMemo(() => payload?.strategies?.find((row) => row.id === logic), [payload, logic]);

  return (
    <main className="space-y-4 p-1 text-white md:p-2">
      <header className="panel-gold rounded-[28px] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Link href="/decision-status" className="inline-flex items-center gap-2 text-sm text-gold-100">
              <ArrowLeft className="h-4 w-4" />判定状況一覧
            </Link>
            <h1 className="gold-heading mt-3 text-3xl font-black">{strategy?.label || logic.toUpperCase()} 判定状況</h1>
            <p className="mt-2 text-sm leading-6 text-white/65">{strategy?.description || "現在のrunner stateを表示します。"}</p>
          </div>
          <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />更新
          </button>
        </div>

        {!payload?.ok || !strategy ? (
          <div className="mt-4 rounded-xl border border-rose-400/30 bg-rose-400/10 p-3 text-sm text-rose-200">
            {payload?.error || "対象runnerの状態を取得できませんでした。"}
          </div>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/45">Status</div><div className="mt-1 font-black">{strategy.status}</div></div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/45">Runtime SHA</div><div className="mt-1 break-all font-mono text-xs">{strategy.runtimeSha || "—"}</div></div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/45">Snapshot</div><div className="mt-1 text-sm font-bold">{fmtTime(strategy.updatedAt)}</div></div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3"><div className="text-[10px] text-white/45">Trading release</div><div className="mt-1 break-all font-mono text-xs">{payload.releaseSha || "—"}</div></div>
          </div>
        )}
      </header>

      {strategy ? (
        <>
          <section className="panel-gold rounded-[24px] p-4">
            <h2 className="text-lg font-black">Heartbeat</h2>
            <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {topLevelRows(strategy.heartbeat).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">{key}</div>
                  <div className="mt-1 break-words text-xs font-bold text-white/85">{compact(value)}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 text-[10px] text-white/40">file mtime {fmtTime(strategy.heartbeatMtimeMs)}</div>
            <details className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <summary className="cursor-pointer text-xs font-bold text-gold-100">Heartbeat 詳細</summary>
              <pre className="mt-3 max-h-[420px] overflow-auto whitespace-pre-wrap break-all text-[10px] leading-5 text-white/65">{JSON.stringify(strategy.heartbeat, null, 2)}</pre>
            </details>
          </section>

          {Object.entries(strategy.states || {}).map(([name, state]) => (
            <section key={name} className="panel-gold rounded-[24px] p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black">{name}</h2>
                <span className="text-[10px] text-white/40">mtime {fmtTime(strategy.stateMtimes?.[name])}</span>
              </div>
              {state ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {topLevelRows(state).map(([key, value]) => (
                    <div key={key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-white/45">{key}</div>
                      <div className="mt-1 break-words text-xs font-bold text-white/85">{compact(value)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-white/10 p-4 text-sm text-white/50">state file未取得</div>
              )}
              {state ? (
                <details className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                  <summary className="cursor-pointer text-xs font-bold text-gold-100">{name} 詳細</summary>
                  <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-all text-[10px] leading-5 text-white/65">{JSON.stringify(state, null, 2)}</pre>
                </details>
              ) : null}
            </section>
          ))}
        </>
      ) : null}
    </main>
  );
}
