import {
    applyPreemption,
    type DynamicPreemptionPosition,
    type PreemptionExitStatus,
    type PreemptionMode,
} from "./dynamic-preemption";
import {
    confirmFill,
    createInitialAllocatorState,
    decideCandidate,
    registerProtection,
    releaseReservation,
    type DynamicAllocatorCandidate,
    type DynamicAllocatorPolicy,
    type DynamicAllocatorState,
    cooldownKey,
} from "./dynamic-allocator";
import { classifyOrderingEvidence, orderDynamicEvents, type DynamicOrderingInput } from "./dynamic-ordering";
import { hashAllocatorState } from "./dynamic-state";

export type ReplayEventKind =
    | "DEPOSIT" | "FUNDING" | "MARK" | "PROTECTION_STOP" | "STOP"
    | "PREEMPTION_EXIT" | "NORMAL_EXIT" | "TAKE_PROFIT" | "TIME_STOP"
    | "PARTIAL_FILL" | "EXECUTION_RECONCILIATION" | "RESERVATION_RELEASE"
    | "COOLDOWN_UPDATE" | "OWNERSHIP_UPDATE" | "CANDIDATE_VALIDATION"
    | "CANDIDATE_PRIORITY" | "PREEMPTION_ELIGIBILITY" | "SIZING"
    | "RESERVATION" | "ENTRY" | "ENTRY_FILL" | "PROTECTION_REGISTRATION";

export interface ReplayEvent extends DynamicOrderingInput {
    readonly event_id: string;
    readonly timestamp_ms: number;
    readonly event_seq: number | null;
    readonly kind: ReplayEventKind;
    readonly candidate?: DynamicAllocatorCandidate;
    readonly incoming_candidate?: DynamicAllocatorCandidate;
    readonly victim_position?: DynamicPreemptionPosition;
    readonly mode?: PreemptionMode;
    readonly exit_status?: PreemptionExitStatus;
    readonly confirmed?: boolean;
    readonly execution_evidence?: ReplayExecutionEvidence | null;
    readonly data_split?: "IS" | "OOS";
    readonly ordering_events?: readonly DynamicOrderingInput[];
    readonly charge_id?: string;
    readonly reservation_id?: string;
    readonly protection_id?: string;
    readonly amount_jpy?: number;
    readonly settlement_pnl?: number;
    readonly settlement_currency?: string;
    readonly fx_rate?: number;
    readonly fee_settlement?: number;
    readonly funding_settlement?: number;
    readonly filled_gross?: number;
    readonly fill_price?: number;
    readonly exit_price?: number;
    readonly slippage_bps?: number;
    readonly gap_bps?: number;
    readonly slippage_settlement?: number;
    readonly gap_settlement?: number;
    readonly exit_reason?: string;
    readonly cooldown_until_ts_ms?: number | null;
    readonly cooldown_source_event_ts_ms?: number | null;
}
export interface ReplayMarketMark {
    readonly timestamp_ms: number;
    readonly symbol: string;
    readonly price: number;
    readonly fx_rate?: number;
    readonly timeframe?: "H1" | string;
    readonly interval_ms?: number;
}

export interface DynamicReplayPolicy {
    readonly allocator: DynamicAllocatorPolicy;
    readonly initial_wallet_jpy: number;
    readonly default_fx_rate?: number;
    readonly require_canonical_same_bar_order?: boolean;
    readonly settlement_currency?: string;
    readonly oos_start_ts_ms?: number | null;
    readonly oos_end_ts_ms?: number | null;
    readonly h1_interval_ms?: number;
}

export type ReplayRejection =
    | "INVALID_EVENT"
    | "FUTURE_EVENT_REFERENCE"
    | "SAME_BAR_ORDER_UNVERIFIABLE"
    | "PARTIAL_EXECUTION_UNSUPPORTED"
    | "UNKNOWN_EXECUTION"
    | "DUPLICATE_EVENT"
    | "DUPLICATE_CHARGE"
    | "DATA_MISSING"
    | "ALLOCATOR_REJECTED"
    | "UNSUPPORTED_PHASE";

export interface ReplayExecutionEvidence {
    readonly source: string;
    readonly evidence_id: string;
    readonly observed_ts_ms: number;
}

export interface ReplayPositionSnapshot {
    readonly reservation_id: string;
    readonly symbol: string;
    readonly side: "LONG" | "SHORT";
    readonly quantity: number;
    readonly entry_price: number;
    readonly gross: number;
    readonly strategy_id: string;
}

export interface ReplayAccounting {
    readonly initial_wallet_jpy: number;
    readonly wallet_jpy: number;
    readonly realized_pnl_settlement: number;
    readonly realized_pnl_jpy: number;
    readonly fees_settlement: number;
    readonly fees_jpy: number;
    readonly funding_settlement: number;
    readonly funding_jpy: number;
    readonly settlement_currency: string | null;
    readonly deposits_jpy: number;
    readonly expected_wallet_jpy: number;
    readonly reconciliation_delta_jpy: number;
    readonly accounting_reconciliation: "PASS" | "FAIL";
    readonly charge_ledger: readonly ReplayChargeEntry[];
    readonly charge_reconciliation: "PASS" | "FAIL";
}

export interface ReplayChargeEntry {
    readonly event_id: string;
    readonly kind: ReplayEventKind;
    readonly settlement_currency: string;
    readonly settlement_pnl: number;
    readonly pnl_jpy: number;
    readonly fee_settlement: number;
    readonly fee_jpy: number;
    readonly funding_settlement: number;
    readonly funding_jpy: number;
    readonly slippage_settlement: number;
    readonly gap_settlement: number;
    readonly wallet_delta_jpy: number;
}

