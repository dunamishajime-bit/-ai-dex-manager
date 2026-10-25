import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { allocateDynamicEntryGross, type DynamicEntryAllocation, type DynamicEntryAllocationResult, type DynamicEntryCandidate } from "./disdex-dynamic-entry-allocation";
import { deriveAccountReservationId, type AccountLockHandle, type AccountReservationInput } from "./disdex-account-order-lock";
import { validateStrictEntryApproval, type StrictEntryApproval } from "./disdex-strict-entry-approval";

export const DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA = "disdex-dynamic-entry-intents/v1" as const;
export type DynamicEntryIntent = DynamicEntryCandidate & { cycleId: string; submittedAt: number };
export type DynamicEntryAllocationDecision = Omit<DynamicEntryAllocationResult, "allocations"> & {
    allocations: Array<DynamicEntryAllocation & { reservationId: string }>;
    cycleId: string; decisionId: string; decidedAt: number; approvalSource: "REGISTRY_ALLOCATION";
    strictApprovalTokens: string[];
};
export type DynamicEntryReservationStatus = "RESERVATION_PENDING" | "DECISION_PUBLISHED" | "RELEASED" | "REQUIRES_REVIEW";
export type DynamicEntryReservationRecord = {
    reservationKey: string;
    cycleId: string;
    intentId: string;
    strategy: string;
    symbol: string;
    side: "LONG" | "SHORT";
    assetClass: "CRYPTO" | "STOCK";
    gross: number;
    notionalUsd: number;
    status: DynamicEntryReservationStatus;
    createdAt: number;
    updatedAt: number;
    reservationId?: string;
    decisionId?: string;
    strictApprovalToken: string;
    reviewReason?: string;
};
type Document = { schema: typeof DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA; intents: DynamicEntryIntent[]; decisions: DynamicEntryAllocationDecision[]; reservations: DynamicEntryReservationRecord[] };

type AuthoritativeGrossCaps = {
    strategyGrossAvailable: Readonly<Record<string, number>>;
    positionGrossAvailable: Readonly<Record<string, number>>;
};

function assertCapMap(value: unknown, name: string): asserts value is Readonly<Record<string, number>> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DYNAMIC_ENTRY_AUTHORITATIVE_CAPS_REQUIRED");
    for (const [key, cap] of Object.entries(value)) {
        if (!key.trim() || !Number.isFinite(cap) || cap < 0) throw new Error(`DYNAMIC_ENTRY_AUTHORITATIVE_CAP_INVALID:${name}:${key}`);
    }
}

function positionCapKey(intent: Pick<DynamicEntryCandidate, "strategy" | "symbol" | "side">) {
    return `${intent.strategy}|${intent.symbol.toUpperCase()}|${intent.side}`;
}

function assertStrictReservationGates(candidates: readonly DynamicEntryIntent[], quality102CausalV1Ready: boolean) {
    if (candidates.some((intent) => intent.strategy === "QUALITY102")) throw new Error("QUALITY102_LIVE_BLOCKED_FAIL_CLOSED");
    if (candidates.some((intent) => intent.strategy === "QUALITY102_CAUSAL_V1") && quality102CausalV1Ready !== true) {
        throw new Error("QUALITY102_CAUSAL_V1_NOT_READY");
    }
}

function assertCandidateCaps(candidates: readonly DynamicEntryIntent[], caps: AuthoritativeGrossCaps) {
    for (const intent of candidates) {
        if (!Object.prototype.hasOwnProperty.call(caps.strategyGrossAvailable, intent.strategy)) {
            throw new Error(`DYNAMIC_ENTRY_AUTHORITATIVE_CAP_MISSING:strategy:${intent.strategy}`);
        }
        const key = positionCapKey(intent);
        if (!Object.prototype.hasOwnProperty.call(caps.positionGrossAvailable, key)) {
            throw new Error(`DYNAMIC_ENTRY_AUTHORITATIVE_CAP_MISSING:position:${key}`);
        }
    }
}

