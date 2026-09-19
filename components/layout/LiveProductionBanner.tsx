"use client";

import { Activity, ChevronDown, ShieldCheck } from "lucide-react";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { LiveRuntimeBadge } from "@/components/layout/LiveRuntimeBadge";
import { useProductionRuntime } from "@/hooks/useProductionRuntime";

function BannerContent() {
  const { snapshot: runtime, error: runtimeError } = useProductionRuntime();
  const caps = runtime?.caps;
  const q102 = runtime?.quality102;
  const v52 = runtime?.v52;
  return (
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/80">
      <span className="inline-flex items-center gap-1.5 font-bold text-emerald-200">
        <Activity className="h-3.5 w-3.5" />
        {config.strategyLabel}
      </span>
      <span>{config.executionVenue}</span>
      <span className={runtime ? "text-emerald-200" : "text-amber-200"}>
        {runtime ? `Production ${runtime.releaseSha.slice(0, 12)} / runtime直結` : `Production runtime未接続${runtimeError ? `: ${runtimeError}` : ""}`}
      </span>
      <span>V12+PENGU共有損失上限 {caps?.sharedCryptoDailyLossPct ?? config.sharedCryptoDailyLossPct}%</span>
      <span>V52損失上限 {caps?.stockDailyLossPct ?? config.v52DailyLossPct}%</span>
      <span>Portfolio Gross上限 {(caps?.totalGross ?? config.maximumGross).toFixed(1)}x</span>
      <span>V12 Top2 / 1件{(caps?.v12PerPositionGross ?? config.v12PerPositionGross).toFixed(2)}x / Base {(caps?.v12BaseGross ?? config.v12BaseGross).toFixed(2)}x / Dynamic込み最大 {(caps?.v12DynamicGross ?? config.v12Gross).toFixed(2)}x / PENGU上限 {(caps?.penguGross ?? config.penguGross).toFixed(2)}x / Crypto共有 {(caps?.cryptoGross ?? config.sharedCryptoGross).toFixed(2)}x</span>
      <span>PENGU Short V20 / Recovery V8 {config.penguRecoveryV8.entryRule} / hard-stop後{config.penguHardStopCooldownHours}h cooldown / {config.penguRecoveryV8.recoveryGross.toFixed(2)}x</span>
      <span>V52 Top2 Rank1 {config.v52Top2Policy.rank1RequestedGross.toFixed(2)}x / Rank2 {config.v52Top2Policy.rank2RequestedGross.toFixed(2)}x / Slot上限 {(caps?.v52V50Gross ?? config.v52V50Gross).toFixed(2)}x / Stock {(caps?.stockGross ?? config.v52StockGross).toFixed(2)}x / 最大{config.v52Top2Policy.maxConcurrentPositions}建玉</span>
      <span>V52 V11 unchanged / V50 Basis≥{v52?.minimumEntryBasisBps ?? config.v52Top2Policy.minEntryBasisBps}bps / Conv {v52?.convergenceBps ?? config.v52Top2Policy.convergenceBps}bps / Stop {v52?.basisStopMultiple ?? config.v52Top2Policy.basisStopMultiple}x / Edge≥{v52?.minimumNetEdgeBps ?? config.v52Top2Policy.minNetEdgeBps}bps / Cost≤{v52?.maximumRoundTripCostBps ?? config.v52Top2Policy.maximumRoundTripCostBps}bps / Spread≤{v52?.maximumSpreadBps ?? config.v52Top2Policy.maximumSpreadBps}bps</span>
      <span className="text-amber-200">Q102 {q102?.selectorMode ?? config.quality102Runtime.selectorMode}: 1 Slot / ≤ {(caps?.quality102Gross ?? config.quality102Runtime.strategyGrossCap).toFixed(2)}x / HV {(q102?.familyGross.HIGH_VOL ?? config.quality102Runtime.familyGross.HIGH_VOL).toFixed(3)}x / MR {(q102?.familyGross.MR ?? config.quality102Runtime.familyGross.MR).toFixed(2)}x / BRK {(q102?.familyGross.BRK ?? config.quality102Runtime.familyGross.BRK).toFixed(3)}x / REV/PB {(q102?.familyGross.REV ?? config.quality102Runtime.familyGross.REV).toFixed(2)}x / Crypto ≤ {(caps?.cryptoGross ?? config.quality102Runtime.cryptoGrossCap).toFixed(2)}x / Total ≤ {(caps?.totalGross ?? config.quality102Runtime.totalGrossCap).toFixed(2)}x</span>
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
