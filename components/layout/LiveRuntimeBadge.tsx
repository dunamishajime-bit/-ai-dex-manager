"use client";

import { usePathname } from "next/navigation";

import { useProductionRuntime } from "@/hooks/useProductionRuntime";
import { useV12V4HpStatus } from "@/hooks/useV12V4HpStatus";
import type { CurrentProductionRuntime } from "@/lib/server/current-production-runtime";

type RuntimeUnit = CurrentProductionRuntime["runtimeLineage"]["units"][keyof CurrentProductionRuntime["runtimeLineage"]["units"]];

function statusText(unit: RuntimeUnit | undefined, available: boolean) {
  if (!available || !unit) return "未取得";
  return unit.matchesCurrent ? "LIVE" : "要確認";
}

export function LiveRuntimeBadge() {
  const pathname = usePathname();
  const { snapshot, loading } = useProductionRuntime();
  const { snapshot: v4Snapshot, loading: v4Loading } = useV12V4HpStatus();
  const hideV12 = pathname === "/";
  const available = snapshot?.status === "LIVE" && snapshot.runtimeLineage.synchronized;
  const find = (id: keyof CurrentProductionRuntime["runtimeLineage"]["units"]) => snapshot?.runtimeLineage.units[id];
  const v4Entry = v4Snapshot?.actual.orderEnabled === true && v4Snapshot?.freshness.heartbeat === true && v4Snapshot?.freshness.decision === true && v4Snapshot?.displayStatus === "LIVE_VERIFIED";
  const statusItems = [
    hideV12 ? null : `V12 ${statusText(find("v12"), available)}`,
    `PENGU ${statusText(find("pengu"), available)}`,
    `FET ${statusText(find("fet"), available)}`,
    `Q102 ${statusText(find("quality102"), available)}`,
    `V52 ${statusText(find("v52"), available)}`,
  ].filter((item): item is string => item !== null);

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-white/75" aria-live="polite">
      LIVE状態: {loading && !snapshot ? "確認中" : statusItems.join(" / ")} / V4 process {v4Loading && !v4Snapshot ? "確認中" : v4Snapshot?.actual.activeRunnerState || "未取得"} / 新規entry {v4Entry ? "条件内" : "Fail Closed"}
    </span>
  );
}
