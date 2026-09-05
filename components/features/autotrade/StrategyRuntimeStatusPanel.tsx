"use client";

import { Activity, ShieldAlert } from "lucide-react";

import { heartbeatAgeLabel, runtimeStateLabel, useStrategyRuntimeStatus } from "@/hooks/useStrategyRuntimeStatus";
import type { StrategyRuntimeStatus } from "@/lib/disdex-runtime-status";
import { cn } from "@/lib/utils";

const stateTone: Record<StrategyRuntimeStatus["state"], string> = {
  LIVE: "border-profit/40 bg-profit/10 text-profit",
  WAITING: "border-gold-400/35 bg-gold-400/10 text-gold-100",
  RECOVERING: "border-sky-400/35 bg-sky-400/10 text-sky-200",
  FAIL_CLOSED: "border-loss/35 bg-loss/10 text-loss",
  MANUAL_REVIEW: "border-loss/35 bg-loss/10 text-loss",
  要確認: "border-white/20 bg-white/[0.05] text-white/72",
};

function capLabel(value: number | null) {
  return value === null ? "要確認" : `${value.toFixed(2)}x`;
}

function RuntimeCard({ item }: { item: StrategyRuntimeStatus }) {
  return (
    <article className="min-w-0 rounded-[20px] border border-white/10 bg-white/[0.035] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-black text-white">{item.displayName}</h3>
          <div className="mt-1 break-all text-[10px] text-white/50">{item.strategyId}</div>
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[10px] font-bold", stateTone[item.state])}>
          {runtimeStateLabel(item.state)}
        </span>
      </div>
      <div className="mt-3 grid gap-2 text-[11px] text-white/76 sm:grid-cols-2">
        <div>Heartbeat: {heartbeatAgeLabel(item.heartbeatAt)}</div>
        <div>Release: {item.releaseShaMatch ? "一致" : "要確認"}</div>
        <div className="sm:col-span-2">Decision: {item.lastDecision || "要確認"}</div>
        <div className="sm:col-span-2 break-words">Reason: {item.safetyReason || "要確認"}</div>
        <div>Recovery: {item.recovery.action}</div>
        <div>Attempts: {item.recovery.attempts}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1.5 text-[10px] text-white/66">
        <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-2">Strategy {capLabel(item.gross.strategyCap)}</div>
        <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-2">Crypto {capLabel(item.gross.cryptoCap)}</div>
        <div className="rounded-lg border border-white/8 bg-black/20 px-2 py-2">Total {capLabel(item.gross.totalCap)}</div>
      </div>
    </article>
  );
}

function Q102Conditions({ item, stale }: { item: StrategyRuntimeStatus; stale: boolean }) {
  const safeState = stale || item.state === "要確認" ? "要確認" : "FAIL_CLOSED";
  return (
    <div id="q102-runtime-status" className="mt-3 rounded-[22px] border border-loss/25 bg-loss/[0.06] p-3">
      <div className="flex items-center gap-2 text-sm font-black text-white"><ShieldAlert className="h-4 w-4 text-loss" />Q102判定条件 / 対象通貨</div>
      <div className="mt-2 grid gap-2 text-[11px] leading-5 text-white/78 sm:grid-cols-2">
        <div>Selector: DERIVED_HIGH_VOL_ONLY</div><div>Quality102上限: 0.50x</div>
        <div>Crypto Gross上限: 2.00x</div><div>Total Gross上限: 2.50x</div>
        <div className="sm:col-span-2">Historical selector parity: 未証明（LIVE判定とは分離）</div>
        <div className="sm:col-span-2 font-bold text-loss">表示状態: {safeState} / 実行不可（Q102はFAIL_CLOSED固定）</div>
      </div>
      <div className="mt-3 space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold-100/72">runtime heartbeatのsymbols一覧</div>
        {item.symbols.length > 0 ? item.symbols.map((symbol) => (
          <div key={symbol.symbol} className="grid gap-1 rounded-[14px] border border-white/10 bg-black/20 px-3 py-2 text-[11px] text-white/76 sm:grid-cols-[0.8fr_0.7fr_1.5fr]">
            <div className="font-bold text-white">{symbol.symbol}</div>
            <div>{symbol.eligible ? "eligible" : "ineligible"}</div>
            <div className="break-words">{stale ? "要確認: status stale" : symbol.reason || "reason unavailable"}</div>
          </div>
        )) : <div className="rounded-[14px] border border-dashed border-white/10 px-3 py-3 text-[11px] text-white/62">対象通貨は要確認</div>}
      </div>
    </div>
  );
}

export function StrategyRuntimeStatusPanel() {
  const snapshot = useStrategyRuntimeStatus();
  const q102 = snapshot.data?.find((item) => item.strategyId === "QUALITY102_CAUSAL_V1");
  return (
    <section className="panel-gold min-w-0 rounded-[28px] p-4" aria-label="Strategy runtime status">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white"><Activity className="h-4 w-4 text-gold-100" />Strategy Runtime Status</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-gold-100/70">{snapshot.refreshing ? "refreshing" : snapshot.stale ? "要確認" : "60s monitor"}</div>
      </div>
      {snapshot.loading && !snapshot.data ? <div className="mt-3 rounded-[16px] border border-dashed border-white/10 px-3 py-5 text-sm text-white/70">runtime statusを読み込んでいます。</div> : null}
      {snapshot.data ? <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">{snapshot.data.map((item) => <RuntimeCard key={item.strategyId} item={item} />)}</div> : null}
      {!snapshot.data && !snapshot.loading ? <div className="mt-3 rounded-[16px] border border-loss/30 bg-loss/10 px-3 py-5 text-sm text-loss">Runtime status: 要確認（API unavailable）</div> : null}
      {snapshot.data && snapshot.error ? <div className="mt-3 rounded-[14px] border border-loss/25 bg-loss/[0.06] px-3 py-2 text-[11px] text-loss">最新取得に失敗しました。前回成功値を表示中: 要確認</div> : null}
      {q102 ? <Q102Conditions item={q102} stale={snapshot.stale} /> : null}
    </section>
  );
}