function sanitizeIntent(input: DynamicEntryCandidate & { cycleId: string }, submittedAt: number): DynamicEntryIntent {
    const { id, strategy, symbol, side, assetClass, marketFitScore, scoreSource, signalTs, idempotencyKey, targetGross, minGross, maxGross, minNotionalUsd, btPrior, btPriorVersion, correlationPenalty, concentrationPenalty, stalePenalty } = input;
    if (!id.trim() || !strategy.trim() || !symbol.trim() || !input.cycleId.trim() || (side !== "LONG" && side !== "SHORT") || (assetClass !== "CRYPTO" && assetClass !== "STOCK")
        || !Number.isFinite(marketFitScore) || !Number.isFinite(targetGross) || targetGross <= 0 || !Number.isFinite(minGross) || minGross <= 0
        || !Number.isFinite(maxGross) || maxGross < minGross || !Number.isFinite(submittedAt)
        || [minNotionalUsd, correlationPenalty, concentrationPenalty, stalePenalty].some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))) throw new Error("DYNAMIC_ENTRY_INTENT_INVALID");
    if (btPrior && Object.values(btPrior).some((n) => !Number.isFinite(n))) throw new Error("DYNAMIC_ENTRY_INTENT_BT_PRIOR_INVALID");
    if ((signalTs !== undefined && (!Number.isFinite(signalTs) || signalTs <= 0 || signalTs > submittedAt))
        || (idempotencyKey !== undefined && !idempotencyKey.trim())
        || (scoreSource !== undefined && !scoreSource.trim())
        || (btPrior !== undefined && !btPriorVersion?.trim())
        || (btPriorVersion !== undefined && (btPrior === undefined || !btPriorVersion.trim()))) throw new Error("DYNAMIC_ENTRY_INTENT_METADATA_INVALID");
    return {
        cycleId: input.cycleId, submittedAt, id, strategy, symbol: symbol.toUpperCase(), side, assetClass,
        marketFitScore, targetGross, minGross, maxGross,
        ...(scoreSource === undefined ? {} : { scoreSource }),
        ...(signalTs === undefined ? {} : { signalTs }),
        idempotencyKey: idempotencyKey ?? id,
        ...(btPriorVersion === undefined ? {} : { btPriorVersion }),
        ...(minNotionalUsd === undefined ? {} : { minNotionalUsd }),
        ...(btPrior === undefined ? {} : { btPrior: { returnPct: btPrior.returnPct, profitFactor: btPrior.profitFactor, winRatePct: btPrior.winRatePct, maxDrawdownPct: btPrior.maxDrawdownPct, tradeCount: btPrior.tradeCount, observationDays: btPrior.observationDays } }),
        ...(correlationPenalty === undefined ? {} : { correlationPenalty }),
        ...(concentrationPenalty === undefined ? {} : { concentrationPenalty }),
        ...(stalePenalty === undefined ? {} : { stalePenalty }),
    };
}

async function read(path: string): Promise<Document> {
    try {
        const value = JSON.parse(await readFile(path, "utf8")) as Document;
        if (value.schema !== DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA || !Array.isArray(value.intents) || !Array.isArray(value.decisions)) throw new Error("DYNAMIC_ENTRY_INTENT_REGISTRY_MALFORMED");
        return { ...value, reservations: Array.isArray(value.reservations) ? value.reservations : [] };
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schema: DYNAMIC_ENTRY_INTENT_REGISTRY_SCHEMA, intents: [], decisions: [], reservations: [] };
        throw error;
    }
}

function reservationKey(cycleId: string, intentId: string) {
    return createHash("sha256").update(`${cycleId}|${intentId}`).digest("hex").slice(0, 24);
}

export type DynamicEntryReconciliationEvidence = {
    capturedAt: number;
    accountSnapshotFresh: boolean;
    openOrdersSnapshotFresh: boolean;
    pendingExposureSnapshotFresh: boolean;
    protectionSnapshotFresh: boolean;
    liveOrder: boolean;
    livePosition: boolean;
    pendingExposure: boolean;
    unmanagedOpenOrders: number;
    protectiveStopsVerified: boolean;
};

