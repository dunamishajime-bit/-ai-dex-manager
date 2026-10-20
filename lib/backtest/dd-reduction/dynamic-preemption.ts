import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { classifyOrderingEvidence, type DynamicOrderingInput, type OrderingEvidence } from "./dynamic-ordering";
import {
    createInitialAllocatorState,
    decideCandidate,
    releaseReservation,
    type AllocationRejectionReason,
    type DynamicAllocatorCandidate,
    type DynamicAllocatorPolicy,
    type DynamicAllocatorState,
    type OwnershipStatus,
    type ReservationStatus,
} from "./dynamic-allocator";
import { hashAllocatorState } from "./dynamic-state";
import type { CandidateSide, DynamicStrategyId } from "./dynamic-types";

export type PreemptionMode = "WHOLE" | "PARTIAL";
export type PreemptionExitStatus = "FILLED" | "PARTIAL" | "UNKNOWN";

export type PreemptionReason =
    | "DATA_MISSING"
    | "VICTIM_NOT_OPEN"
    | "VICTIM_PROTECTED"
    | "VICTIM_ALREADY_EXITED"
    | "VICTIM_IDENTITY_MISMATCH"
    | "INCOMING_PRIORITY_LOST"
    | "INVALID_GROSS"
    | "PARTIAL_EXECUTION_UNSUPPORTED"
    | "UNKNOWN_EXECUTION"
    | "NONCANONICAL_ORDERING"
    | "DUPLICATE_RELEASE"
    | "DUPLICATE_EXIT_OR_RELEASE"
    | "EXIT_CONFIRMATION_REQUIRED"
    | "TEMPORAL_ORDER_INVALID"
    | "RELEASE_FAILED"
    | "INCOMING_REJECTED";

export type DynamicPreemptionCandidate = DynamicAllocatorCandidate;

export interface DynamicPreemptionPosition {
    readonly position_id: string;
    readonly reservation_id: string;
    readonly candidate_id: string;
    readonly strategy_id: DynamicStrategyId;
    readonly symbol: string;
    readonly side: CandidateSide;
    readonly gross: number;
    readonly quantity: number;
    readonly entry_price: number;
    readonly priority: number;
    readonly status?: OwnershipStatus | ReservationStatus | "OPEN" | "CLOSED";
    readonly protected?: boolean;
    readonly protection_verified?: boolean;
    readonly protection_id?: string | null;
    readonly opened_ts_ms?: number;
}

export interface PreemptionEligibilityInput {
    readonly incoming_candidate: DynamicPreemptionCandidate;
    readonly victim_position: DynamicPreemptionPosition;
    readonly allocator_state?: DynamicAllocatorState;
    readonly mode: PreemptionMode;
    readonly requested_gross?: number;
    readonly exit_ts_ms: number;
    readonly exit_status?: PreemptionExitStatus;
    readonly ordering_events?: readonly DynamicOrderingInput[];
    readonly ordering_evidence?: OrderingEvidence;
    readonly same_timestamp_order_unverifiable?: boolean;
}

export interface PreemptionEligibilityResult {
    readonly eligible: boolean;
    readonly reason: PreemptionReason | null;
    readonly mode: PreemptionMode;
    readonly incoming_candidate_id: string | null;
    readonly victim_position_id: string | null;
    readonly victim_strategy_id: DynamicStrategyId | null;
    readonly victim_symbol: string | null;
    readonly victim_side: CandidateSide | null;
    readonly requested_gross: number;
    readonly releasable_gross: number;
    readonly released_gross: number;
    readonly ordering_evidence: OrderingEvidence;
}

export interface PreemptionExitConfirmation {
    readonly status: PreemptionExitStatus;
    readonly confirmed: boolean;
    readonly filled_gross: number;
    readonly exit_ts_ms: number;
    readonly exit_price?: number;
    readonly exit_cost?: number;
}

export interface PreemptionCooldown {
    readonly until_ts_ms?: number | null;
    readonly source_event_ts_ms?: number | null;
}

export interface ReleasePreemptionInput {
    readonly exit_ts_ms: number;
    readonly status: PreemptionExitStatus;
    readonly confirmed: boolean;
    readonly filled_gross: number;
    readonly cooldown?: PreemptionCooldown;
}

export interface PreemptionReleaseResult {
    readonly applied: boolean;
    readonly reason: PreemptionReason | null;
    readonly state_before: DynamicAllocatorState;
    readonly state_after: DynamicAllocatorState;
    readonly state_hash_before: string;
    readonly state_hash_after: string;
    readonly released_gross: number;
    readonly transition: string;
}

export interface ApplyPreemptionInput extends Omit<PreemptionEligibilityInput, "exit_ts_ms" | "exit_status"> {
    readonly state: DynamicAllocatorState;
    readonly exit: PreemptionExitConfirmation;
    readonly cooldown?: PreemptionCooldown;
    readonly policy: DynamicAllocatorPolicy;
}

