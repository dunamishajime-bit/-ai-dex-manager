import type {
    CandidateDecision,
    BaselineLedgerEntry,
    CanonicalSource,
    Direction,
    ExecutionBar,
    ExecutionExit,
    IntegratedReplay,
    LifecycleEvent,
    PortfolioState,
    PositionLifecycle,
    ReplayConfig,
    Reservation,
} from "./types";
import {
    applyProtectionPolicy,
    positionWithProtection,
    type PositionLifecycleWithProtection,
    type ProtectionEvent,
    type ProtectionState,
    type ProtectionPolicyInput,
} from "./protection";

export interface GrossCaps {
    readonly totalGross: number;
    readonly cryptoGross: number;
    readonly strategyGross: number;
}

export type ExecutionOrdering = "ENTRY" | "STOP" | "NORMAL_EXIT" | "TAKE_PROFIT" | "TIME_STOP";
export type ExecutionStatus = "FILLED" | "PARTIAL_FILLED" | "UNKNOWN";

export interface ExecutionLifecycleEvent extends LifecycleEvent {
    readonly executionKind: ExecutionOrdering;
    readonly clientOrderId: string;
    readonly quantity: number;
    readonly executionStatus: ExecutionStatus;
    readonly price?: number;
}

export interface CandidateDecisionWithExecution extends CandidateDecision {
    readonly worstCaseGross?: number;
    readonly clientOrderId?: string;
}

export interface CandidateReservationState extends Omit<PortfolioState, "positions"> {
    readonly pendingGross: number;
    readonly positions: readonly PositionLifecycleWithProtection[];
    readonly caps: GrossCaps;
    readonly grossBySymbol: Readonly<Record<string, number>>;
    readonly grossByStrategy: Readonly<Record<string, number>>;
    readonly reservedCandidateIds: readonly string[];
    readonly intentLedger: Readonly<Record<string, string>>;
    readonly pendingGrossBySymbol?: Readonly<Record<string, number>>;
    readonly reservedGrossBySymbol?: Readonly<Record<string, number>>;
    readonly pendingGrossByStrategy?: Readonly<Record<string, number>>;
    readonly reservedGrossByStrategy?: Readonly<Record<string, number>>;
    readonly eventOrdering: readonly ExecutionOrdering[];
    readonly manualReview: readonly string[];
    readonly events: readonly ExecutionLifecycleEvent[];
    readonly protectionReadback: boolean;
}

export type PortfolioRuntimeState = CandidateReservationState;

export interface ReservationResult {
    readonly accepted: boolean;
    readonly state: PortfolioRuntimeState;
    readonly reservation: Reservation | null;
    readonly reason: string;
    readonly preemptedCandidateIds: readonly string[];
}

export interface ReplayConfigWithRuntime extends ReplayConfig {
    readonly deposits?: readonly { readonly ts: number; readonly amount: number }[];
    readonly caps?: GrossCaps;
    readonly eventOrdering?: readonly ExecutionOrdering[];
    readonly fixedBaselinePolicy?: string;
    readonly directionPolicies?: Partial<Record<Direction, ProtectionPolicyInput>>;
    readonly baselinePositions?: readonly PositionLifecycle[];
    readonly executionEvents?: readonly ExecutionLifecycleEvent[];
    readonly protectionReadback?: boolean;
}

export interface ProtectionLedgerEntry extends ProtectionEvent {
    readonly positionId: string;
    readonly stopPrice: number;
    readonly trigger: string;
}

export interface ReplayLedgers {
    readonly decisionLedger: readonly CandidateDecision[];
    readonly reservationLedger: readonly Reservation[];
    readonly protectionLedger: readonly ProtectionLedgerEntry[];
    readonly tradeLedger: readonly PositionLifecycle[];
    readonly equityMtmTimeline: readonly PortfolioState[];
    readonly accountingReconciliation: readonly string[];
    readonly rejectionCount: number;
    readonly preemptionCount: number;
}

export type IntegratedReplayResult = IntegratedReplay & ReplayLedgers;

function stateCopy(state: CandidateReservationState, overrides: Partial<CandidateReservationState>): PortfolioRuntimeState {
    return { ...state, ...overrides };
}