export interface ReplayMtmPoint {
    readonly timestamp_ms: number;
    readonly wallet_jpy: number;
    readonly unrealized_pnl_jpy: number;
    readonly unrealized_by_logic_direction: Readonly<Record<string, number>>;
    readonly equity_jpy: number;
    readonly total_gross: number;
    readonly open_positions: readonly ReplayPositionSnapshot[];
    readonly peak_equity_jpy: number;
    readonly drawdown_pct: number;
}

export interface ReplayDdWindow {
    readonly peak_ts_ms: number;
    readonly trough_ts_ms: number;
    readonly recovery_ts_ms: number | null;
    readonly peak_equity_jpy: number;
    readonly trough_equity_jpy: number;
    readonly drawdown_pct: number;
}

export interface ReplayLedgerEntry {
    readonly event_id: string;
    readonly timestamp_ms: number;
    readonly kind: ReplayEventKind;
    readonly accepted: boolean;
    readonly reason: string | null;
    readonly data_split: "IS" | "OOS" | null;
    readonly state_hash_before: string;
    readonly state_hash_after: string;
    readonly allocator_before: DynamicAllocatorState;
    readonly allocator_after: DynamicAllocatorState;
    readonly wallet_before_jpy: number;
    readonly wallet_after_jpy: number;
    readonly realized_pnl_jpy: number;
    readonly fee_jpy: number;
    readonly funding_jpy: number;
    readonly lifecycle: "OWNERSHIP_CARRIED" | "COOLDOWN_CARRIED" | "VICTIM_RELEASED_INCOMING_REJECTED" | null;
}

export interface DynamicReplayResult {
    readonly status: "PASS" | "FAIL";
    readonly rejection: ReplayRejection | null;
    readonly allocator_state: DynamicAllocatorState;
    readonly execution_ledger: readonly ReplayLedgerEntry[];
    readonly reservation_ledger: readonly ReplayLedgerEntry[];
    readonly preemption_ledger: readonly ReplayLedgerEntry[];
    readonly allocator_state_snapshots: readonly ReplayLedgerEntry[];
    readonly charge_ledger: readonly ReplayChargeEntry[];
    readonly mtm_timeline: readonly ReplayMtmPoint[];
    readonly accounting: ReplayAccounting;
    readonly maximum_mtm_dd: ReplayDdWindow | null;
    readonly top5_dd_windows: readonly ReplayDdWindow[];
    readonly ordering_evidence: ReturnType<typeof classifyOrderingEvidence>;
    readonly oos_boundary: { readonly is_end_ts_ms: number | null; readonly oos_start_ts_ms: number | null; readonly oos_end_ts_ms: number | null; readonly classification: "EXPLICIT" | "UNSPECIFIED" };
    readonly processed_event_ids: readonly string[];
}

interface MutableAccounting {
    wallet: number;
    realized: number;
    realizedSettlement: number;
    fees: number;
    feesSettlement: number;
    funding: number;
    fundingSettlement: number;
    deposits: number;
}

interface SettlementValues {
    readonly currency: string;
    readonly pnl: number;
    readonly pnlJpy: number;
    readonly fee: number;
    readonly feeJpy: number;
    readonly funding: number;
    readonly fundingJpy: number;
}

const EPSILON = 1e-8;

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function requiredNumber(value: unknown): number | null {
    return finite(value) ? value : null;
}

function settlementValues(event: ReplayEvent, policy: DynamicReplayPolicy): SettlementValues | null {
    if (!hasOwn(event, "settlement_pnl") || !hasOwn(event, "fee_settlement") || !hasOwn(event, "funding_settlement") || !hasOwn(event, "settlement_currency") || !hasOwn(event, "fx_rate")) return null;
    const pnl = requiredNumber(event.settlement_pnl);
    const fee = requiredNumber(event.fee_settlement);
    const funding = requiredNumber(event.funding_settlement);
    const fx = requiredNumber(event.fx_rate);
    const currency = typeof event.settlement_currency === "string" ? event.settlement_currency.trim() : "";
    if (pnl === null || fee === null || funding === null || fx === null || fx <= 0 || currency.length === 0 || fee < 0) return null;
    if (typeof policy.settlement_currency !== "string" || policy.settlement_currency.trim().length === 0 || currency !== policy.settlement_currency) return null;
    return { currency, pnl, pnlJpy: pnl * fx, fee, feeJpy: fee * fx, funding, fundingJpy: funding * fx };
}

function validPrice(value: unknown): boolean {
    return finite(value) && value > 0;
}

function executionFieldsPresent(event: ReplayEvent): boolean {
    const slippageSettlement = event.slippage_settlement ?? 0;
    const gapSettlement = event.gap_settlement ?? 0;
    return finite(event.slippage_bps) && finite(event.gap_bps) && finite(slippageSettlement) && finite(gapSettlement) && event.slippage_bps === 0 && event.gap_bps === 0 && slippageSettlement === 0 && gapSettlement === 0;
}

function executionEvidence(event: ReplayEvent, timestamp: number): boolean {
    const evidence = event.execution_evidence;
    return evidence !== null && typeof evidence === "object" && typeof evidence.source === "string" && evidence.source.trim().length > 0 && typeof evidence.evidence_id === "string" && evidence.evidence_id.trim().length > 0 && finite(evidence.observed_ts_ms) && evidence.observed_ts_ms === timestamp;
}

function executionEvidenceKey(event: ReplayEvent): string | null {
    const evidence = event.execution_evidence;
    if (evidence === null || typeof evidence !== "object" || typeof evidence.source !== "string" || typeof evidence.evidence_id !== "string") return null;
    return `${evidence.source.trim()}\u0000${evidence.evidence_id.trim()}`;
}

function isStop(kind: ReplayEventKind): boolean {
    return kind === "PROTECTION_STOP" || kind === "STOP";
}

