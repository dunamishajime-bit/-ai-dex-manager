import { isCooldownActiveAt } from "./dynamic-state";
import {
    DYNAMIC_STRATEGY_IDS,
    type CandidateSide,
    type DynamicStrategyId,
    type EvidenceLevel,
} from "./dynamic-types";
import { hashAllocatorState } from "./dynamic-state";

export type AllocationRejectionReason =
    | "DATA_MISSING"
    | "ENTRY_EXPIRED"
    | "SAME_SYMBOL_OWNERSHIP"
    | "OPPOSITE_SIDE_CONFLICT"
    | "COOLDOWN_ACTIVE"
    | "GROSS_CAP_TOTAL"
    | "GROSS_CAP_CRYPTO"
    | "GROSS_CAP_STRATEGY"
    | "GROSS_CAP_SYMBOL"
    | "PENDING_GROSS"
    | "RESERVED_GROSS"
    | "MARGIN_UNAVAILABLE"
    | "MIN_QTY"
    | "MIN_NOTIONAL"
    | "PROTECTION_UNVERIFIABLE"
    | "RESERVATION_SINGLE_USE"
    | "RESERVATION_ALREADY_FILLED"
    | "RESERVATION_ALREADY_RELEASED"
    | "RESERVATION_NOT_EXPIRED"
    | "RESERVATION_NOT_PENDING"
    | "FILL_GROSS_MISMATCH"
    | "PROTECTION_NOT_READY";

export type ReservationStatus = "PENDING" | "PARTIALLY_FILLED" | "FILLED" | "PROTECTED" | "RELEASED" | "EXPIRED";
export type OwnershipStatus = "RESERVED" | "OPEN" | "RELEASED";

export interface DynamicAllocatorCandidate {
    readonly candidate_id?: string | null;
    readonly candidateId?: string | null;
    readonly strategy_id?: DynamicStrategyId | string | null;
    readonly strategy?: DynamicStrategyId | string | null;
    readonly symbol?: string | null;
    readonly side?: CandidateSide | string | null;
    readonly decision_ts_ms?: number | null;
    readonly decisionTsMs?: number | null;
    readonly ts?: number | null;
    readonly signal_ts_ms?: number | null;
    readonly entry_valid_until_ms?: number | null;
    readonly entryValidUntilMs?: number | null;
    readonly requested_gross?: number | null;
    readonly requestedGross?: number | null;
    readonly worst_case_gross?: number | null;
    readonly quantity?: number | null;
    readonly qty?: number | null;
    readonly entry_price?: number | null;
    readonly entryPrice?: number | null;
    readonly price?: number | null;
    readonly priority?: number | null;
    readonly rank?: number | null;
    readonly evidence_level?: EvidenceLevel | string | null;
    readonly source_sha?: string | null;
    readonly sourceSha?: string | null;
    readonly evidence?: {
        readonly level?: EvidenceLevel | string | null;
        readonly sourceKind?: string | null;
        readonly sourcePath?: string | null;
        readonly sourceSha256?: string | null;
        readonly rowNumber?: number | null;
        readonly sourceBytes?: number | null;
        readonly source_kind?: string | null;
        readonly source_path?: string | null;
        readonly source_sha256?: string | null;
        readonly row_number?: number | null;
        readonly source_bytes?: number | null;
    } | null;
    readonly validity?: "VALID" | "INVALID" | "UNKNOWN" | string | null;
    readonly asset_class?: "CRYPTO" | "NON_CRYPTO" | string | null;
    readonly assetClass?: "CRYPTO" | "NON_CRYPTO" | string | null;
    readonly protection_verified?: boolean | null;
    readonly protectionVerified?: boolean | null;
}

export interface DynamicAllocatorPolicy {
    readonly total_gross_cap?: number;
    readonly crypto_gross_cap?: number;
    readonly strategy_gross_caps?: Readonly<Record<string, number>>;
    readonly symbol_gross_caps?: Readonly<Record<string, number>>;
    readonly pending_gross_cap?: number;
    readonly reserved_gross_cap?: number;
    readonly reservation_ttl_ms?: number;
    readonly min_qty?: number;
    readonly min_notional?: number;
    readonly require_protection?: boolean;

    /** Compatibility aliases for callers that use max_* terminology. */
    readonly max_total_gross?: number;
    readonly max_crypto_gross?: number;
    readonly max_gross_by_strategy?: Readonly<Record<string, number>>;
    readonly max_gross_by_symbol?: Readonly<Record<string, number>>;
    readonly max_pending_gross?: number;
    readonly max_reserved_gross?: number;
    readonly reservation_ttl_ms_default?: number;
    readonly minQty?: number;
    readonly minNotional?: number;
}

export interface CooldownRecord {
    readonly until_ts_ms: number | null;
    readonly source_event_ts_ms: number | null;
    readonly reason: string;
}

