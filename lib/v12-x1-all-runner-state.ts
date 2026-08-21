import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { V12StopState } from "@/lib/v12-resident-stop-lifecycle";

export interface V12PendingOrderState {
    idempotencyKey: string;
    action: "ENTRY" | "EXIT" | "STOP_UPDATE" | "FAILSAFE_CLOSE";
    clientOrderId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    signalTs: number;
    expectedPrice?: number;
    requestedGross?: number;
    atrAtEntry?: number;
    reason?: string;
    createdAt: number;
    // STOP_UPDATE recovery metadata. Persisted before the replacement STOP is
    // sent so a hard crash can reuse/reconcile the exact deterministic leg.
    positionId?: string;
    stopPrice?: number;
    previousStopClientOrderId?: string;
    nextPeakOrTrough?: number;
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
    lastCompletedIdempotencyKey?: string;
    cooldownUntilTs?: number;
    /** Primary `active` is retained for backward compatibility; new entries
     * are persisted in ranked order here so up to two protected positions can
     * be reconciled after restart without changing the state file contract. */
    activePositions?: V12ActivePositionState[];
    active?: V12ActivePositionState;
    pending?: V12PendingOrderState;
    manualReview?: string;
    killSwitch?: { active: boolean; reason: string; trippedAt: number };
}

function initial(mode: V12X1AllRunnerState["mode"]): V12X1AllRunnerState {
    return { schema: "v12-x1-all-runner-state/v1", strategyId: "V12_X1.00_ALL", mode, updatedAt: Date.now() };
}

function validate(value: Partial<V12X1AllRunnerState>, mode: V12X1AllRunnerState["mode"]) {
    if (value.schema !== "v12-x1-all-runner-state/v1" || value.strategyId !== "V12_X1.00_ALL" || value.mode !== mode) throw new Error("V12_STATE_SCHEMA_MISMATCH");
    if (value.active) {
        if (!(value.active.quantity > 0 && value.active.entryPrice > 0 && value.active.atrAtEntry > 0)) throw new Error("V12_STATE_ACTIVE_INVALID");
        if (!value.active.protection || value.active.protection.positionId !== value.active.positionId) throw new Error("V12_STATE_PROTECTION_INVALID");
    }
    if (value.activePositions) {
        if (!Array.isArray(value.activePositions) || value.activePositions.length > 2) throw new Error("V12_STATE_ACTIVE_POSITIONS_INVALID");
        const symbols = new Set<string>();
        let aggregateGross = 0;
        for (const active of value.activePositions) {
            const symbol = String(active.symbol || "").toUpperCase();
            if (symbols.has(symbol)) throw new Error("V12_STATE_DUPLICATE_ACTIVE_SYMBOL");
            symbols.add(symbol);
            if (!(active.quantity > 0 && active.entryPrice > 0 && active.atrAtEntry > 0 && Number.isFinite(active.gross) && active.gross > 0 && active.gross <= 1)) throw new Error("V12_STATE_ACTIVE_POSITION_INVALID");
            if (!active.protection || active.protection.positionId !== active.positionId) throw new Error("V12_STATE_ACTIVE_POSITION_PROTECTION_INVALID");
            aggregateGross += active.gross;
        }
        if (aggregateGross > 1.5 + 1e-9) throw new Error("V12_STATE_AGGREGATE_GROSS_INVALID");
        if (value.active && value.activePositions[0]?.positionId !== value.active.positionId) throw new Error("V12_STATE_PRIMARY_ACTIVE_MISMATCH");
    }
    if (value.pending) {
        if (!value.pending.clientOrderId || !value.pending.idempotencyKey || !value.pending.symbol || !value.pending.side || !(value.pending.quantity > 0) || !Number.isFinite(value.pending.signalTs)) throw new Error("V12_STATE_PENDING_INVALID");
        if (value.pending.action === "STOP_UPDATE") {
            if (!value.pending.positionId || !(Number(value.pending.stopPrice) > 0) || !Number.isFinite(Number(value.pending.nextPeakOrTrough))) throw new Error("V12_STATE_STOP_UPDATE_PENDING_INVALID");
        }
    }
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
        const next: V12X1AllRunnerState = { ...state, manualReview: reason, killSwitch: state.killSwitch?.active ? state.killSwitch : { active: true, reason, trippedAt: Date.now() } };
        await this.save(next);
        return next;
    }
}
