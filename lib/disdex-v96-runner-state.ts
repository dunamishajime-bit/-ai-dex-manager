import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AsterOrderSide } from "@/lib/aster-v3-client";
import { DISDEX_V96_RUNTIME, DISDEX_V96_STRATEGY_ID } from "@/config/disdexV96Runtime";
import { disDexV96ConfigFingerprint } from "@/lib/disdex-v96-live-gates";
import type { DisDexV96DailyRiskState } from "@/lib/disdex-v96-live-risk-controls";

export type DisDexV96RunnerMode = "paper" | "live";
export type DisDexV96PendingPhase = "planned" | "submitted" | "manual_review";

export interface DisDexV96PendingOrder {
    idempotencyKey: string;
    clientOrderId: string;
    phase: DisDexV96PendingPhase;
    symbol: string;
    side: AsterOrderSide;
    requestedQuantity: number;
    normalizedQuantity?: number;
    reduceOnly: boolean;
    expectedPrice: number;
    targetWeight: number;
    targetNotionalUsd: number;
    deltaNotionalUsd: number;
    referenceTs: number;
    createdAt: number;
    updatedAt: number;
    retryCount: number;
    reason: string;
    lastError?: string;
}

export interface DisDexV96CompletedExecution {
    idempotencyKey: string;
    clientOrderId: string;
    orderId?: number;
    symbol: string;
    side: AsterOrderSide;
    reduceOnly: boolean;
    requestedQuantity: number;
    submittedQuantity: number;
    executedQuantity: number;
    averagePrice: number;
    quoteQuantity: number;
    status: string;
    completedAt: number;
    referenceTs: number;
}

export interface DisDexV96Failure {
    occurredAt: number;
    message: string;
    idempotencyKey?: string;
    symbol?: string;
}

export interface DisDexV96ForwardEvidenceState {
    startedAt?: number;
    completedDecisionBars: number;
    closedLongTrades: number;
    closedShortTrades: number;
    grossCapBreaches: number;
    unknownOrderEvents: number;
    stateRecoveryFailures: number;
    minimumObservedPenguClip: number;
    lastUpdatedAt?: number;
}

export interface DisDexV96OperatorOverrideAudit {
    artifactSha256: string;
    operator: string;
    approvedAt: string;
    expiresAt: string;
    approvedCommitSha: string;
    initialPenguGrossCap: number;
    maximumPortfolioGross: number;
    maximumDailyLossPct: number;
    maximumDailyLossUsd?: number;
}

export interface DisDexV96KillSwitchAudit {
    active: boolean;
    action: "FLATTEN_MANAGED";
    reason: string;
    operator: string;
    activatedAt: string;
    observedAt: number;
}

export interface DisDexV96RunnerState {
    version: 2;
    strategyId: typeof DISDEX_V96_STRATEGY_ID;
    configFingerprint: string;
    mode: DisDexV96RunnerMode;
    updatedAt: number;
    createdAt: number;
    lastRunAt?: number;
    lastSignalReferenceTs?: number;
    lastCompletedIdempotencyKey?: string;
    pending?: DisDexV96PendingOrder;
    completedExecutions: DisDexV96CompletedExecution[];
    failures: DisDexV96Failure[];
    forwardEvidence: DisDexV96ForwardEvidenceState;
    operatorOverride?: DisDexV96OperatorOverrideAudit;
    dailyRisk?: DisDexV96DailyRiskState;
    killSwitch?: DisDexV96KillSwitchAudit;
    bootstrapRequired: boolean;
    manualReviewReason?: string;
}

function defaultForwardEvidence(): DisDexV96ForwardEvidenceState {
    return {
        completedDecisionBars: 0,
        closedLongTrades: 0,
        closedShortTrades: 0,
        grossCapBreaches: 0,
        unknownOrderEvents: 0,
        stateRecoveryFailures: 0,
        minimumObservedPenguClip: 1,
    };
}

export function createDisDexV96RunnerState(mode: DisDexV96RunnerMode): DisDexV96RunnerState {
    const now = Date.now();
    return {
        version: 2,
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        mode,
        updatedAt: now,
        createdAt: now,
        completedExecutions: [],
        failures: [],
        forwardEvidence: defaultForwardEvidence(),
        bootstrapRequired: true,
    };
}

