"use client";

import { useCallback, useEffect, useState } from "react";
import type { DisterminalAccountSnapshot } from "@/lib/disterminal-account-types";

export function useDisterminalAccount() {
  const [data, setData] = useState<DisterminalAccountSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/disterminal/account", { cache: "no-store" });
      const value = (await response.json()) as DisterminalAccountSnapshot;
      setData(value);
      setError(!response.ok || !value.ok);
    } catch {
      setData(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  return { data, loading, error, refresh };
}
