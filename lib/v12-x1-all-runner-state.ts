import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { V12StopState } from "@/lib/v12-resident-stop-lifecycle";
import { V12_X1_ALL } from "@/config/v12X1AllRuntime";

export type V12RunnerStateSchema = "v12-x1-all-runner-state/v1" | "v12-x1-all-runner-state/v2";

export interface V12PendingOrderState {
    idempotencyKey: string;
    action: "ENTRY" | "EXIT" | "STOP_UPDATE" | "FAILSAFE_CLOSE" | "DYNAMIC_TRIM";
    clientOrderId: string;
    symbol: string;
    side: "LONG" | "SHORT";
    quantity: number;
    signalTs: number;
    expectedPrice?: number;
    requestedGross?: number;
    baseRequestedGross?: number;
    dynamicRequestedGross?: number;
    atrAtEntry?: number;
    reason?: string;
    createdAt: number;
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
    /** Durable quantity/gross owned by the normal 1.50x Base contract. */
    baseQuantity: number;
    baseGross: number;
    /** Lower-priority residual allocation which may be trimmed for Core demand. */
    dynamicQuantity: number;
    dynamicGross: number;
    dynamicUpdatedAt?: number;
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
    schema: V12RunnerStateSchema;
    strategyId: "V12_X1.00_ALL";
    mode: "SHADOW" | "PAPER" | "LIVE";
    updatedAt: number;
    lastReferenceTs?: number;
    /** Latest completed bar whose entry opportunity was deferred only because shared risk was temporarily unavailable. */
    deferredEntryReferenceTs?: number;
    lastCompletedIdempotencyKey?: string;
    cooldownUntilTs?: number;
    activePositions?: V12ActivePositionState[];
    active?: V12ActivePositionState;
    pending?: V12PendingOrderState;
    manualReview?: string;
    killSwitch?: { active: boolean; reason: string; trippedAt: number };
}

function initial(mode: V12X1AllRunnerState["mode"]): V12X1AllRunnerState {
    return { schema: "v12-x1-all-runner-state/v2", strategyId: "V12_X1.00_ALL", mode, updatedAt: Date.now() };
}

function finiteNonNegative(value: unknown, fallback: number) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : fallback;
}

function normalizeActive(raw: Partial<V12ActivePositionState>): V12ActivePositionState {
    const quantity = Number(raw.quantity);
    const gross = Number(raw.gross);
    const baseQuantity = finiteNonNegative(raw.baseQuantity, quantity);
    const dynamicQuantity = finiteNonNegative(raw.dynamicQuantity, 0);
    const baseGross = finiteNonNegative(raw.baseGross, gross);
    const dynamicGross = finiteNonNegative(raw.dynamicGross, 0);
    const toleranceQty = Math.max(1e-8, Math.abs(quantity) * 1e-6);
    if (Math.abs(baseQuantity + dynamicQuantity - quantity) > toleranceQty) throw new Error("V12_STATE_BASE_DYNAMIC_QUANTITY_MISMATCH");
    if (Math.abs(baseGross + dynamicGross - gross) > 1e-6) throw new Error("V12_STATE_BASE_DYNAMIC_GROSS_MISMATCH");
    return {
        ...(raw as V12ActivePositionState),
        quantity,
        gross,
        baseQuantity,
        dynamicQuantity,
        baseGross,
        dynamicGross,
    };
}

export class FileV12X1AllRunnerStateStore {
    private readonly path: string;
    constructor(path: string, private readonly mode: V12X1AllRunnerState["mode"]) { this.path = resolve(path); }