export interface ReservationRecord {
    readonly reservation_id: string;
    readonly candidate_id: string;
    readonly strategy_id: DynamicStrategyId;
    readonly symbol: string;
    readonly side: CandidateSide;
    readonly asset_class: "CRYPTO" | "NON_CRYPTO";
    readonly requested_gross: number;
    readonly reserved_gross: number;
    readonly pending_gross: number;
    readonly filled_gross: number;
    readonly quantity: number;
    readonly entry_price: number;
    readonly priority: number;
    readonly created_ts_ms: number;
    readonly expires_ts_ms: number;
    readonly status: ReservationStatus;
    readonly fill_ts_ms: number | null;
    readonly protection_id: string | null;
    readonly released_ts_ms: number | null;
    readonly release_reason: string | null;
}

export interface OwnershipRecord {
    readonly reservation_id: string;
    readonly candidate_id: string;
    readonly strategy_id: DynamicStrategyId;
    readonly symbol: string;
    readonly side: CandidateSide;
    readonly priority: number;
    readonly gross: number;
    readonly status: OwnershipStatus;
}

export interface DynamicAllocatorState {
    readonly wallet_jpy: number;
    readonly equity_jpy: number;
    readonly available_margin: number;
    readonly total_gross: number;
    readonly crypto_gross: number;
    readonly gross_by_strategy: Readonly<Record<string, number>>;
    readonly gross_by_symbol: Readonly<Record<string, number>>;
    readonly pending_gross: number;
    readonly reserved_gross: number;
    readonly pending_gross_by_strategy: Readonly<Record<string, number>>;
    readonly pending_gross_by_symbol: Readonly<Record<string, number>>;
    readonly reserved_gross_by_strategy: Readonly<Record<string, number>>;
    readonly reserved_gross_by_symbol: Readonly<Record<string, number>>;
    readonly reservations: readonly ReservationRecord[];
    readonly reservation_ids: readonly string[];
    readonly ownership: readonly OwnershipRecord[];
    readonly ownership_by_symbol: Readonly<Record<string, readonly string[]>>;
    readonly cooldown_by_symbol_side_strategy: Readonly<Record<string, CooldownRecord>>;
}

export interface AllocationDecision {
    readonly accepted: boolean;
    readonly candidate_id: string | null;
    readonly reason: AllocationRejectionReason | null;
    readonly rejection_reason: AllocationRejectionReason | null;
    readonly reservation: ReservationRecord | null;
    readonly state_before: DynamicAllocatorState;
    readonly state_after: DynamicAllocatorState;
    readonly state_hash_before: string;
    readonly state_hash_after: string;
    readonly transition: "REJECTED" | "RESERVATION_CREATED";
}

export interface AllocationTransition {
    readonly applied: boolean;
    readonly reason: AllocationRejectionReason | null;
    readonly reservation: ReservationRecord | null;
    readonly state_before: DynamicAllocatorState;
    readonly state_after: DynamicAllocatorState;
    readonly state_hash_before: string;
    readonly state_hash_after: string;
    readonly transition: string;
}

export interface FillConfirmation {
    readonly fill_ts_ms: number;
    readonly filled_gross: number;
}

export interface ReleaseRequest {
    readonly at_ts_ms: number;
    readonly reason: string;
    readonly cooldown_until_ts_ms?: number | null;
    readonly cooldown_source_event_ts_ms?: number | null;
}

export interface ProtectionRegistration {
    readonly protection_id: string;
    readonly registered_ts_ms: number;
}

type MutableState = {
    wallet_jpy: number;
    equity_jpy: number;
    available_margin: number;
    total_gross: number;
    crypto_gross: number;
    gross_by_strategy: Record<string, number>;
    gross_by_symbol: Record<string, number>;
    pending_gross: number;
    reserved_gross: number;
    pending_gross_by_strategy: Record<string, number>;
    pending_gross_by_symbol: Record<string, number>;
    reserved_gross_by_strategy: Record<string, number>;
    reserved_gross_by_symbol: Record<string, number>;
    reservations: ReservationRecord[];
    reservation_ids: string[];
    ownership: OwnershipRecord[];
    ownership_by_symbol: Record<string, string[]>;
    cooldown_by_symbol_side_strategy: Record<string, CooldownRecord>;
};

function recordCopy(value: Readonly<Record<string, number>> | undefined): Record<string, number> {
    return { ...(value ?? {}) };
}

function cooldownCopy(value: Readonly<Record<string, CooldownRecord>> | undefined): Record<string, CooldownRecord> {
    return { ...(value ?? {}) };
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
        for (const key of Reflect.ownKeys(value)) {
            const child = (value as Record<PropertyKey, unknown>)[key];
            if (child !== null && typeof child === "object") deepFreeze(child);
        }
        Object.freeze(value);
    }
    return value;
}

