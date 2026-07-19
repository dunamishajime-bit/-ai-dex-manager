"use client";

import { useEffect, useState } from "react";
import { Activity, AlertCircle, RefreshCw, ShieldCheck } from "lucide-react";

import {
  CURRENT_DISDEX_STRATEGY,
  type CurrentStrategyStatusResponse,
} from "@/lib/current-strategy-display";

function money(value: number | null) {
  return value == null ? "—" : `$${value.toFixed(2)}`;
}

function percent(value: number | null) {
  return value == null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function time(value: number | null) {
  return value == null ? "—" : new Date(value).toLocaleString("ja-JP");
}

function runnerLabel(status?: CurrentStrategyStatusResponse["runner"]["status"]) {
  if (status === "active") return "LIVE runner 稼働中";
  if (status === "stale") return "runner状態が古い";
  return "runner状態を取得できません";
}

export function CurrentStrategyStatus({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<CurrentStrategyStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/strategy/current-status", { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as CurrentStrategyStatusResponse | null;
        if (!cancelled && data?.ok) setStatus(data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    window.addEventListener("strategy-status-refresh", load);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("strategy-status-refresh", load);
    };
  }, []);

  const current = status?.strategy || CURRENT_DISDEX_STRATEGY;
  const runner = status?.runner;
  const account = status?.account;
  const safety = status?.safety;

  if (compact) {
    return (
      <section className="mb-3 rounded-[18px] border border-profit/25 bg-[linear-gradient(90deg,rgba(10,35,27,0.82),rgba(8,16,22,0.92))] px-3 py-2.5 text-white shadow-[0_0_20px_rgba(34,197,94,0.06)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <div className="flex items-center gap-2 font-bold text-white">
            <ShieldCheck className="h-4 w-4 text-profit" />
            現行自動売買
          </div>
          <span className="rounded-full border border-profit/40 bg-profit/15 px-2 py-0.5 text-[10px] font-black tracking-[0.16em] text-profit">
            LIVE
          </span>
          <span className="font-semibold text-white/90">{current.name}</span>
          <span className="text-white/62">{current.venue}</span>
          <span className={runner?.active ? "text-profit" : "text-gold-100"}>
            {loading ? "状態確認中…" : runnerLabel(runner?.status)}
          </span>
          <span className="text-white/62">Gross {current.maximumGross.toFixed(1)}</span>
          <span className="text-white/62">管理 {current.managedSymbols.length}銘柄</span>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-gold rounded-[28px] p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.28em] text-gold-100/76">
            <Activity className="h-3.5 w-3.5" />
            Current live strategy
          </div>
          <h2 className="mt-2 text-xl font-black text-white md:text-2xl">{current.name}</h2>
          <p className="mt-1 text-[11px] text-white/62">{current.id} / {current.venue}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-profit/40 bg-profit/15 px-3 py-1.5 text-[10px] font-black tracking-[0.18em] text-profit">
            MODE: LIVE
          </span>
          <span className="rounded-full border border-gold-400/25 bg-gold-400/10 px-3 py-1.5 text-[10px] font-bold text-gold-100">
            {loading ? "確認中" : runnerLabel(runner?.status)}
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-100/70">Gross / Reserve</div>
          <div className="mt-1 text-lg font-black text-white">{percent(account?.currentGross ?? null)} / {current.cashReservePct}%</div>
          <div className="mt-1 text-[11px] text-white/60">上限 {current.maximumGross.toFixed(1)}</div>
        </div>
        <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-100/70">Aster equity</div>
          <div className="mt-1 text-lg font-black text-white">{money(account?.equity ?? null)}</div>
          <div className="mt-1 text-[11px] text-white/60">Available {money(account?.availableBalance ?? null)}</div>
        </div>
        <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-100/70">PENGU allocation</div>
          <div className="mt-1 text-lg font-black text-white">L {current.penguLongGross.toFixed(2)} / S {current.penguShortGross.toFixed(2)}</div>
          <div className="mt-1 text-[11px] text-white/60">Funding上限 {current.penguFundingCap}</div>
        </div>
        <div className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3">
          <div className="text-[10px] uppercase tracking-[0.2em] text-gold-100/70">Safety state</div>
          <div className="mt-1 text-lg font-black text-white">Open Order {safety?.openOrderCount ?? "—"}</div>
          <div className={safety?.pendingUnknown ? "mt-1 text-[11px] text-loss" : "mt-1 text-[11px] text-profit"}>
            {safety?.pendingUnknown ? "UNKNOWN pendingあり：注文停止" : "UNKNOWN pendingなし"}
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-100/70">Managed symbols</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {current.managedSymbols.map((symbol) => (
              <span key={symbol} className="rounded-full border border-white/12 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/84">
                {symbol}
              </span>
            ))}
          </div>
          <div className="mt-3 text-[11px] leading-5 text-white/70">
            closeUnmanagedPositions=false。管理外銘柄・手動ポジション・別プロジェクトのポジションは自動決済しません。
          </div>
        </div>
        <div className="rounded-[18px] border border-white/10 bg-black/20 px-4 py-3 text-[11px] leading-5 text-white/72">
          <div className="font-bold text-gold-100">研究と実売買の境界</div>
          <p className="mt-1">Win80 / Ultra90の研究表示は研究ラボ専用で、現在の実売買ロジックではありません。</p>
          <p className="mt-1">{current.evidenceNotice}</p>
          <p className="mt-1">起動状態: {runner?.recoveryStatus || "—"} / 最終更新: {time(runner?.stateUpdatedAt ?? null)}</p>
        </div>
      </div>

      {status?.positions.length ? (
        <div className="mt-3 rounded-[18px] border border-white/10 bg-black/20 px-4 py-3">
          <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-100/70">Current managed positions</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {status.positions.map((position) => (
              <div key={`${position.symbol}-${position.positionSide}`} className="rounded-[14px] border border-white/8 bg-white/[0.03] px-3 py-2 text-[11px] text-white/78">
                <div className="font-bold text-white">{position.symbol} / {position.positionSide}</div>
                <div className="mt-1">Qty {position.quantity} / Notional ${position.notionalUsd.toFixed(2)}</div>
                <div className="mt-1 text-white/58">Entry {position.entryPrice} / Mark {position.markPrice}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-[18px] border border-dashed border-white/10 px-4 py-3 text-[11px] text-white/62">
          現在、V46の管理対象ポジションはありません。
        </div>
      )}

      {safety?.failures.length ? (
        <div className="mt-3 flex items-start gap-2 rounded-[16px] border border-loss/30 bg-loss/10 px-3 py-3 text-[11px] text-loss">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>runnerの直近警告: {safety.failures.join(" / ")}</div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2 text-[10px] text-white/48">
        <RefreshCw className="h-3.5 w-3.5" />
        30秒ごとにV46 durable stateを再取得します。最終tick: {time(runner?.lastRunAt ?? null)}
      </div>
    </section>
  );
}

