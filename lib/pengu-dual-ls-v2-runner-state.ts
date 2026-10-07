import { validateStopLedger } from "./resident-stop-ledger";
import { validateResidentStopProtection } from "./venue-resident-stop";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PenguDualLsV2Mode } from "@/config/penguDualLsV2Runtime";
import type { PenguDualLsV2ExitDecision, PenguDualLsV2Position, PenguDualLsV2ShortV20State, PenguDualLsV2Signal } from "@/lib/pengu-dual-ls-v2";
import type { RecoveryV8DurableState } from "@/lib/pengu-recovery-v8";
import {
    createPenguRiskOverlayState,
    normalizePenguRiskOverlayState,
    type PenguRiskOverlayState,
} from "@/lib/pengu-route-quarantine-dd-governor";

export interface PenguDualLsV2PendingOrder {
    idempotencyKey: string;
    clientOrderId: string;
    phase: "planned" | "submitted" | "manual_review";
    side: "BUY" | "SELL";
    quantity: number;
    reduceOnly: boolean;
    expectedPrice: number;
    reason: string;
    exitReason?: PenguDualLsV2ExitDecision["reason"];
    referenceTs: number;
    targetGross: number;
    requestedGross?: number;
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

export interface PenguM05ShadowObservation {
    strategyId: "PENGU_DUAL_LS_V2_FINAL";
    route: "SHORT_V20";
    referenceTs: number;
    entryTs?: number;
    penguReturn72h: number;
    threshold: number;
    pass: boolean;
    wouldBlock: boolean;
    productionSignalSide: -1 | 0 | 1;
    productionReason?: string;
    sourceRuntimeSha?: string;
    observedAt: number;
    /** Shadow-only lifecycle evidence. Never consulted by Production decisions. */
    productionTickStatus?: string;
    productionTickMessage?: string;
    productionOutcome?: "CANDIDATE" | "BLOCKED" | "ENTRY_FILLED" | "EXITED" | "MANUAL_REVIEW" | "FAILED";
    downstreamBlockReason?: string;
    entryIdempotencyKey?: string;
    entryFillObservedAt?: number;
    entryFillPrice?: number;
    entryFillQuantity?: number;
    entryTargetGross?: number;
    exitIdempotencyKey?: string;
    exitFillObservedAt?: number;
    exitFillPrice?: number;
    exitReason?: string;
    realizedDirectionalReturn?: number;
    /** Same net account-return metric used by the Production Q60/DD overlay. */
    realizedNetAccountReturn?: number;
    outcomeUpdatedAt?: number;
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
    /** Shadow-only M05 candidate observations. Never consulted by Production order logic. */
    m05ShadowHistory?: PenguM05ShadowObservation[];
    lastCompletedIdempotencyKey?: string;
    cooldownUntilTs?: number;
    /** Durable Q60 route quarantine + realized DD17/H72 overlay state. */
    riskOverlay: PenguRiskOverlayState;
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
        riskOverlay: createPenguRiskOverlayState(),
        m05ShadowHistory: [],
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
        && (state.logicalEntryPrice === undefined || Number.isFinite(state.logicalEntryPrice) && state.logicalEntryPrice > 0)
        && (state.recoveryExecutionPrice === undefined || Number.isFinite(state.recoveryExecutionPrice) && state.recoveryExecutionPrice > 0)
        && Number.isFinite(originalQuantity) && originalQuantity > 0
        && Number.isFinite(originalGross) && (Math.abs(originalGross - 0.5) <= 1e-12 || Math.abs(originalGross - 1.0) <= 1e-12)
        && Number.isFinite(remainingGross)
        && typeof state.partialDefenseTriggered === "boolean"
        && Math.abs(remainingGross - originalGross * (partialDefenseTriggered ? 0.5 : 1)) <= 1e-12
        && (state.protectionLifecycle === "FULL_HARD_STOP" || state.protectionLifecycle === "SPLIT_PROTECTION" || state.protectionLifecycle === "MANUAL_REVIEW")
        && (state.protectionLifecycle === "MANUAL_REVIEW"
            || state.protectionLifecycle === "FULL_HARD_STOP" && typeof state.fullHardStopClientOrderId === "string" && state.fullHardStopClientOrderId.length > 0
            || state.protectionLifecycle === "SPLIT_PROTECTION" && typeof state.partialStopClientOrderId === "string" && state.partialStopClientOrderId.length > 0 && typeof state.remainingHardStopClientOrderId === "string" && state.remainingHardStopClientOrderId.length > 0)
        && Number.isFinite(state.highWaterMark)
        && (!partialDefenseTriggered || Boolean(actualFill && Number.isFinite(actualFill.filledAtTs) && Number.isFinite(actualFill.executedQuantity) && actualFill.executedQuantity > 0 && Number.isFinite(actualFill.averagePrice) && Number.isFinite(actualFill.triggerPrice) && Number.isFinite(actualFill.slippageBps)));
}

function normalizeM05ShadowHistory(value: unknown): PenguM05ShadowObservation[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item): PenguM05ShadowObservation[] => {
        if (!item || typeof item !== "object") return [];
        const row = item as Partial<PenguM05ShadowObservation>;
        const referenceTs = Number(row.referenceTs);
        const penguReturn72h = Number(row.penguReturn72h);
        const threshold = Number(row.threshold);
        const observedAt = Number(row.observedAt);
        const side = Number(row.productionSignalSide);
        if (!Number.isFinite(referenceTs) || referenceTs <= 0
            || !Number.isFinite(penguReturn72h) || !Number.isFinite(threshold)
            || !Number.isFinite(observedAt)
            || (side !== -1 && side !== 0 && side !== 1)
            || typeof row.pass !== "boolean" || typeof row.wouldBlock !== "boolean") return [];
        return [{
            strategyId: "PENGU_DUAL_LS_V2_FINAL",
            route: "SHORT_V20",
            referenceTs,
            entryTs: Number.isFinite(Number(row.entryTs)) ? Number(row.entryTs) : undefined,
            penguReturn72h,
            threshold,
            pass: row.pass,
            wouldBlock: row.wouldBlock,
            productionSignalSide: side as -1 | 0 | 1,
            productionReason: typeof row.productionReason === "string" ? row.productionReason : undefined,
            sourceRuntimeSha: typeof row.sourceRuntimeSha === "string" ? row.sourceRuntimeSha : undefined,
            observedAt,
            productionTickStatus: typeof row.productionTickStatus === "string" ? row.productionTickStatus : undefined,
            productionTickMessage: typeof row.productionTickMessage === "string" ? row.productionTickMessage : undefined,
            productionOutcome: row.productionOutcome === "CANDIDATE" || row.productionOutcome === "BLOCKED" || row.productionOutcome === "ENTRY_FILLED" || row.productionOutcome === "EXITED" || row.productionOutcome === "MANUAL_REVIEW" || row.productionOutcome === "FAILED" ? row.productionOutcome : undefined,
            downstreamBlockReason: typeof row.downstreamBlockReason === "string" ? row.downstreamBlockReason : undefined,
            entryIdempotencyKey: typeof row.entryIdempotencyKey === "string" ? row.entryIdempotencyKey : undefined,
            entryFillObservedAt: Number.isFinite(Number(row.entryFillObservedAt)) ? Number(row.entryFillObservedAt) : undefined,
            entryFillPrice: Number.isFinite(Number(row.entryFillPrice)) ? Number(row.entryFillPrice) : undefined,
            entryFillQuantity: Number.isFinite(Number(row.entryFillQuantity)) ? Number(row.entryFillQuantity) : undefined,
            entryTargetGross: Number.isFinite(Number(row.entryTargetGross)) ? Number(row.entryTargetGross) : undefined,
            exitIdempotencyKey: typeof row.exitIdempotencyKey === "string" ? row.exitIdempotencyKey : undefined,
            exitFillObservedAt: Number.isFinite(Number(row.exitFillObservedAt)) ? Number(row.exitFillObservedAt) : undefined,
            exitFillPrice: Number.isFinite(Number(row.exitFillPrice)) ? Number(row.exitFillPrice) : undefined,
            exitReason: typeof row.exitReason === "string" ? row.exitReason : undefined,
            realizedDirectionalReturn: Number.isFinite(Number(row.realizedDirectionalReturn)) ? Number(row.realizedDirectionalReturn) : undefined,
            realizedNetAccountReturn: Number.isFinite(Number(row.realizedNetAccountReturn)) ? Number(row.realizedNetAccountReturn) : undefined,
            outcomeUpdatedAt: Number.isFinite(Number(row.outcomeUpdatedAt)) ? Number(row.outcomeUpdatedAt) : undefined,
        }];
    }).slice(-100);
}