    async load(): Promise<V12X1AllRunnerState> {
        try {
            const value = JSON.parse(await readFile(this.path, "utf8")) as Partial<V12X1AllRunnerState>;
            if (!["v12-x1-all-runner-state/v1", "v12-x1-all-runner-state/v2"].includes(String(value.schema))
                || value.strategyId !== "V12_X1.00_ALL" || value.mode !== this.mode) {
                throw new Error("V12_STATE_SCHEMA_MISMATCH");
            }
            if (value.deferredEntryReferenceTs !== undefined && !Number.isFinite(Number(value.deferredEntryReferenceTs))) throw new Error("V12_STATE_DEFERRED_ENTRY_REFERENCE_INVALID");
            const legacyActive = value.active ? normalizeActive(value.active) : undefined;
            if (legacyActive) {
                if (!(legacyActive.quantity > 0 && legacyActive.entryPrice > 0 && legacyActive.atrAtEntry > 0)) throw new Error("V12_STATE_ACTIVE_INVALID");
                if (!legacyActive.protection || legacyActive.protection.positionId !== legacyActive.positionId) throw new Error("V12_STATE_PROTECTION_INVALID");
            }
            const activePositions = value.activePositions === undefined
                ? (legacyActive ? [legacyActive] : [])
                : value.activePositions.map((row) => normalizeActive(row));
            if (!Array.isArray(activePositions) || activePositions.length > V12_X1_ALL.maximumPositions) throw new Error("V12_STATE_ACTIVE_POSITIONS_INVALID");
            const symbols = new Set<string>();
            let aggregateBaseGross = 0;
            let aggregateGross = 0;
            for (const active of activePositions) {
                const symbol = String(active.symbol || "").toUpperCase();
                if (symbols.has(symbol)) throw new Error("V12_STATE_DUPLICATE_ACTIVE_SYMBOL");
                symbols.add(symbol);
                if (!(active.quantity > 0 && active.entryPrice > 0 && active.atrAtEntry > 0
                    && active.gross > 0 && active.gross <= V12_X1_ALL.perPositionEntryGrossCap + 1e-9
                    && active.baseGross >= 0 && active.dynamicGross >= 0
                    && active.baseQuantity >= 0 && active.dynamicQuantity >= 0)) {
                    throw new Error("V12_STATE_ACTIVE_POSITION_INVALID");
                }
                if (!active.protection || active.protection.positionId !== active.positionId
                    || Math.abs(active.protection.quantity - active.quantity) > Math.max(1e-8, active.quantity * 0.001)) {
                    throw new Error("V12_STATE_ACTIVE_POSITION_PROTECTION_INVALID");
                }
                aggregateBaseGross += active.baseGross;
                aggregateGross += active.gross;
            }
            if (aggregateBaseGross > V12_X1_ALL.aggregateEntryGrossCap + 1e-9) throw new Error("V12_STATE_BASE_AGGREGATE_GROSS_INVALID");
            if (aggregateGross > V12_X1_ALL.dynamicResidualAggregateGrossCap + 1e-9) throw new Error("V12_STATE_AGGREGATE_GROSS_INVALID");
            const primary = activePositions[0];
            if (value.active && primary?.positionId !== value.active.positionId) throw new Error("V12_STATE_PRIMARY_ACTIVE_MISMATCH");
            if (value.pending) {
                if (!value.pending.clientOrderId || !value.pending.idempotencyKey || !value.pending.symbol || !value.pending.side || !(value.pending.quantity > 0) || !Number.isFinite(value.pending.signalTs)) throw new Error("V12_STATE_PENDING_INVALID");
                if (value.pending.action === "STOP_UPDATE" && (!value.pending.positionId || !(Number(value.pending.stopPrice) > 0) || !Number.isFinite(Number(value.pending.nextPeakOrTrough)))) throw new Error("V12_STATE_STOP_UPDATE_PENDING_INVALID");
                if (value.pending.action === "DYNAMIC_TRIM" && (!value.pending.positionId || !(Number(value.pending.dynamicRequestedGross) > 0))) throw new Error("V12_STATE_DYNAMIC_TRIM_PENDING_INVALID");
            }
            return {
                ...initial(this.mode),
                ...value,
                schema: "v12-x1-all-runner-state/v2",
                active: primary,
                activePositions: activePositions.length ? activePositions : undefined,
                updatedAt: Number(value.updatedAt) || Date.now(),
            } as V12X1AllRunnerState;
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return initial(this.mode);
            throw error;
        }
    }

    async save(state: V12X1AllRunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const temp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temp, `${JSON.stringify({ ...state, schema: "v12-x1-all-runner-state/v2", strategyId: "V12_X1.00_ALL", mode: this.mode, updatedAt: Date.now() }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
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
