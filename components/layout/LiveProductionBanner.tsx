"use client";

import { Activity, ShieldCheck } from "lucide-react";
import { useDisterminalLiveStatus } from "@/hooks/useDisterminalLiveStatus";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

export function LiveProductionBanner() {
  const { data, loading } = useDisterminalLiveStatus();
  const active = data?.state === "ACTIVE";
  return (
    <section className="border-b border-white/10 bg-[linear-gradient(90deg,rgba(17,20,28,0.96),rgba(7,13,21,0.96))] px-3 py-2 md:px-6">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-white/80">
        <span className={"inline-flex items-center gap-1.5 font-bold " + (active ? "text-emerald-200" : "text-amber-100")}><Activity className="h-3.5 w-3.5" />{active ? "LIVE稼働確認済み" : loading ? "LIVE状態確認中" : "LIVE状態未確認"}</span>
        <span>V96 Crypto + V52 Stock</span>
        <span>{config.executionVenue}</span>
        <span>V96 Daily Loss {config.v96DailyLossPct}%</span>
        <span>V52 Daily Loss {config.v52DailyLossPct}%</span>
        <span>最大Gross {config.maximumGross.toFixed(1)}</span>
        <span>PENGU初期Gross {config.penguInitialGross.toFixed(2)}</span>
        <span className="inline-flex items-center gap-1 text-white/65"><ShieldCheck className="h-3.5 w-3.5" />Parity / Override / Kill Switchは実状態を別途確認</span>
        {data?.checkedAt ? <span className="text-white/45">確認 {new Date(data.checkedAt).toLocaleString("ja-JP")}</span> : null}
      </div>
    </section>
  );
}
