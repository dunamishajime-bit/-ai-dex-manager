"use client";

import { useCallback, useEffect, useState } from "react";

type V12LiveStatusResponse = {
  ok?: boolean;
  mode?: string;
  enabled?: boolean;
  liveTradingEnabled?: boolean;
  liveExecutionEnabled?: boolean;
  state?: {
    killSwitch?: { active?: boolean } | null;
    manualReview?: string | null;
  };
  risk?: {
    ok?: boolean;
    sourceComplete?: boolean;
    tripped?: boolean | null;
  };
};

export type V12LiveStatus = "running" | "blocked" | "unknown";

export function useV12LiveStatus() {
  const [status, setStatus] = useState<V12LiveStatus>("unknown");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/system/v12-status", { cache: "no-store" });
      const payload = (await response.json()) as V12LiveStatusResponse;
      if (!response.ok || payload.ok !== true) {
        setStatus("unknown");
        return;
      }

      const liveEnabled =
        payload.mode === "LIVE" &&
        payload.enabled === true &&
        payload.liveTradingEnabled === true &&
        payload.liveExecutionEnabled === true;
      const safetyBlocked =
        payload.risk?.ok !== true ||
        payload.risk?.sourceComplete !== true ||
        payload.risk?.tripped === true ||
        payload.state?.killSwitch?.active === true ||
        Boolean(payload.state?.manualReview);

      setStatus(liveEnabled && !safetyBlocked ? "running" : "blocked");
    } catch {
      setStatus("unknown");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { status, loading, refresh };
}