export interface ApplyPreemptionResult {
    readonly applied: boolean;
    readonly reason: PreemptionReason | AllocationRejectionReason | null;
    readonly lifecycle: "VICTIM_EXIT_RELEASE_COOLDOWN_READMIT" | "VICTIM_RELEASED_INCOMING_REJECTED" | "REJECTED";
    readonly victim_release_applied: boolean;
    readonly state_before: DynamicAllocatorState;
    readonly state_after: DynamicAllocatorState;
    readonly state_hash_before: string;
    readonly state_hash_after: string;
    readonly ordering_evidence: OrderingEvidence;
    readonly exit_confirmation: PreemptionExitConfirmation | null;
    readonly gross_release: PreemptionReleaseResult | null;
    readonly incoming_admission: ReturnType<typeof decideCandidate> | null;
}

export interface HistoricalPreemptionProvenanceInput {
    readonly manifest_path: string | null | undefined;
    readonly manifest_sha256: string | null | undefined;
}

export interface HistoricalPreemptionObservationInput {
    readonly cost_bps: number;
    readonly observed_count: number | null | undefined;
    readonly source_path: string | null | undefined;
    readonly source_sha256: string | null | undefined;
    readonly provenance?: HistoricalPreemptionProvenanceInput | null;
}

export type HistoricalPreemptionObservationReason = "INVALID_COST_BPS" | "MISSING_PROVENANCE" | "OBSERVATION_MISSING" | "COUNT_MISMATCH" | "PROVENANCE_NOT_FOUND" | "PROVENANCE_MISMATCH";

export interface HistoricalPreemptionProvenanceResult {
    readonly manifest_path: string | null;
    readonly manifest_sha256: string | null;
    readonly source_verified: boolean;
    readonly manifest_verified: boolean;
    readonly verified: boolean;
}

export interface HistoricalPreemptionObservationResult {
    readonly status: "OBSERVED" | "UNSUPPORTED";
    readonly classification: "OBSERVATION_ONLY" | "UNSUPPORTED";
    readonly expected_count: number;
    readonly observed_count: number | null;
    readonly matches_expected: boolean;
    readonly formal_parity_eligible: false;
    readonly reason: HistoricalPreemptionObservationReason | null;
    readonly source_path: string | null;
    readonly source_sha256: string | null;
    readonly provenance: HistoricalPreemptionProvenanceResult;
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function candidateId(candidate: DynamicPreemptionCandidate): string | null {
    return text(candidate.candidate_id) ?? text(candidate.candidateId);
}

function candidatePriority(candidate: DynamicPreemptionCandidate): number | null {
    return finite(candidate.priority) ? candidate.priority : null;
}

function compareCodeUnits(left: string, right: string): number {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const difference = left.charCodeAt(index) - right.charCodeAt(index);
        if (difference !== 0) return difference;
    }
    return left.length - right.length;
}

function emptyResult(input: Partial<PreemptionEligibilityInput>, reason: PreemptionReason, orderingEvidence: OrderingEvidence = "CANONICAL_ORDERING"): PreemptionEligibilityResult {
    const victim = input.victim_position;
    return {
        eligible: false,
        reason,
        mode: input.mode === "PARTIAL" ? "PARTIAL" : "WHOLE",
        incoming_candidate_id: input.incoming_candidate ? candidateId(input.incoming_candidate) : null,
        victim_position_id: victim?.position_id ?? null,
        victim_strategy_id: victim?.strategy_id ?? null,
        victim_symbol: victim?.symbol ?? null,
        victim_side: victim?.side ?? null,
        requested_gross: finite(input.requested_gross) ? input.requested_gross : 0,
        releasable_gross: finite(input.requested_gross) ? input.requested_gross : 0,
        released_gross: 0,
        ordering_evidence: orderingEvidence,
    };
}

function reservationStatus(state: DynamicAllocatorState | undefined, reservationId: string): ReservationStatus | null {
    return state?.reservations.find((reservation) => reservation.reservation_id === reservationId)?.status ?? null;
}

