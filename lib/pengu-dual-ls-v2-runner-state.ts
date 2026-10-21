import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PenguDualLsV2Mode } from "@/config/penguDualLsV2Runtime";
import type { PenguDualLsV2Position, PenguDualLsV2Signal } from "@/lib/pengu-dual-ls-v2";

export interface PenguDualLsV2PendingOrder {
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

export interface PenguDualLsV2RunnerFailure {
    occurredAt: number;
    message: string;
    idempotencyKey?: string;
}

export interface PenguDualLsV2RunnerState {
    version: 1;
    strategyId: "PENGU_DUAL_LS_V2_FINAL";
    mode: PenguDualLsV2Mode;
    updatedAt: number;
    lastRunAt?: number;
    lastSignalReferenceTs?: number;
    /** Sanitized read-only decision telemetry for the monitoring UI. */
    latestSignal?: PenguDualLsV2Signal;
    lastCompletedIdempotencyKey?: string;
    cooldownUntilTs?: number;
    position?: PenguDualLsV2Position;
    pending?: PenguDualLsV2PendingOrder;
    failures: PenguDualLsV2RunnerFailure[];
}

function defaultState(mode: PenguDualLsV2Mode): PenguDualLsV2RunnerState {
    return {
        version: 1,
        strategyId: "PENGU_DUAL_LS_V2_FINAL",
        mode,
        updatedAt: Date.now(),
        failures: [],
    };
}

function normalize(value: unknown, mode: PenguDualLsV2Mode): PenguDualLsV2RunnerState {
    if (!value || typeof value !== "object") return defaultState(mode);
    const raw = value as Partial<PenguDualLsV2RunnerState>;
    const position = raw.position && typeof raw.position === "object" ? raw.position as PenguDualLsV2Position : undefined;
    return {
        version: 1,
        strategyId: "PENGU_DUAL_LS_V2_FINAL",
        mode,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
        lastRunAt: Number.isFinite(Number(raw.lastRunAt)) ? Number(raw.lastRunAt) : undefined,
        lastSignalReferenceTs: Number.isFinite(Number(raw.lastSignalReferenceTs)) ? Number(raw.lastSignalReferenceTs) : undefined,
        latestSignal: raw.latestSignal && typeof raw.latestSignal === "object" ? raw.latestSignal as PenguDualLsV2Signal : undefined,
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        cooldownUntilTs: Number.isFinite(Number(raw.cooldownUntilTs)) ? Number(raw.cooldownUntilTs) : undefined,
        position: position && (position.side === 1 || position.side === -1) ? position : undefined,
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending as PenguDualLsV2PendingOrder : undefined,
        failures: Array.isArray(raw.failures)
            ? raw.failures.filter((item): item is PenguDualLsV2RunnerFailure => Boolean(item && typeof item.message === "string")).slice(-100)
            : [],
    };
}

export interface PenguDualLsV2RunnerStateStore {
    load(): Promise<PenguDualLsV2RunnerState>;
    save(state: PenguDualLsV2RunnerState): Promise<void>;
}

export class FilePenguDualLsV2RunnerStateStore implements PenguDualLsV2RunnerStateStore {
    private readonly path: string;

    constructor(path: string, private readonly mode: PenguDualLsV2Mode) {
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

    async save(state: PenguDualLsV2RunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const value: PenguDualLsV2RunnerState = {
            ...state,
            version: 1,
            strategyId: "PENGU_DUAL_LS_V2_FINAL",
            mode: this.mode,
            updatedAt: Date.now(),
            failures: state.failures.slice(-100),
        };
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
    }
}

export class MemoryPenguDualLsV2RunnerStateStore implements PenguDualLsV2RunnerStateStore {
    constructor(private state: PenguDualLsV2RunnerState) {}
    async load() { return structuredClone(this.state); }
    async save(state: PenguDualLsV2RunnerState) { this.state = structuredClone(state); }
}

export function createPenguDualLsV2RunnerState(mode: PenguDualLsV2Mode): PenguDualLsV2RunnerState {
    return defaultState(mode);
}
