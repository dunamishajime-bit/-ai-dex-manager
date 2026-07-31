"use client";

import { useCallback, useEffect, useState } from "react";
import type { DisterminalLiveStatus } from "@/lib/disterminal-account-types";

let cachedStatus: DisterminalLiveStatus | null = null;
let cachedAt = 0;
let pendingRequest: Promise<DisterminalLiveStatus> | null = null;

async function fetchStatus() {
  if (pendingRequest) return pendingRequest;
  if (cachedStatus && Date.now() - cachedAt < 30_000) return cachedStatus;
  pendingRequest = fetch("/api/disterminal/status", { cache: "no-store" })
    .then(async (response) => (await response.json()) as DisterminalLiveStatus)
    .catch((): DisterminalLiveStatus => ({
      ok: false,
      state: "UNKNOWN",
      source: "unavailable",
      checkedAt: new Date().toISOString(),
      lastRuntimeAt: null,
      reason: "LIVEサービス状態を取得できません。",
    }))
    .then((value) => {
      cachedStatus = value;
      cachedAt = Date.now();
      return value;
    })
    .finally(() => {
      pendingRequest = null;
    });
  return pendingRequest;
}

export function useDisterminalLiveStatus() {
  const [data, setData] = useState<DisterminalLiveStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setData(await fetchStatus());
    setLoading(false);
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { data, loading, refresh };
}