function victimIdentityReason(state: DynamicAllocatorState, victim: DynamicPreemptionPosition): PreemptionReason | null {
    if (victim.status !== "OPEN") return "VICTIM_NOT_OPEN";
    const reservation = state.reservations.find((item) => item.reservation_id === victim.reservation_id);
    if (reservation === undefined) return "DATA_MISSING";
    if (reservation.status === "PROTECTED") return "VICTIM_PROTECTED";
    if (reservation.status === "RELEASED" || reservation.status === "EXPIRED") return "VICTIM_ALREADY_EXITED";
    if (reservation.status !== "FILLED") return "VICTIM_NOT_OPEN";
    const ownership = state.ownership.find((item) => item.reservation_id === victim.reservation_id);
    if (!finite(victim.gross) || victim.gross <= 0 || !finite(reservation.filled_gross) || reservation.filled_gross <= 0 || ownership === undefined || !finite(ownership.gross) || ownership.gross <= 0) return "DATA_MISSING";
    if (
        reservation.candidate_id !== victim.candidate_id ||
        reservation.strategy_id !== victim.strategy_id ||
        reservation.symbol !== victim.symbol ||
        reservation.side !== victim.side ||
        reservation.filled_gross !== victim.gross ||
        ownership === undefined ||
        ownership.status !== "OPEN" ||
        ownership.candidate_id !== victim.candidate_id ||
        ownership.strategy_id !== victim.strategy_id ||
        ownership.symbol !== victim.symbol ||
        ownership.side !== victim.side ||
        ownership.gross !== victim.gross
    ) return "VICTIM_IDENTITY_MISMATCH";
    return null;
}

function amountEqual(left: number, right: number): boolean {
    const tolerance = 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
    return Math.abs(left - right) <= tolerance;
}

function nonNegativeFinite(value: unknown): value is number {
    return finite(value) && value >= 0;
}

function recordValuesAreNonNegativeFinite(value: unknown): value is Readonly<Record<string, number>> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.values(value as Record<string, unknown>).every((item) => nonNegativeFinite(item));
}

function mapMatches(actual: Readonly<Record<string, number>>, expected: Readonly<Record<string, number>>): boolean {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) {
        if (!amountEqual(actual[key] ?? 0, expected[key] ?? 0)) return false;
    }
    return true;
}

