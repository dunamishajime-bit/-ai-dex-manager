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
        <span>V12+PENGU共有損失上限 {config.sharedCryptoDailyLossPct}%</span>
        <span>V52損失上限 {config.v52DailyLossPct}%</span>
        <span>Portfolio Gross上限 {config.maximumGross.toFixed(1)}x</span>
       <span>V12 {config.v12SizingMode} / PENGU上限 {config.penguGross.toFixed(2)}x / Crypto共有 {config.sharedCryptoGross.toFixed(1)}x</span>
        <span>PENGU Recovery V8 {config.penguRecoveryV8.entryRule} / {config.penguRecoveryV8.recoveryGross.toFixed(2)}x / {config.penguRecoveryV8.partialAfterHours}h後partial {config.penguRecoveryV8.partialGross.toFixed(2)}x</span>
        <span>V52 Top2 Rank1 {config.v52Top2Policy.rank1RequestedGross.toFixed(2)}x / Rank2 {config.v52Top2Policy.rank2RequestedGross.toFixed(2)}x / 最大{config.v52Top2Policy.maxConcurrentPositions}建玉</span>
        <span>V52 Gate basis≥{config.v52Top2Policy.minEntryBasisBps}bps / net edge≥{config.v52Top2Policy.minNetEdgeBps}bps / 各{config.v52Top2Policy.entryWindowSeconds}秒</span>
        <span className="inline-flex items-center gap-1 text-emerald-200">
          <ShieldCheck className="h-3.5 w-3.5" />
          Kill Switch / Parity / Override は実状態を確認
        </span>
      </div>
    </section>
  );
}