function runtimeState(state: PortfolioState): PortfolioRuntimeState {
    const candidate = state as Partial<CandidateReservationState>;
    return {
        ...state,
        pendingGross: candidate.pendingGross ?? 0,
        positions: (candidate.positions ?? []).map(positionWithProtection),
        caps: candidate.caps ?? { totalGross: Number.POSITIVE_INFINITY, cryptoGross: Number.POSITIVE_INFINITY, strategyGross: Number.POSITIVE_INFINITY },
        grossBySymbol: candidate.grossBySymbol ?? {},
        grossByStrategy: candidate.grossByStrategy ?? {},
        reservedCandidateIds: candidate.reservedCandidateIds ?? [],
        intentLedger: candidate.intentLedger ?? {},
        eventOrdering: candidate.eventOrdering ?? ["STOP", "NORMAL_EXIT", "TAKE_PROFIT", "TIME_STOP"],
        manualReview: candidate.manualReview ?? [],
        events: candidate.events ?? [],
        protectionReadback: candidate.protectionReadback === true,
    };
}

function grossForCandidate(candidate: CandidateDecisionWithExecution): number {
    const value = Math.max(candidate.worstCaseGross ?? 0, candidate.requestedGross, candidate.acceptedGross);
    if (!(value > 0) || !Number.isFinite(value)) throw new Error("INVALID_CANDIDATE_GROSS");
    return value;
}

function reservationFor(state: CandidateReservationState, candidate: CandidateDecisionWithExecution, gross: number): Reservation {
    return {
        sourceHash: candidate.sourceHash,
        ts: candidate.ts,
        requestedGross: gross,
        acceptedGross: gross,
        reservedGross: gross,
        reason: "CANDIDATE_RESERVED",
    };
}

function candidateAlreadyReserved(state: CandidateReservationState, candidate: CandidateDecisionWithExecution): boolean {
    const clientOrderId = candidate.clientOrderId ?? candidate.candidateId;
    return state.reservedCandidateIds.includes(candidate.candidateId) || state.intentLedger[clientOrderId] !== undefined;
}

export function reserveCandidate(
    state: PortfolioState,
    candidate: CandidateDecision,
): ReservationResult;
export function reserveCandidate(
    state: CandidateReservationState,
    candidate: CandidateDecisionWithExecution,
): ReservationResult;
export function reserveCandidate(
    state: PortfolioState,
    candidate: CandidateDecisionWithExecution,
): ReservationResult {
    const runtime = runtimeState(state);
    if (!candidate.accepted) return { accepted: false, state: runtime, reservation: null, reason: candidate.rejectionReason ?? "CANDIDATE_REJECTED", preemptedCandidateIds: [] };
    if (runtime.protectionReadback !== true) return { accepted: false, state: runtime, reservation: null, reason: "PROTECTION_READBACK_REQUIRED", preemptedCandidateIds: [] };
    if (candidateAlreadyReserved(runtime, candidate)) return { accepted: false, state: runtime, reservation: null, reason: "IDEMPOTENT_INTENT_ALREADY_RESERVED", preemptedCandidateIds: [] };
    const gross = grossForCandidate(candidate);
    const totalAfterWorstCase = runtime.acceptedGross + runtime.pendingGross + runtime.reservedGross + gross;
    const symbolAfterWorstCase = (runtime.grossBySymbol[candidate.symbol] ?? 0)
        + (runtime.pendingGrossBySymbol?.[candidate.symbol] ?? 0)
        + (runtime.reservedGrossBySymbol?.[candidate.symbol] ?? 0)
        + gross;
    const strategyAfterWorstCase = (runtime.grossByStrategy[candidate.strategy] ?? 0)
        + (runtime.pendingGrossByStrategy?.[candidate.strategy] ?? 0)
        + (runtime.reservedGrossByStrategy?.[candidate.strategy] ?? 0)
        + gross;
    const capReason = totalAfterWorstCase > runtime.caps.totalGross
        ? "GROSS_CAP_TOTAL"
        : symbolAfterWorstCase > runtime.caps.cryptoGross
            ? "GROSS_CAP_CRYPTO"
            : strategyAfterWorstCase > runtime.caps.strategyGross
                ? "GROSS_CAP_STRATEGY"
                : null;
    if (capReason !== null) return { accepted: false, state: runtime, reservation: null, reason: capReason, preemptedCandidateIds: [] };

    const reservation = reservationFor(runtime, candidate, gross);
    const clientOrderId = candidate.clientOrderId ?? candidate.candidateId;
    return {
        accepted: true,
        reservation,
        reason: "CANDIDATE_RESERVED",
        preemptedCandidateIds: [],
        state: stateCopy(runtime, {
            reservedGross: runtime.reservedGross + gross,
            reservedCandidateIds: [...runtime.reservedCandidateIds, candidate.candidateId],
            intentLedger: { ...runtime.intentLedger, [clientOrderId]: "RESERVED" },
        }),
    };
}

