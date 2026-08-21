"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";

type Candidate = {
  symbol: string;
  regime: string | null;
  available: boolean;
  passed: boolean;
  side?: string;
  momentum?: number;
  volumeRatio?: number;
  score?: number;
  reasons: string[];
  gates: Record<string, boolean>;
};

type Status = {
  ok: boolean;
  generatedAt: string;
  mode: string;
  enabled: boolean;
  liveTradingEnabled: boolean;
  liveExecutionEnabled: boolean;
  caps: { v12Aggregate: number; v12PerPosition: number; maximumPositions: number; crypto: number; portfolio: number };
  state: { activePositions: Array<{ symbol: string; side: string; quantity: number; gross: number }>; pending: unknown; killSwitch: { active: boolean; reason?: string } | null; manualReview?: string | null };
  risk: { ok: boolean; reason: string | null; updatedAt: string | number | null };
  market?: { unavailable?: boolean; reason?: string; referenceTs?: number | null; regime?: string | null; candidates: Candidate[]; signals: Array<{ symbol: string; side: string; score: number; rank: number }> };
};

const gateLabels: Record<string, string> = { history: "履歴", indicators: "指標", volume: "出来高", edge: "コスト優位性", momentum: "モメンタム", regime: "BTCレジーム" };

function pct(value?: number) { return value == null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(2)}%`; }

export function V12GateStatusPanel({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/system/v12-status", { cache: "no-store" });
      const data = (await response.json()) as Status;
      if (!response.ok || !data.ok) throw new Error("V12判定状態を取得できませんでした。");
      setStatus(data); setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "V12判定状態を取得できませんでした。"); }
  }

  useEffect(() => { void load(); const timer = window.setInterval(load, 60_000); return () => window.clearInterval(timer); }, []);

  const market = status?.market;
  const signals = market?.signals || [];
  const rows = compact ? (market?.candidates || []).filter((row) => row.passed || signals.some((signal) => signal.symbol === row.symbol)).slice(0, 5) : (market?.candidates || []);
  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white"><ShieldCheck className="h-4 w-4 text-gold-100" />V12 X1.00 ALL — 発火候補と最終Gate</div>
        <button onClick={() => void load()} className="text-gold-100/80 hover:text-gold-50" aria-label="V12状態を更新"><RefreshCw className="h-3.5 w-3.5" /></button>
      </div>
      {error ? <div className="mt-3 rounded-[16px] border border-loss/30 bg-loss/10 px-3 py-3 text-sm text-loss">{error}</div> : null}
      {!status ? <div className="mt-3 text-sm text-white/70">V12の現在判定を読み込んでいます。</div> : (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 text-[11px] text-white/78 md:grid-cols-4">
            <div>モード: <b className="text-white">{status.mode}</b></div>
            <div>V12稼働: <b className={status.enabled ? "text-profit" : "text-loss"}>{status.enabled ? "有効" : "無効"}</b></div>
            <div>共通リスク: <b className={status.risk.ok ? "text-profit" : "text-loss"}>{status.risk.ok ? "PASS" : "BLOCKED"}</b></div>
            <div>保有: <b className="text-white">{status.state.activePositions.length}/{status.caps.maximumPositions}</b></div>
          </div>
          {status.state.killSwitch?.active || status.state.manualReview ? <div className="rounded-[14px] border border-loss/30 bg-loss/10 px-3 py-2 text-[11px] text-loss">Kill Switch / Manual Review: {status.state.killSwitch?.reason || status.state.manualReview}</div> : null}
          {market?.unavailable ? <div className="rounded-[14px] border border-loss/30 bg-loss/10 px-3 py-2 text-[11px] text-loss">参照データ unavailable: {market.reason || "unknown"}</div> : null}
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => {
              const selected = market?.signals.find((signal) => signal.symbol === row.symbol);
              const allPassed = Object.values(row.gates).every(Boolean);
              return <div key={row.symbol} className="rounded-[16px] border border-white/10 bg-white/[0.035] p-3">
                <div className="flex items-center justify-between gap-2"><div className="font-black text-white">{row.symbol}/USDT</div><span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", row.passed && allPassed ? "border-profit/40 bg-profit/10 text-profit" : "border-white/15 text-white/60")}>{row.passed && allPassed ? "ENTRY_ELIGIBLE" : "BLOCKED"}</span></div>
                <div className="mt-1 text-[11px] text-white/60">{selected ? `rank ${selected.rank} / ${selected.side} / score ${selected.score.toFixed(3)}` : "発火候補外"} · BTC regime {row.regime || "-"}</div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-white/72">{Object.entries(row.gates).map(([key, pass]) => <span key={key} className={pass ? "text-profit" : "text-loss"}>{pass ? "✓" : "×"} {gateLabels[key] || key}</span>)}</div>
                <div className="mt-2 text-[10px] text-white/58">momentum {pct(row.momentum)} · volume {row.volumeRatio == null ? "-" : row.volumeRatio.toFixed(2)}{row.reasons.length ? ` · ${row.reasons.join(", ")}` : ""}</div>
              </div>;
            })}
          </div>
          <div className="text-[10px] text-white/55">判定時刻: {new Date(status.generatedAt).toLocaleString("ja-JP")}。ENTRY_ELIGIBLEはV12シグナルGateのみの表示で、注文可否は共通リスク・残余枠・Kill Switch・再照合を通過したworkerだけが決定します。</div>
        </div>
      )}
    </section>
  );
}
