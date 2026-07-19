import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
    DisDexV35PendingOrder,
    DisDexV35RunnerFailure,
    DisDexV35RunnerMode,
    DisDexV35RunnerState,
    DisDexV35RunnerStateStore,
} from "./disdex-v35-runner-state";
import type { DisDexV46AccountSnapshot, DisDexV46PositionSnapshot } from "./disdex-v46-live-safety";
import type { DisDexV46ExecutionRecord } from "./disdex-v46-settlement-analysis";

export type DisDexV46RecoveryStatus = "required" | "in_progress" | "complete" | "manual_review";

export interface DisDexV46RecoveryState {
    status: DisDexV46RecoveryStatus;
    startedAt?: number;
    completedAt?: number;
    reason?: string;
}

export interface DisDexV46RunnerState {
    version: 1;
    strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46";
    mode: DisDexV35RunnerMode;
    updatedAt: number;
    lastRunAt?: number;
    lastSignalReferenceTs?: number;
    lastCompletedIdempotencyKey?: string;
    pending?: DisDexV35PendingOrder;
    completedExecutions?: DisDexV46ExecutionRecord[];
    failures: DisDexV35RunnerFailure[];
    bootstrapRequired: boolean;
    bootstrapCompletedAt?: number;
    recovery: DisDexV46RecoveryState;
    positionsSnapshot: DisDexV46PositionSnapshot[];
    accountSnapshot?: DisDexV46AccountSnapshot;
    lastOpenOrderClientOrderIds: string[];
}

function defaultState(mode: DisDexV35RunnerMode): DisDexV46RunnerState {
    return {
        version: 1,
        strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46",
        mode,
        updatedAt: Date.now(),
        completedExecutions: [],
        failures: [],
        bootstrapRequired: true,
        recovery: { status: "required", startedAt: Date.now(), reason: "Initial LIVE bootstrap is required." },
        positionsSnapshot: [],
        lastOpenOrderClientOrderIds: [],
    };
}

function normalize(value: unknown, mode: DisDexV35RunnerMode): DisDexV46RunnerState {
    if (!value || typeof value !== "object") return defaultState(mode);
    const raw = value as Partial<DisDexV46RunnerState>;
    const recovery = raw.recovery && typeof raw.recovery === "object"
        ? raw.recovery as DisDexV46RecoveryState
        : { status: "required" as const, reason: "Recovery metadata is missing; manual review is required." };
    return {
        version: 1,
        strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46",
        mode,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : Date.now(),
        lastRunAt: Number.isFinite(Number(raw.lastRunAt)) ? Number(raw.lastRunAt) : undefined,
        lastSignalReferenceTs: Number.isFinite(Number(raw.lastSignalReferenceTs)) ? Number(raw.lastSignalReferenceTs) : undefined,
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending as DisDexV35PendingOrder : undefined,
        completedExecutions: Array.isArray(raw.completedExecutions)
            ? raw.completedExecutions.filter((item): item is DisDexV46ExecutionRecord => Boolean(item && typeof item.idempotencyKey === "string" && typeof item.symbol === "string" && item.reduceOnly === true)).slice(-500)
            : [],
        failures: Array.isArray(raw.failures)
            ? raw.failures.filter((item): item is DisDexV35RunnerFailure => Boolean(item && typeof item.message === "string")).slice(-100)
            : [],
        bootstrapRequired: typeof raw.bootstrapRequired === "boolean" ? raw.bootstrapRequired : false,
        bootstrapCompletedAt: Number.isFinite(Number(raw.bootstrapCompletedAt)) ? Number(raw.bootstrapCompletedAt) : undefined,
        recovery,
        positionsSnapshot: Array.isArray(raw.positionsSnapshot) ? raw.positionsSnapshot as DisDexV46PositionSnapshot[] : [],
        accountSnapshot: raw.accountSnapshot && typeof raw.accountSnapshot === "object" ? raw.accountSnapshot as DisDexV46AccountSnapshot : undefined,
        lastOpenOrderClientOrderIds: Array.isArray(raw.lastOpenOrderClientOrderIds)
            ? raw.lastOpenOrderClientOrderIds.filter((item): item is string => typeof item === "string")
            : [],
    };
}

function toV35Compatible(state: DisDexV46RunnerState): DisDexV35RunnerState {
    return { ...state, strategyId: "DISDEX_RESILIENT_PROFIT_MAIN_V35" };
}

function fromV35Compatible(state: DisDexV35RunnerState): DisDexV46RunnerState {
    return {
        ...(state as unknown as DisDexV46RunnerState),
        strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46",
    };
}

export interface DisDexV46RunnerStateStore {
    load(): Promise<DisDexV46RunnerState>;
    save(state: DisDexV46RunnerState): Promise<void>;
}

export class FileDisDexV46RunnerStateStore implements DisDexV46RunnerStateStore {
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

    async save(state: DisDexV46RunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const value: DisDexV46RunnerState = {
            ...state,
            version: 1,
            strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46",
            mode: this.mode,
            updatedAt: Date.now(),
            completedExecutions: (state.completedExecutions || []).slice(-500),
            failures: state.failures.slice(-100),
            lastOpenOrderClientOrderIds: state.lastOpenOrderClientOrderIds || [],
        };
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
    }

    asV35CompatibleStore(): DisDexV35RunnerStateStore {
        return {
            load: async () => toV35Compatible(await this.load()),
            save: async (state) => this.save(fromV35Compatible(state)),
        };
    }
}

export class MemoryDisDexV46RunnerStateStore implements DisDexV46RunnerStateStore {
    constructor(private state: DisDexV46RunnerState) {}
    async load() { return structuredClone(this.state); }
    async save(state: DisDexV46RunnerState) { this.state = structuredClone(state); }

    asV35CompatibleStore(): DisDexV35RunnerStateStore {
        return {
            load: async () => toV35Compatible(await this.load()),
            save: async (state) => this.save(fromV35Compatible(state)),
        };
    }
}

export function createDisDexV46RunnerState(mode: DisDexV35RunnerMode): DisDexV46RunnerState {
    return defaultState(mode);
}
