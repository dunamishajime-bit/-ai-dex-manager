import { classifyAsterRateBudgetFailure, nextAsterRateBudgetRetryMs } from "./disdex-aster-rate-budget-policy";

export type SharedRiskRefreshFailureContext = {
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  observedAt: number;
  scheduledRetryMs: number;
};

export type SharedRiskRefreshLoopResult = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
};

/**
 * On shared venue-budget pressure, repeated immediate RISK_READ requests amplify
 * contention with protective STOP reconciliation. Delay and jitter the writer
 * retry, without changing the shared 7.5% loss latch or writing a false risk
 * snapshot. A stale risk snapshot continues to block every entry fail-closed.
 * Ordinary network/read failures keep their established retry cadence.
 */
export function nextSharedRiskRefreshRetryMs(
  error: unknown,
  consecutiveFailures: number,
  retryMs: number,
  random: () => number = Math.random,
): number {
  const budget = classifyAsterRateBudgetFailure(error);
  if (!budget) return retryMs;
  return nextAsterRateBudgetRetryMs(
    Math.min(6, Math.max(0, consecutiveFailures - 1)),
    retryMs,
    60_000,
    Math.max(0, budget.waitMs ?? 0),
    random,
  );
}

export async function runSharedRiskRefreshLoop<T>(input: {
  refresh: () => Promise<T>;
  daemon: boolean;
  intervalMs: number;
  retryMs: number;
  wait: (milliseconds: number) => Promise<void>;
  shouldStop: () => boolean;
  onSuccess: (state: T) => void | Promise<void>;
  onFailure: (error: unknown, context: SharedRiskRefreshFailureContext) => void | Promise<void>;
  now?: () => number;
}): Promise<SharedRiskRefreshLoopResult> {
  const now = input.now || Date.now;
  const intervalMs = Math.max(1, Math.floor(input.intervalMs));
  const retryMs = Math.max(1, Math.min(intervalMs, Math.floor(input.retryMs)));
  let successes = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let lastSuccessAt: number | null = null;

  while (!input.shouldStop()) {
    try {
      const state = await input.refresh();
      lastSuccessAt = now();
      successes += 1;
      consecutiveFailures = 0;
      await input.onSuccess(state);
    } catch (error) {
      failures += 1;
      consecutiveFailures += 1;
      const scheduledRetryMs = nextSharedRiskRefreshRetryMs(error, consecutiveFailures, retryMs);
      await input.onFailure(error, {
        consecutiveFailures,
        lastSuccessAt,
        observedAt: now(),
        scheduledRetryMs,
      });
      if (!input.daemon) throw error;
      if (input.shouldStop()) break;
      await input.wait(scheduledRetryMs);
      continue;
    }

    if (!input.daemon || input.shouldStop()) break;
    await input.wait(intervalMs);
  }

  return { successes, failures, consecutiveFailures, lastSuccessAt };
}
