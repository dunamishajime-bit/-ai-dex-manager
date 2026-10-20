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

export interface HistoricalPreemptionObservationInput {
    readonly cost_bps: 10 | 30;
    readonly observed_count: number | null | undefined;
    readonly source_path: string | null | undefined;
    readonly source_sha256: string | null | undefined;
}

export type HistoricalPreemptionObservationReason = "MISSING_PROVENANCE" | "OBSERVATION_MISSING" | "COUNT_MISMATCH";

export interface HistoricalPreemptionObservationResult {
    readonly status: "OBSERVED" | "UNSUPPORTED";
    readonly classification: "OBSERVATION_ONLY" | "UNSUPPORTED";
    readonly expected_count: number;
    readonly observed_count: number | null;
    readonly matches_expected: boolean;
    readonly formal_parity_eligible: false;
    readonly reason: HistoricalPreemptionObservationReason | null;
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

function orderingFor(input: Pick<PreemptionEligibilityInput, "ordering_evidence" | "ordering_events" | "same_timestamp_order_unverifiable">): OrderingEvidence {
    if (input.ordering_events !== undefined) return classifyOrderingEvidence(input.ordering_events).ordering;
    if (input.ordering_evidence !== undefined) return input.ordering_evidence;
    return "NONCANONICAL_ORDERING";
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
    if (orderingEvidence !== "CANONICAL_ORDERING") return emptyResult(input, "NONCANONICAL_ORDERING", orderingEvidence);
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
    if (input.exit_ts_ms === incomingDecisionTs && input.ordering_events === undefined) return emptyResult(input, "NONCANONICAL_ORDERING", orderingEvidence);
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
    const before = createInitialAllocatorState(state);
    const reservation = before.reservations.find((item) => item.reservation_id === victim.reservation_id);
    if (reservation === undefined) return releaseResult(before, before, false, "DATA_MISSING", 0, "RELEASE_REJECTED");
    if (reservation.status === "RELEASED" || reservation.status === "EXPIRED") return releaseResult(before, before, false, "DUPLICATE_RELEASE", 0, "RELEASE_REJECTED");
    const identityReason = victimIdentityReason(before, victim);
    if (identityReason !== null) return releaseResult(before, before, false, identityReason, 0, "RELEASE_REJECTED");
    if (exit.status === "UNKNOWN") return releaseResult(before, before, false, "UNKNOWN_EXECUTION", 0, "RELEASE_REJECTED");
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
    const expectedCount = input.cost_bps === 10 ? 123 : 125;
    const observedCount = typeof input.observed_count === "number" && Number.isInteger(input.observed_count) && input.observed_count >= 0 ? input.observed_count : null;
    const provenanceUsable = typeof input.source_path === "string" && input.source_path.trim().length > 0 && typeof input.source_sha256 === "string" && /^[a-f0-9]{64}$/i.test(input.source_sha256);
    if (!provenanceUsable) {
        return { status: "UNSUPPORTED", classification: "UNSUPPORTED", expected_count: expectedCount, observed_count: observedCount, matches_expected: false, formal_parity_eligible: false, reason: "MISSING_PROVENANCE" };
    }
    if (observedCount === null) {
        return { status: "UNSUPPORTED", classification: "UNSUPPORTED", expected_count: expectedCount, observed_count: null, matches_expected: false, formal_parity_eligible: false, reason: "OBSERVATION_MISSING" };
    }
    if (observedCount !== expectedCount) {
        return { status: "UNSUPPORTED", classification: "UNSUPPORTED", expected_count: expectedCount, observed_count: observedCount, matches_expected: false, formal_parity_eligible: false, reason: "COUNT_MISMATCH" };
    }
    return { status: "OBSERVED", classification: "OBSERVATION_ONLY", expected_count: expectedCount, observed_count: observedCount, matches_expected: true, formal_parity_eligible: false, reason: null };
}

