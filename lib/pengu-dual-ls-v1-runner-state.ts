import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PenguDualLsV1Mode } from "@/config/penguDualLsV1Runtime";
import type { PenguDualLsV1Position, PenguDualLsV1Signal } from "@/lib/pengu-dual-ls-v1";

export interface PenguDualLsV1PendingOrder {
    idempotencyKey: string;
    clientOrderId: string;
    phase: "planned" | "submitted" | "manual_review";
    side: "BUY" | "SELL";
    quantity: number;
    reduceOnly: boolean;
    expectedPrice: number;
    reason: string;
    referenceTs: number;
    targetGross: number;
    createdAt: number;
    updatedAt: number;
    retryCount: number;
    lastError?: string;
}

export interface PenguDualLsV1RunnerFailure {
    occurredAt: number;
    message: string;
    idempotencyKey?: string;
}

export interface PenguDualLsV1RunnerState {
    version: 1;
    strategyId: "PENGU_DUAL_LS_V1";
    mode: PenguDualLsV1Mode;
    updatedAt: number;
    lastRunAt?: number;
    lastSignalReferenceTs?: number;
    /** Sanitized read-only decision telemetry for the monitoring UI. */
    latestSignal?: PenguDualLsV1Signal;
    lastCompletedIdempotencyKey?: string;
    position?: PenguDualLsV1Position;
    pending?: PenguDualLsV1PendingOrder;
    failures: PenguDualLsV1RunnerFailure[];
}

function defaultState(mode: PenguDualLsV1Mode): PenguDualLsV1RunnerState {
    return {
        version: 1,
        strategyId: "PENGU_DUAL_LS_V1",
        mode,
        updatedAt: Date.now(),
        failures: [],
    };
}

function normalize(value: unknown, mode: PenguDualLsV1Mode): PenguDualLsV1RunnerState {
    if (!value || typeof value !== "object") return defaultState(mode);
    const raw = value as Partial<PenguDualLsV1RunnerState>;
    const position = raw.position && typeof raw.position === "object" ? raw.position as PenguDualLsV1Position : undefined;
    return {
        version: 1,
        strategyId: "PENGU_DUAL_LS_V1",
        mode,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
        lastRunAt: Number.isFinite(Number(raw.lastRunAt)) ? Number(raw.lastRunAt) : undefined,
        lastSignalReferenceTs: Number.isFinite(Number(raw.lastSignalReferenceTs)) ? Number(raw.lastSignalReferenceTs) : undefined,
        latestSignal: raw.latestSignal && typeof raw.latestSignal === "object" ? raw.latestSignal as PenguDualLsV1Signal : undefined,
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        position: position && (position.side === 1 || position.side === -1) ? position : undefined,
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending as PenguDualLsV1PendingOrder : undefined,
        failures: Array.isArray(raw.failures)
            ? raw.failures.filter((item): item is PenguDualLsV1RunnerFailure => Boolean(item && typeof item.message === "string")).slice(-100)
            : [],
    };
}

export interface PenguDualLsV1RunnerStateStore {
    load(): Promise<PenguDualLsV1RunnerState>;
    save(state: PenguDualLsV1RunnerState): Promise<void>;
}

export class FilePenguDualLsV1RunnerStateStore implements PenguDualLsV1RunnerStateStore {
    private readonly path: string;

    constructor(path: string, private readonly mode: PenguDualLsV1Mode) {
        this.path = resolve(path);
    }

    async load() {
        try {
            return normalize(JSON.parse(await readFile(this.path, "utf8")) as unknown, this.mode);
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return defaultState(this.mode);
            throw error;
        }
    }

    async save(state: PenguDualLsV1RunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const value: PenguDualLsV1RunnerState = {
            ...state,
            version: 1,
            strategyId: "PENGU_DUAL_LS_V1",
            mode: this.mode,
            updatedAt: Date.now(),
            failures: state.failures.slice(-100),
        };
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
    }
}

export class MemoryPenguDualLsV1RunnerStateStore implements PenguDualLsV1RunnerStateStore {
    constructor(private state: PenguDualLsV1RunnerState) {}
    async load() { return structuredClone(this.state); }
    async save(state: PenguDualLsV1RunnerState) { this.state = structuredClone(state); }
}

export function createPenguDualLsV1RunnerState(mode: PenguDualLsV1Mode): PenguDualLsV1RunnerState {
    return defaultState(mode);
}