function appendM05ShadowObservation(state: PenguDualLsV2RunnerState): PenguM05ShadowObservation[] {
    const history = normalizeM05ShadowHistory(state.m05ShadowHistory);
    const signal = state.latestSignal;
    const diagnostics = signal?.diagnostics;
    if (!signal || diagnostics?.m05ShadowCandidateObserved !== true) return history;
    const referenceTs = Number(signal.referenceTs);
    const penguReturn72h = Number(diagnostics.m05ShadowPenguReturn72h);
    const threshold = Number(diagnostics.m05ShadowThreshold);
    if (!Number.isFinite(referenceTs) || referenceTs <= 0 || !Number.isFinite(penguReturn72h) || !Number.isFinite(threshold)) return history;
    if (history.some((item) => item.referenceTs === referenceTs && item.route === "SHORT_V20")) return history;
    const sourceRuntimeSha = String(process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_RUNTIME_SHA || "").trim() || undefined;
    const observation: PenguM05ShadowObservation = {
        strategyId: "PENGU_DUAL_LS_V2_FINAL",
        route: "SHORT_V20",
        referenceTs,
        entryTs: Number.isFinite(Number(signal.entryTs)) ? Number(signal.entryTs) : undefined,
        penguReturn72h,
        threshold,
        pass: diagnostics.m05ShadowPass === true,
        wouldBlock: diagnostics.m05ShadowWouldBlock === true,
        productionSignalSide: signal.side,
        productionReason: signal.reason,
        sourceRuntimeSha,
        observedAt: Date.now(),
    };
    return [...history, observation].slice(-100);
}