function eventPriority(state: CandidateReservationState, event: ExecutionLifecycleEvent): number {
    const order = state.eventOrdering.length > 0 ? state.eventOrdering : ["STOP", "NORMAL_EXIT"];
    const index = order.indexOf(event.executionKind);
    return index === -1 ? order.length : index;
}

function eventIsKnown(event: ExecutionLifecycleEvent): boolean {
    return (event.executionStatus === "FILLED" || event.executionStatus === "PARTIAL_FILLED")
        && Number.isFinite(event.quantity)
        && event.quantity > 0
        && event.price !== undefined
        && Number.isFinite(event.price)
        && event.price > 0;
}

function executionEvent(event: LifecycleEvent): ExecutionLifecycleEvent {
    const candidate = event as Partial<ExecutionLifecycleEvent>;
    return {
        ...event,
        executionKind: candidate.executionKind ?? (event.eventType === "EXIT" ? "NORMAL_EXIT" : "ENTRY"),
        clientOrderId: candidate.clientOrderId ?? event.eventId,
        quantity: candidate.quantity ?? event.exit?.quantity ?? event.fill?.quantity ?? 0,
        executionStatus: candidate.executionStatus ?? (event.exit !== null || event.fill !== null ? "FILLED" : "UNKNOWN"),
        price: candidate.price ?? event.exit?.price ?? event.fill?.price,
    };
}

function exitFromEvent(event: ExecutionLifecycleEvent, quantity: number): ExecutionExit {
    const price = event.price ?? event.fill?.price ?? 0;
    return {
        sourceHash: event.sourceHash,
        ts: event.ts,
        price,
        quantity,
        gross: price * quantity,
        fee: event.fee,
        funding: event.funding,
        slippage: event.slippage,
        realizedPnl: 0,
        reason: event.reason,
    };
}

function applyExecutionToPosition(
    position: PositionLifecycleWithProtection,
    event: ExecutionLifecycleEvent,
): PositionLifecycleWithProtection {
    const currentQuantity = Math.max(0, position.remainingQuantity);
    const fillQuantity = Math.min(currentQuantity, Math.max(0, event.quantity));
    if (fillQuantity === 0 || position.exit !== null) return position;
    const remainingQuantity = Math.max(0, currentQuantity - fillQuantity);
    if (event.executionStatus === "PARTIAL_FILLED" || remainingQuantity > 0) {
        const existingProtection = position.protection;
        const protection: ProtectionState = existingProtection === null
            ? {
                entryPrice: position.entryFill?.price ?? 0,
                direction: position.direction,
                activated: false,
                mfeBps: 0,
                mfePrice: position.entryFill?.price ?? 0,
                favorableBps: 0,
                profitFloorPrice: null,
                trailPrice: null,
                stopPrice: 0,
                givebackBps: 0,
                remainingQuantity,
                protectedQuantity: remainingQuantity,
                reprotectQuantity: remainingQuantity,
                barsHeld: 0,
                clientOrderId: `reprotect:${event.clientOrderId}`,
                events: [{ kind: "REPROTECT", ts: event.ts, quantity: remainingQuantity, price: event.price ?? 0, reason: "PARTIAL_PROTECTIVE_FILL" }],
            }
            : {
                ...existingProtection,
                remainingQuantity,
                protectedQuantity: remainingQuantity,
                reprotectQuantity: remainingQuantity,
                events: [...existingProtection.events, { kind: "REPROTECT", ts: event.ts, quantity: remainingQuantity, price: event.price ?? existingProtection.stopPrice, reason: "PARTIAL_PROTECTIVE_FILL" }],
            };
        return { ...position, remainingQuantity, protectedQuantity: remainingQuantity, protection };
    }
    return {
        ...position,
        remainingQuantity: 0,
        protectedQuantity: 0,
        exit: exitFromEvent(event, fillQuantity),
    };
}

