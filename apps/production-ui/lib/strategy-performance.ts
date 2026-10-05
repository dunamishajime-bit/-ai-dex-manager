import type {
    ContinuousStrategyCandidate,
    ContinuousStrategyMonitor,
    StrategyRegime,
    StrategyTriggerState,
    StrategyTriggerType,
} from "@/lib/cycle-strategy";

export type StrategyChain = "BNB" | "SOLANA";
export type StrategyRouteType = "native" | "proxy" | "cross-chain" | "unknown";
export type StrategyDecision = "Selected" | "Half-size Eligible" | "Watchlist" | "Blocked";
export type StrategyPositionSize = "0.5x" | "0.3x" | "0.2x" | "0x";
export type StrategyExitReason = "SL" | "TP" | "timed exit" | "manual" | "failed" | "basket exit" | "unknown";
export type StrategyWindowKey = "today" | "24h" | "7d";

export interface StrategyCandidateEvent {
    id: string;
    timestamp: number;
    symbol: string;
    chain: StrategyChain;
    regime: StrategyRegime;
    score: number;
    triggerState: StrategyTriggerState;
    triggerType: StrategyTriggerType;
    decision: StrategyDecision;
    positionSize: StrategyPositionSize;
    routeType: StrategyRouteType;
    triggeredAt?: number;
    selectedAt?: number;
    failureReason?: string;
}

export interface StrategyExecutionEvent {
    id: string;
    kind: "order" | "fill" | "failure";
    action: "BUY" | "SELL";
    timestamp: number;
    symbol: string;
    chain: StrategyChain;
    regime: StrategyRegime;
    score: number;
    triggerState: StrategyTriggerState;
    triggerType: StrategyTriggerType;
    decision: StrategyDecision;
    positionSize: StrategyPositionSize;
    routeType: StrategyRouteType;
    orderId?: string;
    executionId?: string;
    triggeredAt?: number;
    selectedAt?: number;
    filledAt?: number;
    exitedAt?: number;
    exitReason?: StrategyExitReason;
    pnl?: number;
    pnlPct?: number;
    success?: boolean;
    failureReason?: string;
    holdMinutes?: number;
}

export interface StrategyLifecycleRecord {
    symbol: string;
    chain: StrategyChain;
    regime: StrategyRegime;
    score: number;
    triggerState: StrategyTriggerState;
    triggerType: StrategyTriggerType;
    decision: StrategyDecision;
    positionSize: StrategyPositionSize;
    routeType: StrategyRouteType;
    triggeredAt?: number;
    selectedAt?: number;
    filledAt?: number;
    exitedAt?: number;
}

export interface StrategyPerformanceStore {
    version: 1;
    updatedAt: number;
    candidateEvents: StrategyCandidateEvent[];
    executionEvents: StrategyExecutionEvent[];
    lifecycles: Record<string, StrategyLifecycleRecord>;
}

export type StrategySnapshotLike = {
    symbol: string;
    chain?: StrategyChain;
    regime?: StrategyRegime;
    marketScore?: number;
    triggerState?: StrategyTriggerState;
    triggerType?: StrategyTriggerType;
    tradeDecision?: StrategyDecision;
    positionSizeLabel?: StrategyPositionSize;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    autoTradeTarget?: boolean;
    finalRejectReason?: string;
    autoTradeExcludedReason?: string;
    mainReason?: string;
};

export type StrategyPerformanceBucket = {
    triggered: number;
    selected: number;
    orders: number;
    fills: number;
    wins: number;
    losses: number;
    winRate: number;
    totalPnl: number;
    averagePnl: number;
    averageHoldMinutes: number;
    stopLossCount: number;
    takeProfitCount: number;
    timedExitCount: number;
};

