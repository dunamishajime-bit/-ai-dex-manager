import { createHash } from "node:crypto";

import type { DynamicEntryCandidate } from "./disdex-entry-intent-types";
import type { PortfolioDdGovernorState } from "./disdex-portfolio-dd-governor";
import type { SharedCryptoDailyRiskState } from "./disdex-shared-crypto-daily-risk";
import type { StrictPortfolioIntent, StrictPortfolioPlan } from "./disdex-strict-portfolio-planner";

export const STRICT_ENTRY_APPROVAL_SCHEMA = "disdex-strict-entry-approval/v1" as const;

export type StrictEntryApprovalSnapshot = {
    capturedAt: number;
    account: { equityUsd: number; availableBalanceUsd: number; updatedAt: number };
    positions: Array<Pick<StrictPortfolioPlan["activePositions"][number], "id" | "strategy" | "symbol" | "side" | "quantity" | "entryPrice" | "markPrice" | "updatedAt">>;
    openOrders: Array<{ symbol: string; clientOrderId: string; status: string; type: string; side: string; reduceOnly: boolean }>;
    pendingReservationIds: string[];
    entryCeiling: { cryptoGrossCap: number; totalGrossCap: number };
    sharedDailyRisk: Pick<SharedCryptoDailyRiskState, "schema" | "accountScope" | "updatedAt" | "tripped" | "sourceComplete" | "stateHash">;
    portfolioDdGovernor: Pick<PortfolioDdGovernorState, "schema" | "updatedAt" | "currentDrawdownPct" | "twrIndex" | "twrPeak">;
    unmanagedOpenOrders: { checkedAt: number; count: number };
    marginGuard: { checkedAt: number; healthy: true };
    protectiveStops: { checkedAt: number; requiredPositionIds: string[]; verifiedPositionIds: string[] };
};

export type StrictEntryApproval = {
    schema: typeof STRICT_ENTRY_APPROVAL_SCHEMA;
    token: string;
    cycleId: string;
    candidateId: string;
    approvedAt: number;
    expiresAt: number;
    accepted: Pick<StrictPortfolioIntent, "idempotencyKey" | "strategy" | "symbol" | "side" | "signalTs" | "gross" | "notionalUsd" | "minGross" | "maxGross">;
    plan: StrictPortfolioPlan;
    snapshot: StrictEntryApprovalSnapshot;
};

const EPSILON = 1e-9;

function finite(value: unknown) {
    return typeof value === "number" && Number.isFinite(value);
}

function normalizedAccepted(row: StrictPortfolioIntent) {
    return {
        idempotencyKey: row.idempotencyKey,
        strategy: row.strategy,
        symbol: row.symbol.toUpperCase(),
        side: row.side,
        signalTs: row.signalTs,
        gross: row.gross,
        notionalUsd: row.notionalUsd,
        ...(row.minGross === undefined ? {} : { minGross: row.minGross }),
        ...(row.maxGross === undefined ? {} : { maxGross: row.maxGross }),
    } as StrictEntryApproval["accepted"];
}

function tokenBody(input: Omit<StrictEntryApproval, "token">) {
    return {
        schema: input.schema,
        cycleId: input.cycleId,
        candidateId: input.candidateId,
        approvedAt: input.approvedAt,
        expiresAt: input.expiresAt,
        accepted: input.accepted,
        plan: input.plan,
        snapshot: input.snapshot,
    };
}

function digest(input: Omit<StrictEntryApproval, "token">) {
    return createHash("sha256").update(JSON.stringify(tokenBody(input))).digest("hex");
}

