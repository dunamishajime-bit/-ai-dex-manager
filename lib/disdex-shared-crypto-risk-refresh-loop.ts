export type SharedRiskRefreshFailureContext = {
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  observedAt: number;
};

export type SharedRiskRefreshLoopResult = {
  successes: number;
  failures: number;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
};

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
      await input.onFailure(error, {
        consecutiveFailures,
        lastSuccessAt,
        observedAt: now(),
      });
      if (!input.daemon) throw error;
      if (input.shouldStop()) break;
      await input.wait(retryMs);
      continue;
    }

    if (!input.daemon || input.shouldStop()) break;
    await input.wait(intervalMs);
  }

  return { successes, failures, consecutiveFailures, lastSuccessAt };
}
