/**
 * The minimum event shape needed by the research-only ordering boundary. The
 * optional aliases allow lifecycle fixtures and normalized candidate events to
 * share the same pure ordering function without changing the Task 1 contract.
 */
export interface DynamicOrderingEvent {
    readonly candidate_id?: string | null;
    readonly candidateId?: string | null;
    readonly event_id?: string | null;
    readonly eventId?: string | null;
    readonly timestamp?: number | null;
    readonly timestamp_ms?: number | null;
    readonly ts_ms?: number | null;
    readonly ts?: number | null;
    readonly signal_ts_ms?: number | null;
    readonly decision_ts_ms?: number | null;
    readonly event_seq?: number | null | "";
    readonly eventSeq?: number | null | "";
    readonly priority?: number | null;
    readonly rank?: number | null;
    readonly kind?: string | null;
    readonly event_kind?: string | null;
    readonly eventType?: string | null;
    readonly type?: string | null;
    readonly action?: string | null;
}

// DynamicCandidateEvent is structurally compatible with this optional-field
// boundary; keeping one shape also lets the comparator remain type-safe.
export type DynamicOrderingInput = DynamicOrderingEvent;

export type OrderingEvidence = "CANONICAL_ORDERING" | "NONCANONICAL_ORDERING";

export type OrderingEvidenceReason =
    | "INVALID_EVENT_SEQUENCE"
    | "DUPLICATE_EVENT_SEQUENCE"
    | "MISSING_EVENT_SEQUENCE"
    | "SAME_TIMESTAMP_ORDER_UNVERIFIABLE";

export interface OrderingEvidenceResult {
    readonly ordering: OrderingEvidence;
    readonly orderingEvidence: OrderingEvidence;
    readonly status: OrderingEvidence;
    readonly reasons: readonly OrderingEvidenceReason[];
    readonly formalParityEligible: boolean;
}

const EVENT_PHASE_ORDER: Readonly<Record<string, number>> = {
    DEPOSIT: 1,
    FUNDING: 1,
    PROTECTION_STOP: 2,
    STOP: 2,
    PREEMPTION_EXIT: 3,
    NORMAL_EXIT: 4,
    TAKE_PROFIT: 4,
    TIME_STOP: 4,
    EXECUTION_RECONCILIATION: 5,
    PARTIAL_FILL: 5,
    RESERVATION_RELEASE: 6,
    COOLDOWN_UPDATE: 7,
    OWNERSHIP_UPDATE: 7,
    CANDIDATE_VALIDATION: 8,
    CANDIDATE_PRIORITY: 9,
    PREEMPTION_ELIGIBILITY: 10,
    SIZING: 11,
    RESERVATION: 12,
    ENTRY: 12,
    ENTRY_FILL: 13,
    PROTECTION_REGISTRATION: 14,
    STATE_HASH: 15,
};

const STOP_KINDS = new Set(["PROTECTION_STOP", "STOP", "PROTECTIVE_STOP"]);
const ENTRY_KINDS = new Set(["ENTRY", "ENTRY_FILL", "CANDIDATE", "CANDIDATE_ENTRY"]);

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstFinite(...values: readonly unknown[]): number | null {
    for (const value of values) {
        const number = finiteNumber(value);
        if (number !== null) return number;
    }
    return null;
}

function firstText(...values: readonly unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string" && value.length > 0) return value;
    }
    return null;
}

function timestampOf(event: DynamicOrderingInput): number {
    return firstFinite(
        event.timestamp,
        event.timestamp_ms,
        event.ts_ms,
        event.ts,
        event.decision_ts_ms,
        event.signal_ts_ms,
    ) ?? Number.POSITIVE_INFINITY;
}

type EventSequenceStatus = "missing" | "valid" | "invalid";

interface EventSequenceResult {
    readonly status: EventSequenceStatus;
    readonly value: number | null;
}

function sequenceOf(event: DynamicOrderingInput): number | null {
    return sequenceResult(event).value;
}

function sequenceResult(event: DynamicOrderingInput): EventSequenceResult {
    const eventSeq: unknown = event.event_seq;
    const raw: unknown = eventSeq === undefined || eventSeq === null || eventSeq === "" ? event.eventSeq : eventSeq;
    if (raw === undefined || raw === null || raw === "") return { status: "missing", value: null };
    if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return { status: "valid", value: raw };
    return { status: "invalid", value: null };
}

function priorityOf(event: DynamicOrderingInput): number | null {
    return firstFinite(event.priority);
}

function rankOf(event: DynamicOrderingInput): number | null {
    return firstFinite(event.rank);
}

function kindOf(event: DynamicOrderingInput): string {
    return (firstText(event.kind, event.event_kind, event.eventType, event.type, event.action) ?? "ENTRY").toUpperCase();
}