function isExit(kind: ReplayEventKind): boolean {
    return ["PROTECTION_STOP", "STOP", "PREEMPTION_EXIT", "NORMAL_EXIT", "TAKE_PROFIT", "TIME_STOP"].includes(kind);
}

function snapshotPositions(state: DynamicAllocatorState): ReplayPositionSnapshot[] {
    return state.reservations
        .filter((item) => (item.status === "FILLED" || item.status === "PROTECTED") && item.filled_gross > 0)
        .map((item) => ({
            reservation_id: item.reservation_id,
            symbol: item.symbol,
            side: item.side,
            quantity: item.quantity,
            entry_price: item.entry_price,
            gross: item.filled_gross,
            strategy_id: item.strategy_id,
        }));
}

function markEquity(state: DynamicAllocatorState, marks: readonly ReplayMarketMark[], at: number, wallet: number, peak: number): ReplayMtmPoint | null {
    const open = snapshotPositions(state);
    let unrealized = 0;
    const byLogicDirection: Record<string, number> = {};
    for (const position of open) {
        const mark = marks.find((item) => item.symbol === position.symbol && item.timestamp_ms === at);
        if (!mark || !validPrice(mark.price) || !finite(mark.fx_rate) || mark.fx_rate <= 0) return null;
        const delta = position.side === "LONG" ? mark.price - position.entry_price : position.entry_price - mark.price;
        const pnl = delta * position.quantity * mark.fx_rate;
        if (!finite(pnl)) return null;
        unrealized += pnl;
        const key = `${position.strategy_id}|${position.side}`;
        byLogicDirection[key] = (byLogicDirection[key] ?? 0) + pnl;
    }
    const equity = wallet + unrealized;
    const nextPeak = Math.max(peak, equity);
    const dd = nextPeak > 0 ? ((equity - nextPeak) / nextPeak) * 100 : 0;
    return { timestamp_ms: at, wallet_jpy: wallet, unrealized_pnl_jpy: unrealized, unrealized_by_logic_direction: byLogicDirection, equity_jpy: equity, total_gross: state.total_gross, open_positions: open, peak_equity_jpy: nextPeak, drawdown_pct: dd };
}

function windows(points: readonly ReplayMtmPoint[]): ReplayDdWindow[] {
    if (points.length === 0) return [];
    const result: ReplayDdWindow[] = [];
    let peak = points[0];
    let trough = points[0];
    for (const point of points.slice(1)) {
        if (point.equity_jpy > peak.equity_jpy + EPSILON) {
            if (trough.equity_jpy < peak.equity_jpy - EPSILON) result.push({ peak_ts_ms: peak.timestamp_ms, trough_ts_ms: trough.timestamp_ms, recovery_ts_ms: point.timestamp_ms, peak_equity_jpy: peak.equity_jpy, trough_equity_jpy: trough.equity_jpy, drawdown_pct: ((trough.equity_jpy - peak.equity_jpy) / peak.equity_jpy) * 100 });
            peak = point;
            trough = point;
            continue;
        }
        if (point.equity_jpy < trough.equity_jpy - EPSILON) trough = point;
        if (trough.equity_jpy < peak.equity_jpy - EPSILON && point.equity_jpy >= peak.equity_jpy - EPSILON) {
            result.push({ peak_ts_ms: peak.timestamp_ms, trough_ts_ms: trough.timestamp_ms, recovery_ts_ms: point.timestamp_ms, peak_equity_jpy: peak.equity_jpy, trough_equity_jpy: trough.equity_jpy, drawdown_pct: ((trough.equity_jpy - peak.equity_jpy) / peak.equity_jpy) * 100 });
            peak = point;
            trough = point;
        }
    }
    if (trough.equity_jpy < peak.equity_jpy - EPSILON) result.push({ peak_ts_ms: peak.timestamp_ms, trough_ts_ms: trough.timestamp_ms, recovery_ts_ms: null, peak_equity_jpy: peak.equity_jpy, trough_equity_jpy: trough.equity_jpy, drawdown_pct: ((trough.equity_jpy - peak.equity_jpy) / peak.equity_jpy) * 100 });
    return result.sort((left, right) => left.drawdown_pct - right.drawdown_pct).slice(0, 5);
}

function boundaryFor(policy: DynamicReplayPolicy): DynamicReplayResult["oos_boundary"] {
    const start = finite(policy.oos_start_ts_ms) ? policy.oos_start_ts_ms : null;
    const end = finite(policy.oos_end_ts_ms) ? policy.oos_end_ts_ms : null;
    const explicit = policy.oos_start_ts_ms !== undefined && policy.oos_start_ts_ms !== null || policy.oos_end_ts_ms !== undefined && policy.oos_end_ts_ms !== null;
    return { is_end_ts_ms: start === null ? null : start - 1, oos_start_ts_ms: start, oos_end_ts_ms: end, classification: explicit ? "EXPLICIT" : "UNSPECIFIED" };
}

function boundaryReason(policy: DynamicReplayPolicy): ReplayRejection | null {
    const hasStart = policy.oos_start_ts_ms !== undefined && policy.oos_start_ts_ms !== null;
    const hasEnd = policy.oos_end_ts_ms !== undefined && policy.oos_end_ts_ms !== null;
    if (!hasStart && !hasEnd) return null;
    if (!hasStart || !hasEnd || !finite(policy.oos_start_ts_ms) || !finite(policy.oos_end_ts_ms) || policy.oos_start_ts_ms < 0 || policy.oos_end_ts_ms < 0 || policy.oos_start_ts_ms > policy.oos_end_ts_ms) return "DATA_MISSING";
    return null;
}