export type StrategyPerformanceWindow = {
    key: StrategyWindowKey;
    label: string;
    trendCount: number;
    rangeCount: number;
    noTradeCount: number;
    readyCount: number;
    armedCount: number;
    triggeredCount: number;
    selectedCount: number;
    orderCount: number;
    fillCount: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    totalPnl: number;
    averagePnl: number;
    normalLotCount: number;
    halfLotCount: number;
    crossChainCount: number;
    routeCounts: Record<StrategyRouteType, number>;
    byRegime: Record<StrategyRegime, StrategyPerformanceBucket>;
    bySize: Record<"0.5x" | "0.3x" | "0.2x", StrategyPerformanceBucket>;
    byRoute: Record<StrategyRouteType, StrategyPerformanceBucket>;
    topWinners: Array<{ symbol: string; chain: StrategyChain; pnl: number }>;
    topLosers: Array<{ symbol: string; chain: StrategyChain; pnl: number }>;
    topFailures: Array<{ reason: string; count: number }>;
    symbolRows: Array<{
        symbol: string;
        chain: StrategyChain;
        routeType: StrategyRouteType;
        triggered: number;
        selected: number;
        fills: number;
        wins: number;
        losses: number;
        winRate: number;
        totalPnl: number;
        averagePnl: number;
        regimeBreakdown: Record<StrategyRegime, { fills: number; pnl: number; winRate: number }>;
    }>;
    funnel: {
        triggered: number;
        selected: number;
        ordered: number;
        filled: number;
        selectedFromTriggeredPct: number;
        fillFromSelectedPct: number;
    };
};

export interface StrategyPerformanceSummary {
    updatedAt: number;
    windows: Record<StrategyWindowKey, StrategyPerformanceWindow>;
}

const MAX_CANDIDATE_EVENTS = 2400;
const MAX_EXECUTION_EVENTS = 1800;
const MAX_LIFECYCLES = 240;

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function comparableKey(symbol: string, chain: StrategyChain) {
    return `${chain}:${symbol.toUpperCase()}`;
}

function toJstDayStart(referenceTs: number) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(referenceTs));
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
    const year = pick("year");
    const month = pick("month");
    const day = pick("day");
    return Date.UTC(year, month - 1, day, -9, 0, 0, 0);
}

function emptyBucket(): StrategyPerformanceBucket {
    return {
        triggered: 0,
        selected: 0,
        orders: 0,
        fills: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalPnl: 0,
        averagePnl: 0,
        averageHoldMinutes: 0,
        stopLossCount: 0,
        takeProfitCount: 0,
        timedExitCount: 0,
    };
}

function average(values: number[]) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalizeRouteType(routeType?: StrategyRouteType | "native" | "proxy" | "cross-chain") {
    return routeType === "native" || routeType === "proxy" || routeType === "cross-chain" ? routeType : "unknown";
}

function normalizeDecision(decision?: StrategyDecision) {
    return decision === "Selected" || decision === "Half-size Eligible" || decision === "Watchlist" ? decision : "Blocked";
}

function normalizePositionSize(size?: StrategyPositionSize) {
    const normalizedInput = String(size || "");
    if (normalizedInput === "1.0x") return "0.5x";
    if (normalizedInput === "0.25x") return "0.2x";
    return size === "0.5x" || size === "0.3x" || size === "0.2x" ? size : "0x";
}

function isSelectedDecision(decision: StrategyDecision, size: StrategyPositionSize, autoTradeTarget?: boolean) {
    const normalizedSize = normalizePositionSize(size);
    return autoTradeTarget || decision === "Selected" || decision === "Half-size Eligible" || normalizedSize === "0.5x" || normalizedSize === "0.3x" || normalizedSize === "0.2x";
}

function trimMap<T>(entries: Array<[string, T]>, limit: number) {
    return Object.fromEntries(entries.slice(-limit));
}

export function createEmptyStrategyPerformanceStore(): StrategyPerformanceStore {
    return {
        version: 1,
        updatedAt: Date.now(),
        candidateEvents: [],
        executionEvents: [],
        lifecycles: {},
    };
}

