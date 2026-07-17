import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export type LiveRunnerPhase =
    | "idle"
    | "planned"
    | "source_sell_submitted"
    | "source_sell_confirmed"
    | "target_buy_submitted"
    | "completed"
    | "failed"
    | "manual_review";

export interface LiveRunnerPendingTransaction {
    idempotencyKey: string;
    phase: LiveRunnerPhase;
    action: "OPEN_FULL" | "SPLIT_50" | "SWITCH_70";
    incomingSymbol: string;
    incomingStrategySymbol: string;
    incomingTier: "WIN80" | "ULTRA90";
    sourceSymbol?: string;
    sourceQuantity?: number;
    sourceSellFraction?: number;
    sourceClientOrderId?: string;
    sourceExecutedQuantity?: number;
    sourceAveragePrice?: number;
    sourceQuoteQuantity?: number;
    targetNotionalUsd: number;
    targetQuantity?: number;
    targetClientOrderId?: string;
    createdAt: number;
    updatedAt: number;
    retryCount: number;
    lastError?: string;
    reason: string;
}

export interface LiveRunnerFailureRecord {
    idempotencyKey?: string;
    phase?: LiveRunnerPhase;
    message: string;
    occurredAt: number;
}

export interface LiveRunnerState {
    version: 1;
    strategyId: string;
    mode: "paper" | "live";
    updatedAt: number;
    lastRunAt?: number;
    lastCompletedIdempotencyKey?: string;
    pending?: LiveRunnerPendingTransaction;
    failures: LiveRunnerFailureRecord[];
}

export interface LiveRunnerStateStore {
    load(): Promise<LiveRunnerState>;
    save(state: LiveRunnerState): Promise<void>;
}

export interface LiveRunnerLockHandle {
    ownerId: string;
    acquiredAt: number;
    release(): Promise<void>;
}

export interface LiveRunnerLock {
    acquire(ownerId: string): Promise<LiveRunnerLockHandle | null>;
}

function defaultState(strategyId: string, mode: "paper" | "live"): LiveRunnerState {
    return {
        version: 1,
        strategyId,
        mode,
        updatedAt: Date.now(),
        failures: [],
    };
}

function normalizeState(
    value: unknown,
    strategyId: string,
    mode: "paper" | "live",
): LiveRunnerState {
    if (!value || typeof value !== "object") return defaultState(strategyId, mode);
    const raw = value as Partial<LiveRunnerState>;
    const failures = Array.isArray(raw.failures)
        ? raw.failures.filter((item): item is LiveRunnerFailureRecord => Boolean(item && typeof item.message === "string")).slice(-50)
        : [];
    return {
        version: 1,
        strategyId,
        mode,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
        lastRunAt: Number.isFinite(Number(raw.lastRunAt)) ? Number(raw.lastRunAt) : undefined,
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending : undefined,
        failures,
    };
}

export class FileLiveRunnerStateStore implements LiveRunnerStateStore {
    private readonly path: string;

    constructor(
        path: string,
        private readonly strategyId: string,
        private readonly mode: "paper" | "live",
    ) {
        this.path = resolve(path);
    }

    async load(): Promise<LiveRunnerState> {
        try {
            const text = await readFile(this.path, "utf8");
            return normalizeState(JSON.parse(text) as unknown, this.strategyId, this.mode);
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code)
                : "";
            if (code === "ENOENT") return defaultState(this.strategyId, this.mode);
            throw error;
        }
    }

    async save(state: LiveRunnerState): Promise<void> {
        await mkdir(dirname(this.path), { recursive: true });
        const normalized: LiveRunnerState = {
            ...state,
            version: 1,
            strategyId: this.strategyId,
            mode: this.mode,
            updatedAt: Date.now(),
            failures: state.failures.slice(-50),
        };
        const tempPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(tempPath, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(tempPath, this.path);
    }
}

export class FileLiveRunnerLock implements LiveRunnerLock {
    private readonly path: string;

    constructor(path: string, private readonly staleAfterMs = 5 * 60_000) {
        this.path = resolve(path);
    }

    private async removeIfStale() {
        try {
            const text = await readFile(this.path, "utf8");
            const payload = JSON.parse(text) as { acquiredAt?: unknown };
            const acquiredAt = Number(payload.acquiredAt || 0);
            if (acquiredAt > 0 && Date.now() - acquiredAt <= this.staleAfterMs) return false;
            await unlink(this.path);
            return true;
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error
                ? String((error as { code?: unknown }).code)
                : "";
            if (code === "ENOENT") return true;
            try {
                await unlink(this.path);
                return true;
            } catch {
                return false;
            }
        }
    }

    async acquire(ownerId: string): Promise<LiveRunnerLockHandle | null> {
        await mkdir(dirname(this.path), { recursive: true });
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                const acquiredAt = Date.now();
                const handle = await open(this.path, "wx", 0o600);
                await handle.writeFile(`${JSON.stringify({ ownerId, acquiredAt, pid: process.pid })}\n`, "utf8");
                await handle.close();
                let released = false;
                return {
                    ownerId,
                    acquiredAt,
                    release: async () => {
                        if (released) return;
                        released = true;
                        try {
                            const current = JSON.parse(await readFile(this.path, "utf8")) as { ownerId?: unknown };
                            if (current.ownerId === ownerId) await unlink(this.path);
                        } catch {
                            // Lock already disappeared or is no longer owned by this runner.
                        }
                    },
                };
            } catch (error) {
                const code = error && typeof error === "object" && "code" in error
                    ? String((error as { code?: unknown }).code)
                    : "";
                if (code !== "EEXIST") throw error;
                if (attempt === 0 && await this.removeIfStale()) continue;
                return null;
            }
        }
        return null;
    }
}

export class MemoryLiveRunnerStateStore implements LiveRunnerStateStore {
    constructor(private state: LiveRunnerState) {}

    async load() {
        return structuredClone(this.state);
    }

    async save(state: LiveRunnerState) {
        this.state = structuredClone(state);
    }
}

export class MemoryLiveRunnerLock implements LiveRunnerLock {
    private owner?: string;

    async acquire(ownerId: string): Promise<LiveRunnerLockHandle | null> {
        if (this.owner) return null;
        this.owner = ownerId;
        const acquiredAt = Date.now();
        return {
            ownerId,
            acquiredAt,
            release: async () => {
                if (this.owner === ownerId) this.owner = undefined;
            },
        };
    }
}