function splitFor(event: ReplayEvent, boundary: DynamicReplayResult["oos_boundary"]): "IS" | "OOS" | null {
    if (boundary.classification === "UNSPECIFIED") return event.data_split === "OOS" ? null : "IS";
    if (boundary.oos_start_ts_ms === null || boundary.oos_end_ts_ms === null) return null;
    const inferred = event.timestamp_ms < boundary.oos_start_ts_ms ? "IS" : event.timestamp_ms <= boundary.oos_end_ts_ms ? "OOS" : null;
    if (inferred === null) return null;
    return event.data_split === undefined ? inferred : event.data_split === inferred ? event.data_split : null;
}

function marketDataReason(marketData: readonly ReplayMarketMark[], policy: DynamicReplayPolicy): ReplayRejection | null {
    if (!finite(policy.h1_interval_ms) || policy.h1_interval_ms <= 0) return "DATA_MISSING";
    const seen = new Map<string, number>();
    let previousTimestamp = -Infinity;
    for (const mark of marketData) {
        if (!finite(mark.timestamp_ms) || mark.timestamp_ms < 0 || typeof mark.symbol !== "string" || mark.symbol.trim().length === 0 || !validPrice(mark.price) || !finite(mark.fx_rate) || mark.fx_rate <= 0) return "DATA_MISSING";
        if (mark.timestamp_ms < previousTimestamp) return "DATA_MISSING";
        previousTimestamp = mark.timestamp_ms;
        if (mark.timeframe !== "H1") return "DATA_MISSING";
        const key = mark.symbol;
        const prior = seen.get(key);
        if (prior !== undefined && mark.timestamp_ms <= prior) return "DATA_MISSING";
        if (prior !== undefined) {
            if (mark.timestamp_ms - prior !== policy.h1_interval_ms) return "DATA_MISSING";
        }
        seen.set(key, mark.timestamp_ms);
    }
    return null;
}

function prevalidate(events: readonly ReplayEvent[], policy: DynamicReplayPolicy, marketData: readonly ReplayMarketMark[]): ReplayRejection | null {
    if (!finite(policy.initial_wallet_jpy) || policy.initial_wallet_jpy < 0 || typeof policy.settlement_currency !== "string" || policy.settlement_currency.trim().length === 0 || !finite(policy.h1_interval_ms) || policy.h1_interval_ms <= 0) return "DATA_MISSING";
    const boundaryValidation = boundaryReason(policy);
    if (boundaryValidation !== null) return boundaryValidation;
    const marketReason = marketDataReason(marketData, policy);
    if (marketReason !== null) return marketReason;
    const entryTimestamps = new Map<string, number>();
    for (const event of events) {
        if (typeof event.event_id !== "string" || event.event_id.length === 0) return "INVALID_EVENT";
        if (!finite(event.timestamp_ms) || event.timestamp_ms < 0) return "INVALID_EVENT";
        const candidate = event.incoming_candidate ?? event.candidate;
        if (candidate !== undefined) {
            const decisionTs = candidate.decision_ts_ms ?? candidate.decisionTsMs ?? candidate.ts;
            if (!finite(decisionTs) || decisionTs > event.timestamp_ms) return "FUTURE_EVENT_REFERENCE";
            if (event.kind === "ENTRY") entryTimestamps.set(`reservation:${candidate.candidate_id ?? candidate.candidateId}:${decisionTs}`, event.timestamp_ms);
        }
    }
    for (const event of events) {
        if (isExit(event.kind) && event.reservation_id !== undefined) {
            const entryTs = entryTimestamps.get(event.reservation_id);
            if (entryTs !== undefined && event.timestamp_ms < entryTs) return "FUTURE_EVENT_REFERENCE";
        }
    }
    const boundary = boundaryFor(policy);
    if (boundary.classification === "EXPLICIT" && events.some((event) => event.data_split !== undefined && splitFor(event, boundary) === null)) return "DATA_MISSING";
    return null;
}

function syncAllocatorCash(state: DynamicAllocatorState, wallet: number, equity: number, walletBefore: number): DynamicAllocatorState {
    return createInitialAllocatorState({ ...state, wallet_jpy: wallet, equity_jpy: equity, available_margin: state.available_margin + (wallet - walletBefore) });
}

function candidateTimestamp(candidate: DynamicAllocatorCandidate): number | null {
    return requiredNumber(candidate.decision_ts_ms ?? candidate.decisionTsMs ?? candidate.ts);
}

function candidateExpiry(candidate: DynamicAllocatorCandidate): number | null {
    return requiredNumber(candidate.entry_valid_until_ms ?? candidate.entryValidUntilMs);
}

function candidateCausality(event: ReplayEvent, candidate: DynamicAllocatorCandidate): ReplayRejection | null {
    const decisionTs = candidateTimestamp(candidate);
    const expiryTs = candidateExpiry(candidate);
    if (decisionTs === null || expiryTs === null || event.timestamp_ms < decisionTs) return "FUTURE_EVENT_REFERENCE";
    if (decisionTs > expiryTs) return "ALLOCATOR_REJECTED";
    if (event.kind === "ENTRY" && event.timestamp_ms > expiryTs) return "ALLOCATOR_REJECTED";
    if (event.kind === "ENTRY_FILL" && event.timestamp_ms > expiryTs) return "DATA_MISSING";
    if (event.kind === "PREEMPTION_EXIT" && event.timestamp_ms > expiryTs) return "ALLOCATOR_REJECTED";
    return null;
}

function isUnsupportedPhase(kind: ReplayEventKind): boolean {
    return kind === "SIZING" || kind === "PREEMPTION_ELIGIBILITY";
}

function isOosCandidateSelection(kind: ReplayEventKind): boolean {
    return kind === "CANDIDATE_VALIDATION" || kind === "CANDIDATE_PRIORITY" || kind === "PREEMPTION_ELIGIBILITY" || kind === "SIZING" || kind === "RESERVATION" || kind === "ENTRY";
}