function reconcilePositions(
    state: CandidateReservationState,
    event: ExecutionLifecycleEvent,
    orderedEvents: readonly ExecutionLifecycleEvent[],
): readonly PositionLifecycleWithProtection[] {
    return state.positions.map((position) => {
        if (position.positionId !== event.positionId) return position;
        const applicable = orderedEvents.filter((candidate) => candidate.positionId === position.positionId && eventIsKnown(candidate));
        const sameTimestampExecutions = applicable.filter((candidate) => candidate.ts === event.ts);
        const rebuildSameTimestamp = sameTimestampExecutions.length > 1 || (sameTimestampExecutions.length === 1 && position.exit?.ts === event.ts);
        let current = rebuildSameTimestamp
            ? {
                ...position,
                exit: null,
                remainingQuantity: position.entryFill?.quantity ?? position.remainingQuantity,
                protectedQuantity: position.entryFill?.quantity ?? position.protectedQuantity,
            }
            : { ...position };
        const executions = rebuildSameTimestamp ? sameTimestampExecutions : [event];
        for (const candidate of executions) current = applyExecutionToPosition(current, candidate);
        return current;
    });
}

function positionFromEntry(event: ExecutionLifecycleEvent): PositionLifecycleWithProtection | null {
    const entryFill = event.fill;
    if (entryFill === null) return null;
    return {
        sourceHash: event.sourceHash,
        positionId: event.positionId,
        strategy: event.strategy,
        direction: event.direction,
        symbol: event.symbol,
        requestedGross: event.requestedGross,
        acceptedGross: event.acceptedGross,
        reservation: event.reservation,
        entryFill,
        exit: null,
        reason: event.reason,
        fee: event.fee,
        funding: event.funding,
        slippage: event.slippage,
        policyHash: event.policyHash,
        configHash: event.configHash,
        resultHash: event.resultHash,
        events: [event],
        remainingQuantity: entryFill.quantity,
        protectedQuantity: 0,
        protection: null,
    };
}

function baselinePosition(entry: BaselineLedgerEntry): PositionLifecycleWithProtection | null {
    if (entry.entry === null) return null;
    return positionWithProtection({
        sourceHash: entry.sourceHash,
        positionId: `baseline:${entry.tradeId}`,
        strategy: entry.strategy,
        direction: entry.direction,
        symbol: entry.symbol,
        requestedGross: entry.requestedGross,
        acceptedGross: entry.acceptedGross,
        reservation: entry.reservation,
        entryFill: entry.entry,
        exit: entry.finalExit,
        reason: entry.reason,
        fee: entry.fee,
        funding: entry.funding,
        slippage: entry.slippage,
        policyHash: entry.policyHash,
        configHash: entry.configHash,
        resultHash: entry.resultHash,
        events: [],
    });
}

