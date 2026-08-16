import { Redis } from "@upstash/redis";

import type { DirectTradeCommand, DirectTradeExecutor, DirectTradeResult } from "@/lib/direct-trade-executor";

export type ExecutionLeaseAcquireResult = {
    acquired: boolean;
    token: string;
    key: string;
};

export interface ExecutionLeaseStore {
    tryAcquire(key: string, token: string, ttlMs: number): Promise<ExecutionLeaseAcquireResult>;
    release(key: string, token: string): Promise<boolean>;
}

export class UpstashExecutionLeaseStore implements ExecutionLeaseStore {
    constructor(
        private readonly redis: Redis,
        private readonly prefix = "disdex:entry-lease",
    ) {}

    static fromEnv(prefix?: string) {
        return new UpstashExecutionLeaseStore(Redis.fromEnv(), prefix);
    }

    private keyFor(key: string) {
        return `${this.prefix}:${key}`;
    }

    async tryAcquire(key: string, token: string, ttlMs: number): Promise<ExecutionLeaseAcquireResult> {
        if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Execution lease ttlMs must be positive.");
        const redisKey = this.keyFor(key);
        const result = await this.redis.set(redisKey, token, { nx: true, px: Math.ceil(ttlMs) });
        return { acquired: result === "OK", token, key: redisKey };
    }

    async release(key: string, token: string): Promise<boolean> {
        const redisKey = this.keyFor(key);
        const result = await this.redis.eval<number>(
            `if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end`,
            [redisKey],
            [token],
        );
        return Number(result) === 1;
    }
}

export type RedundantEntryDecision = {
    decisionId: string;
    decisionTs: number;
    freshUntilTs: number;
    ownerId: string;
    command: DirectTradeCommand;
};

export type RedundantEntryOutcome =
    | { status: "EXECUTED"; result: DirectTradeResult; decisionId: string; ownerId: string }
    | { status: "STANDBY_SKIPPED"; decisionId: string; ownerId: string; reason: "DECISION_LOCKED" }
    | { status: "STALE_REJECTED"; decisionId: string; ownerId: string; reason: "DECISION_EXPIRED" };

function stableDecisionKey(decisionId: string) {
    const normalized = decisionId.trim().replace(/[^.A-Z:/a-z0-9_-]/g, "-").slice(0, 96);
    if (!normalized) throw new Error("decisionId is empty after sanitization.");
    return normalized;
}

function stableLeaseToken(ownerId: string, decisionId: string) {
    const owner = ownerId.trim().replace(/[^.A-Z:/a-z0-9_-]/g, "-").slice(0, 48);
    if (!owner) throw new Error("ownerId is empty after sanitization.");
    return `${owner}:${stableDecisionKey(decisionId)}`;
}

export class RedundantEntryCoordinator {
    constructor(
        private readonly executor: DirectTradeExecutor,
        private readonly leases: ExecutionLeaseStore,
        private readonly now: () => number = Date.now,
    ) {}

    async executeFresh(decision: RedundantEntryDecision): Promise<RedundantEntryOutcome> {
        const now = this.now();
        if (!Number.isFinite(decision.decisionTs) || !Number.isFinite(decision.freshUntilTs)) {
            throw new Error("decisionTs/freshUntilTs must be finite timestamps.");
        }
        if (decision.freshUntilTs < decision.decisionTs) {
            throw new Error("freshUntilTs must be at or after decisionTs.");
        }
        if (now > decision.freshUntilTs) {
            return {
                status: "STALE_REJECTED",
                decisionId: decision.decisionId,
                ownerId: decision.ownerId,
                reason: "DECISION_EXPIRED",
            };
        }

        const key = stableDecisionKey(decision.decisionId);
        const token = stableLeaseToken(decision.ownerId, decision.decisionId);
        // Keep the decision key for its entire remaining freshness window. We deliberately do NOT
        // release it after execution: a second node arriving milliseconds later must never be able
        // to re-acquire the same still-fresh decision and submit a duplicate market order.
        const ttlMs = Math.max(1, Math.ceil(decision.freshUntilTs - now + 1));
        const lease = await this.leases.tryAcquire(key, token, ttlMs);
        if (!lease.acquired) {
            return {
                status: "STANDBY_SKIPPED",
                decisionId: decision.decisionId,
                ownerId: decision.ownerId,
                reason: "DECISION_LOCKED",
            };
        }

        // The clientOrderId must be identical across primary/standby for the same decision.
        // AsterDirectTradeExecutor already reconciles execution-unknown 503/timeouts instead of
        // blindly resubmitting. If this owner dies after acquiring the lock but before submission,
        // that trade is intentionally skipped: fail-closed duplicate prevention has priority over
        // forcing every signal to execute.
        const result = await this.executor.executeMarket(decision.command);
        return {
            status: "EXECUTED",
            result,
            decisionId: decision.decisionId,
            ownerId: decision.ownerId,
        };
    }
}