function normalize(value: unknown, mode: DisDexV96RunnerMode): DisDexV96RunnerState {
    if (!value || typeof value !== "object") return createDisDexV96RunnerState(mode);
    const raw = value as Partial<DisDexV96RunnerState> & { version?: number };
    if (raw.strategyId && raw.strategyId !== DISDEX_V96_STRATEGY_ID) {
        throw new Error(`V96 state strategyId mismatch: ${String(raw.strategyId)}`);
    }
    if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) {
        throw new Error(`Unsupported V96 state version: ${String(raw.version)}`);
    }
    const expectedFingerprint = disDexV96ConfigFingerprint();
    if (raw.configFingerprint && raw.configFingerprint !== expectedFingerprint) {
        throw new Error("V96 state config fingerprint changed; manual migration/review is required.");
    }
    const now = Date.now();
    const forward = raw.forwardEvidence && typeof raw.forwardEvidence === "object"
        ? raw.forwardEvidence as Partial<DisDexV96ForwardEvidenceState>
        : {};
    return {
        version: 2,
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: expectedFingerprint,
        mode,
        updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : now,
        createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : now,
        lastRunAt: Number.isFinite(Number(raw.lastRunAt)) ? Number(raw.lastRunAt) : undefined,
        lastSignalReferenceTs: Number.isFinite(Number(raw.lastSignalReferenceTs)) ? Number(raw.lastSignalReferenceTs) : undefined,
        lastCompletedIdempotencyKey: typeof raw.lastCompletedIdempotencyKey === "string" ? raw.lastCompletedIdempotencyKey : undefined,
        pending: raw.pending && typeof raw.pending === "object" ? raw.pending as DisDexV96PendingOrder : undefined,
        completedExecutions: Array.isArray(raw.completedExecutions)
            ? raw.completedExecutions.filter((item): item is DisDexV96CompletedExecution => Boolean(item && typeof item.idempotencyKey === "string")).slice(-500)
            : [],
        failures: Array.isArray(raw.failures)
            ? raw.failures.filter((item): item is DisDexV96Failure => Boolean(item && typeof item.message === "string")).slice(-100)
            : [],
        forwardEvidence: {
            completedDecisionBars: Math.max(0, Number(forward.completedDecisionBars) || 0),
            closedLongTrades: Math.max(0, Number(forward.closedLongTrades) || 0),
            closedShortTrades: Math.max(0, Number(forward.closedShortTrades) || 0),
            grossCapBreaches: Math.max(0, Number(forward.grossCapBreaches) || 0),
            unknownOrderEvents: Math.max(0, Number(forward.unknownOrderEvents) || 0),
            stateRecoveryFailures: Math.max(0, Number(forward.stateRecoveryFailures) || 0),
            minimumObservedPenguClip: Number.isFinite(Number(forward.minimumObservedPenguClip)) ? Number(forward.minimumObservedPenguClip) : 1,
            startedAt: Number.isFinite(Number(forward.startedAt)) ? Number(forward.startedAt) : undefined,
            lastUpdatedAt: Number.isFinite(Number(forward.lastUpdatedAt)) ? Number(forward.lastUpdatedAt) : undefined,
        },
        operatorOverride: raw.operatorOverride && typeof raw.operatorOverride === "object"
            ? raw.operatorOverride as DisDexV96OperatorOverrideAudit
            : undefined,
        dailyRisk: raw.dailyRisk && typeof raw.dailyRisk === "object"
            ? raw.dailyRisk as DisDexV96DailyRiskState
            : undefined,
        killSwitch: raw.killSwitch && typeof raw.killSwitch === "object"
            ? raw.killSwitch as DisDexV96KillSwitchAudit
            : undefined,
        bootstrapRequired: typeof raw.bootstrapRequired === "boolean" ? raw.bootstrapRequired : true,
        manualReviewReason: typeof raw.manualReviewReason === "string" ? raw.manualReviewReason : undefined,
    };
}

export interface DisDexV96RunnerStateStore {
    load(): Promise<DisDexV96RunnerState>;
    save(state: DisDexV96RunnerState): Promise<void>;
}

export class FileDisDexV96RunnerStateStore implements DisDexV96RunnerStateStore {
    private readonly path: string;

    constructor(path: string, private readonly mode: DisDexV96RunnerMode) {
        this.path = resolve(path);
    }

    async load() {
        try {
            return normalize(JSON.parse(await readFile(this.path, "utf8")) as unknown, this.mode);
        } catch (error) {
            const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
            if (code === "ENOENT") return createDisDexV96RunnerState(this.mode);
            throw error;
        }
    }

    async save(state: DisDexV96RunnerState) {
        await mkdir(dirname(this.path), { recursive: true });
        const value: DisDexV96RunnerState = {
            ...state,
            version: 2,
            strategyId: DISDEX_V96_STRATEGY_ID,
            configFingerprint: disDexV96ConfigFingerprint(),
            mode: this.mode,
            updatedAt: Date.now(),
            completedExecutions: state.completedExecutions.slice(-500),
            failures: state.failures.slice(-100),
        };
        const temporary = `${this.path}.${process.pid}.${Date.now()}.tmp`;
        await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(temporary, this.path);
    }
}

export class MemoryDisDexV96RunnerStateStore implements DisDexV96RunnerStateStore {
    constructor(private state: DisDexV96RunnerState) {}
    async load() { return structuredClone(this.state); }
    async save(state: DisDexV96RunnerState) { this.state = structuredClone(state); }
}
