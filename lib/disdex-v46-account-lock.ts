import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { FileLiveRunnerLock, type LiveRunnerLock, type LiveRunnerLockHandle } from "./live-runner-state";

export class CompositeLiveRunnerLock implements LiveRunnerLock {
    constructor(private readonly locks: LiveRunnerLock[]) {}

    async acquire(ownerId: string): Promise<LiveRunnerLockHandle | null> {
        const acquired: LiveRunnerLockHandle[] = [];
        for (const lock of this.locks) {
            const handle = await lock.acquire(ownerId);
            if (!handle) {
                for (const held of acquired.reverse()) await held.release();
                return null;
            }
            acquired.push(handle);
        }
        return {
            ownerId,
            acquiredAt: Date.now(),
            release: async () => {
                for (const held of acquired.reverse()) await held.release();
            },
        };
    }
}

export function buildDisDexV46AccountLock(
    userAddress: string,
    lockDirectory = process.env.DISDEX_V46_ACCOUNT_LOCK_DIR || process.env.HOME || ".",
    staleAfterMs = 30 * 60_000,
) {
    const digest = createHash("sha256").update(userAddress.trim().toLowerCase()).digest("hex").slice(0, 24);
    const path = resolve(lockDirectory, `.disdex-v46-account-${digest}.lock`);
    return new FileLiveRunnerLock(path, staleAfterMs);
}
