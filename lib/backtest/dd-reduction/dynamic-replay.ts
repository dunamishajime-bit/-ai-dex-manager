import {
    confirmFill,
    createInitialAllocatorState,
    decideCandidate,
    registerProtection,
    releaseReservation,
    type DynamicAllocatorCandidate,
    type DynamicAllocatorPolicy,
    type DynamicAllocatorState,
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
    readonly exit_reason?: string;
    readonly cooldown_until_ts_ms?: number | null;
    readonly cooldown_source_event_ts_ms?: number | null;
}
export interface ReplayMarketMark {
    readonly timestamp_ms: number;
    readonly symbol: string;
    readonly price: number;
    readonly fx_rate?: number;
}

export interface DynamicReplayPolicy {
    readonly allocator: DynamicAllocatorPolicy;
    readonly initial_wallet_jpy: number;
    readonly default_fx_rate?: number;
    readonly require_canonical_same_bar_order?: boolean;
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
    | "ALLOCATOR_REJECTED";

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
    readonly realized_pnl_jpy: number;
    readonly fees_jpy: number;
    readonly funding_jpy: number;
    readonly deposits_jpy: number;
    readonly expected_wallet_jpy: number;
    readonly reconciliation_delta_jpy: number;
    readonly accounting_reconciliation: "PASS" | "FAIL";
}

export interface ReplayMtmPoint {
    readonly timestamp_ms: number;
    readonly wallet_jpy: number;
    readonly unrealized_pnl_jpy: number;
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
    readonly state_hash_before: string;
    readonly state_hash_after: string;
    readonly allocator_before: DynamicAllocatorState;
    readonly allocator_after: DynamicAllocatorState;
    readonly wallet_before_jpy: number;
    readonly wallet_after_jpy: number;
    readonly realized_pnl_jpy: number;
    readonly fee_jpy: number;
    readonly funding_jpy: number;
}

export interface DynamicReplayResult {
    readonly status: "PASS" | "FAIL";
    readonly rejection: ReplayRejection | null;
    readonly allocator_state: DynamicAllocatorState;
    readonly execution_ledger: readonly ReplayLedgerEntry[];
    readonly reservation_ledger: readonly ReplayLedgerEntry[];
    readonly preemption_ledger: readonly ReplayLedgerEntry[];
    readonly allocator_state_snapshots: readonly ReplayLedgerEntry[];
    readonly mtm_timeline: readonly ReplayMtmPoint[];
    readonly accounting: ReplayAccounting;
    readonly maximum_mtm_dd: ReplayDdWindow | null;
    readonly top5_dd_windows: readonly ReplayDdWindow[];
    readonly ordering_evidence: ReturnType<typeof classifyOrderingEvidence>;
    readonly processed_event_ids: readonly string[];
}

interface MutableAccounting {
    wallet: number;
    realized: number;
    fees: number;
    funding: number;
    deposits: number;
}

const EPSILON = 1e-8;

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function jpy(value: number, event: ReplayEvent, policy: DynamicReplayPolicy): number | null {
    const fx = event.fx_rate ?? policy.default_fx_rate ?? 1;
    if (!finite(value) || !finite(fx) || fx <= 0) return null;
    return value * fx;
}

function eventKind(event: ReplayEvent): string {
    return event.kind;
}

