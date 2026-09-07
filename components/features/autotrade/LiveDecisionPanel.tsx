"use client";

import { useEffect, useState } from "react";
import { Activity, RefreshCw, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

const REFRESH_INTERVAL_MS = 180_000;

type Decision = "LONG" | "SHORT" | "WAIT" | "HOLD" | "EXIT" | "UNKNOWN";
type StrategyRow = {
  id: "V12" | "PENGU" | "V52" | "Q102";
  strategyId: string;
  mode: string;
  enabled: boolean;
  decision: Decision;
  symbol?: string;
  stateStatus: "AVAILABLE" | "MISSING" | "INVALID";
  stateUpdatedAt?: number;
  pending: boolean;
  positionCount: number;
  grossCap: number;
  selectorMode?: string;
  reason?: string;
};

type LiveStatus = {
  source: "DAEMON_STATE_READ_ONLY";
  generatedAt: number;
  refreshIntervalMs: number;
  deployedSha?: string;
  strategies: StrategyRow[];
  risk: {
    killSwitchActive: boolean | null;
    killSwitchReason?: string;
    dailyRiskTripped: boolean | null;
    dailyLossPct?: number;
    accountLockStatus: "CLEAR" | "BUSY" | "STALE_REVIEW" | "UNKNOWN";
    cryptoGrossCap: number;
    totalGrossCap: number;
    penguGrossCap: number;
    stockGrossCap: number;
    q102GrossCap: number;
  };
};

type LiveStatusResponse = { ok: boolean; status?: LiveStatus; error?: string };

function timeLabel(value?: number) {
  return value ? new Date(value).toLocaleString("ja-JP") : "未取得";
}

function decisionTone(decision: Decision) {
  if (decision === "LONG") return "border-profit/35 bg-profit/10 text-profit";
  if (decision === "SHORT" || decision === "EXIT") return "border-loss/35 bg-loss/10 text-loss";
  return "border-white/15 bg-white/[0.03] text-white/70";
}

function stateTone(status: StrategyRow["stateStatus"]) {
  return status === "AVAILABLE"
    ? "text-profit"
    : status === "MISSING" ? "text-gold-100" : "text-loss";
}

function riskTone(ok: boolean | null) {
  if (ok === null) return "text-gold-100";
  return ok ? "text-loss" : "text-profit";
}

export function LiveDecisionPanel({ compact = false }: { compact?: boolean }) {
  const [response, setResponse] = useState<LiveStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/system/auto-trade/live-decision", { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as LiveStatusResponse | null;
        if (cancelled) return;
        if (json?.ok && json.status) {
          setResponse(json);
          setError(null);
        } else setError(json?.error || "現LIVE daemon状態を取得できませんでした。");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "現LIVE daemon状態を取得できませんでした。");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    const timer = window.setInterval(load, REFRESH_INTERVAL_MS);
    window.addEventListener("auto-trade-live-decision-refresh", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("auto-trade-live-decision-refresh", load);
    };
  }, []);

  const status = response?.status;
  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Activity className="h-4 w-4 text-gold-100" />
          現LIVEロジック判定状況
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.2em] text-gold-100/70">
          <RefreshCw className="h-3.5 w-3.5" />
          3分更新 / daemon state
        </div>
      </div>

      {loading ? (
        <div className="mt-3 rounded-[18px] border border-dashed border-white/10 px-4 py-6 text-sm text-white/70">
          V12 / PENGU / V52 / Q102 の実daemon状態を読み込んでいます。
        </div>
      ) : error ? (
        <div className="mt-3 rounded-[18px] border border-loss/30 bg-loss/10 px-4 py-6 text-sm text-loss">{error}</div>
      ) : status ? (
        <div className="mt-3 space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {status.strategies.map((row) => (
              <article key={row.id} className="min-w-0 rounded-[18px] border border-white/10 bg-white/[0.035] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-base font-black text-white">{row.id}</div>
                  <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", decisionTone(row.decision))}>
                    {row.decision}
                  </span>
                </div>
                <div className="mt-2 break-all text-[11px] leading-5 text-white/70">{row.strategyId}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-white/72">
                  <div>mode {row.mode}</div>
                  <div className={stateTone(row.stateStatus)}>state {row.stateStatus}</div>
                  <div>gross {row.grossCap.toFixed(2)}x</div>
                  <div>position {row.positionCount}</div>
                  <div>pending {row.pending ? "あり" : "なし"}</div>
                  <div>{row.symbol || "WAIT"}</div>
                </div>
                {row.selectorMode ? <div className="mt-2 text-[10px] font-bold text-gold-100">selector {row.selectorMode}</div> : null}
                {!compact && row.reason ? <div className="mt-2 break-words text-[11px] leading-5 text-white/60">{row.reason}</div> : null}
                <div className="mt-2 text-[10px] text-white/45">state更新 {timeLabel(row.stateUpdatedAt)}</div>
              </article>
            ))}
          </div>
          <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
            <div className="rounded-[18px] border border-white/10 bg-black/20 p-3">
              <div className="flex items-center gap-2 text-[11px] font-bold text-gold-100">
                <ShieldCheck className="h-3.5 w-3.5" /> 共通Safety
              </div>
              <div className="mt-2 grid gap-1 text-[11px] text-white/72 sm:grid-cols-2">
                <div className={riskTone(status.risk.killSwitchActive)}>Kill Switch: {status.risk.killSwitchActive === null ? "UNKNOWN" : status.risk.killSwitchActive ? "ACTIVE" : "inactive"}</div>
                <div>Account lock: {status.risk.accountLockStatus}</div>
                <div className={riskTone(status.risk.dailyRiskTripped)}>Daily risk: {status.risk.dailyRiskTripped === null ? "UNKNOWN" : status.risk.dailyRiskTripped ? "TRIPPED" : "未発動"}</div>
                <div>Daily loss: {status.risk.dailyLossPct == null ? "-" : `${status.risk.dailyLossPct.toFixed(2)}%`}</div>
              </div>
              {status.risk.killSwitchReason ? <div className="mt-2 break-words text-[10px] text-loss">{status.risk.killSwitchReason}</div> : null}
            </div>

            <div className="rounded-[18px] border border-white/10 bg-black/20 p-3 text-[11px] text-white/72">
              <div className="font-bold text-gold-100">Gross / Release</div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <div>Crypto {status.risk.cryptoGrossCap.toFixed(1)}x</div>
                <div>Total {status.risk.totalGrossCap.toFixed(1)}x</div>
                <div>PENGU {status.risk.penguGrossCap.toFixed(2)}x</div>
                <div>V52 Stock {status.risk.stockGrossCap.toFixed(1)}x</div>
                <div>Q102 {status.risk.q102GrossCap.toFixed(1)}x</div>
              </div>
              <div className="mt-2 break-all text-[10px] text-white/45">
                SHA {status.deployedSha || "未取得"}
              </div>
            </div>
          </div>

          <div className="text-right text-[10px] text-white/40">
            API取得 {timeLabel(status.generatedAt)} / source {status.source}
          </div>
        </div>
      ) : null}
    </section>
  );
}
