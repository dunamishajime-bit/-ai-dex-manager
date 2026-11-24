import { classifyAsterRateBudgetFailure } from "./disdex-aster-rate-budget-policy";

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
  message?: string,
  monitorPollMs = 0,
) {
  if (status === "locked") return lockRetryMs;
  if (status === "failed" && classifyAsterRateBudgetFailure(message)?.kind === "RATE_BUDGET_DEFERRED") return lockRetryMs;
  // Monitor-only verification may request a short observation cadence so the
  // cutover can prove fresh heartbeats without waiting for the live strategy's
  // hourly boundary. The caller passes this only for SHADOW mode; LIVE keeps
  // the production hour-boundary schedule unchanged.
  if (monitorPollMs > 0) return Math.max(1_000, Math.min(30_000, Math.trunc(monitorPollMs)));
  return PENGU_HOUR_MS - (nowMs % PENGU_HOUR_MS) + boundaryDelayMs;
}
