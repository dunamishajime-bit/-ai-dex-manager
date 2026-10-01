export function nextAccountLockAwareWaitMs(
  status: string,
  normalWaitMs: number,
  lockRetryMs: number,
): number {
  if (!Number.isFinite(normalWaitMs) || normalWaitMs < 1_000) {
    throw new Error("DISDEX_ACCOUNT_LOCK_NORMAL_WAIT_INVALID");
  }
  if (!Number.isFinite(lockRetryMs)) {
    throw new Error("DISDEX_ACCOUNT_LOCK_RETRY_WAIT_INVALID");
  }
  const boundedRetryMs = Math.max(1_000, Math.min(30_000, Math.floor(lockRetryMs)));
  return status === "locked" ? boundedRetryMs : Math.floor(normalWaitMs);
}
