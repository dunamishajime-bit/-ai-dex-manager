import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PenguDualLsV2Mode } from "@/config/penguDualLsV2Runtime";
import type { PenguDualLsV2Position, PenguDualLsV2ShortV20State, PenguDualLsV2Signal } from "@/lib/pengu-dual-ls-v2";
import type { RecoveryV8DurableState } from "@/lib/pengu-recovery-v8";

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
    entryVersion?: "LONG_V2_FINAL" | "SHORT_V20" | "RECOVERY_V8";
    shortV20Seed?: {
        requestedGross: number;
        entryAtr24Ratio: number;
        btcEma168Distance: number;
        btcReturn24h: number;
    };
    recoveryV8Seed?: {
        originalGross: number;
        remainingGross: number;
    };
}

export interface PenguDualLsV2RunnerFailure {
    occurredAt: number;
    message: string;
    idempotencyKey?: string;
}

export interface PenguDualLsV2RunnerState {
    version: 2;
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
        version: 2,
        strategyId: "PENGU_DUAL_LS_V2_FINAL",
        mode,
        updatedAt: Date.now(),
        failures: [],
    };
}

function validShortV20State(value: unknown): value is PenguDualLsV2ShortV20State {
    if (!value || typeof value !== "object") return false;
    const state = value as Partial<PenguDualLsV2ShortV20State>;
    return state.version === "SHORT_V20"
        && state.preRegistrationSha === "ad7cedb3cafaf9f9680e390112f72375d84b50ac"
        && (state.sizingState === "CAP" || state.sizingState === "FLOOR" || state.sizingState === "VOL_TARGET")
        && (state.phase === "TRACKING" || state.phase === "PROBATION" || state.phase === "RESUMED")
        && typeof state.armed === "boolean"
        && typeof state.progressed === "boolean"
        && typeof state.counterwind === "boolean"
        && Number.isFinite(state.requestedGross)
        && Number.isFinite(state.entryAtr24Ratio)
        && Number.isFinite(state.lowWater)
        && (state.failureConfirmedTs === undefined || Number.isFinite(state.failureConfirmedTs))
        && (state.thesisResumedTs === undefined || Number.isFinite(state.thesisResumedTs));
}

function validRecoveryV8State(value: unknown, position: PenguDualLsV2Position): value is RecoveryV8DurableState {
    if (!value || typeof value !== "object") return false;
    const state = value as Partial<RecoveryV8DurableState>;
    const actualFill = state.actualPartialFill;
    const partialDefenseTriggered = state.partialDefenseTriggered === true;
    const originalQuantity = Number(state.originalQuantity);
    const originalGross = Number(state.originalGross);
    const remainingGross = Number(state.remainingGross);
    const quantity = Number(state.quantity);
    return state.version === "RECOVERY_V8"
        && state.entryTs === position.entryTs
        && state.side === 1
        && Number.isFinite(quantity) && quantity > 0
        && Math.abs(quantity - position.quantity) <= Math.max(1e-8, position.quantity * 0.01)
        && Number.isFinite(state.entryPrice) && state.entryPrice === position.entryPrice
        && Number.isFinite(originalQuantity) && originalQuantity > 0
        && Number.isFinite(originalGross) && Math.abs(originalGross - 0.5) <= 1e-12
        && Number.isFinite(remainingGross)
        && (Math.abs(remainingGross - 0.5) <= 1e-12 || Math.abs(remainingGross - 0.25) <= 1e-12)
        && typeof state.partialDefenseTriggered === "boolean"
        && (partialDefenseTriggered ? Math.abs(remainingGross - 0.25) <= 1e-12 : Math.abs(remainingGross - 0.5) <= 1e-12)
        && (state.protectionLifecycle === "FULL_HARD_STOP" || state.protectionLifecycle === "SPLIT_PROTECTION" || state.protectionLifecycle === "MANUAL_REVIEW")
        && (state.protectionLifecycle === "MANUAL_REVIEW"
            || state.protectionLifecycle === "FULL_HARD_STOP" && typeof state.fullHardStopClientOrderId === "string" && state.fullHardStopClientOrderId.length > 0
            || state.protectionLifecycle === "SPLIT_PROTECTION" && typeof state.partialStopClientOrderId === "string" && state.partialStopClientOrderId.length > 0 && typeof state.remainingHardStopClientOrderId === "string" && state.remainingHardStopClientOrderId.length > 0)
        && Number.isFinite(state.highWaterMark)
        && (!partialDefenseTriggered || Boolean(actualFill && Number.isFinite(actualFill.filledAtTs) && Number.isFinite(actualFill.executedQuantity) && actualFill.executedQuantity > 0 && Number.isFinite(actualFill.averagePrice) && Number.isFinite(actualFill.triggerPrice) && Number.isFinite(actualFill.slippageBps)));
}

function normalize(value: unknown, mode: PenguDualLsV2Mode): PenguDualLsV2RunnerState {
    if (!value || typeof value !== "object") return defaultState(mode);
    const raw = value as Partial<PenguDualLsV2RunnerState>;
    const rawPosition = raw.position && typeof raw.position === "object" ? raw.position as PenguDualLsV2Position : undefined;
    if (rawPosition?.entryVersion === "SHORT_V20" && !validShortV20State(rawPosition.shortV20)) {
        throw new Error("PENGU Short V20 state is missing or invalid; fail closed for manual reconciliation.");
    }
    if (rawPosition?.entryVersion === "RECOVERY_V8" && !validRecoveryV8State(rawPosition.recoveryV8, rawPosition)) {
        throw new Error("PENGU Recovery V8 state is missing or invalid; fail closed for manual reconciliation.");
    }
    const position = rawPosition
        ? {
            ...rawPosition,
            // State written before Short V20 is explicitly legacy and never
            // receives the new Short state machine after restart.
            entryVersion: rawPosition.entryVersion || "LEGACY_V2",
        } satisfies PenguDualLsV2Position
        : undefined;
    return {
        version: 2,
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
            version: 2,
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
