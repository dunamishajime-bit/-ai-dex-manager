"use client";

import { useEffect, useState } from "react";

type RuntimeUnit = {
  id: string;
  status: "LIVE" | "STALE" | "UNAVAILABLE" | "UNCONFIRMED";
  reason?: string;
};

function statusText(unit?: RuntimeUnit) {
  if (!unit) return "未取得";
  if (unit.id === "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96" && unit.status === "UNCONFIRMED") return "市場時間外";
  return unit.status === "LIVE" ? "LIVE" : unit.status === "STALE" ? "要確認" : "未取得";
}

export function LiveRuntimeBadge() {
  const [units, setUnits] = useState<RuntimeUnit[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/system/decision-status?refresh=1&runtime=${Date.now()}`, { cache: "no-store" });
        const data = await response.json() as { runtime?: { units?: RuntimeUnit[] } };
        if (!cancelled) setUnits(response.ok && Array.isArray(data.runtime?.units) ? data.runtime.units : null);
      } catch {
        if (!cancelled) setUnits(null);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  const find = (id: string) => units?.find((unit) => unit.id === id);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold text-white/75" aria-live="polite">
      LIVE状態: V12 {statusText(find("V12_X1.00_ALL"))} / PENGU {statusText(find("PENGU_DUAL_LS_V2_FINAL"))} / Q102 {statusText(find("QUALITY102_CAUSAL_V1"))} / V52 {statusText(find("DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96"))}
    </span>
  );
}