export function reconcileLifecycle(state: PortfolioState, event: LifecycleEvent): PortfolioRuntimeState;
export function reconcileLifecycle(state: PortfolioRuntimeState, event: ExecutionLifecycleEvent): PortfolioRuntimeState;
export function reconcileLifecycle(state: PortfolioState, event: LifecycleEvent): PortfolioRuntimeState {
    const runtime = runtimeState(state);
    const lifecycleEvent = executionEvent(event);
    const knownIntent = runtime.intentLedger[lifecycleEvent.clientOrderId];
    if (runtime.events.some((existing) => existing.eventId === lifecycleEvent.eventId)) return runtime;
    if (!eventIsKnown(lifecycleEvent)) {
        return stateCopy(runtime, {
            manualReview: [...runtime.manualReview, `UNKNOWN_EXECUTION:${lifecycleEvent.clientOrderId}`],
            reason: "MANUAL_REVIEW_UNKNOWN_EXECUTION",
        });
    }
    const sameTimestamp = runtime.events.filter((existing) => existing.ts === lifecycleEvent.ts);
    const orderedEvents = [...sameTimestamp, lifecycleEvent].sort((left, right) => eventPriority(runtime, left) - eventPriority(runtime, right) || left.eventId.localeCompare(right.eventId));
    const previousEvents = runtime.events.filter((existing) => existing.ts !== lifecycleEvent.ts);
    const nextEvents = [...previousEvents, ...orderedEvents].sort((left, right) => left.ts - right.ts || eventPriority(runtime, left) - eventPriority(runtime, right) || left.eventId.localeCompare(right.eventId));
    const entryPosition = lifecycleEvent.executionKind === "ENTRY" ? positionFromEntry(lifecycleEvent) : null;
    const priorPosition = runtime.positions.find((position) => position.positionId === lifecycleEvent.positionId);
    const positions = entryPosition === null
        ? reconcilePositions(runtime, lifecycleEvent, nextEvents)
        : [...runtime.positions.filter((position) => position.positionId !== lifecycleEvent.positionId), entryPosition];
    const entryGross = lifecycleEvent.executionKind === "ENTRY" ? lifecycleEvent.fill?.gross ?? lifecycleEvent.acceptedGross : 0;
    const reservedAfterEntry = lifecycleEvent.executionKind === "ENTRY" ? Math.max(0, runtime.reservedGross - entryGross) : runtime.reservedGross;
    const acceptedAfterEntry = lifecycleEvent.executionKind === "ENTRY" ? runtime.acceptedGross + entryGross : runtime.acceptedGross;
    return stateCopy(runtime, {
        events: nextEvents,
        positions,
        intentLedger: { ...runtime.intentLedger, [lifecycleEvent.clientOrderId]: lifecycleEvent.executionStatus },
        reason: "LIFECYCLE_RECONCILED",
        reservedGross: reservedAfterEntry,
        acceptedGross: acceptedAfterEntry,
        cash: runtime.cash + (priorPosition === undefined ? 0 : realizedPnl(priorPosition, lifecycleEvent)) - lifecycleEvent.fee,
        grossBySymbol: lifecycleEvent.executionKind === "ENTRY" ? { ...runtime.grossBySymbol, [lifecycleEvent.symbol]: (runtime.grossBySymbol[lifecycleEvent.symbol] ?? 0) + entryGross } : runtime.grossBySymbol,
        grossByStrategy: lifecycleEvent.executionKind === "ENTRY" ? { ...runtime.grossByStrategy, [lifecycleEvent.strategy]: (runtime.grossByStrategy[lifecycleEvent.strategy] ?? 0) + entryGross } : runtime.grossByStrategy,
        fee: runtime.fee + lifecycleEvent.fee,
        funding: runtime.funding + lifecycleEvent.funding,
        slippage: runtime.slippage + lifecycleEvent.slippage,
    });
}

function initialState(source: CanonicalSource, config: ReplayConfigWithRuntime): PortfolioRuntimeState {
    const configuredBaseline = config.baselinePositions?.map(positionWithProtection) ?? [];
    const sourceBaseline = source.baselineLedger.map(baselinePosition).filter((position): position is PositionLifecycleWithProtection => position !== null);
    const baselinePositions = [...sourceBaseline, ...configuredBaseline];
    const baselineGrossBySymbol: Record<string, number> = {};
    const baselineGrossByStrategy: Record<string, number> = {};
    for (const baseline of baselinePositions) {
        baselineGrossBySymbol[baseline.symbol] = (baselineGrossBySymbol[baseline.symbol] ?? 0) + baseline.acceptedGross;
        baselineGrossByStrategy[baseline.strategy] = (baselineGrossByStrategy[baseline.strategy] ?? 0) + baseline.acceptedGross;
    }
    const deposits = config.deposits ?? source.input.deposits;
    const initialDeposits = deposits.filter((deposit) => deposit.ts <= config.startTs).reduce((total, deposit) => total + deposit.amount, 0);
    const baselineGross = baselinePositions.reduce((total, position) => total + position.acceptedGross, 0);
    return {
        sourceHash: config.sourceHash,
        ts: config.startTs,
        cash: config.initialEquity + initialDeposits,
        equity: config.initialEquity + initialDeposits,
        reservedGross: 0,
        acceptedGross: baselineGross,
        pendingGross: 0,
        positions: baselinePositions,
        reason: "REPLAY_INITIALIZED",
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: config.policyHash,
        configHash: config.configHash,
        resultHash: config.configHash,
        caps: config.caps ?? { totalGross: Number.POSITIVE_INFINITY, cryptoGross: Number.POSITIVE_INFINITY, strategyGross: Number.POSITIVE_INFINITY },
        grossBySymbol: baselineGrossBySymbol,
        grossByStrategy: baselineGrossByStrategy,
        reservedCandidateIds: [],
        intentLedger: {},
        eventOrdering: config.eventOrdering ?? ["STOP", "NORMAL_EXIT", "TAKE_PROFIT", "TIME_STOP", "ENTRY"],
        manualReview: [],
        events: [],
        protectionReadback: config.protectionReadback === true,
    };
}

