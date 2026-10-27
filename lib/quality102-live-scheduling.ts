import { classifyAsterRateBudgetFailure } from "./disdex-aster-rate-budget-policy";

export const QUALITY102_HOUR_MS = 60 * 60_000;

export type Quality102DaemonTickStatus = "locked" | string;

export function isRetryableQuality102NoOrderBlock(message: string) {
  return message === "Q102_PENDING_QUOTE_STALE_OR_INVALID_RETRYABLE_NO_ORDER"
    || message === "Q102 entry quote is stale or invalid."
    || message === "Q102 quote precedes signal reference.";
}

/**
 * A short shared-account lock collision or transient shared Aster rate-budget
 * collision must not make Q102 discard the whole hourly decision. Retry the
 * same decision on the bounded lock-retry cadence without changing any
 * signal/order gate. All other completed/blocked states keep the hourly cadence.
 */
export function nextQuality102DaemonWaitMs(
  status: Quality102DaemonTickStatus,
  nowMs: number,
  boundaryDelayMs: number,
  lockRetryMs: number,
  message = "",
) {
  // Repeated market-data/account reads at an Aster budget boundary can
  // otherwise starve other runners. Honour the shared budget's wait and use a
  // bounded quiet period while retaining the same hourly signal reference.
  const rateBudget = status === "blocked-local" ? classifyAsterRateBudgetFailure(message) : undefined;
  if (rateBudget) return Math.min(120_000, Math.max(45_000, lockRetryMs, (rateBudget.waitMs ?? 0) + 1_000));
  if (status === "locked" || (status === "blocked-local" && isRetryableQuality102NoOrderBlock(message))) return lockRetryMs;
  return QUALITY102_HOUR_MS - (nowMs % QUALITY102_HOUR_MS) + boundaryDelayMs;
}
