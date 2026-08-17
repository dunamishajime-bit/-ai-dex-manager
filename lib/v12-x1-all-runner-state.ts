import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { V12StopState } from "@/lib/v12-resident-stop-lifecycle";

export interface V12PendingOrderState {
    idempotencyKey: string;
    action: "ENTRY" | "EXIT" | "STOP_UPDATE" | "FAILSAFE_CLOSE";
    clientOrderId: string;
    symbol?: string;
    side?: "LONG" | "SHORT";
    quantity?: number;
    signalTs?: number;
    createdAt: number;
}

export interface V12ActivePositionState {
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    gross: number;
    positionId: string;
    entryPrice: number;
    atrAtEntry: number;
    entrySignalTs: number;
    holdingBars: number;
    peakPrice: number;
    troughPrice: number;
    protection: V12StopState;
}

export interface V12X1AllRunnerState {
    schema: "v12-x1-all-runner-state/v1";
    strategyId: "V12_X1.00_ALL";
    mode: "SHADOW" | "PAPER" | "LIVE";
    updatedAt: number;
    lastReferenceTs?: number;
    cooldownUntilTs?: number;
    active?: V12ActivePositionState;
    pending?: V12PendingOrderState;
    manualReview?: string;
    killSwitch?: { active: boolean; reason: string; trippedAt: number };
}

function initial(mode: V12X1AllRunnerState["mode"]): V12X1AllRunnerState {
    return { schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode, updatedAt: Date.now() };
}

function validate(value: Partial<V12X1AllRunnerState>, mode: V12X1AllRunnerState["mode"]) {
    if (value.schema !== "v12-x1-all-runner-state/v1" || value.strategyId !== "V12_X1.00_ALL" || value.mode !== mode) {
        throw new Error("V12_STATE_SCHEMA_MISMATCH");
    }
    if (value.active) {
        if (!(value.active.quantity > 0 && value.active.entryPrice > 0 && value.active.atrAtEntry > 0)) throw new Error("V12_STATE_ACTIVE_INVALID");
        if (!value.active.protection || value.active.protection.positionId !== value.active.positionId) throw new Error("V12_STATE_PROTECTION_INVALID");
    }
    if (value.pending && (!value.pending.clientOrderId || !value.pending.idempotencyKey)) throw new Error("V12_STATE_PENDING_INVALID");
    return value;
}

export class FileV12X1AllRunnerStateStore {
    private readonly path: string;
    constructor(path: string, private readonly mode: V12X1AllRunnerState["mode"]) { this.path = resolve(path); }

    async load(): Promise<V12X1AllRunnerState> {
        try {
            const value = validate(JSON.parse(await readFile(this.path, "utf8")) as Partial<V12X1AllRunnerState>, this.mode);
            return { ...initial(this.mode), ...value, updatedAt: Number(value.updatedAt) || Date.now() } as V12X1AllRunnerState;
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return initial(this.mode);
            throw error;
        }
    }

    async save(state: V12X1AllRunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, `${JSON.stringify({ ...state, schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode: this.mode, updatedAt: Date.now() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temp, this.path);
    }

    async tripKillSwitch(state: V12X1AllRunnerState, reason: string) {
        const next: V12X1AllRunnerState = {
            ...state,
            manualReview: reason,
            killSwitch: state.killSwitch?.active ? state.killSwitch : { active: true, reason, trippedAt: Date.now() },
        };
        await this.save(next);
        return next;
    }
}
