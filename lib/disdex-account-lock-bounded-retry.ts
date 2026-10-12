export type LockRetryResult = { status: string };

export async function runWithBoundedAccountLockRetry<T extends LockRetryResult>(input: {
    operation: () => Promise<T>;
    attempts: number;
    retryMs: number | ((attempt: number) => number);
    wait?: (milliseconds: number) => Promise<void>;
    shouldStop?: () => boolean;
}): Promise<T> {
    const attempts = Math.max(1, Math.min(10, Math.trunc(input.attempts)));
    const retryMsForAttempt = (attempt: number) => {
        const raw = typeof input.retryMs === "function" ? input.retryMs(attempt) : input.retryMs;
        return Math.max(250, Math.min(2_000, Math.trunc(raw)));
    };
    const wait = input.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

    let result = await input.operation();
    for (let attempt = 1; result.status === "locked" && attempt < attempts; attempt += 1) {
        if (input.shouldStop?.()) return result;
        await wait(retryMsForAttempt(attempt));
        if (input.shouldStop?.()) return result;
        result = await input.operation();
    }
    return result;
}