function rejectedResult(policy: DynamicReplayPolicy, events: readonly ReplayEvent[], reason: ReplayRejection, orderingEvidence: ReturnType<typeof classifyOrderingEvidence>): DynamicReplayResult {
    const initial = finite(policy.initial_wallet_jpy) && policy.initial_wallet_jpy >= 0 ? policy.initial_wallet_jpy : 0;
    const state = createInitialAllocatorState({ wallet_jpy: initial, equity_jpy: initial, available_margin: initial });
    const accounting: ReplayAccounting = { initial_wallet_jpy: initial, wallet_jpy: initial, realized_pnl_settlement: 0, realized_pnl_jpy: 0, fees_settlement: 0, fees_jpy: 0, funding_settlement: 0, funding_jpy: 0, settlement_currency: null, deposits_jpy: 0, expected_wallet_jpy: initial, reconciliation_delta_jpy: 0, accounting_reconciliation: "PASS", charge_ledger: [], charge_reconciliation: "PASS" };
    return { status: "FAIL", rejection: reason, allocator_state: state, execution_ledger: [], reservation_ledger: [], preemption_ledger: [], allocator_state_snapshots: [], charge_ledger: [], mtm_timeline: [], accounting, maximum_mtm_dd: null, top5_dd_windows: [], ordering_evidence: orderingEvidence, oos_boundary: boundaryFor(policy), processed_event_ids: [] };
}