function executionBars(source: CanonicalSource, startTs: number, endTs: number): readonly ExecutionBar[] {
    return source.candleSeries.flatMap((series) => series.bars.filter((bar) => bar.ts >= startTs && bar.ts <= endTs));
}

function realizedPnl(position: PositionLifecycleWithProtection, event: ExecutionLifecycleEvent): number {
    if (event.executionKind === "ENTRY" || position.entryFill === null || event.price === undefined) return 0;
    const quantity = Math.min(position.remainingQuantity, event.quantity);
    const move = event.direction === "LONG" ? event.price - position.entryFill.price : position.entryFill.price - event.price;
    return move * quantity;
}

function unrealizedPnl(position: PositionLifecycleWithProtection, close: number): number {
    if (position.exit !== null || position.entryFill === null) return 0;
    const move = position.direction === "LONG" ? close - position.entryFill.price : position.entryFill.price - close;
    return move * position.remainingQuantity;
}

function markToMarket(state: PortfolioRuntimeState, bar: ExecutionBar, depositAmount: number): PortfolioRuntimeState {
    const cash = state.cash + depositAmount;
    const unrealized = state.positions.filter((position) => position.symbol === bar.symbol).reduce((total, position) => total + unrealizedPnl(position, bar.close), 0);
    return stateCopy(state, {
        ts: bar.ts,
        cash,
        equity: cash + unrealized,
        reason: "MARK_TO_MARKET",
    });
}

function protectionLedgerEntries(position: PositionLifecycleWithProtection, decision: ReturnType<typeof applyProtectionPolicy>): readonly ProtectionLedgerEntry[] {
    return decision.events.map((event) => ({
        ...event,
        positionId: position.positionId,
        stopPrice: decision.stopPrice,
        trigger: decision.trigger,
    }));
}

function protectiveExecutionEvent(position: PositionLifecycleWithProtection, bar: ExecutionBar, decision: ReturnType<typeof applyProtectionPolicy>): ExecutionLifecycleEvent | null {
    if (decision.trigger === "NONE" || position.remainingQuantity <= 0) return null;
    return {
        sourceHash: position.sourceHash,
        ts: bar.ts,
        strategy: position.strategy,
        direction: position.direction,
        symbol: position.symbol,
        requestedGross: position.requestedGross,
        acceptedGross: position.acceptedGross,
        reservation: position.reservation,
        fill: null,
        exit: null,
        reason: decision.trigger,
        fee: 0,
        funding: 0,
        slippage: 0,
        policyHash: position.policyHash,
        configHash: position.configHash,
        resultHash: position.resultHash,
        eventId: `protection-exit:${position.positionId}:${bar.ts}`,
        eventType: "EXIT",
        positionId: position.positionId,
        executionKind: decision.trigger === "TIME_STOP" ? "TIME_STOP" : "STOP",
        clientOrderId: `${decision.protection.clientOrderId}:${bar.ts}`,
        quantity: position.remainingQuantity,
        price: decision.trigger === "TIME_STOP" ? bar.close : decision.stopPrice,
        executionStatus: "FILLED",
    };
}

