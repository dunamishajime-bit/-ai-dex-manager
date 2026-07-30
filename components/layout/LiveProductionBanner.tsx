import { Activity, ShieldCheck } from "lucide-react";

import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

export function LiveProductionBanner() {
  return (
    <section className="border-b border-emerald-400/15 bg-[linear-gradient(90deg,rgba(6,30,27,0.96),rgba(7,13,21,0.96))] px-3 py-2 md:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/80">
        <span className="inline-flex items-center gap-1.5 font-bold text-emerald-200">
          <Activity className="h-3.5 w-3.5" />
          {config.strategyLabel}
        </span>
        <span>{config.executionVenue}</span>
        <span>V96損失上限 {config.v96DailyLossPct}%</span>
        <span>V52損失上限 {config.v52DailyLossPct}%</span>
        <span>最大Gross {config.maximumGross.toFixed(1)}</span>
        <span>PENGU初期Gross {config.penguInitialGross.toFixed(2)}</span>
        <span className="inline-flex items-center gap-1 text-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" />
          Kill Switch / Parity / Override は実状態を確認
        </span>
      </div>
    </section>
  );
}