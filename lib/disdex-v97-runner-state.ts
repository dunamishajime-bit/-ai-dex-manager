import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DisDexV97Mode } from "@/config/disdexV97Runtime";
import type { DisDexV97Position, DisDexV97Symbol } from "@/lib/disdex-v97-signal-engine";

export interface DisDexV97PendingOrder {
    idempotencyKey: string;
    clientOrderId: string;
    phase: "planned" | "submitted" | "manual_review";
    symbol: DisDexV97Symbol;
    side: "BUY" | "SELL";
    quantity: number;
    reduceOnly: boolean;
    expectedPrice: number;
    targetGross: number;
    referenceTs: number;
    entryTs?: number;
    reason: string;
    createdAt: number;
    updatedAt: number;
    retryCount: number;
    lastError?: string;
}

export interface DisDexV97RunnerFailure {
    occurredAt: number;
    message: string;
    idempotencyKey?: string;
}

export interface DisDexV97RunnerState {
    version: 1;
    strategyId: "V97_ADAPTIVE_EVENT_CORE_V1";
    mode: DisDexV97Mode;
    updatedAt: number;
    lastRunAt?: number;
    lastSignalReferenceTs?: number;
    lastCompletedIdempotencyKey?: string;
    position?: DisDexV97Position;
    pending?: DisDexV97PendingOrder;
    failures: DisDexV97RunnerFailure[];
}

function defaultState(mode: DisDexV97Mode): DisDexV97RunnerState {
    return {
        version: 1,
        strategyId: "V97_ADAPTIVE_EVENT_CORE_V1",
        mode,
        updatedAt: Date.now(),
        failures: [],
    };
}

function normalize(value: unknown, mode: DisDexV97Mode): DisDexV97RunnerState {
    if (!value || typeof value !== "object") return defaultState(mode);
    const raw = value as Partial<DisDexV97RunnerState>;
    const position = raw.position && typeof raw.position === "object" ? raw.position as DisDexV97Position : undefined;
    return {
        version: 1,
        strategyId: "V97_ADAPTIVE_EVENT_CORE_V1",
        mode,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
        lastRunAt: Number.isFinite(Number(raw.lastRunAt)) ? Number(raw.lastRunAt) : undefined,
        lastSignalReferenceTs: Number.isFinite(Number(raw.lastSignalReferenceTs)) ? Number(raw.lastSignalReferenceTs) : undefined,
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        position: position && position.side === -1 ? position : undefined,
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending as DisDexV97PendingOrder : undefined,
        failures: Array.isArray(raw.failures)
            ? raw.failures.filter((item): item is DisDexV97RunnerFailure => Boolean(item && typeof item.message === "string")).slice(-100)
            : [],
    };
}

export interface DisDexV97RunnerStateStore {
    load(): Promise<DisDexV97RunnerState>;
    save(state: DisDexV97RunnerState): Promise<void>;
}

export class FileDisDexV97RunnerStateStore implements DisDexV97RunnerStateStore {
    private readonly path: string;
    constructor(path: string, private readonly mode: DisDexV97Mode) { this.path = resolve(path); }
    async load() {
        try { return normalize(JSON.parse(await readFile(this.path, "utf8")) as unknown, this.mode); }
        catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return defaultState(this.mode);
            throw error;
        }
    }
    async save(state: DisDexV97RunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const value: DisDexV97RunnerState = { ...state, version: 1, strategyId: "V97_ADAPTIVE_EVENT_CORE_V1", mode: this.mode, updatedAt: Date.now(), failures: state.failures.slice(-100) };
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
    }
}

export class MemoryDisDexV97RunnerStateStore implements DisDexV97RunnerStateStore {
    constructor(private state: DisDexV97RunnerState) {}
    async load() { return structuredClone(this.state); }
    async save(state: DisDexV97RunnerState) { this.state = structuredClone(state); }
}

export function createDisDexV97RunnerState(mode: DisDexV97Mode) { return defaultState(mode); }
