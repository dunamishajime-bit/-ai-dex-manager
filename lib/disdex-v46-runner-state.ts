import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
    DisDexV35PendingOrder,
    DisDexV35RunnerFailure,
    DisDexV35RunnerMode,
    DisDexV35RunnerState,
    DisDexV35RunnerStateStore,
} from "@/lib/disdex-v35-runner-state";

export interface DisDexV46RunnerState {
    version: 1;
    strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46";
    mode: DisDexV35RunnerMode;
    updatedAt: number;
    lastRunAt?: number;
    lastSignalReferenceTs?: number;
    lastCompletedIdempotencyKey?: string;
    pending?: DisDexV35PendingOrder;
    failures: DisDexV35RunnerFailure[];
}

function defaultState(mode: DisDexV35RunnerMode): DisDexV46RunnerState {
    return {
        version: 1,
        strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46",
        mode,
        updatedAt: Date.now(),
        failures: [],
    };
}

function normalize(value: unknown, mode: DisDexV35RunnerMode): DisDexV46RunnerState {
    if (!value || typeof value !== "object") return defaultState(mode);
    const raw = value as Partial<DisDexV46RunnerState>;
    return {
        version: 1,
        strategyId: "DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46",
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

function toV35Compatible(state: DisDexV46RunnerState): DisDexV35RunnerState {
    return {
        ...state,
        strategyId: "DISDEX_RESILIENT_PROFIT_MAIN_V35",
    };
}

function fromV35Compatible(state: DisDexV35RunnerState): DisDexV46RunnerState {
    return {
        ...state,
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
            failures: state.failures.slice(-100),
        };
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
    }

    /**
     * The shared order/reconciliation machinery still consumes the V35 state
     * interface. This adapter changes only the compile-time strategy literal;
     * the file on disk is always normalized back to the V46 composite ID.
     */
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