function assertSnapshot(snapshot: StrictEntryApprovalSnapshot, now: number, maxAgeMs: number) {
    if (!Number.isFinite(snapshot.capturedAt) || snapshot.capturedAt <= 0 || snapshot.capturedAt > now || now - snapshot.capturedAt > maxAgeMs) throw new Error("DYNAMIC_ENTRY_STRICT_SNAPSHOT_STALE");
    if (![snapshot.account.equityUsd, snapshot.account.availableBalanceUsd, snapshot.account.updatedAt].every(finite)
        || snapshot.account.equityUsd <= 0 || snapshot.account.availableBalanceUsd < 0
        || snapshot.account.updatedAt <= 0 || snapshot.account.updatedAt > now || now - snapshot.account.updatedAt > maxAgeMs) {
        throw new Error("DYNAMIC_ENTRY_STRICT_ACCOUNT_SNAPSHOT_INVALID");
    }
    if (!Number.isFinite(snapshot.entryCeiling.cryptoGrossCap) || !Number.isFinite(snapshot.entryCeiling.totalGrossCap)
        || snapshot.entryCeiling.cryptoGrossCap <= 0 || snapshot.entryCeiling.totalGrossCap <= 0) throw new Error("DYNAMIC_ENTRY_STRICT_ENTRY_CEILING_INVALID");
    if (snapshot.sharedDailyRisk.schema !== "disdex-shared-crypto-daily-risk/v1" || snapshot.sharedDailyRisk.accountScope !== "ASTER_FUTURES"
        || snapshot.sharedDailyRisk.tripped !== false || snapshot.sharedDailyRisk.sourceComplete !== true
        || !Number.isFinite(snapshot.sharedDailyRisk.updatedAt) || snapshot.sharedDailyRisk.updatedAt <= 0
        || snapshot.sharedDailyRisk.updatedAt > now || now - snapshot.sharedDailyRisk.updatedAt > maxAgeMs) throw new Error("DYNAMIC_ENTRY_STRICT_DAILY_RISK_INVALID");
    if (snapshot.portfolioDdGovernor.schema !== "disdex-portfolio-dd-governor/v1"
        || !Number.isFinite(snapshot.portfolioDdGovernor.updatedAt) || snapshot.portfolioDdGovernor.updatedAt <= 0
        || snapshot.portfolioDdGovernor.updatedAt > now || now - snapshot.portfolioDdGovernor.updatedAt > maxAgeMs
        || !Number.isFinite(snapshot.portfolioDdGovernor.currentDrawdownPct) || snapshot.portfolioDdGovernor.currentDrawdownPct < 0
        || !Number.isFinite(snapshot.portfolioDdGovernor.twrIndex) || snapshot.portfolioDdGovernor.twrIndex <= 0
        || !Number.isFinite(snapshot.portfolioDdGovernor.twrPeak) || snapshot.portfolioDdGovernor.twrPeak <= 0) throw new Error("DYNAMIC_ENTRY_STRICT_DD_GOVERNOR_INVALID");
    if (!Number.isFinite(snapshot.unmanagedOpenOrders.checkedAt) || snapshot.unmanagedOpenOrders.checkedAt <= 0
        || snapshot.unmanagedOpenOrders.checkedAt > now || now - snapshot.unmanagedOpenOrders.checkedAt > maxAgeMs
        || snapshot.unmanagedOpenOrders.count !== 0) throw new Error("DYNAMIC_ENTRY_STRICT_UNMANAGED_ORDER_STATE_INVALID");
    if (!Number.isFinite(snapshot.marginGuard.checkedAt) || snapshot.marginGuard.checkedAt <= 0
        || snapshot.marginGuard.checkedAt > now || now - snapshot.marginGuard.checkedAt > maxAgeMs || snapshot.marginGuard.healthy !== true) throw new Error("DYNAMIC_ENTRY_STRICT_MARGIN_STATE_INVALID");
    if (!Number.isFinite(snapshot.protectiveStops.checkedAt) || snapshot.protectiveStops.checkedAt <= 0
        || snapshot.protectiveStops.checkedAt > now || now - snapshot.protectiveStops.checkedAt > maxAgeMs) throw new Error("DYNAMIC_ENTRY_STRICT_PROTECTION_STATE_INVALID");
    const required = new Set(snapshot.protectiveStops.requiredPositionIds);
    const verified = new Set(snapshot.protectiveStops.verifiedPositionIds);
    if ([...required].some((id) => !verified.has(id))) throw new Error("DYNAMIC_ENTRY_STRICT_PROTECTIVE_STOP_UNVERIFIED");
    if (!Array.isArray(snapshot.openOrders) || snapshot.openOrders.some((row) => !row.symbol || !row.clientOrderId || !row.status || !row.type || !row.side || typeof row.reduceOnly !== "boolean")) throw new Error("DYNAMIC_ENTRY_STRICT_OPEN_ORDER_SNAPSHOT_INVALID");
    if (!Array.isArray(snapshot.pendingReservationIds) || snapshot.pendingReservationIds.some((id) => !id.trim())) throw new Error("DYNAMIC_ENTRY_STRICT_PENDING_SNAPSHOT_INVALID");
}