function numeric(value: unknown, fallback = 0): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: unknown, fallback = 0): number {
    return Math.max(0, numeric(value, fallback));
}

function normalizeState(input: Partial<DynamicAllocatorState>): DynamicAllocatorState {
    const reservations = (input.reservations ?? []).map((reservation) => ({ ...reservation }));
    const ownership = (input.ownership ?? []).map((item) => ({ ...item }));
    const activeOwnership = ownership.filter((item) => item.status !== "RELEASED");
    const ownershipBySymbol: Record<string, string[]> = {};
    for (const item of activeOwnership) {
        const ids = ownershipBySymbol[item.symbol] ?? [];
        ids.push(item.reservation_id);
        ownershipBySymbol[item.symbol] = ids.sort();
    }
    const reservationIds = input.reservation_ids ?? reservations.map((reservation) => reservation.reservation_id);
    return {
        wallet_jpy: numeric(input.wallet_jpy),
        equity_jpy: numeric(input.equity_jpy),
        available_margin: nonNegative(input.available_margin),
        total_gross: nonNegative(input.total_gross),
        crypto_gross: nonNegative(input.crypto_gross),
        gross_by_strategy: recordCopy(input.gross_by_strategy),
        gross_by_symbol: recordCopy(input.gross_by_symbol),
        pending_gross: nonNegative(input.pending_gross),
        reserved_gross: nonNegative(input.reserved_gross),
        pending_gross_by_strategy: recordCopy(input.pending_gross_by_strategy),
        pending_gross_by_symbol: recordCopy(input.pending_gross_by_symbol),
        reserved_gross_by_strategy: recordCopy(input.reserved_gross_by_strategy),
        reserved_gross_by_symbol: recordCopy(input.reserved_gross_by_symbol),
        reservations,
        reservation_ids: [...reservationIds],
        ownership,
        ownership_by_symbol: ownershipBySymbol,
        cooldown_by_symbol_side_strategy: cooldownCopy(input.cooldown_by_symbol_side_strategy),
    };
}

export function createInitialAllocatorState(input: Partial<DynamicAllocatorState> = {}): DynamicAllocatorState {
    return deepFreeze(normalizeState(input));
}

function mutableState(input: DynamicAllocatorState | Partial<DynamicAllocatorState>): MutableState {
    const state = normalizeState(input);
    return {
        ...state,
        gross_by_strategy: recordCopy(state.gross_by_strategy),
        gross_by_symbol: recordCopy(state.gross_by_symbol),
        pending_gross_by_strategy: recordCopy(state.pending_gross_by_strategy),
        pending_gross_by_symbol: recordCopy(state.pending_gross_by_symbol),
        reserved_gross_by_strategy: recordCopy(state.reserved_gross_by_strategy),
        reserved_gross_by_symbol: recordCopy(state.reserved_gross_by_symbol),
        reservations: state.reservations.map((reservation) => ({ ...reservation })),
        reservation_ids: [...state.reservation_ids],
        ownership: state.ownership.map((item) => ({ ...item })),
        ownership_by_symbol: Object.fromEntries(Object.entries(state.ownership_by_symbol).map(([key, ids]) => [key, [...ids]])),
        cooldown_by_symbol_side_strategy: cooldownCopy(state.cooldown_by_symbol_side_strategy),
    };
}

function finalizedState(state: MutableState): DynamicAllocatorState {
    const ownershipBySymbol: Record<string, string[]> = {};
    for (const item of state.ownership) {
        if (item.status === "RELEASED") continue;
        const ids = ownershipBySymbol[item.symbol] ?? [];
        ids.push(item.reservation_id);
        ownershipBySymbol[item.symbol] = ids.sort();
    }
    state.ownership_by_symbol = ownershipBySymbol;
    state.reservation_ids = state.reservations.map((reservation) => reservation.reservation_id);
    return deepFreeze(state);
}

function keyFor(symbol: string, side: CandidateSide, strategy: DynamicStrategyId): string {
    return `${symbol}|${side}|${strategy}`;
}

export function cooldownKey(symbol: string, side: CandidateSide, strategy: DynamicStrategyId): string {
    return keyFor(symbol, side, strategy);
}

function candidateText(candidate: DynamicAllocatorCandidate, primary: keyof DynamicAllocatorCandidate, alias: keyof DynamicAllocatorCandidate): string | null {
    const value = candidate[primary] ?? candidate[alias];
    return typeof value === "string" && value.length > 0 ? value : null;
}