function allocatorStateIntegrityReason(input: unknown): PreemptionReason | null {
    if (input === null || typeof input !== "object") return "DATA_MISSING";
    const state = input as Partial<DynamicAllocatorState>;
    const scalarFields = ["wallet_jpy", "equity_jpy", "available_margin", "total_gross", "crypto_gross", "pending_gross", "reserved_gross"] as const;
    if (scalarFields.some((field) => !nonNegativeFinite(state[field]))) return "DATA_MISSING";
    const mapFields = [
        "gross_by_strategy",
        "gross_by_symbol",
        "pending_gross_by_strategy",
        "pending_gross_by_symbol",
        "reserved_gross_by_strategy",
        "reserved_gross_by_symbol",
    ] as const;
    for (const field of mapFields) {
        if (!recordValuesAreNonNegativeFinite(state[field])) return "DATA_MISSING";
    }
    if (!Array.isArray(state.reservations) || !Array.isArray(state.reservation_ids) || !Array.isArray(state.ownership) || state.ownership_by_symbol === null || typeof state.ownership_by_symbol !== "object" || Array.isArray(state.ownership_by_symbol)) return "DATA_MISSING";

    const reservations = state.reservations;
    const reservationIds = reservations.map((reservation) => reservation?.reservation_id);
    if (reservationIds.some((id) => typeof id !== "string" || id.length === 0) || new Set(reservationIds).size !== reservationIds.length) return "DATA_MISSING";
    if (state.reservation_ids.length !== reservationIds.length || state.reservation_ids.some((id, index) => id !== reservationIds[index])) return "DATA_MISSING";
    const reservationById = new Map(reservations.map((reservation) => [reservation.reservation_id, reservation]));
    const expectedGrossByStrategy: Record<string, number> = {};
    const expectedGrossBySymbol: Record<string, number> = {};
    const expectedPendingByStrategy: Record<string, number> = {};
    const expectedPendingBySymbol: Record<string, number> = {};
    const expectedReservedByStrategy: Record<string, number> = {};
    const expectedReservedBySymbol: Record<string, number> = {};
    let expectedTotalGross = 0;
    let expectedCryptoGross = 0;
    let expectedPendingGross = 0;
    let expectedReservedGross = 0;
    for (const reservation of reservations) {
        if (reservation === null || typeof reservation !== "object") return "DATA_MISSING";
        if (![reservation.requested_gross, reservation.reserved_gross, reservation.pending_gross, reservation.filled_gross].every(nonNegativeFinite) || !finite(reservation.quantity) || reservation.quantity <= 0 || !finite(reservation.entry_price) || reservation.entry_price <= 0 || !finite(reservation.priority) || !finite(reservation.created_ts_ms) || !finite(reservation.expires_ts_ms)) return "DATA_MISSING";
        if (reservation.requested_gross <= 0 || reservation.reserved_gross > reservation.requested_gross || reservation.pending_gross > reservation.requested_gross || reservation.filled_gross > reservation.requested_gross) return "DATA_MISSING";
        if (reservation.asset_class !== "CRYPTO" && reservation.asset_class !== "NON_CRYPTO") return "DATA_MISSING";
        if (reservation.status === "PENDING") {
            if (!amountEqual(reservation.pending_gross, reservation.requested_gross) || !amountEqual(reservation.reserved_gross, reservation.requested_gross) || reservation.filled_gross !== 0 || reservation.fill_ts_ms !== null) return "DATA_MISSING";
        } else if (reservation.status === "FILLED" || reservation.status === "PROTECTED") {
            if (!amountEqual(reservation.filled_gross, reservation.requested_gross) || reservation.pending_gross !== 0 || reservation.reserved_gross !== 0 || !finite(reservation.fill_ts_ms)) return "DATA_MISSING";
        } else if (reservation.status === "RELEASED" || reservation.status === "EXPIRED") {
            if (reservation.pending_gross !== 0 || reservation.reserved_gross !== 0 || reservation.filled_gross !== 0) return "DATA_MISSING";
        } else {
            return "DATA_MISSING";
        }
        const active = reservation.status !== "RELEASED" && reservation.status !== "EXPIRED";
        if (!active) continue;
        expectedTotalGross += reservation.filled_gross;
        expectedPendingGross += reservation.pending_gross;
        expectedReservedGross += reservation.reserved_gross;
        if (reservation.asset_class === "CRYPTO") expectedCryptoGross += reservation.filled_gross;
        expectedGrossByStrategy[reservation.strategy_id] = (expectedGrossByStrategy[reservation.strategy_id] ?? 0) + reservation.filled_gross;
        expectedGrossBySymbol[reservation.symbol] = (expectedGrossBySymbol[reservation.symbol] ?? 0) + reservation.filled_gross;
        expectedPendingByStrategy[reservation.strategy_id] = (expectedPendingByStrategy[reservation.strategy_id] ?? 0) + reservation.pending_gross;
        expectedPendingBySymbol[reservation.symbol] = (expectedPendingBySymbol[reservation.symbol] ?? 0) + reservation.pending_gross;
        expectedReservedByStrategy[reservation.strategy_id] = (expectedReservedByStrategy[reservation.strategy_id] ?? 0) + reservation.reserved_gross;
        expectedReservedBySymbol[reservation.symbol] = (expectedReservedBySymbol[reservation.symbol] ?? 0) + reservation.reserved_gross;
    }
    const ownershipByReservation = new Map<string, DynamicAllocatorState["ownership"][number]>();
    for (const ownership of state.ownership) {
        if (ownership === null || typeof ownership !== "object" || typeof ownership.reservation_id !== "string" || !nonNegativeFinite(ownership.gross)) return "DATA_MISSING";
        if (ownershipByReservation.has(ownership.reservation_id)) return "DATA_MISSING";
        ownershipByReservation.set(ownership.reservation_id, ownership);
        const reservation = reservationById.get(ownership.reservation_id);
        if (reservation === undefined || ownership.candidate_id !== reservation.candidate_id || ownership.strategy_id !== reservation.strategy_id || ownership.symbol !== reservation.symbol || ownership.side !== reservation.side) return "DATA_MISSING";
        if (ownership.status === "RELEASED") {
            if (ownership.gross !== 0 || reservation.status !== "RELEASED" && reservation.status !== "EXPIRED") return "DATA_MISSING";
        } else if (ownership.status === "RESERVED") {
            if (reservation.status !== "PENDING" || !amountEqual(ownership.gross, reservation.pending_gross)) return "DATA_MISSING";
        } else if (ownership.status === "OPEN") {
            if ((reservation.status !== "FILLED" && reservation.status !== "PROTECTED") || !amountEqual(ownership.gross, reservation.filled_gross)) return "DATA_MISSING";
        } else {
            return "DATA_MISSING";
        }
    }
    for (const reservation of reservations) {
        const ownership = ownershipByReservation.get(reservation.reservation_id);
        if (ownership === undefined) return "DATA_MISSING";
    }
    const expectedOwnershipBySymbol: Record<string, string[]> = {};
    for (const ownership of state.ownership) {
        if (ownership.status === "RELEASED") continue;
        const ids = expectedOwnershipBySymbol[ownership.symbol] ?? [];
        ids.push(ownership.reservation_id);
        expectedOwnershipBySymbol[ownership.symbol] = ids.sort();
    }
    if (!Object.entries(state.ownership_by_symbol).every(([symbol, ids]) => Array.isArray(ids) && ids.every((id) => typeof id === "string")) || !Object.entries(expectedOwnershipBySymbol).every(([symbol, ids]) => JSON.stringify(state.ownership_by_symbol?.[symbol] ?? []) === JSON.stringify(ids)) || !Object.keys(state.ownership_by_symbol).every((symbol) => JSON.stringify(state.ownership_by_symbol?.[symbol] ?? []) === JSON.stringify(expectedOwnershipBySymbol[symbol] ?? []))) return "DATA_MISSING";
    if (!amountEqual(state.total_gross!, expectedTotalGross) || !amountEqual(state.crypto_gross!, expectedCryptoGross) || !amountEqual(state.pending_gross!, expectedPendingGross) || !amountEqual(state.reserved_gross!, expectedReservedGross)) return "DATA_MISSING";
    if (!mapMatches(state.gross_by_strategy!, expectedGrossByStrategy) || !mapMatches(state.gross_by_symbol!, expectedGrossBySymbol) || !mapMatches(state.pending_gross_by_strategy!, expectedPendingByStrategy) || !mapMatches(state.pending_gross_by_symbol!, expectedPendingBySymbol) || !mapMatches(state.reserved_gross_by_strategy!, expectedReservedByStrategy) || !mapMatches(state.reserved_gross_by_symbol!, expectedReservedBySymbol)) return "DATA_MISSING";
    if (state.available_margin! < state.pending_gross!) return "DATA_MISSING";
    return null;
}

