import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export interface V12X1AllRunnerState {
    schema: "v12-x1-all-runner-state/v1";
    strategyId: "V12_X1.00_ALL";
    mode: "SHADOW" | "PAPER" | "LIVE";
    updatedAt: number;
    lastReferenceTs?: number;
    active?: { symbol: string; side: "LONG" | "SHORT"; quantity: number; gross: number; positionId: string };
    pending?: { idempotencyKey: string; action: "ENTRY" | "EXIT" | "STOP_UPDATE"; clientOrderId: string; createdAt: number };
    manualReview?: string;
}

function initial(mode: V12X1AllRunnerState["mode"]): V12X1AllRunnerState { return { schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode, updatedAt: Date.now() }; }

export class FileV12X1AllRunnerStateStore {
    private readonly path: string;
    constructor(path: string, private readonly mode: V12X1AllRunnerState["mode"]) { this.path = resolve(path); }
    async load(): Promise<V12X1AllRunnerState> {
        try {
            const value = JSON.parse(await readFile(this.path, "utf8")) as Partial<V12X1AllRunnerState>;
            if (value.schema !== "v12-x1-all-runner-state/v1" || value.strategyId !== "V12_X1.00_ALL" || value.mode !== this.mode) throw new Error("V12_STATE_SCHEMA_MISMATCH");
            return { ...initial(this.mode), ...value, updatedAt: Number(value.updatedAt) || Date.now() } as V12X1AllRunnerState;
        } catch (error) { const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : ""; if (code === "ENOENT") return initial(this.mode); throw error; }
    }
    async save(state: V12X1AllRunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, `${JSON.stringify({ ...state, schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: this.mode, updatedAt: Date.now() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temp, this.path);
    }
}