export function normalizeStrategyPerformanceStore(value: unknown): StrategyPerformanceStore {
    const base = createEmptyStrategyPerformanceStore();
    if (!value || typeof value !== "object") return base;
    const raw = value as Partial<StrategyPerformanceStore>;
    return {
        version: 1,
        updatedAt: Number(raw.updatedAt || Date.now()),
        candidateEvents: Array.isArray(raw.candidateEvents) ? raw.candidateEvents.slice(-MAX_CANDIDATE_EVENTS) : [],
        executionEvents: Array.isArray(raw.executionEvents) ? raw.executionEvents.slice(-MAX_EXECUTION_EVENTS) : [],
        lifecycles: raw.lifecycles && typeof raw.lifecycles === "object"
            ? trimMap(Object.entries(raw.lifecycles), MAX_LIFECYCLES)
            : {},
    };
}

function importantCandidateSignature(candidate: StrategySnapshotLike) {
    return JSON.stringify([
        candidate.regime || "No-trade",
        Math.round(Number(candidate.marketScore || 0)),
        candidate.triggerState || "Ready",
        candidate.triggerType || "None",
        normalizeDecision(candidate.tradeDecision),
        normalizePositionSize(candidate.positionSizeLabel),
        normalizeRouteType(candidate.executionRouteKind),
        Boolean(candidate.autoTradeTarget),
        candidate.finalRejectReason || candidate.autoTradeExcludedReason || candidate.mainReason || "",
    ]);
}

export function appendStrategyCandidateEvents(
    previousStore: StrategyPerformanceStore,
    previousMonitor: ContinuousStrategyMonitor | null | undefined,
    nextMonitor: ContinuousStrategyMonitor,
): StrategyPerformanceStore {
    const nextStore = normalizeStrategyPerformanceStore(previousStore);
    const previousMap = new Map((previousMonitor?.candidates || []).map((candidate) => [comparableKey(candidate.symbol, candidate.chain), candidate]));
    const nextEvents = [...nextStore.candidateEvents];
    const nextLifecycles = { ...nextStore.lifecycles };
    for (const candidate of nextMonitor.candidates) {
        const key = comparableKey(candidate.symbol, candidate.chain);
        const previousCandidate = previousMap.get(key);
        if (previousCandidate && importantCandidateSignature(previousCandidate) === importantCandidateSignature(candidate)) {
            continue;
        }
        const lifecycle = nextLifecycles[key] || {
            symbol: candidate.symbol,
            chain: candidate.chain,
            regime: candidate.regime,
            score: candidate.marketScore,
            triggerState: candidate.triggerState,
            triggerType: candidate.triggerType,
            decision: normalizeDecision(candidate.tradeDecision),
            positionSize: normalizePositionSize(candidate.positionSizeLabel),
            routeType: normalizeRouteType(candidate.executionRouteKind),
        };
        if (candidate.triggerState === "Triggered" && !lifecycle.triggeredAt) lifecycle.triggeredAt = nextMonitor.monitoredAt;
        if (isSelectedDecision(normalizeDecision(candidate.tradeDecision), normalizePositionSize(candidate.positionSizeLabel), candidate.autoTradeTarget) && !lifecycle.selectedAt) {
            lifecycle.selectedAt = nextMonitor.monitoredAt;
        }
        lifecycle.regime = candidate.regime;
        lifecycle.score = candidate.marketScore;
        lifecycle.triggerState = candidate.triggerState;
        lifecycle.triggerType = candidate.triggerType;
        lifecycle.decision = normalizeDecision(candidate.tradeDecision);
        lifecycle.positionSize = normalizePositionSize(candidate.positionSizeLabel);
        lifecycle.routeType = normalizeRouteType(candidate.executionRouteKind);
        nextLifecycles[key] = lifecycle;
        nextEvents.push({
            id: `${key}:${nextMonitor.monitoredAt}:${nextEvents.length}`,
            timestamp: nextMonitor.monitoredAt,
            symbol: candidate.symbol,
            chain: candidate.chain,
            regime: candidate.regime,
            score: candidate.marketScore,
            triggerState: candidate.triggerState,
            triggerType: candidate.triggerType,
            decision: normalizeDecision(candidate.tradeDecision),
            positionSize: normalizePositionSize(candidate.positionSizeLabel),
            routeType: normalizeRouteType(candidate.executionRouteKind),
            triggeredAt: lifecycle.triggeredAt,
            selectedAt: lifecycle.selectedAt,
            failureReason: candidate.finalRejectReason || candidate.autoTradeExcludedReason || candidate.mainReason,
        });
    }
    return {
        ...nextStore,
        updatedAt: nextMonitor.monitoredAt,
        candidateEvents: nextEvents.slice(-MAX_CANDIDATE_EVENTS),
        lifecycles: trimMap(Object.entries(nextLifecycles), MAX_LIFECYCLES),
    };
}

