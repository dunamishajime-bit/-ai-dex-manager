export const QUALITY102_HOUR_MS = 60 * 60_000;

export type Quality102DaemonTickStatus = "locked" | string;

/**
 * A short shared-account lock collision must not make Q102 discard the whole
 * hourly decision. Retry the collision without changing any signal/order gate.
 */
export function nextQuality102DaemonWaitMs(
  status: Quality102DaemonTickStatus,
  nowMs: number,
  boundaryDelayMs: number,
  lockRetryMs: number,
) {
  if (status === "locked") return lockRetryMs;
  return QUALITY102_HOUR_MS - (nowMs % QUALITY102_HOUR_MS) + boundaryDelayMs;
}