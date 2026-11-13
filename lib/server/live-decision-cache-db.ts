import fs from "fs/promises";
import path from "path";

import type { HybridLiveDecisionDetails } from "@/lib/backtest/hybrid-engine";
import type { CombinedDecisionPayload } from "@/lib/server/combined/types";
import type { IdleBigWaveSidecarEvaluation, IdleRunnerEvaluation } from "@/lib/server/live-hybrid-autotrade";

export type LegacyLiveDecisionCachePayload = {
  ok: true;
  details: HybridLiveDecisionDetails;
  walletDecision: {
    currentSymbol: string;
    desiredSymbol: string;
    desiredSide: "trend" | "range" | "cash";
    desiredAlloc: number;
    reason: string;
    marketJudgement?: unknown;
    rotation: {
      fromSymbol: string;
      toSymbol: string;
      scoreGap: number;
    } | null;
  } | null;
  sidecarEvaluations: IdleBigWaveSidecarEvaluation[];
  idleRunnerEvaluations?: IdleRunnerEvaluation[];
  cashRescueApplied: boolean;
  cachedAt: number;
};

export type LiveDecisionCachePayload = LegacyLiveDecisionCachePayload | CombinedDecisionPayload;

const CACHE_PATH = path.join(process.cwd(), "data", "live-decision-cache.json");
const STALE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function isValidPayload(payload: LiveDecisionCachePayload | null | undefined) {
  if (!payload?.ok || !Number(payload.cachedAt)) return false;
  return Date.now() - Number(payload.cachedAt) <= STALE_TTL_MS;
}

export async function readLiveDecisionCache() {
  try {
    const raw = await fs.readFile(CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw) as LiveDecisionCachePayload;
    if (isValidPayload(parsed)) {
      return parsed;
    }
  } catch {
    // no-op
  }
  return null;
}

export async function writeLiveDecisionCache(payload: LiveDecisionCachePayload) {
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(payload, null, 2), "utf8");
}
