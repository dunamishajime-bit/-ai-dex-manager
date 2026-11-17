"use client";
import { formatQ102SideGross } from "@/lib/production-display";

import { Activity, ChevronDown, ShieldCheck } from "lucide-react";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";
import { formatDisplayFractionPercent, formatDisplayNumber, formatDisplayPercent } from "@/lib/display-format";
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
        {runtime && v12 && pengu && v52 ? `${v12.strategyId} / ${pengu.strategyId} / Q102 ${q102?.selectorMode ?? "UNAVAILABLE"} / ${v52.policyId}` : "DISTerminal Production Runtime"}
      </span>
      <span>{config.executionVenue}</span>
      <span className={runtime && lineage?.synchronized ? "text-emerald-200" : "text-amber-200"}>
        {runtime ? (lineage?.synchronized ? `Production ${runtime.releaseSha.slice(0, 12)} / runtime SHA同期` : `Production ${runtime.releaseSha.slice(0, 12)} / RUNTIME MISMATCH`) : `Production runtime未接続${runtimeError ? `: ${runtimeError}` : ""}`}
      </span>
      <span>{caps ? `Crypto共有損失上限 ${caps.sharedCryptoDailyLossPct}% / V52 ${caps.stockDailyLossPct}%` : "Risk contract runtime未取得"}</span>
      <span>{caps ? `Portfolio Gross上限 ${formatDisplayNumber(caps.totalGross, 1)}x` : "Gross runtime未取得"}</span>
      <span>{caps && v12 ? `V12 Top${v12.maximumPositions} / 1件${formatDisplayNumber(caps.v12PerPositionGross, 2)}x / Base ${formatDisplayNumber(caps.v12BaseGross, 2)}x / Dynamic ${formatDisplayNumber(caps.v12DynamicGross, 2)}x / Crypto ${formatDisplayNumber(caps.cryptoGross, 2)}x` : "V12 runtime未取得"}</span>
      <span>{v12 ? `V12 Entry Score≥${formatDisplayNumber(v12.neutralScoreThreshold, 2)} / Strong ${formatDisplayNumber(v12.strongRegimeQualityScoreMinimum, 2)}–${formatDisplayNumber(v12.strongRegimeQualityScoreMaximum, 2)} + ATR≥${formatDisplayFractionPercent(v12.strongRegimeQualityMinimumAtrRatio)}` : "V12 Entry runtime未取得"}</span>
      <span>{pengu && caps ? `PENGU ${pengu.logicProfile} / 限定${formatDisplayFractionPercent(pengu.limitedStructuralRebreakPct)} re-break / ${formatDisplayNumber(caps.penguGross, 2)}x / Recovery ${pengu.recoveryRule} ${formatDisplayNumber(pengu.recoveryInitialGross, 2)}x / 通常${formatDisplayNumber(pengu.normalCooldownHours, 1)}h / hard-stop ${formatDisplayNumber(pengu.hardStopCooldownHours, 1)}h / Q${formatDisplayNumber(pengu.routeHardStopQuarantineHours, 1)} / DD ${formatDisplayPercent(pengu.realizedDrawdownThresholdPct)}→${formatDisplayNumber(pengu.realizedDrawdownHoldHours, 1)}h` : "PENGU runtime未取得"}</span>
      <span>{v52 && caps ? `V52 ${v52.policyId} / Slot ${formatDisplayNumber(caps.v52V50Gross, 2)}x / Stock ${formatDisplayNumber(caps.stockGross, 2)}x / Hold≤${formatDisplayNumber(v52.maximumHoldingHours, 1)}h` : "V52 runtime未取得"}</span>
      <span>{v52 ? `V52 Basis≥${v52.minimumEntryBasisBps}bps / Conv ${v52.convergenceBps}bps / Stop ${v52.basisStopMultiple}x / Edge≥${v52.minimumNetEdgeBps}bps / Cost≤${v52.maximumRoundTripCostBps}bps / Spread≤${v52.maximumSpreadBps}bps` : "V52 policy runtime未取得"}</span>
      <span className="text-amber-200">{q102 && caps ? `Q102 ${q102.selectorMode}: 1 Slot / ≤ ${formatDisplayNumber(caps.quality102Gross, 2)}x / ${formatQ102SideGross(q102.familySideGross)} / Crypto ≤ ${formatDisplayNumber(caps.cryptoGross, 2)}x / Total ≤ ${formatDisplayNumber(caps.totalGross, 2)}x` : "Q102 runtime未取得"}</span>
      <span>{runtime?.hype ? `${runtime.hype.profile} / Gross ${formatDisplayNumber(runtime.hype.maximumGross, 2)}x` : "HYPE runtime未取得"}</span>
      <span>FET 72h ≥ +2% / 決済後24h cooldown・V12 同Side6連敗→6h / V52 固定緊急STOP無効</span>
      <LiveRuntimeBadge />
      <span className="inline-flex items-center gap-1 text-emerald-200">
        <ShieldCheck className="h-3.5 w-3.5" />
        Kill Switch / Parity / Override は実状態を確認
      </span>
    </div>
  );
}

export function LiveProductionBanner({ compact = false }: { compact?: boolean } = {}) {
  return (
    <>
      <details className={"group shrink-0 border-b border-emerald-400/15 bg-[linear-gradient(90deg,rgba(6,30,27,0.96),rgba(7,13,21,0.96))] " + (compact ? "" : "md:hidden")}>
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

      <section className={"hidden shrink-0 border-b border-emerald-400/15 bg-[linear-gradient(90deg,rgba(6,30,27,0.96),rgba(7,13,21,0.96))] px-3 py-2 md:px-6 " + (compact ? "" : "md:block")}>
        <BannerContent />
      </section>
    </>
  );
}