export function replayIntegrated(source: CanonicalSource, config: ReplayConfigWithRuntime): IntegratedReplayResult {
    let state = initialState(source, config);
    const decisions: readonly CandidateDecisionWithExecution[] = [...source.candidateEvents].filter((candidate) => candidate.ts >= config.startTs && candidate.ts <= config.endTs).sort((left, right) => left.ts - right.ts || left.candidateId.localeCompare(right.candidateId));
    const reservations: Reservation[] = [];
    const protectionLedger: ProtectionLedgerEntry[] = [];
    let rejectionCount = 0;
    for (const decision of decisions) {
        const result = reserveCandidate(state, decision);
        state = result.state;
        if (result.accepted && result.reservation !== null) {
            reservations.push(result.reservation);
            if (decision.fill !== null) {
                state = reconcileLifecycle(state, {
                    ...decision,
                    eventId: `fill:${decision.candidateId}`,
                    eventType: decision.fill.gross < decision.acceptedGross ? "PARTIAL_FILL" : "FILL",
                    positionId: decision.candidateId,
                    executionKind: "ENTRY",
                    clientOrderId: decision.clientOrderId ?? decision.candidateId,
                    quantity: decision.fill.quantity,
                    executionStatus: decision.fill.gross < decision.acceptedGross ? "PARTIAL_FILLED" : "FILLED",
                    price: decision.fill.price,
                });
            }
        }
        else rejectionCount += 1;
    }
    const timeline: PortfolioState[] = [state];
    const marketBars = [...executionBars(source, config.startTs, config.endTs)].sort((left, right) => left.ts - right.ts || left.symbol.localeCompare(right.symbol));
    const executionEvents = [...(config.executionEvents ?? [])].filter((event) => event.ts >= config.startTs && event.ts <= config.endTs).sort((left, right) => left.ts - right.ts || left.eventId.localeCompare(right.eventId));
    const deposits = [...(config.deposits ?? source.input.deposits)].filter((deposit) => deposit.ts > config.startTs && deposit.ts <= config.endTs).sort((left, right) => left.ts - right.ts);
    let executionIndex = 0;
    let depositIndex = 0;
    for (const marketBar of marketBars) {
        while (executionIndex < executionEvents.length && executionEvents[executionIndex]!.ts <= marketBar.ts) {
            state = reconcileLifecycle(state, executionEvents[executionIndex]!);
            executionIndex += 1;
        }
        const currentPositions = [...state.positions];
        for (const currentPosition of currentPositions) {
            if (currentPosition.symbol !== marketBar.symbol || currentPosition.exit !== null || currentPosition.remainingQuantity <= 0) continue;
            const policy = config.directionPolicies?.[currentPosition.direction];
            if (policy === undefined) continue;
            const decision = applyProtectionPolicy(currentPosition, policy, marketBar);
            state = stateCopy(state, {
                positions: state.positions.map((position) => position.positionId === currentPosition.positionId
                    ? { ...position, protection: decision.protection, protectedQuantity: decision.protection.protectedQuantity }
                    : position),
            });
            protectionLedger.push(...protectionLedgerEntries(currentPosition, decision));
            const protectiveEvent = protectiveExecutionEvent(currentPosition, marketBar, decision);
            if (protectiveEvent !== null) state = reconcileLifecycle(state, protectiveEvent);
        }
        let depositAmount = 0;
        while (depositIndex < deposits.length && deposits[depositIndex]!.ts <= marketBar.ts) {
            depositAmount += deposits[depositIndex]!.amount;
            depositIndex += 1;
        }
        state = markToMarket(state, marketBar, depositAmount);
        timeline.push(state);
    }
    while (executionIndex < executionEvents.length) {
        state = reconcileLifecycle(state, executionEvents[executionIndex]!);
        executionIndex += 1;
    }
    const result: IntegratedReplayResult = {
        sourceHash: config.sourceHash,
        configHash: config.configHash,
        resultHash: config.configHash,
        events: state.events,
        positions: state.positions,
        portfolio: timeline,
        reason: state.manualReview.length > 0 ? "MANUAL_REVIEW_REQUIRED" : "REPLAY_COMPLETE",
        fee: state.fee,
        funding: state.funding,
        slippage: state.slippage,
        policyHash: config.policyHash,
        decisionLedger: decisions,
        reservationLedger: reservations,
        protectionLedger,
        tradeLedger: state.positions,
        equityMtmTimeline: timeline,
        accountingReconciliation: ["cash + realizedPnl + unrealizedPnl = equity"],
        rejectionCount,
        preemptionCount: 0,
    };
    return result;
}
