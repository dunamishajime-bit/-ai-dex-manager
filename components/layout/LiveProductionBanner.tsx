"use client";

import { Activity, ChevronDown, ShieldCheck } from "lucide-react";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { LiveRuntimeBadge } from "@/components/layout/LiveRuntimeBadge";
import { useProductionRuntime } from "@/hooks/useProductionRuntime";

function BannerContent() {
  const { snapshot: runtime, error: runtimeError } = useProductionRuntime();
  const caps = runtime?.caps;
  const v12 = runtime?.v12;
  const pengu = runtime?.pengu;
  const q102 = runtime?.quality102;
  const v52 = runtime?.v52;
  const lineage = runtime?.runtimeLineage;
  return (
    <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/80">
      <span className="inline-flex items-center gap-1.5 font-bold text-emerald-200">
        <Activity className="h-3.5 w-3.5" />
        {runtime && v12 && pengu && v52 ? `${v12.strategyId} / ${pengu.strategyId} / Q102 ${q102?.selectorMode ?? "UNAVAILABLE"} / FET BRK48 / ${v52.policyId}` : "DISTerminal Production Runtime"}
      </span>
      <span>{config.executionVenue}</span>
      <span className={runtime && lineage?.synchronized ? "text-emerald-200" : "text-amber-200"}>
        {runtime ? (lineage?.synchronized ? `Production ${runtime.releaseSha.slice(0, 12)} / runtime SHA同期` : `Production ${runtime.releaseSha.slice(0, 12)} / RUNTIME MISMATCH`) : `Production runtime未接続${runtimeError ? `: ${runtimeError}` : ""}`}
      </span>
      <span>{caps ? `Crypto共有損失上限 ${caps.sharedCryptoDailyLossPct}% / V52 ${caps.stockDailyLossPct}%` : "Risk contract runtime未取得"}</span>
      <span>{caps ? `Portfolio Gross上限 ${caps.totalGross.toFixed(1)}x` : "Gross runtime未取得"}</span>
      <span>{caps && v12 ? `V12 Top${v12.maximumPositions} / 1件${caps.v12PerPositionGross.toFixed(2)}x / Base ${caps.v12BaseGross.toFixed(2)}x / Dynamic ${caps.v12DynamicGross.toFixed(2)}x / Crypto ${caps.cryptoGross.toFixed(2)}x` : "V12 runtime未取得"}</span>
      <span>{v12 ? `V12 Entry Score≥${v12.neutralScoreThreshold.toFixed(4)} / Strong ${v12.strongRegimeQualityScoreMinimum.toFixed(2)}–${v12.strongRegimeQualityScoreMaximum.toFixed(2)} + ATR≥${(v12.strongRegimeQualityMinimumAtrRatio * 100).toFixed(1)}%` : "V12 Entry runtime未取得"}</span>
      <span>{pengu && caps ? `PENGU ${pengu.strategyId} / ${caps.penguGross.toFixed(2)}x / Recovery ${pengu.recoveryRule} ${pengu.recoveryInitialGross.toFixed(2)}x / hard-stop後${pengu.hardStopCooldownHours}h` : "PENGU runtime未取得"}</span>
      <span>{v52 && caps ? `V52 ${v52.policyId} / Slot ${caps.v52V50Gross.toFixed(2)}x / Stock ${caps.stockGross.toFixed(2)}x / Hold≤${v52.maximumHoldingHours}h` : "V52 runtime未取得"}</span>
      <span>{v52 ? `V52 Basis≥${v52.minimumEntryBasisBps}bps / Conv ${v52.convergenceBps}bps / Stop ${v52.basisStopMultiple}x / Edge≥${v52.minimumNetEdgeBps}bps / Cost≤${v52.maximumRoundTripCostBps}bps / Spread≤${v52.maximumSpreadBps}bps` : "V52 policy runtime未取得"}</span>
      <span className="text-amber-200">{q102 && caps ? `Q102 ${q102.selectorMode}: 1 Slot / ≤ ${caps.quality102Gross.toFixed(2)}x / HV ${q102.familyGross.HIGH_VOL.toFixed(3)}x / MR ${q102.familyGross.MR.toFixed(2)}x / BRK ${q102.familyGross.BRK.toFixed(3)}x / REV/PB ${q102.familyGross.REV.toFixed(2)}x / Crypto ≤ ${caps.cryptoGross.toFixed(2)}x / Total ≤ ${caps.totalGross.toFixed(2)}x` : "Q102 runtime未取得"}</span>
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