export function appendStrategyExecutionEvent(
    previousStore: StrategyPerformanceStore,
    input: Omit<StrategyExecutionEvent, "id" | "triggeredAt" | "selectedAt" | "filledAt" | "exitedAt" | "holdMinutes"> & {
        id?: string;
        chain?: StrategyChain;
        triggeredAt?: number;
        selectedAt?: number;
        filledAt?: number;
        exitedAt?: number;
    },
): StrategyPerformanceStore {
    const nextStore = normalizeStrategyPerformanceStore(previousStore);
    const chain = input.chain || "BNB";
    const key = comparableKey(input.symbol, chain);
    const lifecycle = nextStore.lifecycles[key] || {
        symbol: input.symbol,
        chain,
        regime: input.regime,
        score: input.score,
        triggerState: input.triggerState,
        triggerType: input.triggerType,
        decision: input.decision,
        positionSize: input.positionSize,
        routeType: input.routeType,
    };
    if (input.triggeredAt && !lifecycle.triggeredAt) lifecycle.triggeredAt = input.triggeredAt;
    if (input.selectedAt && !lifecycle.selectedAt) lifecycle.selectedAt = input.selectedAt;
    if (input.kind === "fill" && input.action === "BUY") lifecycle.filledAt = input.filledAt || input.timestamp;
    if (input.kind === "fill" && input.action === "SELL") lifecycle.exitedAt = input.exitedAt || input.timestamp;
    lifecycle.regime = input.regime;
    lifecycle.score = input.score;
    lifecycle.triggerState = input.triggerState;
    lifecycle.triggerType = input.triggerType;
    lifecycle.decision = input.decision;
    lifecycle.positionSize = input.positionSize;
    lifecycle.routeType = input.routeType;
    const event: StrategyExecutionEvent = {
        ...input,
        id: input.id || `${key}:${input.kind}:${input.action}:${input.timestamp}:${nextStore.executionEvents.length}`,
        chain,
        triggeredAt: input.triggeredAt || lifecycle.triggeredAt,
        selectedAt: input.selectedAt || lifecycle.selectedAt,
        filledAt: input.action === "BUY" && input.kind === "fill" ? (input.filledAt || input.timestamp) : lifecycle.filledAt,
        exitedAt: input.action === "SELL" && input.kind === "fill" ? (input.exitedAt || input.timestamp) : undefined,
        holdMinutes: input.action === "SELL" && input.kind === "fill" && lifecycle.filledAt
            ? Math.max(0, Math.round(((input.exitedAt || input.timestamp) - lifecycle.filledAt) / 60_000))
            : undefined,
    };
    return {
        ...nextStore,
        updatedAt: Math.max(nextStore.updatedAt, input.timestamp),
        executionEvents: [...nextStore.executionEvents, event].slice(-MAX_EXECUTION_EVENTS),
        lifecycles: trimMap(Object.entries({ ...nextStore.lifecycles, [key]: lifecycle }), MAX_LIFECYCLES),
    };
}

