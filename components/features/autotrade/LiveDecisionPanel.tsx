"use client";

import { Activity, AlertTriangle } from "lucide-react";
import { useDisterminalLiveStatus } from "@/hooks/useDisterminalLiveStatus";
import { DIST_TERMINAL_LIVE_CONFIG as config } from "@/lib/disterminal-live-config";

export function LiveDecisionPanel({ compact = false }: { compact?: boolean }) {
  const { data, loading } = useDisterminalLiveStatus();
  const active = data?.state === "ACTIVE";
  return (
    <section className="panel-gold rounded-[28px] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-bold text-white"><Activity className="h-4 w-4 text-gold-100" />V96 Crypto + V52 Stock 状態</div>
        <span className={"rounded-full border px-3 py-1 text-[10px] font-semibold " + (active ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" : "border-amber-400/25 bg-amber-500/10 text-amber-100")}>{loading ? "確認中" : active ? "LIVE稼働確認済み" : "LIVE状態未確認"}</span>
      </div>
      <div className={"mt-3 rounded-2xl border px-4 py-4 text-sm " + (active ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100" : "border-amber-400/25 bg-amber-500/10 text-amber-100")}>
        {active ? <Activity className="mr-2 inline h-4 w-4" /> : <AlertTriangle className="mr-2 inline h-4 w-4" />}
        {data?.reason ?? "LIVEサービスの状態を取得できません。"}
      </div>
      {!compact ? <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><div className="text-xs text-white/50">Executor</div><div className="mt-1 font-semibold">{config.executor}</div></div><div><div className="text-xs text-white/50">V96 Daily Loss</div><div className="mt-1 font-semibold">{config.v96DailyLossPct}%</div></div><div><div className="text-xs text-white/50">V52 Daily Loss</div><div className="mt-1 font-semibold">{config.v52DailyLossPct}%</div></div><div><div className="text-xs text-white/50">最終確認</div><div className="mt-1 font-semibold">{data?.checkedAt ? new Date(data.checkedAt).toLocaleString("ja-JP") : "未確認"}</div></div></div> : null}
    </section>
  );
}