export function createStrictEntryApproval(input: {
    cycleId: string;
    candidate: DynamicEntryCandidate;
    plan: StrictPortfolioPlan;
    snapshot: StrictEntryApprovalSnapshot;
    now: number;
    maxAgeMs: number;
}): StrictEntryApproval {
    const candidateSignalTs = input.candidate.signalTs;
    if (!input.candidate.idempotencyKey?.trim() || typeof candidateSignalTs !== "number" || !Number.isFinite(candidateSignalTs) || candidateSignalTs <= 0) throw new Error("DYNAMIC_ENTRY_STRICT_CANDIDATE_IDENTITY_INVALID");
    if (input.plan.status !== "planned") throw new Error(`DYNAMIC_ENTRY_STRICT_PLAN_BLOCKED:${input.plan.reason || "UNKNOWN"}`);
    const accepted = input.plan.accepted.find((row) => row.idempotencyKey === input.candidate.idempotencyKey);
    if (!accepted) throw new Error("DYNAMIC_ENTRY_STRICT_PLAN_CANDIDATE_NOT_ACCEPTED");
    if (!Number.isFinite(input.now) || input.now <= 0 || !Number.isFinite(input.maxAgeMs) || input.maxAgeMs <= 0) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_TIME_INVALID");
    assertSnapshot(input.snapshot, input.now, input.maxAgeMs);
    if (accepted.strategy !== input.candidate.strategy || accepted.symbol.toUpperCase() !== input.candidate.symbol.toUpperCase()
        || accepted.side !== input.candidate.side || accepted.signalTs !== candidateSignalTs
        || accepted.gross <= 0 || accepted.gross > input.candidate.targetGross + EPSILON || accepted.gross > input.candidate.maxGross + EPSILON
        || (accepted.minGross !== undefined && accepted.gross + EPSILON < accepted.minGross)
        || Math.abs(accepted.notionalUsd - accepted.gross * input.snapshot.account.equityUsd) > EPSILON
        || input.plan.totals.cryptoGross > input.snapshot.entryCeiling.cryptoGrossCap + EPSILON
        || input.plan.totals.totalGross > input.snapshot.entryCeiling.totalGrossCap + EPSILON) {
        throw new Error("DYNAMIC_ENTRY_STRICT_PLAN_CANDIDATE_INCOMPATIBLE");
    }
    const expiresAt = input.now + input.maxAgeMs;
    const unsigned = {
        schema: STRICT_ENTRY_APPROVAL_SCHEMA,
        cycleId: input.cycleId,
        candidateId: input.candidate.id,
        approvedAt: input.now,
        expiresAt,
        accepted: normalizedAccepted(accepted),
        plan: input.plan,
        snapshot: input.snapshot,
    } satisfies Omit<StrictEntryApproval, "token">;
    return { ...unsigned, token: digest(unsigned) };
}

export function validateStrictEntryApproval(input: {
    approval: StrictEntryApproval;
    cycleId: string;
    candidate: DynamicEntryCandidate;
    now: number;
    maxAgeMs: number;
}) {
    const { approval, cycleId, candidate, now, maxAgeMs } = input;
    if (approval.schema !== STRICT_ENTRY_APPROVAL_SCHEMA || approval.cycleId !== cycleId || approval.candidateId !== candidate.id) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_INCOMPATIBLE");
    const candidateSignalTs = candidate.signalTs;
    if (!candidate.idempotencyKey?.trim() || typeof candidateSignalTs !== "number" || !Number.isFinite(candidateSignalTs) || candidateSignalTs <= 0) throw new Error("DYNAMIC_ENTRY_STRICT_CANDIDATE_IDENTITY_INVALID");
    if (!Number.isFinite(approval.approvedAt) || !Number.isFinite(approval.expiresAt) || approval.approvedAt > now || now > approval.expiresAt || now - approval.approvedAt > maxAgeMs) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_STALE");
    assertSnapshot(approval.snapshot, now, maxAgeMs);
    const planned = approval.plan.accepted.find((row) => row.idempotencyKey === candidate.idempotencyKey);
    if (approval.plan.status !== "planned" || !planned || Math.abs(planned.gross - approval.accepted.gross) > EPSILON
        || approval.plan.totals.cryptoGross > approval.snapshot.entryCeiling.cryptoGrossCap + EPSILON
        || approval.plan.totals.totalGross > approval.snapshot.entryCeiling.totalGrossCap + EPSILON
        || approval.accepted.idempotencyKey !== candidate.idempotencyKey
        || approval.accepted.strategy !== candidate.strategy || approval.accepted.symbol.toUpperCase() !== candidate.symbol.toUpperCase()
        || approval.accepted.side !== candidate.side || approval.accepted.signalTs !== candidateSignalTs
        || !Number.isFinite(approval.accepted.gross) || approval.accepted.gross <= 0
        || approval.accepted.gross > candidate.targetGross + EPSILON || approval.accepted.gross > candidate.maxGross + EPSILON
        || Math.abs(approval.accepted.notionalUsd - approval.snapshot.account.equityUsd * approval.accepted.gross) > EPSILON) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_INCOMPATIBLE");
    if (approval.plan.accepted.some((row) => row.idempotencyKey === candidate.idempotencyKey && Math.abs(row.gross - approval.accepted.gross) > EPSILON)) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_PLAN_MISMATCH");
    if (digest({
        schema: approval.schema,
        cycleId: approval.cycleId,
        candidateId: approval.candidateId,
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        accepted: approval.accepted,
        plan: approval.plan,
        snapshot: approval.snapshot,
    }) !== approval.token) throw new Error("DYNAMIC_ENTRY_STRICT_APPROVAL_TOKEN_INVALID");
}
