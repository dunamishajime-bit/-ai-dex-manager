import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AsterOrderSide } from "@/lib/aster-v3-client";

export type DisDexV35RunnerMode = "paper" | "live";
export type DisDexV35PendingPhase = "planned" | "submitted" | "manual_review";

export interface DisDexV35PendingOrder {
    idempotencyKey: string;
    phase: DisDexV35PendingPhase;
    symbol: string;
    side: AsterOrderSide;
    quantity: number;
    reduceOnly: boolean;
    expectedPrice: number;
    clientOrderId: string;
    targetWeight: number;
    targetNotionalUsd: number;
    referenceTs: number;
    createdAt: number;
    updatedAt: number;
    retryCount: number;
    lastError?: string;
    reason: string;
}

export interface DisDexV35RunnerFailure {
    occurredAt: number;
    message: string;
    idempotencyKey?: string;
    symbol?: string;
}

export interface DisDexV35RunnerState {
    version: 1;
    strategyId: "DISDEX_RESILIENT_PROFIT_MAIN_V35";
    mode: DisDexV35RunnerMode;
    updatedAt: number;
    lastRunAt?: number;
    lastSignalReferenceTs?: number;
    lastCompletedIdempotencyKey?: string;
    pending?: DisDexV35PendingOrder;
    failures: DisDexV35RunnerFailure[];
}

function defaultState(mode: DisDexV35RunnerMode): DisDexV35RunnerState {
    return {
        version: 1,
        strategyId: "DISDEX_RESILIENT_PROFIT_MAIN_V35",
        mode,
        updatedAt: Date.now(),
        failures: [],
    };
}

function normalize(value: unknown, mode: DisDexV35RunnerMode): DisDexV35RunnerState {
    if (!value || typeof value !== "object") return defaultState(mode);
    const raw = value as Partial<DisDexV35RunnerState>;
    return {
        version: 1,
        strategyId: "DISDEX_RESILIENT_PROFIT_MAIN_V35",
        mode,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
        lastRunAt: Number.isFinite(Number(raw.lastRunAt)) ? Number(raw.lastRunAt) : undefined,
        lastSignalReferenceTs: Number.isFinite(Number(raw.lastSignalReferenceTs)) ? Number(raw.lastSignalReferenceTs) : undefined,
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending as DisDexV35PendingOrder : undefined,
        failures: Array.isArray(raw.failures)
            ? raw.failures.filter((item): item is DisDexV35RunnerFailure => Boolean(item && typeof item.message === "string")).slice(-100)
            : [],
    };
}

export interface DisDexV35RunnerStateStore {
    load(): Promise<DisDexV35RunnerState>;
    save(state: DisDexV35RunnerState): Promise<void>;
}

export class FileDisDexV35RunnerStateStore implements DisDexV35RunnerStateStore {
    private readonly path: string;

    constructor(path: string, private readonly mode: DisDexV35RunnerMode) {
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

    async save(state: DisDexV35RunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const value: DisDexV35RunnerState = {
            ...state,
            version: 1,
            strategyId: "DISDEX_RESILIENT_PROFIT_MAIN_V35",
            mode: this.mode,
            updatedAt: Date.now(),
            failures: state.failures.slice(-100),
        };
        const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temp, this.path);
    }
}

export class MemoryDisDexV35RunnerStateStore implements DisDexV35RunnerStateStore {
    constructor(private state: DisDexV35RunnerState) {}
    async load() { return structuredClone(this.state); }
    async save(state: DisDexV35RunnerState) { this.state = structuredClone(state); }
}

export function createDisDexV35RunnerState(mode: DisDexV35RunnerMode): DisDexV35RunnerState {
    return defaultState(mode);
}