function orderingFor(input: Pick<PreemptionEligibilityInput, "ordering_evidence" | "ordering_events" | "same_timestamp_order_unverifiable">): OrderingEvidence {
    if (input.ordering_events !== undefined) return classifyOrderingEvidence(input.ordering_events).ordering;
    if (input.ordering_evidence !== undefined) return input.ordering_evidence;
    return "NONCANONICAL_ORDERING";
}

function eventTimestamp(event: DynamicOrderingInput): number | null {
    const record = event as DynamicOrderingInput & { readonly timestamp?: number | null; readonly timestamp_ms?: number | null; readonly ts_ms?: number | null };
    for (const value of [record.timestamp, record.timestamp_ms, record.ts_ms, record.ts, record.decision_ts_ms, record.signal_ts_ms]) {
        if (finite(value)) return value;
    }
    return null;
}

function eventKind(event: DynamicOrderingInput): string {
    const record = event as DynamicOrderingInput & { readonly event_kind?: string | null; readonly eventType?: string | null; readonly type?: string | null; readonly action?: string | null };
    return (record.kind ?? record.event_kind ?? record.eventType ?? record.type ?? record.action ?? "").toUpperCase();
}

function eventSequence(event: DynamicOrderingInput): number | null {
    const record = event as DynamicOrderingInput & { readonly eventSeq?: number | null };
    const value = record.event_seq ?? record.eventSeq;
    return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function eventIdentity(event: DynamicOrderingInput): string | null {
    const record = event as DynamicOrderingInput & { readonly position_id?: string | null; readonly reservation_id?: string | null };
    return text(record.candidate_id) ?? text(record.candidateId) ?? text(record.position_id) ?? text(record.reservation_id);
}

function orderingReason(input: PreemptionEligibilityInput, incomingDecisionTs: number, exitTsMs: number): PreemptionReason | null {
    if (input.ordering_events !== undefined) {
        if (input.ordering_events.length === 0 || classifyOrderingEvidence(input.ordering_events).ordering !== "CANONICAL_ORDERING") return "NONCANONICAL_ORDERING";
        if (exitTsMs !== incomingDecisionTs) return null;
        if (input.ordering_events.length !== 2) return "NONCANONICAL_ORDERING";
        const exitEvents = input.ordering_events.filter((event) => eventKind(event) === "PREEMPTION_EXIT");
        const entryEvents = input.ordering_events.filter((event) => eventKind(event) === "ENTRY");
        if (exitEvents.length !== 1 || entryEvents.length !== 1) return "NONCANONICAL_ORDERING";
        const exitEvent = exitEvents[0];
        const entryEvent = entryEvents[0];
        if (eventTimestamp(exitEvent) !== exitTsMs || eventTimestamp(entryEvent) !== incomingDecisionTs) return "NONCANONICAL_ORDERING";
        const exitSequence = eventSequence(exitEvent);
        const entrySequence = eventSequence(entryEvent);
        if (exitSequence === null || entrySequence === null || exitSequence >= entrySequence || exitSequence === entrySequence) return "NONCANONICAL_ORDERING";
        if (eventIdentity(exitEvent) !== input.victim_position.candidate_id || eventIdentity(entryEvent) !== candidateId(input.incoming_candidate)) return "NONCANONICAL_ORDERING";
        return null;
    }
    if (input.ordering_evidence !== "CANONICAL_ORDERING" || exitTsMs === incomingDecisionTs) return "NONCANONICAL_ORDERING";
    return null;
}

/**
 * Checks only causal eligibility. It never releases gross or mutates allocator
 * state; lifecycle transitions belong to applyPreemption/releasePreemptionGross.
 */
export function eligiblePreemption(input: PreemptionEligibilityInput): PreemptionEligibilityResult;
export function eligiblePreemption(
    incoming_candidate: DynamicPreemptionCandidate,
    victim_position: DynamicPreemptionPosition,
    options: Omit<PreemptionEligibilityInput, "incoming_candidate" | "victim_position">,
): PreemptionEligibilityResult;
export function eligiblePreemption(
    inputOrIncoming: PreemptionEligibilityInput | DynamicPreemptionCandidate,
    positionalVictim?: DynamicPreemptionPosition,
    positionalOptions?: Omit<PreemptionEligibilityInput, "incoming_candidate" | "victim_position">,
): PreemptionEligibilityResult {
    const input: PreemptionEligibilityInput = positionalVictim === undefined
        ? inputOrIncoming as PreemptionEligibilityInput
        : { ...positionalOptions, incoming_candidate: inputOrIncoming as DynamicPreemptionCandidate, victim_position: positionalVictim } as PreemptionEligibilityInput;
    const orderingEvidence = orderingFor(input);
    if (input.mode !== "WHOLE" && input.mode !== "PARTIAL") return emptyResult(input, "DATA_MISSING", orderingEvidence);
    if (!finite(input.exit_ts_ms) || !finite(input.victim_position?.gross) || input.victim_position.gross <= 0) return emptyResult(input, "DATA_MISSING", orderingEvidence);
    if (!text(input.victim_position.position_id) || !text(input.victim_position.reservation_id) || !text(input.victim_position.candidate_id)) return emptyResult(input, "DATA_MISSING", orderingEvidence);
    if (input.victim_position.status !== "OPEN") return emptyResult(input, "VICTIM_NOT_OPEN", orderingEvidence);
    if (input.allocator_state !== undefined) {
        const identityReason = victimIdentityReason(createInitialAllocatorState(input.allocator_state), input.victim_position);
        if (identityReason !== null) return emptyResult(input, identityReason, orderingEvidence);
    }
    if (input.victim_position.protected === true || input.victim_position.protection_verified === true || input.victim_position.protection_id !== undefined && input.victim_position.protection_id !== null) {
        return emptyResult(input, "VICTIM_PROTECTED", orderingEvidence);
    }
    const allocatorStatus = reservationStatus(input.allocator_state, input.victim_position.reservation_id);
    if (allocatorStatus === "PROTECTED") return emptyResult(input, "VICTIM_PROTECTED", orderingEvidence);
    if (allocatorStatus === "RELEASED" || allocatorStatus === "EXPIRED") return emptyResult(input, "VICTIM_ALREADY_EXITED", orderingEvidence);
    if (input.exit_status === "UNKNOWN") return emptyResult(input, "UNKNOWN_EXECUTION", orderingEvidence);
    const incomingDecisionTs = input.incoming_candidate.decision_ts_ms ?? input.incoming_candidate.decisionTsMs ?? input.incoming_candidate.ts;
    if (!finite(incomingDecisionTs) || input.exit_ts_ms > incomingDecisionTs) return emptyResult(input, "TEMPORAL_ORDER_INVALID", orderingEvidence);
    const orderReason = orderingReason(input, incomingDecisionTs, input.exit_ts_ms);
    if (orderReason !== null) return emptyResult(input, orderReason, orderingEvidence);
    const incomingId = candidateId(input.incoming_candidate);
    const incomingPriority = candidatePriority(input.incoming_candidate);
    if (incomingId === null || incomingPriority === null || !finite(input.victim_position.priority)) return emptyResult(input, "DATA_MISSING", orderingEvidence);
    const victimId = input.victim_position.candidate_id;
    if (incomingPriority > input.victim_position.priority || incomingPriority === input.victim_position.priority && compareCodeUnits(incomingId, victimId) >= 0) {
        return emptyResult(input, "INCOMING_PRIORITY_LOST", orderingEvidence);
    }
    const requestedGross = input.requested_gross ?? input.victim_position.gross;
    if (!finite(requestedGross) || requestedGross <= 0 || requestedGross > input.victim_position.gross) return emptyResult(input, "INVALID_GROSS", orderingEvidence);
    if (input.mode === "WHOLE" && requestedGross !== input.victim_position.gross) return emptyResult(input, "INVALID_GROSS", orderingEvidence);
    if (input.mode === "PARTIAL" && requestedGross >= input.victim_position.gross) return emptyResult(input, "INVALID_GROSS", orderingEvidence);
    return {
        eligible: true,
        reason: null,
        mode: input.mode,
        incoming_candidate_id: incomingId,
        victim_position_id: input.victim_position.position_id,
        victim_strategy_id: input.victim_position.strategy_id,
        victim_symbol: input.victim_position.symbol,
        victim_side: input.victim_position.side,
        requested_gross: requestedGross,
        releasable_gross: requestedGross,
        released_gross: 0,
        ordering_evidence: orderingEvidence,
    };
}

function releaseResult(state: DynamicAllocatorState, after: DynamicAllocatorState, applied: boolean, reason: PreemptionReason | null, gross: number, transition: string): PreemptionReleaseResult {
    return {
        applied,
        reason,
        state_before: state,
        state_after: after,
        state_hash_before: hashAllocatorState(state),
        state_hash_after: hashAllocatorState(after),
        released_gross: applied ? gross : 0,
        transition,
    };
}

/** Releases the complete filled victim reservation through the Task 3 reducer. */
export function releasePreemptionGross(
    state: DynamicAllocatorState,
    victim: DynamicPreemptionPosition,
    exit: ReleasePreemptionInput,
): PreemptionReleaseResult {
    const rawIntegrityReason = allocatorStateIntegrityReason(state);
    if (rawIntegrityReason !== null) {
        const safeBaseline = createInitialAllocatorState();
        return releaseResult(safeBaseline, safeBaseline, false, rawIntegrityReason, 0, "RELEASE_REJECTED");
    }
    const before = createInitialAllocatorState(state);
    const reservation = before.reservations.find((item) => item.reservation_id === victim.reservation_id);
    if (reservation === undefined) return releaseResult(before, before, false, "DATA_MISSING", 0, "RELEASE_REJECTED");
    if (reservation.status === "RELEASED" || reservation.status === "EXPIRED") return releaseResult(before, before, false, "DUPLICATE_RELEASE", 0, "RELEASE_REJECTED");
    const identityReason = victimIdentityReason(before, victim);
    if (identityReason !== null) return releaseResult(before, before, false, identityReason, 0, "RELEASE_REJECTED");
    if (exit.status === "UNKNOWN") return releaseResult(before, before, false, "UNKNOWN_EXECUTION", 0, "RELEASE_REJECTED");
    if (!finite(exit.filled_gross) || exit.filled_gross <= 0) return releaseResult(before, before, false, "DATA_MISSING", 0, "RELEASE_REJECTED");
    if (exit.status === "PARTIAL" || exit.filled_gross !== reservation.filled_gross || exit.filled_gross !== victim.gross) {
        return releaseResult(before, before, false, "PARTIAL_EXECUTION_UNSUPPORTED", 0, "RELEASE_REJECTED");
    }
    if (exit.confirmed !== true || !finite(exit.exit_ts_ms) || exit.exit_ts_ms < (reservation.fill_ts_ms ?? reservation.created_ts_ms)) {
        return releaseResult(before, before, false, "EXIT_CONFIRMATION_REQUIRED", 0, "RELEASE_REJECTED");
    }
    const cooldown = exit.cooldown;
    const transition = releaseReservation(before, victim.reservation_id, {
        at_ts_ms: exit.exit_ts_ms,
        reason: "PREEMPTION",
        cooldown_until_ts_ms: cooldown?.until_ts_ms,
        cooldown_source_event_ts_ms: cooldown?.source_event_ts_ms,
    });
    if (!transition.applied) {
        const reason = transition.reason === "RESERVATION_ALREADY_RELEASED" ? "DUPLICATE_RELEASE" : "RELEASE_FAILED";
        return releaseResult(before, before, false, reason, 0, transition.transition);
    }
    return releaseResult(before, transition.state_after, true, null, exit.filled_gross, transition.transition);
}

function rejectedApply(state: DynamicAllocatorState, reason: PreemptionReason | AllocationRejectionReason, orderingEvidence: OrderingEvidence): ApplyPreemptionResult {
    const before = createInitialAllocatorState(state);
    return {
        applied: false,
        reason,
        lifecycle: "REJECTED",
        state_before: before,
        state_after: before,
        state_hash_before: hashAllocatorState(before),
        state_hash_after: hashAllocatorState(before),
        ordering_evidence: orderingEvidence,
        victim_release_applied: false,
        exit_confirmation: null,
        gross_release: null,
        incoming_admission: null,
    };
}

/** Applies the causal whole-victim lifecycle; partial/unknown exits remain fail-closed. */
export function applyPreemption(input: ApplyPreemptionInput): ApplyPreemptionResult {
    const rawIntegrityReason = allocatorStateIntegrityReason(input.state);
    if (rawIntegrityReason !== null) return rejectedApply(createInitialAllocatorState(), rawIntegrityReason, orderingFor(input));
    const before = createInitialAllocatorState(input.state);
    const orderingEvidence = orderingFor(input);
    const existing = before.reservations.find((reservation) => reservation.reservation_id === input.victim_position.reservation_id);
    if (existing?.status === "RELEASED" || existing?.status === "EXPIRED") return rejectedApply(before, "DUPLICATE_EXIT_OR_RELEASE", orderingEvidence);
    const eligible = eligiblePreemption({ ...input, allocator_state: before, exit_ts_ms: input.exit.exit_ts_ms, exit_status: input.exit.status });
    if (!eligible.eligible) return rejectedApply(before, eligible.reason ?? "DATA_MISSING", eligible.ordering_evidence);
    if (input.mode === "PARTIAL") return rejectedApply(before, "PARTIAL_EXECUTION_UNSUPPORTED", eligible.ordering_evidence);
    if (input.exit.status !== "FILLED" || input.exit.confirmed !== true) return rejectedApply(before, "EXIT_CONFIRMATION_REQUIRED", eligible.ordering_evidence);
    const grossRelease = releasePreemptionGross(before, input.victim_position, {
        ...input.exit,
        cooldown: input.cooldown,
    });
    if (!grossRelease.applied) return rejectedApply(before, grossRelease.reason ?? "RELEASE_FAILED", eligible.ordering_evidence);
    const admission = decideCandidate(grossRelease.state_after, input.incoming_candidate, input.policy);
    if (!admission.accepted) {
        return {
            applied: false,
            reason: admission.reason ?? "INCOMING_REJECTED",
            state_before: before,
            state_after: grossRelease.state_after,
            state_hash_before: hashAllocatorState(before),
            state_hash_after: hashAllocatorState(grossRelease.state_after),
            ordering_evidence: eligible.ordering_evidence,
            victim_release_applied: true,
            lifecycle: "VICTIM_RELEASED_INCOMING_REJECTED",
            exit_confirmation: input.exit,
            gross_release: grossRelease,
            incoming_admission: admission,
        };
    }
    return {
        applied: true,
        reason: null,
        lifecycle: "VICTIM_EXIT_RELEASE_COOLDOWN_READMIT",
        state_before: before,
        state_after: admission.state_after,
        state_hash_before: hashAllocatorState(before),
        state_hash_after: hashAllocatorState(admission.state_after),
        ordering_evidence: eligible.ordering_evidence,
        victim_release_applied: true,
        exit_confirmation: input.exit,
        gross_release: grossRelease,
        incoming_admission: admission,
    };
}

/** Records historical counts as provenance-bound observations, never parity evidence. */
export function observeHistoricalPreemptionCount(input: HistoricalPreemptionObservationInput): HistoricalPreemptionObservationResult {
    const expectedCount = input.cost_bps === 10 ? 123 : input.cost_bps === 30 ? 125 : null;
    const observedCount = typeof input.observed_count === "number" && Number.isInteger(input.observed_count) && input.observed_count >= 0 ? input.observed_count : null;
    const provenance = input.provenance;
    const provenanceResult = { manifest_path: provenance?.manifest_path ?? null, manifest_sha256: provenance?.manifest_sha256 ?? null, source_verified: false, manifest_verified: false, verified: false };
    const base = (status: "OBSERVED" | "UNSUPPORTED", classification: "OBSERVATION_ONLY" | "UNSUPPORTED", reason: HistoricalPreemptionObservationReason | null, matchesExpected: boolean): HistoricalPreemptionObservationResult => ({ status, classification, expected_count: expectedCount ?? 0, observed_count: observedCount, matches_expected: matchesExpected, formal_parity_eligible: false, reason, source_path: input.source_path ?? null, source_sha256: input.source_sha256 ?? null, provenance: provenanceResult });
    if (expectedCount === null) return base("UNSUPPORTED", "UNSUPPORTED", "INVALID_COST_BPS", false);
    if (typeof input.source_path !== "string" || input.source_path.trim().length === 0 || typeof input.source_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.source_sha256) || provenance === null || provenance === undefined || typeof provenance.manifest_path !== "string" || provenance.manifest_path.trim().length === 0 || typeof provenance.manifest_sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(provenance.manifest_sha256)) return base("UNSUPPORTED", "UNSUPPORTED", "MISSING_PROVENANCE", false);
    const digest = (pathValue: string): string | null => {
        try {
            const absolute = isAbsolute(pathValue) ? pathValue : resolve(process.cwd(), pathValue);
            if (!statSync(absolute).isFile()) return null;
            return createHash("sha256").update(readFileSync(absolute)).digest("hex");
        } catch {
            return null;
        }
    };
    const sourceDigest = digest(input.source_path);
    const manifestDigest = digest(provenance.manifest_path);
    provenanceResult.source_verified = sourceDigest !== null && sourceDigest.toLowerCase() === input.source_sha256.toLowerCase();
    provenanceResult.manifest_verified = manifestDigest !== null && manifestDigest.toLowerCase() === provenance.manifest_sha256.toLowerCase();
    provenanceResult.verified = provenanceResult.source_verified && provenanceResult.manifest_verified;
    if (sourceDigest === null || manifestDigest === null) return base("UNSUPPORTED", "UNSUPPORTED", "PROVENANCE_NOT_FOUND", false);
    if (!provenanceResult.verified) return base("UNSUPPORTED", "UNSUPPORTED", "PROVENANCE_MISMATCH", false);
    if (observedCount === null) {
        return base("UNSUPPORTED", "UNSUPPORTED", "OBSERVATION_MISSING", false);
    }
    if (observedCount !== expectedCount) {
        return base("UNSUPPORTED", "UNSUPPORTED", "COUNT_MISMATCH", false);
    }
    return base("OBSERVED", "OBSERVATION_ONLY", null, true);
}

