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
        <span>V96/V97：現在停止</span>
        <span>V52：市場時間外は待機</span>
        <span>Portfolio Gross上限 {config.maximumGross.toFixed(1)}</span>
        <span>PENGU Gross {config.penguMaximumGross.toFixed(2)} / 初期 {config.penguInitialGross.toFixed(2)}</span>
        <span className="inline-flex items-center gap-1 text-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" />
          状態は実API確認時のみ稼働中と表示
        </span>
      </div>
    </section>
  );
}
