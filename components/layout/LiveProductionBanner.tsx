"use client";

import { Activity, ChevronDown, ShieldCheck } from "lucide-react";

import { LiveRuntimeBadge } from "@/components/layout/LiveRuntimeBadge";
import { useProductionRuntime } from "@/hooks/useProductionRuntime";

function BannerContent() {
  const { snapshot, loading, error } = useProductionRuntime();
  const runtimeReady = snapshot?.status === "LIVE" && snapshot.runtimeLineage.synchronized;

  return (
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/80">
      <span className="inline-flex items-center gap-1.5 font-bold text-emerald-200">
        <Activity className="h-3.5 w-3.5" />
        VPS runtime truth
      </span>
      <span className={runtimeReady ? "text-emerald-200" : "text-amber-200"}>lineage: {loading && !snapshot ? "確認中" : runtimeReady ? "同期済み" : "未取得 / 要確認"}</span>
      <span>release: {snapshot?.releaseSha ? `${snapshot.releaseSha.slice(0, 8)}…` : "未取得"}</span>
      <span>effective total gross: {snapshot ? `${snapshot.caps.totalGross.toFixed(2)}x` : "未取得"}</span>
      <span>shared crypto daily loss: {snapshot ? `${snapshot.caps.sharedCryptoDailyLossPct.toFixed(2)}%` : "未取得"}</span>
      <span className="text-amber-200">runtime caps / lineage unavailable時はstatic contractへfallbackしません。</span>
      {error ? <span className="text-amber-200">要確認: {error}</span> : null}
      <LiveRuntimeBadge />
      <span className="inline-flex items-center gap-1 text-emerald-200">
        <ShieldCheck className="h-3.5 w-3.5" />
        Kill Switch / Parity / Override は実状態を確認
      </span>
    </div>
  );
}

export function LiveProductionBanner() {
  return (
    <>
      <details className="group border-b border-emerald-400/15 bg-[linear-gradient(90deg,rgba(6,30,27,0.96),rgba(7,13,21,0.96))] md:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-[11px] text-white/80 [&::-webkit-details-marker]:hidden">
          <span className="inline-flex items-center gap-2 font-bold text-emerald-200">
            <Activity className="h-3.5 w-3.5" />
            運用ロジック情報
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-white/55">
            詳細
            <ChevronDown className="h-3.5 w-3.5 transition-transform duration-200 group-open:rotate-180" />
          </span>
        </summary>
        <div className="border-t border-emerald-400/10 px-4 pb-3 pt-2">
          <BannerContent />
        </div>
      </details>

      <section className="hidden border-b border-emerald-400/15 bg-[linear-gradient(90deg,rgba(6,30,27,0.96),rgba(7,13,21,0.96))] px-3 py-2 md:block md:px-6">
        <BannerContent />
      </section>
    </>
  );
}
