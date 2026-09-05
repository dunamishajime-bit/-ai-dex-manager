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
      <span>V12+PENGU共有損失上限 {config.sharedCryptoDailyLossPct}%</span>
      <span>V52損失上限 {config.v52DailyLossPct}%</span>
      <span>Portfolio Gross上限 {config.maximumGross.toFixed(1)}x</span>
      <span>V12 {config.v12SizingMode} / PENGU上限 {config.penguGross.toFixed(2)}x / Crypto共有 {config.sharedCryptoGross.toFixed(1)}x</span>
      <span>PENGU Recovery V8 {config.penguRecoveryV8.entryRule} / {config.penguRecoveryV8.recoveryGross.toFixed(2)}x / {config.penguRecoveryV8.partialAfterHours}h後partial {config.penguRecoveryV8.partialGross.toFixed(2)}x</span>
      <span>V52 Top2 Rank1 {config.v52Top2Policy.rank1RequestedGross.toFixed(2)}x / Rank2 {config.v52Top2Policy.rank2RequestedGross.toFixed(2)}x / 最大{config.v52Top2Policy.maxConcurrentPositions}建玉</span>
      <span>V52 Gate basis≥{config.v52Top2Policy.minEntryBasisBps}bps / net edge≥{config.v52Top2Policy.minNetEdgeBps}bps / 各{config.v52Top2Policy.entryWindowSeconds}秒</span>
      <span className="text-amber-200">Quality102 LIVE derived HIGH_VOL: ≤ {config.quality102Runtime.strategyGrossCap.toFixed(2)}x / Crypto ≤ {config.quality102Runtime.cryptoGrossCap.toFixed(2)}x / Total ≤ {config.quality102Runtime.totalGrossCap.toFixed(2)}x</span>
      <span className="text-amber-200">歴史的102件selector / BRK raw式: parity未証明のため該当部分のみFAIL CLOSED</span>
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