export function recordPenguM05ShadowTickOutcome(
    state: PenguDualLsV2RunnerState,
    result: { status: string; message: string; signal?: PenguDualLsV2Signal; idempotencyKey?: string },
    observedAt = Date.now(),
) {
    // Never fall back to state.latestSignal here. A result without an explicit
    // signal can belong to lock/pending/reconciliation work for a later tick,
    // and attaching it to the previous M05 candidate would corrupt the ledger.
    const signal = result.signal;
    if (!signal || signal.diagnostics?.m05ShadowCandidateObserved !== true) return false;
    const history = appendM05ShadowObservation({ ...state, latestSignal: signal });
    const index = history.findIndex((item) => item.route === "SHORT_V20" && item.referenceTs === signal.referenceTs);
    if (index < 0) return false;
    const current = history[index]!;
    let productionOutcome = current.productionOutcome ?? "CANDIDATE";
    const terminal = productionOutcome === "ENTRY_FILLED" || productionOutcome === "EXITED";
    const matchingFilledPosition = result.status === "completed"
        && state.position?.entryVersion === "SHORT_V20"
        && Number.isFinite(Number(signal.entryTs))
        && state.position.entryTs === Number(signal.entryTs);
    const patch: Partial<PenguM05ShadowObservation> = {};

    if (matchingFilledPosition && !terminal) {
        productionOutcome = "ENTRY_FILLED";
        patch.productionTickStatus = result.status;
        patch.productionTickMessage = result.message;
        patch.entryIdempotencyKey = result.idempotencyKey;
        patch.entryFillObservedAt = observedAt;
        patch.entryFillPrice = state.position?.entryPrice;
        patch.entryFillQuantity = state.position?.quantity;
        patch.entryTargetGross = state.position?.gross;
        patch.downstreamBlockReason = undefined;
    } else if (!terminal && productionOutcome !== "BLOCKED" && (result.status === "held" || result.status === "no-change" || result.status === "locked")) {
        productionOutcome = "BLOCKED";
        patch.productionTickStatus = result.status;
        patch.productionTickMessage = result.message;
        patch.downstreamBlockReason = result.message;
    } else if (!terminal && productionOutcome !== "MANUAL_REVIEW" && result.status === "manual-review") {
        productionOutcome = "MANUAL_REVIEW";
        patch.productionTickStatus = result.status;
        patch.productionTickMessage = result.message;
        patch.downstreamBlockReason = result.message;
    } else if (!terminal && productionOutcome !== "FAILED" && result.status === "failed") {
        productionOutcome = "FAILED";
        patch.productionTickStatus = result.status;
        patch.productionTickMessage = result.message;
        patch.downstreamBlockReason = result.message;
    } else if (!terminal && !current.productionTickStatus) {
        patch.productionTickStatus = result.status;
        patch.productionTickMessage = result.message;
    }

    if (Object.keys(patch).length === 0) {
        // If appendM05ShadowObservation created the row on this call, persist it once.
        const existed = normalizeM05ShadowHistory(state.m05ShadowHistory).some((item) => item.route === "SHORT_V20" && item.referenceTs === signal.referenceTs);
        if (existed) return false;
    }
    patch.productionOutcome = productionOutcome;
    patch.outcomeUpdatedAt = observedAt;
    history[index] = { ...current, ...patch };
    state.m05ShadowHistory = history.slice(-100);
    return true;
}

