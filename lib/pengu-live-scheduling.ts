export const PENGU_HOUR_MS = 60 * 60_000;

export type PenguDaemonTickStatus = "locked" | string;

/**
 * A shared account lock can be busy for a short, legitimate interval while a
 * higher-priority strategy is planning or reconciling.  Retrying that bounded
 * collision keeps PENGU's state fresh without changing any order gate.
 */
export function nextPenguDaemonWaitMs(
  status: PenguDaemonTickStatus,
  nowMs: number,
  boundaryDelayMs: number,
  lockRetryMs: number,
) {
  if (status === "locked") return lockRetryMs;
  return PENGU_HOUR_MS - (nowMs % PENGU_HOUR_MS) + boundaryDelayMs;
}
