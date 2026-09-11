import { Activity, ChevronDown, ShieldCheck } from "lucide-react";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { LiveRuntimeBadge } from "@/components/layout/LiveRuntimeBadge";

function BannerContent() {
  return (
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/80">
      <span className="inline-flex items-center gap-1.5 font-bold text-emerald-200">
        <Activity className="h-3.5 w-3.5" />
        {config.strategyLabel}
      </span>
      <span>{config.executionVenue}</span>
      <span>共有日次損失上限 {config.sharedCryptoDailyLossPct}% / V52 {config.v52DailyLossPct}%</span>
      <span>全体Gross上限 {config.maximumGross.toFixed(1)}x / Crypto {config.sharedCryptoGross.toFixed(1)}x</span>
      <span>V12 Top2 {config.v12SizingMode} / PENGU Short V20 + Recovery V8 {config.penguGross.toFixed(2)}x</span>
      <span>V52 Top2 {config.v52Top2Policy.rank1RequestedGross.toFixed(2)}x・{config.v52Top2Policy.rank2RequestedGross.toFixed(2)}x / 最大{config.v52Top2Policy.maxConcurrentPositions}建玉</span>
      <span className="text-amber-200">Quality102 Causal V4 {config.quality102Runtime.strategyGrossCap.toFixed(2)}x / 1 slot</span>
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