function candidateNumber(candidate: DynamicAllocatorCandidate, ...keys: readonly (keyof DynamicAllocatorCandidate)[]): number | null {
    for (const key of keys) {
        const value = candidate[key];
        if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return null;
}

function validSha256(value: unknown): value is string {
    return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function provenanceIsUsable(candidate: DynamicAllocatorCandidate, evidenceLevel: unknown): boolean {
    if (evidenceLevel !== "ORIGINAL_EVIDENCE" && evidenceLevel !== "CAUSALLY_REGENERATED") return false;
    const evidence = candidate.evidence;
    if (evidence === null || evidence === undefined) return false;
    const sourceKind = evidence.sourceKind ?? evidence.source_kind;
    const sourcePath = evidence.sourcePath ?? evidence.source_path;
    const sourceSha256 = evidence.sourceSha256 ?? evidence.source_sha256;
    const rowNumber = evidence.rowNumber ?? evidence.row_number;
    const sourceBytes = evidence.sourceBytes ?? evidence.source_bytes;
    const sourceSha = candidate.source_sha ?? candidate.sourceSha;
    const validSourceKind = sourceKind === "RAW_CANDIDATE_DECISIONS" || sourceKind === "SAVED_MARKET_DATA" || sourceKind === "STRATEGY_ADAPTER";
    return evidence.level === evidenceLevel &&
        validSourceKind &&
        typeof sourcePath === "string" && sourcePath.trim().length > 0 &&
        validSha256(sourceSha256) && validSha256(sourceSha) &&
        sourceSha256.toLowerCase() === sourceSha.toLowerCase() &&
        typeof rowNumber === "number" && Number.isInteger(rowNumber) && rowNumber > 0 &&
        typeof sourceBytes === "number" && Number.isInteger(sourceBytes) && sourceBytes >= 0;
}

interface NormalizedCandidate {
    readonly candidate_id: string;
    readonly strategy_id: DynamicStrategyId;
    readonly symbol: string;
    readonly side: CandidateSide;
    readonly decision_ts_ms: number;
    readonly entry_valid_until_ms: number;
    readonly requested_gross: number;
    readonly quantity: number;
    readonly quantity_provided: boolean;
    readonly entry_price: number;
    readonly priority: number;
    readonly asset_class: "CRYPTO" | "NON_CRYPTO";
}

function normalizeCandidate(candidate: DynamicAllocatorCandidate): NormalizedCandidate | AllocationRejectionReason {
    const candidateId = candidateText(candidate, "candidate_id", "candidateId");
    const strategy = candidateText(candidate, "strategy_id", "strategy");
    const symbol = typeof candidate.symbol === "string" && candidate.symbol.length > 0 ? candidate.symbol : null;
    const rawSide = typeof candidate.side === "string" ? candidate.side.toUpperCase() : null;
    const side = rawSide === "LONG" || rawSide === "SHORT" ? rawSide : null;
    const decisionTs = candidateNumber(candidate, "decision_ts_ms", "decisionTsMs", "ts");
    const validUntil = candidateNumber(candidate, "entry_valid_until_ms", "entryValidUntilMs");
    const requestedGross = candidateNumber(candidate, "requested_gross", "requestedGross", "worst_case_gross");
    const entryPrice = candidateNumber(candidate, "entry_price", "entryPrice", "price");
    const priority = candidateNumber(candidate, "priority");
    const validity = candidate.validity;
    const evidence = candidate.evidence_level ?? candidate.evidence?.level;
    const strategyValid = typeof strategy === "string" && DYNAMIC_STRATEGY_IDS.includes(strategy as DynamicStrategyId);
    if (
        candidateId === null ||
        !strategyValid ||
        symbol === null ||
        side === null ||
        decisionTs === null ||
        validUntil === null ||
        requestedGross === null ||
        entryPrice === null ||
        priority === null ||
        validity !== "VALID" ||
        !provenanceIsUsable(candidate, evidence)
    ) return "DATA_MISSING";
    if (decisionTs > validUntil) return "ENTRY_EXPIRED";
    if (requestedGross <= 0 || entryPrice <= 0) return "DATA_MISSING";
    const rawQuantity = candidateNumber(candidate, "quantity", "qty");
    const quantity = rawQuantity ?? requestedGross / entryPrice;
    if (!Number.isFinite(quantity) || quantity <= 0) return "DATA_MISSING";
    const rawAssetClass = candidate.asset_class ?? candidate.assetClass;
    if (rawAssetClass !== "CRYPTO" && rawAssetClass !== "NON_CRYPTO") return "DATA_MISSING";
    const assetClass = rawAssetClass;
    return {
        candidate_id: candidateId,
        strategy_id: strategy as DynamicStrategyId,
        symbol,
        side,
        decision_ts_ms: decisionTs,
        entry_valid_until_ms: validUntil,
        requested_gross: requestedGross,
        quantity,
        quantity_provided: rawQuantity !== null,
        entry_price: entryPrice,
        priority,
        asset_class: assetClass,
    };
}

function policyNumber(policy: DynamicAllocatorPolicy, primary: keyof DynamicAllocatorPolicy, alias: keyof DynamicAllocatorPolicy, fallback: number): number {
    const value = policy[primary] ?? policy[alias];
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function capFor(policy: DynamicAllocatorPolicy, primary: keyof DynamicAllocatorPolicy, alias: keyof DynamicAllocatorPolicy, key: string): number {
    const source = policy[primary] ?? policy[alias];
    if (source === undefined) return Number.POSITIVE_INFINITY;
    if (typeof source === "number") return source;
    if (typeof source !== "object" || source === null) return Number.POSITIVE_INFINITY;
    const value = source[key];
    return typeof value === "number" && Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function activeReservations(state: DynamicAllocatorState): readonly ReservationRecord[] {
    return state.reservations.filter((reservation) => reservation.status !== "RELEASED" && reservation.status !== "EXPIRED");
}

function reservationFor(state: DynamicAllocatorState, reservationId: string): ReservationRecord | null {
    return state.reservations.find((reservation) => reservation.reservation_id === reservationId) ?? null;
}

function result(
    accepted: boolean,
    candidateId: string | null,
    reason: AllocationRejectionReason | null,
    before: DynamicAllocatorState,
    after: DynamicAllocatorState,
    reservation: ReservationRecord | null,
): AllocationDecision {
    const stateHashBefore = hashAllocatorState(before);
    const stateHashAfter = hashAllocatorState(after);
    return deepFreeze({
        accepted,
        candidate_id: candidateId,
        reason,
        rejection_reason: reason,
        reservation,
        state_before: before,
        state_after: after,
        state_hash_before: stateHashBefore,
        state_hash_after: stateHashAfter,
        transition: accepted ? "RESERVATION_CREATED" : "REJECTED",
    });
}

function transition(
    state: DynamicAllocatorState | Partial<DynamicAllocatorState>,
    reason: AllocationRejectionReason | null,
    transitionName: string,
    apply: (next: MutableState) => ReservationRecord | null,
): AllocationTransition {
    const before = createInitialAllocatorState(state);
    const next = mutableState(before);
    const reservation = apply(next);
    const after = reservation === null && reason !== null ? before : finalizedState(next);
    return deepFreeze({
        applied: reason === null,
        reason,
        reservation,
        state_before: before,
        state_after: after,
        state_hash_before: hashAllocatorState(before),
        state_hash_after: hashAllocatorState(after),
        transition: transitionName,
    });
}

function add(map: Record<string, number>, key: string, amount: number): void {
    const next = (map[key] ?? 0) + amount;
    if (Math.abs(next) < 1e-12) delete map[key];
    else map[key] = next;
}

export function decideCandidate(
    inputState: DynamicAllocatorState | Partial<DynamicAllocatorState>,
    inputCandidate: DynamicAllocatorCandidate,
    policy: DynamicAllocatorPolicy,
): AllocationDecision {
    const before = createInitialAllocatorState(inputState);
    const normalized = normalizeCandidate(inputCandidate);
    const candidateId = candidateText(inputCandidate, "candidate_id", "candidateId");
    if (typeof normalized === "string") return result(false, candidateId, normalized, before, before, null);
    const { candidate_id: id, strategy_id: strategy, symbol, side } = normalized;
    if (before.reservations.some((reservation) => reservation.candidate_id === id)) {
        return result(false, id, "RESERVATION_SINGLE_USE", before, before, null);
    }
    const existing = before.ownership.filter((item) => item.status !== "RELEASED" && item.symbol === symbol);
    if (existing.some((item) => item.side === side)) return result(false, id, "SAME_SYMBOL_OWNERSHIP", before, before, null);
    if (existing.some((item) => item.side !== side)) return result(false, id, "OPPOSITE_SIDE_CONFLICT", before, before, null);

    const cooldown = before.cooldown_by_symbol_side_strategy[keyFor(symbol, side, strategy)];
    if (
        cooldown !== undefined &&
        isCooldownActiveAt({
            candidateDecisionTsMs: normalized.decision_ts_ms,
            cooldownUntilTsMs: cooldown.until_ts_ms,
            sourceEventTsMs: cooldown.source_event_ts_ms,
        })
    ) return result(false, id, "COOLDOWN_ACTIVE", before, before, null);

    const minQty = policyNumber(policy, "min_qty", "minQty", 0);
    const minNotional = policyNumber(policy, "min_notional", "minNotional", 0);
    if (minQty > 0 && !normalized.quantity_provided) return result(false, id, "DATA_MISSING", before, before, null);
    if (normalized.quantity < minQty) return result(false, id, "MIN_QTY", before, before, null);
    if (normalized.requested_gross < minNotional) return result(false, id, "MIN_NOTIONAL", before, before, null);
    if (policy.require_protection === true && inputCandidate.protection_verified !== true && inputCandidate.protectionVerified !== true) {
        return result(false, id, "PROTECTION_UNVERIFIABLE", before, before, null);
    }

    if (normalized.requested_gross > before.available_margin) return result(false, id, "MARGIN_UNAVAILABLE", before, before, null);
    const pendingCap = policyNumber(policy, "pending_gross_cap", "max_pending_gross", Number.POSITIVE_INFINITY);
    const reservedCap = policyNumber(policy, "reserved_gross_cap", "max_reserved_gross", Number.POSITIVE_INFINITY);
    if (before.pending_gross + normalized.requested_gross > pendingCap) return result(false, id, "PENDING_GROSS", before, before, null);
    if (before.reserved_gross + normalized.requested_gross > reservedCap) return result(false, id, "RESERVED_GROSS", before, before, null);

    const rawTtl = policy.reservation_ttl_ms ?? policy.reservation_ttl_ms_default;
    if (typeof rawTtl !== "number" || !Number.isFinite(rawTtl) || rawTtl <= 0) return result(false, id, "DATA_MISSING", before, before, null);
    const expiresTsMs = normalized.decision_ts_ms + rawTtl;
    if (!Number.isFinite(expiresTsMs)) return result(false, id, "DATA_MISSING", before, before, null);

    const reservedForSymbol = before.reserved_gross_by_symbol[symbol] ?? 0;
    const reservedForStrategy = before.reserved_gross_by_strategy[strategy] ?? 0;
    const reservationsForCapacity = activeReservations(before);
    const reservedCryptoGross = reservationsForCapacity.length === 0 && before.reserved_gross > 0
        ? before.reserved_gross
        : reservationsForCapacity.reduce((gross, reservation) => gross + (reservation.asset_class === "CRYPTO" ? reservation.pending_gross : 0), 0);
    const effectiveTotal = before.total_gross + before.reserved_gross + normalized.requested_gross;
    const effectiveCrypto = before.crypto_gross + (normalized.asset_class === "CRYPTO" ? reservedCryptoGross : 0) + (normalized.asset_class === "CRYPTO" ? normalized.requested_gross : 0);
    if (effectiveTotal > policyNumber(policy, "total_gross_cap", "max_total_gross", Number.POSITIVE_INFINITY)) return result(false, id, "GROSS_CAP_TOTAL", before, before, null);
    if (effectiveCrypto > policyNumber(policy, "crypto_gross_cap", "max_crypto_gross", Number.POSITIVE_INFINITY)) return result(false, id, "GROSS_CAP_CRYPTO", before, before, null);
    if (reservedForStrategy + (before.gross_by_strategy[strategy] ?? 0) + normalized.requested_gross > capFor(policy, "strategy_gross_caps", "max_gross_by_strategy", strategy)) {
        return result(false, id, "GROSS_CAP_STRATEGY", before, before, null);
    }
    if (reservedForSymbol + (before.gross_by_symbol[symbol] ?? 0) + normalized.requested_gross > capFor(policy, "symbol_gross_caps", "max_gross_by_symbol", symbol)) {
        return result(false, id, "GROSS_CAP_SYMBOL", before, before, null);
    }

    const reservation: ReservationRecord = {
        reservation_id: `reservation:${id}:${normalized.decision_ts_ms}`,
        candidate_id: id,
        strategy_id: strategy,
        symbol,
        side,
        asset_class: normalized.asset_class,
        requested_gross: normalized.requested_gross,
        reserved_gross: normalized.requested_gross,
        pending_gross: normalized.requested_gross,
        filled_gross: 0,
        quantity: normalized.quantity,
        entry_price: normalized.entry_price,
        priority: normalized.priority,
        created_ts_ms: normalized.decision_ts_ms,
        expires_ts_ms: expiresTsMs,
        status: "PENDING",
        fill_ts_ms: null,
        protection_id: null,
        released_ts_ms: null,
        release_reason: null,
    };
    const next = mutableState(before);
    next.reservations.push(reservation);
    next.reservation_ids.push(reservation.reservation_id);
    next.pending_gross += normalized.requested_gross;
    next.reserved_gross += normalized.requested_gross;
    next.pending_gross_by_strategy[strategy] = (next.pending_gross_by_strategy[strategy] ?? 0) + normalized.requested_gross;
    next.pending_gross_by_symbol[symbol] = (next.pending_gross_by_symbol[symbol] ?? 0) + normalized.requested_gross;
    next.reserved_gross_by_strategy[strategy] = (next.reserved_gross_by_strategy[strategy] ?? 0) + normalized.requested_gross;
    next.reserved_gross_by_symbol[symbol] = (next.reserved_gross_by_symbol[symbol] ?? 0) + normalized.requested_gross;
    next.available_margin -= normalized.requested_gross;
    next.ownership.push({
        reservation_id: reservation.reservation_id,
        candidate_id: id,
        strategy_id: strategy,
        symbol,
        side,
        priority: normalized.priority,
        gross: normalized.requested_gross,
        status: "RESERVED",
    });
    const after = finalizedState(next);
    return result(true, id, null, before, after, reservation);
}

export function confirmFill(
    inputState: DynamicAllocatorState | Partial<DynamicAllocatorState>,
    reservationId: string,
    fill: FillConfirmation,
): AllocationTransition {
    const state = createInitialAllocatorState(inputState);
    const reservation = reservationFor(state, reservationId);
    if (reservation === null) return transition(state, "DATA_MISSING", "FILL_REJECTED", () => null);
    if (reservation.status !== "PENDING") return transition(state, reservation.filled_gross > 0 ? "RESERVATION_ALREADY_FILLED" : "RESERVATION_NOT_PENDING", "FILL_REJECTED", () => null);
    const grossMatchesReservation = Number.isFinite(fill.filled_gross) && fill.filled_gross === reservation.reserved_gross;
    if (!Number.isFinite(fill.fill_ts_ms) || fill.fill_ts_ms < reservation.created_ts_ms || fill.fill_ts_ms > reservation.expires_ts_ms || !grossMatchesReservation || fill.filled_gross <= 0 || fill.filled_gross > reservation.reserved_gross) {
        return transition(state, "FILL_GROSS_MISMATCH", "FILL_REJECTED", () => null);
    }
    return transition(state, null, "FILL_CONFIRMED", (next) => {
        const updated: ReservationRecord = {
            ...reservation,
            reserved_gross: reservation.reserved_gross - fill.filled_gross,
            pending_gross: reservation.reserved_gross - fill.filled_gross,
            filled_gross: fill.filled_gross,
            status: fill.filled_gross === reservation.reserved_gross ? "FILLED" : "PARTIALLY_FILLED",
            fill_ts_ms: fill.fill_ts_ms,
        };
        next.reservations = next.reservations.map((item) => item.reservation_id === reservationId ? updated : item);
        next.pending_gross -= fill.filled_gross;
        next.reserved_gross -= fill.filled_gross;
        add(next.pending_gross_by_strategy, reservation.strategy_id, -fill.filled_gross);
        add(next.pending_gross_by_symbol, reservation.symbol, -fill.filled_gross);
        add(next.reserved_gross_by_strategy, reservation.strategy_id, -fill.filled_gross);
        add(next.reserved_gross_by_symbol, reservation.symbol, -fill.filled_gross);
        next.total_gross += fill.filled_gross;
        if (reservation.asset_class === "CRYPTO") next.crypto_gross += fill.filled_gross;
        next.gross_by_strategy[reservation.strategy_id] = (next.gross_by_strategy[reservation.strategy_id] ?? 0) + fill.filled_gross;
        next.gross_by_symbol[reservation.symbol] = (next.gross_by_symbol[reservation.symbol] ?? 0) + fill.filled_gross;
        next.ownership = next.ownership.map((item) => item.reservation_id === reservationId ? { ...item, status: "OPEN", gross: fill.filled_gross } : item);
        return updated;
    });
}

export function registerProtection(
    inputState: DynamicAllocatorState | Partial<DynamicAllocatorState>,
    reservationId: string,
    protection: ProtectionRegistration,
): AllocationTransition {
    const state = createInitialAllocatorState(inputState);
    const reservation = reservationFor(state, reservationId);
    if (reservation === null) return transition(state, "DATA_MISSING", "PROTECTION_REJECTED", () => null);
    if (reservation.status === "RELEASED" || reservation.status === "EXPIRED") return transition(state, "RESERVATION_ALREADY_RELEASED", "PROTECTION_REJECTED", () => null);
    if (reservation.filled_gross <= 0) return transition(state, "PROTECTION_NOT_READY", "PROTECTION_REJECTED", () => null);
    if (reservation.protection_id !== null) return transition(state, "PROTECTION_NOT_READY", "PROTECTION_REJECTED", () => null);
    if (typeof protection.protection_id !== "string" || protection.protection_id.trim().length === 0 || !Number.isFinite(protection.registered_ts_ms) || reservation.fill_ts_ms === null || protection.registered_ts_ms < reservation.fill_ts_ms) {
        return transition(state, "DATA_MISSING", "PROTECTION_REJECTED", () => null);
    }
    return transition(state, null, "PROTECTION_REGISTERED", (next) => {
        const updated = { ...reservation, status: "PROTECTED" as const, protection_id: protection.protection_id.trim() };
        next.reservations = next.reservations.map((item) => item.reservation_id === reservationId ? updated : item);
        return updated;
    });
}

export function releaseReservation(
    inputState: DynamicAllocatorState | Partial<DynamicAllocatorState>,
    reservationId: string,
    request: ReleaseRequest,
): AllocationTransition {
    const state = createInitialAllocatorState(inputState);
    const reservation = reservationFor(state, reservationId);
    if (reservation === null) return transition(state, "DATA_MISSING", "RELEASE_REJECTED", () => null);
    if (reservation.status === "RELEASED" || reservation.status === "EXPIRED") return transition(state, "RESERVATION_ALREADY_RELEASED", "RELEASE_REJECTED", () => null);
    const hasCooldownMetadata = request.cooldown_until_ts_ms !== undefined || request.cooldown_source_event_ts_ms !== undefined;
    const validCooldownMetadata = !hasCooldownMetadata || (
        typeof request.cooldown_until_ts_ms === "number" && Number.isFinite(request.cooldown_until_ts_ms) &&
        typeof request.cooldown_source_event_ts_ms === "number" && Number.isFinite(request.cooldown_source_event_ts_ms) &&
        request.cooldown_source_event_ts_ms <= request.at_ts_ms
    );
    if (!Number.isFinite(request.at_ts_ms) || request.at_ts_ms < reservation.created_ts_ms || (reservation.fill_ts_ms !== null && request.at_ts_ms < reservation.fill_ts_ms) || typeof request.reason !== "string" || request.reason.trim().length === 0 || !validCooldownMetadata) {
        return transition(state, "DATA_MISSING", "RELEASE_REJECTED", () => null);
    }
    return transition(state, null, "RESERVATION_RELEASED", (next) => {
        const expired = request.reason === "EXPIRY";
        const updated: ReservationRecord = {
            ...reservation,
            pending_gross: 0,
            reserved_gross: 0,
            filled_gross: 0,
            status: expired ? "EXPIRED" : "RELEASED",
            released_ts_ms: request.at_ts_ms,
            release_reason: request.reason.trim(),
        };
        next.reservations = next.reservations.map((item) => item.reservation_id === reservationId ? updated : item);
        next.pending_gross -= reservation.pending_gross;
        next.reserved_gross -= reservation.reserved_gross;
        add(next.pending_gross_by_strategy, reservation.strategy_id, -reservation.pending_gross);
        add(next.pending_gross_by_symbol, reservation.symbol, -reservation.pending_gross);
        add(next.reserved_gross_by_strategy, reservation.strategy_id, -reservation.reserved_gross);
        add(next.reserved_gross_by_symbol, reservation.symbol, -reservation.reserved_gross);
        next.total_gross -= reservation.filled_gross;
        if (reservation.asset_class === "CRYPTO") next.crypto_gross -= reservation.filled_gross;
        add(next.gross_by_strategy, reservation.strategy_id, -reservation.filled_gross);
        add(next.gross_by_symbol, reservation.symbol, -reservation.filled_gross);
        next.available_margin += reservation.pending_gross + reservation.filled_gross;
        next.ownership = next.ownership.map((item) => item.reservation_id === reservationId ? { ...item, status: "RELEASED", gross: 0 } : item);
        const cooldownUntil = request.cooldown_until_ts_ms;
        if (cooldownUntil !== undefined) {
            next.cooldown_by_symbol_side_strategy[keyFor(reservation.symbol, reservation.side, reservation.strategy_id)] = {
                until_ts_ms: cooldownUntil ?? null,
                source_event_ts_ms: request.cooldown_source_event_ts_ms ?? null,
                reason: request.reason.trim(),
            };
        }
        return updated;
    });
}

export function expireReservation(
    inputState: DynamicAllocatorState | Partial<DynamicAllocatorState>,
    reservationId: string,
    atTsMs: number,
): AllocationTransition {
    const state = createInitialAllocatorState(inputState);
    const reservation = reservationFor(state, reservationId);
    if (reservation === null) return transition(state, "DATA_MISSING", "EXPIRY_REJECTED", () => null);
    if (reservation.status === "RELEASED" || reservation.status === "EXPIRED") return transition(state, "RESERVATION_ALREADY_RELEASED", "EXPIRY_REJECTED", () => null);
    if (reservation.status !== "PENDING") return transition(state, "RESERVATION_NOT_PENDING", "EXPIRY_REJECTED", () => null);
    if (!Number.isFinite(atTsMs) || atTsMs < reservation.expires_ts_ms) return transition(state, "RESERVATION_NOT_EXPIRED", "EXPIRY_REJECTED", () => null);
    return releaseReservation(state, reservationId, { at_ts_ms: atTsMs, reason: "EXPIRY" });
}

export const createReservation = decideCandidate;
export const reserveCandidate = decideCandidate;
export const confirmReservationFill = confirmFill;
export const registerReservationProtection = registerProtection;
export const releaseGrossReservation = releaseReservation;
