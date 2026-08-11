"use client";

import { useCallback, useEffect, useState } from "react";

export type LiveServiceState = "ACTIVE" | "STOPPED" | "UNKNOWN";

type DecisionStatusResponse = {
  ok?: boolean;
  checkedAt?: string;
  service?: {
    active?: boolean;
    state?: LiveServiceState;
    mainPid?: number | null;
  };
};

type LiveServiceStatus = {
  state: LiveServiceState;
  active: boolean;
  mainPid: number | null;
  checkedAt: string | null;
  loading: boolean;
  error: string | null;
};

const INITIAL_STATUS: LiveServiceStatus = {
  state: "UNKNOWN",
  active: false,
  mainPid: null,
  checkedAt: null,
  loading: true,
  error: null,
};

function validCheckedAt(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isFinite(Date.parse(value)) ? value : null;
}

export function normalizeLiveServiceStatus(
  responseOk: boolean,
  data: DecisionStatusResponse,
): Omit<LiveServiceStatus, "loading" | "error"> {
  const checkedAt = validCheckedAt(data.checkedAt);
  const service = data.service;
  const mainPid = typeof service?.mainPid === "number" && Number.isFinite(service.mainPid)
    ? service.mainPid
    : null;

  if (
    responseOk
    && data.ok === true
    && service?.state === "ACTIVE"
    && service.active === true
    && mainPid !== null
    && mainPid > 0
  ) {
    return { state: "ACTIVE", active: true, mainPid, checkedAt };
  }

  if (
    responseOk
    && data.ok === true
    && service?.state === "STOPPED"
    && service.active === false
    && (mainPid === null || mainPid === 0)
  ) {
    return { state: "STOPPED", active: false, mainPid, checkedAt };
  }

  return { state: "UNKNOWN", active: false, mainPid: null, checkedAt };
}

export function useLiveServiceStatus() {
  const [status, setStatus] = useState<LiveServiceStatus>(INITIAL_STATUS);

  const refresh = useCallback(async () => {
    setStatus((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch("/api/system/decision-status", { cache: "no-store" });
      const data = (await response.json()) as DecisionStatusResponse;
      const normalized = normalizeLiveServiceStatus(response.ok, data);
      setStatus({
        ...normalized,
        loading: false,
        error: normalized.state === "UNKNOWN" ? "LIVEサービス状態を確認できません。" : null,
      });
    } catch {
      setStatus({
        state: "UNKNOWN",
        active: false,
        mainPid: null,
        checkedAt: null,
        loading: false,
        error: "LIVEサービス状態を取得できません。",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  return { ...status, refresh };
}
