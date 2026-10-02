export type LockRetryResult = { status: string };

export async function runWithBoundedAccountLockRetry<T extends LockRetryResult>(input: {
    operation: () => Promise<T>;
    attempts: number;
    retryMs: number;
    wait?: (milliseconds: number) => Promise<void>;
    shouldStop?: () => boolean;
}): Promise<T> {
    const attempts = Math.max(1, Math.min(10, Math.trunc(input.attempts)));
    const retryMs = Math.max(250, Math.min(2_000, Math.trunc(input.retryMs)));
    const wait = input.wait || ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

    let result = await input.operation();
    for (let attempt = 1; result.status === "locked" && attempt < attempts; attempt += 1) {
        if (input.shouldStop?.()) return result;
        await wait(retryMs);
        if (input.shouldStop?.()) return result;
        result = await input.operation();
    }
    return result;
}
