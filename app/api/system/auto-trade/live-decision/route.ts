import { NextResponse } from "next/server";

import { loadAutoTradeHistory } from "@/lib/server/auto-trade-history-db";
import { loadAutoTradeRuntimeControl } from "@/lib/server/auto-trade-runtime-control";
import type { CombinedDecisionPayload } from "@/lib/server/combined/types";
import { readLiveDecisionCache, type LiveDecisionCachePayload } from "@/lib/server/live-decision-cache-db";
import { refreshActiveLiveDecisionCache } from "@/lib/server/auto-trade-runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MEMORY_CACHE_TTL_MS = 30 * 1000;
const LEGACY_STALE_AFTER_MS = 13 * 60 * 60 * 1000;
const COMBINED_STALE_AFTER_MS = 20 * 60 * 1000;

const liveDecisionCache = globalThis as typeof globalThis & {
  __disLiveDecisionCache?: LiveDecisionCachePayload;
};

type LatestCombinedRun = {
  executedAt: string;
  decisionTime: string;
  desiredSymbol: string;
  desiredSide: "trend" | "range" | "cash";
  reason: string;
  currentSymbol?: string;
  tradedCount: number;
  noopCount: number;
  skippedCount: number;
  errorCount: number;
  triggerLabel?: string;
} | null;

function isCombinedPayload(payload: LiveDecisionCachePayload): payload is CombinedDecisionPayload {
  return "strategyType" in payload && payload.strategyType === "combined";
}

function isStaleDecision(payload: LiveDecisionCachePayload, now: number) {
  const cacheAge = now - Number(payload.cachedAt || 0);
  if (isCombinedPayload(payload)) {
    const signalTs = Date.parse(payload.signal.signalTs || payload.checkedAt || "");
    const signalAge = Number.isFinite(signalTs) ? now - signalTs : cacheAge;
    return cacheAge > COMBINED_STALE_AFTER_MS || signalAge > COMBINED_STALE_AFTER_MS;
  }

  const decisionTs = Date.parse(payload.details?.decision?.isoTime || "");
  const decisionAge = Number.isFinite(decisionTs) ? now - decisionTs : cacheAge;
  return cacheAge > LEGACY_STALE_AFTER_MS || decisionAge > LEGACY_STALE_AFTER_MS;
}

async function readDiskCache() {
  const parsed = await readLiveDecisionCache();
  if (parsed) {
    liveDecisionCache.__disLiveDecisionCache = parsed;
    return parsed;
  }
  return null;
}

async function loadLatestCombinedRun(): Promise<LatestCombinedRun> {
  try {
    const entries = await loadAutoTradeHistory();
    const entry = entries.find((item) => item.strategyId === "combined") || null;
    if (!entry) return null;
    const firstWallet = entry.walletResults[0] || null;
    return {
      triggerLabel: entry.triggerLabel,
      executedAt: entry.executedAt,
      decisionTime: entry.decisionTime,
      desiredSymbol: entry.desiredSymbol,
      desiredSide: entry.desiredSide,
      reason: firstWallet?.reason || entry.reason,
      currentSymbol: firstWallet?.currentSymbol,
      tradedCount: entry.tradedCount,
      noopCount: entry.noopCount,
      skippedCount: entry.skippedCount,
      errorCount: entry.errorCount,
    };
  } catch (error) {
    console.warn("[live-decision] Failed to load latest combined run:", error);
    return null;
  }
}

export async function GET() {
  try {
    const now = Date.now();
    const runtimeControl = loadAutoTradeRuntimeControl();
    const latestCombinedRun = await loadLatestCombinedRun();
    const memoryCache = liveDecisionCache.__disLiveDecisionCache;

    if (memoryCache && now - memoryCache.cachedAt <= MEMORY_CACHE_TTL_MS) {
      return NextResponse.json({
        ...memoryCache,
        stale: isStaleDecision(memoryCache, now),
        runtimeControl,
        latestCombinedRun,
      });
    }

    const diskCache = await readDiskCache();
    if (diskCache) {
      const stale = isStaleDecision(diskCache, now);
      if (!stale) {
        return NextResponse.json({
          ...diskCache,
          stale: false,
          runtimeControl,
          latestCombinedRun,
        });
      }
    }

    try {
      const refreshed = await refreshActiveLiveDecisionCache();
      liveDecisionCache.__disLiveDecisionCache = refreshed;
      return NextResponse.json({
        ...refreshed,
        stale: false,
        runtimeControl,
        latestCombinedRun,
      });
    } catch (refreshError) {
      console.warn("[live-decision] Failed to refresh cache:", refreshError);
      if (diskCache) {
        return NextResponse.json({
          ...diskCache,
          stale: true,
          runtimeControl,
          latestCombinedRun,
          refreshError: refreshError instanceof Error ? refreshError.message : "Failed to refresh live decision cache.",
        });
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: "Live decision cache is not ready yet.",
      },
      { status: 503 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to load live decision.",
      },
      { status: 500 },
    );
  }
}