export function deriveExitReason(reason?: string, failureReason?: string): StrategyExitReason {
    const text = `${reason || ""} ${failureReason || ""}`.toLowerCase();
    if (/損切|stop-loss|stop loss|sl/.test(text)) return "SL";
    if (/利確|take-profit|take profit|tp/.test(text)) return "TP";
    if (/時間決済|timed/.test(text)) return "timed exit";
    if (/整理売り|manual/.test(text)) return "manual";
    if (/failed|失敗|cancelled/.test(text)) return "failed";
    if (/basket|対象外/.test(text)) return "basket exit";
    return "unknown";
}

export function aggregateStrategyPerformance(store: StrategyPerformanceStore, referenceTs: number = Date.now()): StrategyPerformanceSummary {
    const normalized = normalizeStrategyPerformanceStore(store);
    const windows: Record<StrategyWindowKey, { label: string; startTs: number }> = {
        today: { label: "Today", startTs: toJstDayStart(referenceTs) },
        "24h": { label: "24H", startTs: referenceTs - (24 * 60 * 60 * 1000) },
        "7d": { label: "7D", startTs: referenceTs - (7 * 24 * 60 * 60 * 1000) },
    };
    const summary = Object.entries(windows).reduce((accumulator, [key, config]) => {
        const candidateEvents = normalized.candidateEvents.filter((event) => event.timestamp >= config.startTs);
        const executionEvents = normalized.executionEvents.filter((event) => event.timestamp >= config.startTs);
        const byRegime: Record<StrategyRegime, StrategyPerformanceBucket> = {
            Trend: emptyBucket(),
            Range: emptyBucket(),
            "No-trade": emptyBucket(),
        };
        const bySize: Record<"0.5x" | "0.3x" | "0.2x", StrategyPerformanceBucket> = {
            "0.5x": emptyBucket(),
            "0.3x": emptyBucket(),
            "0.2x": emptyBucket(),
        };
        const byRoute: Record<StrategyRouteType, StrategyPerformanceBucket> = {
            native: emptyBucket(),
            proxy: emptyBucket(),
            "cross-chain": emptyBucket(),
            unknown: emptyBucket(),
        };
        const symbolMap = new Map<string, StrategyPerformanceWindow["symbolRows"][number]>();
        const failureMap = new Map<string, number>();
        const pnlMap = new Map<string, number>();
        let readyCount = 0;
        let armedCount = 0;
        let triggeredCount = 0;
        let selectedCount = 0;
        let trendCount = 0;
        let rangeCount = 0;
        let noTradeCount = 0;
        for (const event of candidateEvents) {
            if (event.regime === "Trend") trendCount += 1;
            else if (event.regime === "Range") rangeCount += 1;
            else noTradeCount += 1;
            if (event.triggerState === "Ready") readyCount += 1;
            if (event.triggerState === "Armed") armedCount += 1;
            if (event.triggerState === "Triggered") {
                triggeredCount += 1;
                byRegime[event.regime].triggered += 1;
            }
            if (isSelectedDecision(event.decision, event.positionSize)) {
                selectedCount += 1;
                byRegime[event.regime].selected += 1;
            }
            if (event.failureReason) failureMap.set(event.failureReason, (failureMap.get(event.failureReason) || 0) + 1);
            const rowKey = comparableKey(event.symbol, event.chain);
            const row = symbolMap.get(rowKey) || {
                symbol: event.symbol,
                chain: event.chain,
                routeType: event.routeType,
                triggered: 0,
                selected: 0,
                fills: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                totalPnl: 0,
                averagePnl: 0,
                regimeBreakdown: {
                    Trend: { fills: 0, pnl: 0, winRate: 0 },
                    Range: { fills: 0, pnl: 0, winRate: 0 },
                    "No-trade": { fills: 0, pnl: 0, winRate: 0 },
                },
            };
            if (event.triggerState === "Triggered") row.triggered += 1;
            if (isSelectedDecision(event.decision, event.positionSize)) row.selected += 1;
            symbolMap.set(rowKey, row);
        }
        const exitPnls: number[] = [];
        const holdMinutes: number[] = [];
        let orderCount = 0;
        let fillCount = 0;
        let winCount = 0;
        let lossCount = 0;
        let totalPnl = 0;
        let normalLotCount = 0;
        let halfLotCount = 0;
        let crossChainCount = 0;
        const routeCounts: Record<StrategyRouteType, number> = { native: 0, proxy: 0, "cross-chain": 0, unknown: 0 };
        for (const event of executionEvents) {
            const regimeBucket = byRegime[event.regime];
            const routeBucket = byRoute[event.routeType];
            const normalizedSize = normalizePositionSize(event.positionSize);
            const sizeBucket = normalizedSize === "0.5x" || normalizedSize === "0.3x" || normalizedSize === "0.2x"
                ? bySize[normalizedSize]
                : undefined;
            const rowKey = comparableKey(event.symbol, event.chain);
            const row = symbolMap.get(rowKey) || {
                symbol: event.symbol,
                chain: event.chain,
                routeType: event.routeType,
                triggered: 0,
                selected: 0,
                fills: 0,
                wins: 0,
                losses: 0,
                winRate: 0,
                totalPnl: 0,
                averagePnl: 0,
                regimeBreakdown: {
                    Trend: { fills: 0, pnl: 0, winRate: 0 },
                    Range: { fills: 0, pnl: 0, winRate: 0 },
                    "No-trade": { fills: 0, pnl: 0, winRate: 0 },
                },
            };
            symbolMap.set(rowKey, row);
            if (event.kind === "order" && event.action === "BUY") {
                orderCount += 1;
                regimeBucket.orders += 1;
                routeBucket.orders += 1;
                if (sizeBucket) sizeBucket.orders += 1;
                routeCounts[event.routeType] += 1;
                if (normalizedSize === "0.5x") normalLotCount += 1;
                if (normalizedSize === "0.3x" || normalizedSize === "0.2x") halfLotCount += 1;
                if (event.routeType === "cross-chain") crossChainCount += 1;
            }
            if (event.kind === "fill" && event.action === "BUY") {
                fillCount += 1;
                regimeBucket.fills += 1;
                routeBucket.fills += 1;
                row.fills += 1;
                row.regimeBreakdown[event.regime].fills += 1;
                if (sizeBucket) sizeBucket.fills += 1;
            }
            if (event.kind === "fill" && event.action === "SELL" && Number.isFinite(event.pnl)) {
                const pnl = Number(event.pnl || 0);
                exitPnls.push(pnl);
                totalPnl += pnl;
                row.totalPnl += pnl;
                row.regimeBreakdown[event.regime].pnl += pnl;
                pnlMap.set(rowKey, (pnlMap.get(rowKey) || 0) + pnl);
                regimeBucket.totalPnl += pnl;
                routeBucket.totalPnl += pnl;
                if (sizeBucket) sizeBucket.totalPnl += pnl;
                if (pnl >= 0) {
                    winCount += 1;
                    row.wins += 1;
                    regimeBucket.wins += 1;
                    routeBucket.wins += 1;
                    if (sizeBucket) sizeBucket.wins += 1;
                } else {
                    lossCount += 1;
                    row.losses += 1;
                    regimeBucket.losses += 1;
                    routeBucket.losses += 1;
                    if (sizeBucket) sizeBucket.losses += 1;
                }
                if (Number.isFinite(event.holdMinutes)) {
                    holdMinutes.push(Number(event.holdMinutes));
                    regimeBucket.averageHoldMinutes += Number(event.holdMinutes);
                    routeBucket.averageHoldMinutes += Number(event.holdMinutes);
                    if (sizeBucket) sizeBucket.averageHoldMinutes += Number(event.holdMinutes);
                }
                if (event.exitReason === "SL") regimeBucket.stopLossCount += 1;
                if (event.exitReason === "TP") regimeBucket.takeProfitCount += 1;
                if (event.exitReason === "timed exit") regimeBucket.timedExitCount += 1;
            }
            if (event.kind === "failure" && event.failureReason) {
                failureMap.set(event.failureReason, (failureMap.get(event.failureReason) || 0) + 1);
            }
        }
        const applyRates = (bucket: StrategyPerformanceBucket) => {
            const decisions = bucket.wins + bucket.losses;
            bucket.winRate = decisions ? clamp((bucket.wins / decisions) * 100, 0, 100) : 0;
            bucket.averagePnl = decisions ? bucket.totalPnl / decisions : 0;
            bucket.averageHoldMinutes = decisions ? bucket.averageHoldMinutes / decisions : 0;
        };
        Object.values(byRegime).forEach(applyRates);
        Object.values(bySize).forEach(applyRates);
        Object.values(byRoute).forEach(applyRates);
        const symbolRows = [...symbolMap.values()].map((row) => {
            const decisions = row.wins + row.losses;
            row.winRate = decisions ? clamp((row.wins / decisions) * 100, 0, 100) : 0;
            row.averagePnl = decisions ? row.totalPnl / decisions : 0;
            (Object.keys(row.regimeBreakdown) as StrategyRegime[]).forEach((regime) => {
                const fills = row.regimeBreakdown[regime].fills;
                const wins = executionEvents.filter((event) => event.symbol === row.symbol && event.chain === row.chain && event.kind === "fill" && event.action === "SELL" && event.regime === regime && Number(event.pnl || 0) >= 0).length;
                row.regimeBreakdown[regime].winRate = fills ? clamp((wins / fills) * 100, 0, 100) : 0;
            });
            return row;
        }).sort((left, right) => Math.abs(right.totalPnl) - Math.abs(left.totalPnl) || right.fills - left.fills);
        const pnlEntries = [...pnlMap.entries()].map(([keyValue, pnl]) => {
            const row = symbolMap.get(keyValue);
            return row ? { symbol: row.symbol, chain: row.chain, pnl } : null;
        }).filter((row): row is { symbol: string; chain: StrategyChain; pnl: number } => Boolean(row));
        accumulator[key as StrategyWindowKey] = {
            key: key as StrategyWindowKey,
            label: config.label,
            trendCount,
            rangeCount,
            noTradeCount,
            readyCount,
            armedCount,
            triggeredCount,
            selectedCount,
            orderCount,
            fillCount,
            winCount,
            lossCount,
            winRate: winCount + lossCount ? clamp((winCount / (winCount + lossCount)) * 100, 0, 100) : 0,
            totalPnl,
            averagePnl: exitPnls.length ? average(exitPnls) : 0,
            normalLotCount,
            halfLotCount,
            crossChainCount,
            routeCounts,
            byRegime,
            bySize,
            byRoute,
            topWinners: pnlEntries.filter((entry) => entry.pnl > 0).sort((left, right) => right.pnl - left.pnl).slice(0, 5),
            topLosers: pnlEntries.filter((entry) => entry.pnl < 0).sort((left, right) => left.pnl - right.pnl).slice(0, 5),
            topFailures: [...failureMap.entries()].map(([reason, count]) => ({ reason, count })).sort((left, right) => right.count - left.count).slice(0, 6),
            symbolRows,
            funnel: {
                triggered: triggeredCount,
                selected: selectedCount,
                ordered: orderCount,
                filled: fillCount,
                selectedFromTriggeredPct: triggeredCount ? clamp((selectedCount / triggeredCount) * 100, 0, 999) : 0,
                fillFromSelectedPct: selectedCount ? clamp((fillCount / selectedCount) * 100, 0, 999) : 0,
            },
        };
        return accumulator;
    }, {} as Record<StrategyWindowKey, StrategyPerformanceWindow>);
    return {
        updatedAt: normalized.updatedAt,
        windows: summary,
    };
}