function compareNullableNumber(left: number | null, right: number | null): number {
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
}

function stableValue(value: unknown): string {
    if (value === null || typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) return "null";
        if (typeof value === "number" && Object.is(value, -0)) return "0";
        return JSON.stringify(value) ?? "null";
    }
    if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(",")}}`;
}

function tieBreakKey(event: DynamicOrderingInput): string {
    return [
        firstText(event.candidate_id, event.candidateId) ?? "",
        firstText(event.event_id, event.eventId) ?? "",
        kindOf(event),
        stableValue(event),
    ].join("\u0000");
}

function compareCodeUnits(left: string, right: string): number {
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const difference = left.charCodeAt(index) - right.charCodeAt(index);
        if (difference !== 0) return difference;
    }
    return left.length - right.length;
}

function compareEvents(left: DynamicOrderingInput, right: DynamicOrderingInput): number {
    const timestampComparison = timestampOf(left) - timestampOf(right);
    if (timestampComparison !== 0) return timestampComparison;

    const leftSequence = sequenceOf(left);
    const rightSequence = sequenceOf(right);
    const sequenceComparison = compareNullableNumber(leftSequence, rightSequence);
    if (sequenceComparison !== 0) return sequenceComparison;

    const leftPhase = EVENT_PHASE_ORDER[kindOf(left)] ?? Number.MAX_SAFE_INTEGER;
    const rightPhase = EVENT_PHASE_ORDER[kindOf(right)] ?? Number.MAX_SAFE_INTEGER;
    if (leftPhase !== rightPhase) return leftPhase - rightPhase;

    const priorityComparison = compareNullableNumber(priorityOf(left), priorityOf(right));
    if (priorityComparison !== 0) return priorityComparison;

    const rankComparison = compareNullableNumber(rankOf(left), rankOf(right));
    if (rankComparison !== 0) return rankComparison;

    return compareCodeUnits(tieBreakKey(left), tieBreakKey(right));
}

/**
 * Orders a copy of the input. No event is mutated and no source order is
 * treated as evidence when the explicit sequence is absent.
 */
export function orderDynamicEvents<T extends DynamicOrderingInput>(events: readonly T[]): T[] {
    return events.map((event) => event).sort(compareEvents);
}

function hasStopEntryPair(events: readonly DynamicOrderingInput[]): boolean {
    const byTimestamp = new Map<number, DynamicOrderingInput[]>();
    for (const event of events) {
        const timestamp = timestampOf(event);
        if (!Number.isFinite(timestamp)) continue;
        const group = byTimestamp.get(timestamp) ?? [];
        group.push(event);
        byTimestamp.set(timestamp, group);
    }

    for (const group of byTimestamp.values()) {
        const hasStop = group.some((event) => STOP_KINDS.has(kindOf(event)));
        const hasEntry = group.some((event) => ENTRY_KINDS.has(kindOf(event)));
        if (!hasStop || !hasEntry) continue;
        if (group.some((event) => sequenceResult(event).status !== "valid")) return true;
    }
    return false;
}

function hasDuplicateSequenceInTimestampStream(events: readonly DynamicOrderingInput[]): boolean {
    const byTimestamp = new Map<number, Set<number>>();
    for (const event of events) {
        const timestamp = timestampOf(event);
        const sequence = sequenceResult(event);
        if (!Number.isFinite(timestamp) || sequence.status !== "valid" || sequence.value === null) continue;
        const sequences = byTimestamp.get(timestamp) ?? new Set<number>();
        if (sequences.has(sequence.value)) return true;
        sequences.add(sequence.value);
        byTimestamp.set(timestamp, sequences);
    }
    return false;
}

/**
 * Classifies whether the input order has production-grade evidence. A
 * deterministic fallback is deliberately still noncanonical.
 */
export function classifyOrderingEvidence(events: readonly DynamicOrderingInput[]): OrderingEvidenceResult {
    const reasons: OrderingEvidenceReason[] = [];
    if (events.some((event) => sequenceResult(event).status === "invalid")) reasons.push("INVALID_EVENT_SEQUENCE");
    if (hasDuplicateSequenceInTimestampStream(events)) reasons.push("DUPLICATE_EVENT_SEQUENCE");
    if (events.some((event) => sequenceResult(event).status === "missing")) reasons.push("MISSING_EVENT_SEQUENCE");
    if (hasStopEntryPair(events)) reasons.push("SAME_TIMESTAMP_ORDER_UNVERIFIABLE");

    const ordering: OrderingEvidence = reasons.length === 0 ? "CANONICAL_ORDERING" : "NONCANONICAL_ORDERING";
    return {
        ordering,
        orderingEvidence: ordering,
        status: ordering,
        reasons,
        formalParityEligible: ordering === "CANONICAL_ORDERING",
    };
}