export type DynamicEntryReconciliationResult = {
    reservationKey: string;
    status: DynamicEntryReservationStatus;
    reservationId?: string;
    reason?: string;
};

async function write(path: string, doc: Document) {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try { await writeFile(temp, `${JSON.stringify(doc, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }); await rename(temp, path); }
    catch (error) { await unlink(temp).catch(() => undefined); throw error; }
}

export class FileDynamicEntryIntentRegistry {
    private readonly path: string;
    constructor(path: string, private readonly intentTtlMs = 30_000) {
        if (!Number.isFinite(intentTtlMs) || intentTtlMs <= 0) throw new Error("DYNAMIC_ENTRY_INTENT_TTL_INVALID");
        this.path = resolve(path);
    }

    private async synchronized<T>(work: () => Promise<T>): Promise<T> {
        const lockPath = `${this.path}.mutex`;
        await mkdir(dirname(this.path), { recursive: true });
        let fd;
        for (let tries = 0; tries < 500; tries += 1) {
            try { fd = await open(lockPath, "wx", 0o600); break; }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; await new Promise((resolveWait) => setTimeout(resolveWait, 10)); }
        }
        if (!fd) throw new Error("DYNAMIC_ENTRY_INTENT_REGISTRY_BUSY");
        try { return await work(); } finally { await fd.close(); await unlink(lockPath).catch(() => undefined); }
    }

    async submit(intent: DynamicEntryCandidate & { cycleId: string }, submittedAt = Date.now()): Promise<DynamicEntryIntent> {
        const submitted = sanitizeIntent(intent, submittedAt);
        return this.synchronized(async () => {
            const doc = await read(this.path);
            if (doc.decisions.some((decision) => decision.cycleId === intent.cycleId)) throw new Error("DYNAMIC_ENTRY_CYCLE_ALREADY_DECIDED");
            doc.intents = [...doc.intents.filter((row) => !(row.cycleId === intent.cycleId && row.id === intent.id)), submitted];
            await write(this.path, doc);
            return submitted;
        });
    }

    async allocateCycle(input: {
        cycleId: string; now: number; cryptoGrossAvailable: number; stockGrossAvailable: number;
        totalGrossAvailable: number; equityUsd: number; lock: AccountLockHandle;
        quality102CausalV1Ready: boolean;
        strategyGrossAvailable: Readonly<Record<string, number>>;
        positionGrossAvailable: Readonly<Record<string, number>>;
        strictPlannerApprovals: readonly StrictEntryApproval[];
    }): Promise<DynamicEntryAllocationDecision> {
        return this.synchronized(async () => {
            const doc = await read(this.path);
            const existing = doc.decisions.find((decision) => decision.cycleId === input.cycleId);
            if (existing) {
                if (!existing.strictApprovalTokens?.length) {
                    if (existing.allocations.length === 0) return existing;
                    throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_REQUIRED");
                }
                if (input.strictPlannerApprovals.length !== existing.strictApprovalTokens.length
                    || input.strictPlannerApprovals.some((approval) => !existing.strictApprovalTokens.includes(approval.token))) {
                    throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_INCOMPATIBLE");
                }
                for (const approval of input.strictPlannerApprovals) {
                    const candidate = doc.intents.find((intent) => intent.cycleId === input.cycleId && intent.id === approval.candidateId);
                    if (!candidate) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_CANDIDATE_MISSING");
                    validateStrictEntryApproval({ approval, cycleId: input.cycleId, candidate, now: input.now, maxAgeMs: this.intentTtlMs });
                }
                return existing.approvalSource ? existing : { ...existing, approvalSource: "REGISTRY_ALLOCATION" };
            }
            if (doc.reservations.some((row) => row.cycleId === input.cycleId && row.status !== "RELEASED")) {
                throw new Error("DYNAMIC_ENTRY_CYCLE_RECONCILIATION_REQUIRED");
            }
            const lockSnapshot = await input.lock.document(); // Capture the lease ID before journaling any reservation.
            assertCapMap(input.strategyGrossAvailable, "strategy");
            assertCapMap(input.positionGrossAvailable, "position");
            const rawCandidates = doc.intents.filter((intent) => intent.cycleId === input.cycleId && input.now >= intent.submittedAt && input.now - intent.submittedAt <= this.intentTtlMs);
            assertStrictReservationGates(rawCandidates, input.quality102CausalV1Ready);
            assertCandidateCaps(rawCandidates, input);
            const approvals = new Map(input.strictPlannerApprovals.map((approval) => [approval.candidateId, approval]));
            if (rawCandidates.length !== approvals.size || rawCandidates.some((candidate) => !approvals.has(candidate.id))) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_REQUIRED");
            for (const candidate of rawCandidates) {
                const approval = approvals.get(candidate.id);
                if (!approval) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_REQUIRED");
                validateStrictEntryApproval({ approval, cycleId: input.cycleId, candidate, now: input.now, maxAgeMs: this.intentTtlMs });
            }
            const candidates = rawCandidates.map((intent) => ({
                ...intent,
                maxGross: Math.min(intent.maxGross, input.strategyGrossAvailable[intent.strategy] ?? Number.POSITIVE_INFINITY, input.positionGrossAvailable[positionCapKey(intent)] ?? Number.POSITIVE_INFINITY),
            }));
            const approvedCandidates = candidates.map((candidate) => {
                const approval = approvals.get(candidate.id)!;
                const approvedGross = approval.accepted.gross;
                return { ...candidate, targetGross: Math.min(candidate.targetGross, approvedGross), maxGross: Math.min(candidate.maxGross, approvedGross) };
            });
            const allocation = allocateDynamicEntryGross({ candidates: approvedCandidates, cryptoGrossAvailable: input.cryptoGrossAvailable, stockGrossAvailable: input.stockGrossAvailable, totalGrossAvailable: input.totalGrossAvailable, equityUsd: input.equityUsd });
            const strategyRemaining = { ...input.strategyGrossAvailable };
            const positionRemaining = { ...input.positionGrossAvailable };
            const bounded = allocation.allocations.flatMap((row) => {
                const positionKey = positionCapKey(row);
                const allocatedGross = Math.min(row.allocatedGross, strategyRemaining[row.strategy], positionRemaining[positionKey]);
                if (allocatedGross + 1e-12 < Math.max(row.minGross, row.minNotionalUsd ? row.minNotionalUsd / input.equityUsd : 0)) return [];
                if (strategyRemaining[row.strategy] !== undefined) strategyRemaining[row.strategy] = Math.max(0, strategyRemaining[row.strategy] - allocatedGross);
                if (positionRemaining[positionKey] !== undefined) positionRemaining[positionKey] = Math.max(0, positionRemaining[positionKey] - allocatedGross);
                return [{ ...row, allocatedGross }];
            });
            allocation.allocations = bounded;
            const cryptoAllocated = bounded.filter((row) => row.assetClass === "CRYPTO").reduce((sum, row) => sum + row.allocatedGross, 0);
            const stockAllocated = bounded.filter((row) => row.assetClass === "STOCK").reduce((sum, row) => sum + row.allocatedGross, 0);
            allocation.residual = { cryptoGross: Math.max(0, input.cryptoGrossAvailable - cryptoAllocated), stockGross: Math.max(0, input.stockGrossAvailable - stockAllocated), totalGross: Math.max(0, input.totalGrossAvailable - cryptoAllocated - stockAllocated) };
            const reservationRequest = (row: DynamicEntryAllocation): AccountReservationInput => ({
                reservationKey: reservationKey(input.cycleId, row.id),
                strategyId: row.strategy, symbol: row.symbol, side: row.side,
                sleeve: row.assetClass, gross: row.allocatedGross, notionalUsd: row.allocatedGross * input.equityUsd,
            });
            const reservations: string[] = [];
            const journalRows: DynamicEntryReservationRecord[] = allocation.allocations.map((row) => ({
                // Durable BEFORE calling reserve(). A crash cannot erase the lock's reservation ID.
                reservationId: deriveAccountReservationId(lockSnapshot.leaseId, reservationRequest(row)),
                reservationKey: reservationKey(input.cycleId, row.id),
                cycleId: input.cycleId,
                intentId: row.id,
                strategy: row.strategy,
                symbol: row.symbol,
                side: row.side,
                assetClass: row.assetClass,
                gross: row.allocatedGross,
                notionalUsd: row.allocatedGross * input.equityUsd,
                status: "RESERVATION_PENDING",
                createdAt: input.now,
                updatedAt: input.now,
                strictApprovalToken: approvals.get(row.id)!.token,
            }));
            let publishedDecisionId: string | undefined;
            try {
                doc.reservations = [...doc.reservations.filter((row) => row.cycleId !== input.cycleId), ...journalRows];
                await write(this.path, doc);
                for (let index = 0; index < allocation.allocations.length; index += 1) {
                    const row = allocation.allocations[index];
                    const actual = await input.lock.reserve(reservationRequest(row));
                    reservations.push(actual.reservationId);
                    if (actual.reservationId !== journalRows[index].reservationId) {
                        throw new Error("DYNAMIC_ENTRY_RESERVATION_ID_MISMATCH");
                    }
                }
                const persistedLock = await input.lock.document();
                for (const row of journalRows) {
                    if (!persistedLock.reservations.some((entry) =>
                        entry.reservationId === row.reservationId && entry.status === "RESERVED"
                        && entry.strategyId === row.strategy && entry.symbol === row.symbol
                        && entry.side === row.side && (entry.sleeve ?? "CRYPTO") === row.assetClass
                        && entry.gross === row.gross && entry.notionalUsd === row.notionalUsd)) {
                        throw new Error("DYNAMIC_ENTRY_RESERVATION_LOCK_PARITY_FAILED");
                    }
                }
                const decisionId = createHash("sha256").update(`${input.cycleId}|${allocation.allocations.map((row) => `${row.id}:${row.allocatedGross}`).join("|")}|${input.strictPlannerApprovals.map((approval) => approval.token).sort().join("|")}`).digest("hex").slice(0, 24);
                const decision: DynamicEntryAllocationDecision = {
                    ...allocation,
                    allocations: allocation.allocations.map((row, index) => ({ ...row, reservationId: journalRows[index].reservationId! })),
                    cycleId: input.cycleId, decisionId, decidedAt: input.now, approvalSource: "REGISTRY_ALLOCATION",
                    strictApprovalTokens: input.strictPlannerApprovals.map((approval) => approval.token).sort(),
                };
                publishedDecisionId = decisionId;
                doc.reservations = doc.reservations.map((row) => row.cycleId === input.cycleId
                    ? { ...row, status: "DECISION_PUBLISHED" as const, decisionId, updatedAt: input.now }
                    : row);
                doc.decisions.push(decision);
                await write(this.path, doc);
                return decision;
            } catch (error) {
                // reserve() can persist the lock and pending exposure before throwing.
                // Always release EVERY pre-journaled ID, not only returned IDs.
                let releaseFailed = false;
                const rollbackIds = new Set([...journalRows.map((row) => row.reservationId!).filter(Boolean), ...reservations]);
                for (const id of rollbackIds) {
                    try { await input.lock.releaseReservation(id); } catch { releaseFailed = true; }
                }
                const currentLock = await input.lock.document().catch(() => undefined);
                if (!currentLock || [...rollbackIds].some((id) =>
                    currentLock.reservations.some((row) => row.reservationId === id && row.status === "RESERVED"))) {
                    releaseFailed = true;
                }
                doc.decisions = doc.decisions.filter((row) => !(row.cycleId === input.cycleId && row.decisionId === publishedDecisionId));
                doc.reservations = doc.reservations.map((row) => row.cycleId === input.cycleId
                    ? { ...row, status: (releaseFailed ? "REQUIRES_REVIEW" : "RELEASED") as DynamicEntryReservationStatus,
                        updatedAt: input.now, reviewReason: releaseFailed ? "NORMAL_EXCEPTION_RELEASE_FAILED" : "NORMAL_EXCEPTION_RELEASE" }
                    : row);
                await write(this.path, doc).catch(() => undefined);
                throw error;
            }
        });
    }

    async reconcileReservations(input: {
        now: number;
        lock: AccountLockHandle;
        evidenceFor: (record: DynamicEntryReservationRecord) => Promise<DynamicEntryReconciliationEvidence> | DynamicEntryReconciliationEvidence;
    }): Promise<DynamicEntryReconciliationResult[]> {
        return this.synchronized(async () => {
            const doc = await read(this.path);
            const results: DynamicEntryReconciliationResult[] = [];
            for (const record of doc.reservations.filter((row) => row.status === "RESERVATION_PENDING")) {
                const evidence = await input.evidenceFor(record);
                const fresh = evidence.accountSnapshotFresh && evidence.openOrdersSnapshotFresh && evidence.pendingExposureSnapshotFresh && evidence.protectionSnapshotFresh
                    && Number.isFinite(evidence.capturedAt) && evidence.capturedAt > 0 && evidence.capturedAt <= input.now;
                const potentialLive = evidence.liveOrder || evidence.livePosition || evidence.pendingExposure || evidence.unmanagedOpenOrders > 0
                    || !evidence.protectiveStopsVerified;
                if (!fresh || potentialLive) {
                    const reason = !fresh ? "RECONCILIATION_EVIDENCE_STALE_OR_INCOMPLETE" : "RECONCILIATION_POTENTIAL_LIVE_ORDER_OR_POSITION";
                    doc.reservations = doc.reservations.map((row) => row.reservationKey === record.reservationKey
                        ? { ...row, status: "REQUIRES_REVIEW" as const, updatedAt: input.now, reviewReason: reason }
                        : row);
                    results.push({ reservationKey: record.reservationKey, reservationId: record.reservationId, status: "REQUIRES_REVIEW", reason });
                    continue;
                }
                if (!record.reservationId) {
                    const reason = "RECONCILIATION_RESERVATION_ID_UNKNOWN";
                    doc.reservations = doc.reservations.map((row) => row.reservationKey === record.reservationKey
                        ? { ...row, status: "REQUIRES_REVIEW" as const, updatedAt: input.now, reviewReason: reason }
                        : row);
                    results.push({ reservationKey: record.reservationKey, status: "REQUIRES_REVIEW", reason });
                    continue;
                }
                const before = await input.lock.document();
                const matching = before.reservations.find((entry) => entry.reservationId === record.reservationId);
                if (matching && (matching.strategyId !== record.strategy || matching.symbol !== record.symbol
                    || matching.side !== record.side || (matching.sleeve ?? "CRYPTO") !== record.assetClass
                    || matching.gross !== record.gross || matching.notionalUsd !== record.notionalUsd)) {
                    const reason = "RECONCILIATION_RESERVATION_IDENTITY_MISMATCH";
                    doc.reservations = doc.reservations.map((row) => row.reservationKey === record.reservationKey
                        ? { ...row, status: "REQUIRES_REVIEW" as const, updatedAt: input.now, reviewReason: reason }
                        : row);
                    results.push({ reservationKey: record.reservationKey, reservationId: record.reservationId, status: "REQUIRES_REVIEW", reason });
                    continue;
                }
                await input.lock.releaseReservation(record.reservationId);
                const after = await input.lock.document();
                if (after.reservations.some((entry) => entry.reservationId === record.reservationId && entry.status === "RESERVED")) {
                    throw new Error("DYNAMIC_ENTRY_RECONCILIATION_RELEASE_UNCONFIRMED");
                }
                doc.reservations = doc.reservations.map((row) => row.reservationKey === record.reservationKey
                    ? { ...row, status: "RELEASED" as const, updatedAt: input.now, reviewReason: "RECONCILED_NO_LIVE_EVIDENCE" }
                    : row);
                results.push({ reservationKey: record.reservationKey, reservationId: record.reservationId, status: "RELEASED", reason: "RECONCILED_NO_LIVE_EVIDENCE" });
            }
            await write(this.path, doc);
            return results;
        });
    }
}

export type { DynamicEntryAllocation };