function isExit(kind: ReplayEventKind): boolean {
    return ["PROTECTION_STOP", "STOP", "PREEMPTION_EXIT", "NORMAL_EXIT", "TAKE_PROFIT", "TIME_STOP", "RESERVATION_RELEASE"].includes(kind);
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

function markEquity(state: DynamicAllocatorState, marks: readonly ReplayMarketMark[], at: number, wallet: number, peak: number): ReplayMtmPoint {
    const open = snapshotPositions(state);
    let unrealized = 0;
    for (const position of open) {
        const mark = [...marks].reverse().find((item) => item.symbol === position.symbol && item.timestamp_ms <= at);
        if (!mark) continue;
        const delta = position.side === "LONG" ? mark.price - position.entry_price : position.entry_price - mark.price;
        unrealized += delta * position.quantity * (mark.fx_rate ?? 1);
    }
    const equity = wallet + unrealized;
    const nextPeak = Math.max(peak, equity);
    const dd = nextPeak > 0 ? ((equity - nextPeak) / nextPeak) * 100 : 0;
    return { timestamp_ms: at, wallet_jpy: wallet, unrealized_pnl_jpy: unrealized, equity_jpy: equity, total_gross: state.total_gross, open_positions: open, peak_equity_jpy: nextPeak, drawdown_pct: dd };
}

function windows(points: readonly ReplayMtmPoint[]): ReplayDdWindow[] {
    const result: ReplayDdWindow[] = [];
    for (let index = 0; index < points.length; index += 1) {
        const peak = points[index];
        for (let troughIndex = index; troughIndex < points.length; troughIndex += 1) {
            const trough = points[troughIndex];
            if (trough.equity_jpy > peak.equity_jpy + EPSILON) break;
            const drawdown = peak.equity_jpy > 0 ? ((trough.equity_jpy - peak.equity_jpy) / peak.equity_jpy) * 100 : 0;
            const recovery = points.slice(troughIndex + 1).find((point) => point.equity_jpy >= peak.equity_jpy - EPSILON);
            result.push({ peak_ts_ms: peak.timestamp_ms, trough_ts_ms: trough.timestamp_ms, recovery_ts_ms: recovery?.timestamp_ms ?? null, peak_equity_jpy: peak.equity_jpy, trough_equity_jpy: trough.equity_jpy, drawdown_pct: drawdown });
        }
    }
    return result.sort((left, right) => left.drawdown_pct - right.drawdown_pct).slice(0, 5);
}

function rejectedResult(policy: DynamicReplayPolicy, events: readonly ReplayEvent[], reason: ReplayRejection, orderingEvidence: ReturnType<typeof classifyOrderingEvidence>): DynamicReplayResult {
    const state = createInitialAllocatorState({ wallet_jpy: policy.initial_wallet_jpy, equity_jpy: policy.initial_wallet_jpy, available_margin: policy.initial_wallet_jpy });
    const accounting: ReplayAccounting = { initial_wallet_jpy: policy.initial_wallet_jpy, wallet_jpy: policy.initial_wallet_jpy, realized_pnl_jpy: 0, fees_jpy: 0, funding_jpy: 0, deposits_jpy: 0, expected_wallet_jpy: policy.initial_wallet_jpy, reconciliation_delta_jpy: 0, accounting_reconciliation: "PASS" };
    return { status: "FAIL", rejection: reason, allocator_state: state, execution_ledger: [], reservation_ledger: [], preemption_ledger: [], allocator_state_snapshots: [], mtm_timeline: [], accounting, maximum_mtm_dd: null, top5_dd_windows: [], ordering_evidence: orderingEvidence, processed_event_ids: events.map((event) => event.event_id) };
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
    const ordered = orderDynamicEvents(events) as ReplayEvent[];
    const allocatorStart = createInitialAllocatorState({ wallet_jpy: policy.initial_wallet_jpy, equity_jpy: policy.initial_wallet_jpy, available_margin: policy.initial_wallet_jpy });
    let allocator = allocatorStart;
    const cash: MutableAccounting = { wallet: policy.initial_wallet_jpy, realized: 0, fees: 0, funding: 0, deposits: 0 };
    const processed = new Set<string>();
    const execution: ReplayLedgerEntry[] = [];
    const reservations: ReplayLedgerEntry[] = [];
    const preemptions: ReplayLedgerEntry[] = [];
    const snapshots: ReplayLedgerEntry[] = [];
    const mtm: ReplayMtmPoint[] = [{
        timestamp_ms: 0,
        wallet_jpy: policy.initial_wallet_jpy,
        unrealized_pnl_jpy: 0,
        equity_jpy: policy.initial_wallet_jpy,
        total_gross: 0,
        open_positions: [],
        peak_equity_jpy: policy.initial_wallet_jpy,
        drawdown_pct: 0,
    }];
    let peak = policy.initial_wallet_jpy;
    let failure: ReplayRejection | null = null;

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
        if (event.kind === "DEPOSIT") {
            if (!finite(event.amount_jpy) || event.amount_jpy < 0) { failure = "DATA_MISSING"; break; }
            cash.wallet += event.amount_jpy; cash.deposits += event.amount_jpy;
        } else if (event.kind === "FUNDING") {
            const amount = jpy(event.funding_settlement ?? event.amount_jpy ?? 0, event, policy);
            if (amount === null) { failure = "DATA_MISSING"; break; }
            cash.wallet += amount; cash.funding += amount; eventFunding = amount;
        } else if (isExit(event.kind)) {
            if (!event.reservation_id) { failure = "DATA_MISSING"; break; }
            const pnl = jpy(event.settlement_pnl ?? 0, event, policy);
            const fee = jpy(event.fee_settlement ?? 0, event, policy);
            const funding = jpy(event.funding_settlement ?? 0, event, policy);
            if (pnl === null || fee === null || funding === null || fee < 0) { failure = "DATA_MISSING"; break; }
            const transition = releaseReservation(allocator, event.reservation_id, { at_ts_ms: event.timestamp_ms, reason: event.exit_reason ?? event.kind, cooldown_until_ts_ms: event.cooldown_until_ts_ms, cooldown_source_event_ts_ms: event.cooldown_source_event_ts_ms });
            if (!transition.applied) { accepted = false; reason = transition.reason; failure = "DATA_MISSING"; }
            else {
                allocator = transition.state_after; eventRealized = pnl; eventFee = fee; eventFunding = funding;
                cash.wallet += pnl - fee + funding; cash.realized += pnl; cash.fees += fee; cash.funding += funding;
            }
        } else if (event.kind === "ENTRY" || event.kind === "CANDIDATE_VALIDATION" || event.kind === "CANDIDATE_PRIORITY" || event.kind === "RESERVATION") {
            if (!event.candidate) { failure = "DATA_MISSING"; break; }
            const decision = decideCandidate(allocator, event.candidate, policy.allocator);
            allocator = decision.state_after; accepted = decision.accepted; reason = decision.reason;
            if (decision.accepted) reservations.push({ event_id: event.event_id, timestamp_ms: event.timestamp_ms, kind: event.kind, accepted, reason, state_hash_before: decision.state_hash_before, state_hash_after: decision.state_hash_after, allocator_before: decision.state_before, allocator_after: decision.state_after, wallet_before_jpy: walletBefore, wallet_after_jpy: cash.wallet, realized_pnl_jpy: 0, fee_jpy: 0, funding_jpy: 0 });
        } else if (event.kind === "ENTRY_FILL" || event.kind === "PARTIAL_FILL" || event.kind === "EXECUTION_RECONCILIATION") {
            if (!event.reservation_id || event.kind !== "ENTRY_FILL" || !finite(event.filled_gross)) { failure = event.kind === "PARTIAL_FILL" ? "PARTIAL_EXECUTION_UNSUPPORTED" : "UNKNOWN_EXECUTION"; break; }
            const transition = confirmFill(allocator, event.reservation_id, { fill_ts_ms: event.timestamp_ms, filled_gross: event.filled_gross });
            if (!transition.applied) { accepted = false; reason = transition.reason; }
            else allocator = transition.state_after;
        } else if (event.kind === "PROTECTION_REGISTRATION") {
            if (!event.reservation_id || !event.protection_id) { failure = "DATA_MISSING"; break; }
            const transition = registerProtection(allocator, event.reservation_id, { protection_id: event.protection_id, registered_ts_ms: event.timestamp_ms });
            if (!transition.applied) { accepted = false; reason = transition.reason; }
            else allocator = transition.state_after;
        } else if (event.kind === "MARK") {
            const point = markEquity(allocator, marketData, event.timestamp_ms, cash.wallet, peak); peak = point.peak_equity_jpy; mtm.push(point);
        }
        processed.add(event.event_id);
        const ledger: ReplayLedgerEntry = { event_id: event.event_id, timestamp_ms: event.timestamp_ms, kind: event.kind, accepted, reason, state_hash_before: hashAllocatorState(before), state_hash_after: hashAllocatorState(allocator), allocator_before: before, allocator_after: allocator, wallet_before_jpy: walletBefore, wallet_after_jpy: cash.wallet, realized_pnl_jpy: eventRealized, fee_jpy: eventFee, funding_jpy: eventFunding };
        snapshots.push(ledger);
        execution.push(ledger);
        if (event.kind === "PREEMPTION_EXIT") preemptions.push(ledger);
        if (event.kind === "RESERVATION" || event.kind === "ENTRY") reservations.push(ledger);
    }
    const expectedWallet = cash.deposits + policy.initial_wallet_jpy + cash.realized - cash.fees + cash.funding;
    const delta = cash.wallet - expectedWallet;
    const accounting: ReplayAccounting = { initial_wallet_jpy: policy.initial_wallet_jpy, wallet_jpy: cash.wallet, realized_pnl_jpy: cash.realized, fees_jpy: cash.fees, funding_jpy: cash.funding, deposits_jpy: cash.deposits, expected_wallet_jpy: expectedWallet, reconciliation_delta_jpy: delta, accounting_reconciliation: Math.abs(delta) <= EPSILON ? "PASS" : "FAIL" };
    const dd = windows(mtm);
    return { status: failure === null && accounting.accounting_reconciliation === "PASS" ? "PASS" : "FAIL", rejection: failure, allocator_state: allocator, execution_ledger: execution, reservation_ledger: reservations, preemption_ledger: preemptions, allocator_state_snapshots: snapshots, mtm_timeline: mtm, accounting, maximum_mtm_dd: dd[0] ?? null, top5_dd_windows: dd, ordering_evidence: ordering, processed_event_ids: [...processed] };
}