export function recordPenguM05ShadowEntryFillOutcome(
    state: PenguDualLsV2RunnerState,
    input: {
        referenceTs: number;
        entryTs: number;
        entryIdempotencyKey?: string;
        entryFillObservedAt: number;
        entryFillPrice: number;
        entryFillQuantity: number;
        entryTargetGross: number;
    },
) {
    const history = normalizeM05ShadowHistory(state.m05ShadowHistory);
    const index = history.findIndex((item) => item.route === "SHORT_V20" && item.referenceTs === input.referenceTs);
    if (index < 0) return false;
    const current = history[index]!;
    history[index] = {
        ...current,
        entryTs: input.entryTs,
        productionOutcome: "ENTRY_FILLED",
        productionTickStatus: "completed",
        productionTickMessage: "PENGU Dual LS SHORT_V20 entry filled.",
        downstreamBlockReason: undefined,
        entryIdempotencyKey: input.entryIdempotencyKey,
        entryFillObservedAt: input.entryFillObservedAt,
        entryFillPrice: input.entryFillPrice,
        entryFillQuantity: input.entryFillQuantity,
        entryTargetGross: input.entryTargetGross,
        outcomeUpdatedAt: input.entryFillObservedAt,
    };
    state.m05ShadowHistory = history.slice(-100);
    return true;
}

export function recordPenguM05ShadowExitOutcome(
    state: PenguDualLsV2RunnerState,
    input: {
        entryTs: number;
        exitIdempotencyKey?: string;
        exitFillObservedAt: number;
        exitFillPrice: number;
        exitReason?: string;
        realizedDirectionalReturn: number;
        realizedNetAccountReturn: number;
    },
) {
    const history = normalizeM05ShadowHistory(state.m05ShadowHistory);
    const index = history.findLastIndex((item) => item.route === "SHORT_V20" && item.entryTs === input.entryTs);
    if (index < 0) return false;
    const current = history[index]!;
    history[index] = {
        ...current,
        productionOutcome: "EXITED",
        exitIdempotencyKey: input.exitIdempotencyKey,
        exitFillObservedAt: input.exitFillObservedAt,
        exitFillPrice: input.exitFillPrice,
        exitReason: input.exitReason,
        realizedDirectionalReturn: input.realizedDirectionalReturn,
        realizedNetAccountReturn: input.realizedNetAccountReturn,
        outcomeUpdatedAt: input.exitFillObservedAt,
    };
    state.m05ShadowHistory = history.slice(-100);
    return true;
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
            residentStop: validateResidentStopProtection(rawPosition.residentStop),
            stopLedger: validateStopLedger(rawPosition.stopLedger),
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
        m05ShadowHistory: normalizeM05ShadowHistory(raw.m05ShadowHistory),
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        cooldownUntilTs: Number.isFinite(Number(raw.cooldownUntilTs)) ? Number(raw.cooldownUntilTs) : undefined,
        riskOverlay: normalizePenguRiskOverlayState(raw.riskOverlay),
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
            m05ShadowHistory: appendM05ShadowObservation(state),
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
    async save(state: PenguDualLsV2RunnerState) { this.state = structuredClone({ ...state, m05ShadowHistory: appendM05ShadowObservation(state) }); }
}

export function createPenguDualLsV2RunnerState(mode: PenguDualLsV2Mode): PenguDualLsV2RunnerState {
    return defaultState(mode);
}