/** Deterministic, research-only lifecycle reducer. */
export function replayDynamicPortfolio(
    inputEvents: readonly ReplayEvent[],
    policy: DynamicReplayPolicy,
    marketData: readonly ReplayMarketMark[] = [],
): DynamicReplayResult {
    if (!finite(policy.initial_wallet_jpy) || policy.initial_wallet_jpy < 0) {
        return rejectedResult(policy, inputEvents, "DATA_MISSING", { ordering: "NONCANONICAL_ORDERING", orderingEvidence: "NONCANONICAL_ORDERING", status: "NONCANONICAL_ORDERING", reasons: ["SAME_TIMESTAMP_ORDER_UNVERIFIABLE"], formalParityEligible: false });
    }
    const events = inputEvents.map((event) => ({ ...event, timestamp: event.timestamp_ms }));
    const ordering = classifyOrderingEvidence(events);
    if (policy.require_canonical_same_bar_order !== false && ordering.ordering !== "CANONICAL_ORDERING") return rejectedResult(policy, inputEvents, "SAME_BAR_ORDER_UNVERIFIABLE", ordering);
    const prevalidation = prevalidate(events, policy, marketData);
    if (prevalidation !== null) return rejectedResult(policy, inputEvents, prevalidation, ordering);
    const ordered = orderDynamicEvents(events) as ReplayEvent[];
    const allocatorStart = createInitialAllocatorState({ wallet_jpy: policy.initial_wallet_jpy, equity_jpy: policy.initial_wallet_jpy, available_margin: policy.initial_wallet_jpy });
    let allocator = allocatorStart;
    const cash: MutableAccounting = { wallet: policy.initial_wallet_jpy, realized: 0, realizedSettlement: 0, fees: 0, feesSettlement: 0, funding: 0, fundingSettlement: 0, deposits: 0 };
    const processed = new Set<string>();
    const execution: ReplayLedgerEntry[] = [];
    const reservations: ReplayLedgerEntry[] = [];
    const preemptions: ReplayLedgerEntry[] = [];
    const snapshots: ReplayLedgerEntry[] = [];
    const charges: ReplayChargeEntry[] = [];
    const depositsLedger: Array<{ readonly event_id: string; readonly amount_jpy: number }> = [];
    const reservationExpiry = new Map<string, number>();
    const executionEvidenceKeys = new Set<string>();
    const mtm: ReplayMtmPoint[] = [{
        timestamp_ms: 0,
        wallet_jpy: policy.initial_wallet_jpy,
        unrealized_pnl_jpy: 0,
        unrealized_by_logic_direction: {},
        equity_jpy: policy.initial_wallet_jpy,
        total_gross: 0,
        open_positions: [],
        peak_equity_jpy: policy.initial_wallet_jpy,
        drawdown_pct: 0,
    }];
    let peak = policy.initial_wallet_jpy;
    let equity = policy.initial_wallet_jpy;
    let failure: ReplayRejection | null = null;
    const charged = new Set<string>();
    const boundary = boundaryFor(policy);

    for (const event of ordered) {
        if (failure) break;
        if (processed.has(event.event_id)) { failure = "DUPLICATE_EVENT"; break; }
        if (!finite(event.timestamp_ms) || event.timestamp_ms < 0) { failure = "INVALID_EVENT"; break; }
        const before = allocator;
        const walletBefore = cash.wallet;
        let accepted = true;
        let reason: string | null = null;
        let eventRealized = 0;
        let eventFee = 0;
        let eventFunding = 0;
        let charge: ReplayChargeEntry | null = null;
        let lifecycle: ReplayLedgerEntry["lifecycle"] = null;
        const split = splitFor(event, boundary);
        if (split === null) { failure = "DATA_MISSING"; break; }
        if (split === "OOS" && isOosCandidateSelection(event.kind)) { failure = "DATA_MISSING"; break; }
        if (isUnsupportedPhase(event.kind)) { failure = "UNSUPPORTED_PHASE"; break; }
        if (event.kind === "DEPOSIT") {
            if (!hasOwn(event, "amount_jpy") || !finite(event.amount_jpy) || event.amount_jpy < 0) { failure = "DATA_MISSING"; break; }
            cash.wallet += event.amount_jpy; cash.deposits += event.amount_jpy;
            depositsLedger.push({ event_id: event.event_id, amount_jpy: event.amount_jpy });
        } else if (event.kind === "FUNDING") {
            const settlement = settlementValues({ ...event, settlement_pnl: 0 }, policy);
            const funding = requiredNumber(event.funding_settlement);
            if (settlement === null || funding === null) { failure = "DATA_MISSING"; break; }
            if (typeof event.charge_id !== "string" || event.charge_id.trim().length === 0 || charged.has(event.charge_id)) { failure = event.charge_id === undefined ? "DATA_MISSING" : "DUPLICATE_CHARGE"; break; }
            charged.add(event.charge_id);
            cash.wallet += settlement.fundingJpy; cash.funding += settlement.fundingJpy; cash.fundingSettlement += funding; eventFunding = settlement.fundingJpy;
            charge = { event_id: event.event_id, kind: event.kind, settlement_currency: settlement.currency, settlement_pnl: 0, pnl_jpy: 0, fee_settlement: 0, fee_jpy: 0, funding_settlement: funding, funding_jpy: settlement.fundingJpy, slippage_settlement: 0, gap_settlement: 0, wallet_delta_jpy: settlement.fundingJpy };
        } else if (event.kind === "OWNERSHIP_UPDATE" || event.kind === "COOLDOWN_UPDATE") {
            if (split !== "OOS" || event.reservation_id === undefined) { failure = "UNSUPPORTED_PHASE"; break; }
            const reservation = allocator.reservations.find((item) => item.reservation_id === event.reservation_id);
            if (reservation === undefined) { failure = "DATA_MISSING"; break; }
            if (event.kind === "OWNERSHIP_UPDATE") {
                const ownership = allocator.ownership.find((item) => item.reservation_id === event.reservation_id);
                if (ownership === undefined || (ownership.status !== "OPEN" && ownership.status !== "RELEASED")) { failure = "DATA_MISSING"; break; }
                lifecycle = "OWNERSHIP_CARRIED";
            } else {
                const cooldown = allocator.cooldown_by_symbol_side_strategy[cooldownKey(reservation.symbol, reservation.side, reservation.strategy_id)];
                if ((reservation.status !== "RELEASED" && reservation.status !== "EXPIRED") || cooldown === undefined || cooldown.until_ts_ms !== event.cooldown_until_ts_ms || cooldown.source_event_ts_ms !== event.cooldown_source_event_ts_ms) { failure = "DATA_MISSING"; break; }
                lifecycle = "COOLDOWN_CARRIED";
            }
        } else if (event.kind === "CANDIDATE_VALIDATION" || event.kind === "CANDIDATE_PRIORITY") {
            if (!event.candidate) { failure = "DATA_MISSING"; break; }
            const causality = candidateCausality(event, event.candidate);
            if (causality !== null) { failure = causality; break; }
            if (event.kind === "CANDIDATE_PRIORITY" && !finite(event.candidate.priority ?? event.candidate.rank)) { failure = "DATA_MISSING"; break; }
            const decision = decideCandidate(allocator, event.candidate, policy.allocator);
            accepted = decision.accepted; reason = decision.reason;
            if (!accepted) { failure = "ALLOCATOR_REJECTED"; break; }
        } else if (event.kind === "ENTRY" || event.kind === "RESERVATION") {
            if (!event.candidate) { failure = "DATA_MISSING"; break; }
            const causality = candidateCausality(event, event.candidate);
            if (causality !== null) { failure = causality; break; }
            const decision = decideCandidate(allocator, event.candidate, policy.allocator);
            allocator = decision.state_after; accepted = decision.accepted; reason = decision.reason;
            if (!accepted) { failure = "ALLOCATOR_REJECTED"; break; }
            const expiryTs = candidateExpiry(event.candidate);
            const reservationId = decision.reservation?.reservation_id;
            if (expiryTs === null || reservationId === undefined) { failure = "DATA_MISSING"; break; }
            reservationExpiry.set(reservationId, expiryTs);
        } else if (event.kind === "ENTRY_FILL" || event.kind === "PARTIAL_FILL" || event.kind === "EXECUTION_RECONCILIATION") {
            if (event.kind === "PARTIAL_FILL") { failure = "PARTIAL_EXECUTION_UNSUPPORTED"; break; }
            if (event.kind === "EXECUTION_RECONCILIATION") { failure = "UNKNOWN_EXECUTION"; break; }
            const expiryTs = event.reservation_id === undefined ? undefined : reservationExpiry.get(event.reservation_id);
            const evidenceKey = executionEvidenceKey(event);
            if (!event.reservation_id || !finite(event.filled_gross) || !validPrice(event.fill_price) || (expiryTs !== undefined && event.timestamp_ms > expiryTs) || !executionFieldsPresent(event) || !executionEvidence(event, event.timestamp_ms) || evidenceKey === null || executionEvidenceKeys.has(evidenceKey)) { failure = "DATA_MISSING"; break; }
            const transition = confirmFill(allocator, event.reservation_id, { fill_ts_ms: event.timestamp_ms, filled_gross: event.filled_gross });
            if (!transition.applied) { accepted = false; reason = transition.reason; failure = "DATA_MISSING"; break; } else allocator = transition.state_after;
            executionEvidenceKeys.add(evidenceKey);
        } else if (event.kind === "PROTECTION_REGISTRATION") {
            if (!event.reservation_id || !event.protection_id) { failure = "DATA_MISSING"; break; }
            const transition = registerProtection(allocator, event.reservation_id, { protection_id: event.protection_id, registered_ts_ms: event.timestamp_ms });
            if (!transition.applied) { accepted = false; reason = transition.reason; } else allocator = transition.state_after;
        } else if (event.kind === "MARK") {
            const point = markEquity(allocator, marketData, event.timestamp_ms, cash.wallet, peak);
            if (point === null) { failure = "DATA_MISSING"; break; }
            peak = point.peak_equity_jpy; equity = point.equity_jpy; mtm.push(point);
        } else if (event.kind === "RESERVATION_RELEASE") {
            const reservation = event.reservation_id === undefined ? undefined : allocator.reservations.find((item) => item.reservation_id === event.reservation_id);
            if (reservation === undefined || reservation.status !== "PENDING") { failure = "DATA_MISSING"; break; }
            const transition = releaseReservation(allocator, event.reservation_id!, { at_ts_ms: event.timestamp_ms, reason: event.exit_reason ?? "EXPIRY", cooldown_until_ts_ms: event.cooldown_until_ts_ms, cooldown_source_event_ts_ms: event.cooldown_source_event_ts_ms });
            if (!transition.applied) { failure = "DATA_MISSING"; break; }
            allocator = transition.state_after;
        } else if (event.kind === "PREEMPTION_EXIT") {
            const settlement = settlementValues(event, policy);
            const incomingCandidate = event.incoming_candidate ?? event.candidate;
            const incomingCausality = incomingCandidate === undefined ? "DATA_MISSING" : candidateCausality(event, incomingCandidate);
            const evidenceKey = executionEvidenceKey(event);
            if (split === "OOS" || incomingCausality !== null || settlement === null || !validPrice(event.exit_price) || !executionFieldsPresent(event) || !event.victim_position || incomingCandidate === undefined || !event.reservation_id || !finite(event.filled_gross) || event.exit_status === undefined || !executionEvidence(event, event.timestamp_ms) || evidenceKey === null || executionEvidenceKeys.has(evidenceKey)) { failure = split === "OOS" ? "DATA_MISSING" : incomingCausality ?? "DATA_MISSING"; break; }
            if (event.exit_status === "PARTIAL") { failure = "PARTIAL_EXECUTION_UNSUPPORTED"; break; }
            if (event.exit_status === "UNKNOWN") { failure = "UNKNOWN_EXECUTION"; break; }
            const sameTimestamp = ordered.filter((item) => item.timestamp_ms === event.timestamp_ms).map((item) => ({ ...item, candidate_id: item.victim_position?.candidate_id ?? item.candidate?.candidate_id ?? item.incoming_candidate?.candidate_id }));
            const transition = applyPreemption({ state: allocator, incoming_candidate: incomingCandidate, victim_position: event.victim_position, mode: event.mode ?? "WHOLE", requested_gross: event.filled_gross, exit: { status: event.exit_status, confirmed: event.confirmed === true && executionEvidence(event, event.timestamp_ms), filled_gross: event.filled_gross, exit_ts_ms: event.timestamp_ms, exit_price: event.exit_price }, cooldown: { until_ts_ms: event.cooldown_until_ts_ms, source_event_ts_ms: event.cooldown_source_event_ts_ms }, policy: policy.allocator, ordering_events: event.ordering_events ?? sameTimestamp });
            if (!transition.victim_release_applied) { accepted = false; reason = transition.reason; failure = transition.reason === "PARTIAL_EXECUTION_UNSUPPORTED" ? "PARTIAL_EXECUTION_UNSUPPORTED" : transition.reason === "UNKNOWN_EXECUTION" ? "UNKNOWN_EXECUTION" : "DATA_MISSING"; break; }
            allocator = transition.state_after; lifecycle = transition.lifecycle === "VICTIM_RELEASED_INCOMING_REJECTED" ? "VICTIM_RELEASED_INCOMING_REJECTED" : null; accepted = transition.applied || lifecycle === "VICTIM_RELEASED_INCOMING_REJECTED"; reason = transition.reason;
            if (!accepted) { failure = "DATA_MISSING"; break; }
            if (transition.applied) {
                const incomingReservation = transition.incoming_admission?.reservation;
                const incomingExpiry = candidateExpiry(incomingCandidate);
                if (incomingReservation === null || incomingReservation === undefined || incomingExpiry === null) { failure = "DATA_MISSING"; break; }
                reservationExpiry.set(incomingReservation.reservation_id, incomingExpiry);
            }
            executionEvidenceKeys.add(evidenceKey);
            const key = `reservation:${event.reservation_id}`;
            if (charged.has(key)) { failure = "DUPLICATE_CHARGE"; break; }
            charged.add(key); eventRealized = settlement.pnlJpy; eventFee = settlement.feeJpy; eventFunding = settlement.fundingJpy;
            cash.wallet += eventRealized - eventFee + eventFunding; cash.realized += eventRealized; cash.realizedSettlement += settlement.pnl; cash.fees += eventFee; cash.feesSettlement += settlement.fee; cash.funding += eventFunding; cash.fundingSettlement += settlement.funding;
            charge = { event_id: event.event_id, kind: event.kind, settlement_currency: settlement.currency, settlement_pnl: settlement.pnl, pnl_jpy: settlement.pnlJpy, fee_settlement: settlement.fee, fee_jpy: settlement.feeJpy, funding_settlement: settlement.funding, funding_jpy: settlement.fundingJpy, slippage_settlement: 0, gap_settlement: 0, wallet_delta_jpy: eventRealized - eventFee + eventFunding };
        } else if (isExit(event.kind)) {
            const settlement = settlementValues(event, policy);
            const reservation = event.reservation_id === undefined ? undefined : allocator.reservations.find((item) => item.reservation_id === event.reservation_id);
            const evidenceKey = executionEvidenceKey(event);
            if (settlement === null || !validPrice(event.exit_price) || !executionFieldsPresent(event) || !executionEvidence(event, event.timestamp_ms) || evidenceKey === null || executionEvidenceKeys.has(evidenceKey) || reservation === undefined || reservation.status === "PENDING" || reservation.status === "PARTIALLY_FILLED" || reservation.status === "RELEASED" || reservation.status === "EXPIRED" || reservation.fill_ts_ms === null || event.timestamp_ms < reservation.fill_ts_ms) { failure = reservation?.status === "RELEASED" || reservation?.status === "EXPIRED" ? "DUPLICATE_CHARGE" : "DATA_MISSING"; break; }
            if (isStop(event.kind) && (reservation.status !== "PROTECTED" || reservation.protection_id === null || event.protection_id !== reservation.protection_id)) { failure = "DATA_MISSING"; break; }
            const key = `reservation:${event.reservation_id}`;
            if (charged.has(key)) { failure = "DUPLICATE_CHARGE"; break; }
            const transition = releaseReservation(allocator, event.reservation_id!, { at_ts_ms: event.timestamp_ms, reason: event.exit_reason ?? event.kind, cooldown_until_ts_ms: event.cooldown_until_ts_ms, cooldown_source_event_ts_ms: event.cooldown_source_event_ts_ms });
            if (!transition.applied) { accepted = false; reason = transition.reason; failure = "DATA_MISSING"; break; }
            allocator = transition.state_after; executionEvidenceKeys.add(evidenceKey); charged.add(key); eventRealized = settlement.pnlJpy; eventFee = settlement.feeJpy; eventFunding = settlement.fundingJpy;
            cash.wallet += eventRealized - eventFee + eventFunding; cash.realized += eventRealized; cash.realizedSettlement += settlement.pnl; cash.fees += eventFee; cash.feesSettlement += settlement.fee; cash.funding += eventFunding; cash.fundingSettlement += settlement.funding;
            charge = { event_id: event.event_id, kind: event.kind, settlement_currency: settlement.currency, settlement_pnl: settlement.pnl, pnl_jpy: settlement.pnlJpy, fee_settlement: settlement.fee, fee_jpy: settlement.feeJpy, funding_settlement: settlement.funding, funding_jpy: settlement.fundingJpy, slippage_settlement: 0, gap_settlement: 0, wallet_delta_jpy: eventRealized - eventFee + eventFunding };
        }
        const refreshMtm = event.kind === "DEPOSIT" || event.kind === "FUNDING" || event.kind === "PREEMPTION_EXIT" || event.kind === "NORMAL_EXIT" || event.kind === "TAKE_PROFIT" || event.kind === "TIME_STOP" || event.kind === "PROTECTION_STOP" || event.kind === "STOP";
        let mtmRefreshed = false;
        if (refreshMtm && snapshotPositions(allocator).length > 0) {
            const point = markEquity(allocator, marketData, event.timestamp_ms, cash.wallet, peak);
            if (point === null) { failure = "DATA_MISSING"; break; }
            peak = point.peak_equity_jpy; equity = point.equity_jpy; mtm.push(point); mtmRefreshed = true;
        }
        processed.add(event.event_id);
        if (charge !== null) charges.push(charge);
        if (!mtmRefreshed && (event.kind === "DEPOSIT" || event.kind === "FUNDING" || charge !== null)) equity = cash.wallet;
        allocator = syncAllocatorCash(allocator, cash.wallet, equity, walletBefore);
        const ledger: ReplayLedgerEntry = { event_id: event.event_id, timestamp_ms: event.timestamp_ms, kind: event.kind, accepted, reason, data_split: split, state_hash_before: hashAllocatorState(before), state_hash_after: hashAllocatorState(allocator), allocator_before: before, allocator_after: allocator, wallet_before_jpy: walletBefore, wallet_after_jpy: cash.wallet, realized_pnl_jpy: eventRealized, fee_jpy: eventFee, funding_jpy: eventFunding, lifecycle };
        snapshots.push(ledger);
        execution.push(ledger);
        if (event.kind === "PREEMPTION_EXIT") preemptions.push(ledger);
        if (event.kind === "RESERVATION" || event.kind === "ENTRY") reservations.push(ledger);
    }
    const ledgerDeposits = depositsLedger.reduce((sum, item) => sum + item.amount_jpy, 0);
    const ledgerCharges = charges.reduce((sum, item) => sum + item.wallet_delta_jpy, 0);
    const expectedWallet = policy.initial_wallet_jpy + ledgerDeposits + ledgerCharges;
    const delta = cash.wallet - expectedWallet;
    const chargeTotal = charges.reduce((sum, item) => sum + item.wallet_delta_jpy, 0);
    const chargeReconciliation = Math.abs((cash.realized - cash.fees + cash.funding) - chargeTotal) <= EPSILON && Math.abs(cash.deposits - ledgerDeposits) <= EPSILON ? "PASS" : "FAIL";
    const currencies = new Set(charges.map((item) => item.settlement_currency));
    const accounting: ReplayAccounting = { initial_wallet_jpy: policy.initial_wallet_jpy, wallet_jpy: cash.wallet, realized_pnl_settlement: cash.realizedSettlement, realized_pnl_jpy: cash.realized, fees_settlement: cash.feesSettlement, fees_jpy: cash.fees, funding_settlement: cash.fundingSettlement, funding_jpy: cash.funding, settlement_currency: currencies.size === 1 ? [...currencies][0] : null, deposits_jpy: cash.deposits, expected_wallet_jpy: expectedWallet, reconciliation_delta_jpy: delta, accounting_reconciliation: Math.abs(delta) <= EPSILON ? "PASS" : "FAIL", charge_ledger: charges, charge_reconciliation: chargeReconciliation };
    const dd = windows(mtm);
    return { status: failure === null && accounting.accounting_reconciliation === "PASS" && accounting.charge_reconciliation === "PASS" ? "PASS" : "FAIL", rejection: failure, allocator_state: allocator, execution_ledger: execution, reservation_ledger: reservations, preemption_ledger: preemptions, allocator_state_snapshots: snapshots, charge_ledger: charges, mtm_timeline: mtm, accounting, maximum_mtm_dd: dd[0] ?? null, top5_dd_windows: dd, ordering_evidence: ordering, oos_boundary: boundary, processed_event_ids: [...processed] };
}

