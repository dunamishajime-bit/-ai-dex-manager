export interface BoundedLockRetryPolicy {
    retryMs: number;
    maxRetryWindowMs: number;
}

export interface BoundedLockRetryInput extends BoundedLockRetryPolicy {
    nowMs: number;
    lockedSinceMs: number;
}

/**
 * Return the next delay for a busy account lock, or null when the current
 * decision cycle has exhausted its retry window. This helper deliberately
 * does not inspect or delete lock files; expired leases remain fail-closed.
 */
export function boundedLockRetryDelay(input: BoundedLockRetryInput): number | null {
    const values = [input.nowMs, input.lockedSinceMs, input.retryMs, input.maxRetryWindowMs];
    if (values.some((value) => !Number.isFinite(value)) || input.retryMs <= 0 || input.maxRetryWindowMs <= 0) {
        throw new Error("LOCK_RETRY_POLICY_INVALID");
    }
    const elapsedMs = Math.max(0, input.nowMs - input.lockedSinceMs);
    const remainingMs = input.maxRetryWindowMs - elapsedMs;
    return remainingMs > 0 ? Math.min(input.retryMs, remainingMs) : null;
}
