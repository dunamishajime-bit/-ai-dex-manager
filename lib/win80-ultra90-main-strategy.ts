export type MainStrategyTier = "BLOCKED" | "WIN80" | "ULTRA90";
export type MainStrategyOverlapAction = "HOLD_SAME" | "OPEN_FULL" | "SPLIT_50" | "SWITCH_70" | "REJECT";

export interface MainStrategyCandidateLike {
    symbol: string;
    marketScore?: number;
    confidence?: number;
    eventPriority?: number;
    triggerState?: string;
    triggerProgressRatio?: number;
    volumeRatio?: number;
    resistanceStatus?: string;
    executionStatus?: string;
    conditionalReferencePass?: boolean;
    autoTradeExcludedReason?: string;
    metrics?: {
        rr?: number;
        rsi1h?: number;
        rsi6h?: number;
        adx1h?: number;
        macd1h?: number;
        macd6h?: number;
    };
}

export interface MainStrategyPositionLike {
    symbol: string;
    pnlPct: number;
    usdValue?: number;
}

export interface MainStrategyOverlapDecision {
    action: MainStrategyOverlapAction;
    sourceSellFraction: number;
    incomingAllocation: number;
    retainedAllocation: number;
    reason: string;
}

export const WIN80_ULTRA90_MAIN_STRATEGY = {
    id: "WIN80_ULTRA90_TOP1_V1",
    enabled: true,
    initialNotionalFraction: 1,
    minimumEntryTier: "WIN80" as MainStrategyTier,
    win80: {
        minScore: 80,
        minConfidence: 0.8,
        minTriggerProgress: 0.76,
        minRr: 1.18,
        minVolumeRatio: 0.72,
    },
    ultra90: {
        minScore: 90,
        minConfidence: 0.9,
        minTriggerProgress: 0.88,
        minRr: 1.45,
        minVolumeRatio: 0.9,
    },
    profitableOverlapSplitFraction: 0.5,
    ultra90SwitchFraction: 0.7,
    maxConcurrentPositions: 2,
    realTradingDefaultEnabled: false,
} as const;

function clamp01(value: number) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function normalizeConfidence(value?: number) {
    const safe = Number(value || 0);
    return clamp01(safe > 1 ? safe / 100 : safe);
}

function isExecutionReady(candidate: MainStrategyCandidateLike) {
    return !candidate.autoTradeExcludedReason
        && candidate.resistanceStatus !== "Blocked"
        && (
            candidate.executionStatus === "Pass"
            || candidate.conditionalReferencePass === true
        )
        && (candidate.triggerState === "Triggered" || candidate.triggerState === "Armed");
}

export function classifyMainStrategyCandidate(candidate: MainStrategyCandidateLike): MainStrategyTier {
    if (!isExecutionReady(candidate)) return "BLOCKED";

    const score = Number(candidate.marketScore || 0);
    const confidence = normalizeConfidence(candidate.confidence);
    const progress = clamp01(Number(candidate.triggerProgressRatio || 0));
    const rr = Number(candidate.metrics?.rr || 0);
    const volumeRatio = Number(candidate.volumeRatio || 0);

    const ultra = WIN80_ULTRA90_MAIN_STRATEGY.ultra90;
    if (
        score >= ultra.minScore
        && confidence >= ultra.minConfidence
        && progress >= ultra.minTriggerProgress
        && rr >= ultra.minRr
        && volumeRatio >= ultra.minVolumeRatio
    ) {
        return "ULTRA90";
    }

    const win = WIN80_ULTRA90_MAIN_STRATEGY.win80;
    if (
        score >= win.minScore
        && confidence >= win.minConfidence
        && progress >= win.minTriggerProgress
        && rr >= win.minRr
        && volumeRatio >= win.minVolumeRatio
    ) {
        return "WIN80";
    }

    return "BLOCKED";
}

export function scoreMainStrategyCandidate(candidate: MainStrategyCandidateLike) {
    const tier = classifyMainStrategyCandidate(candidate);
    if (tier === "BLOCKED") return Number.NEGATIVE_INFINITY;

    const score = Number(candidate.marketScore || 0);
    const confidence = normalizeConfidence(candidate.confidence);
    const progress = clamp01(Number(candidate.triggerProgressRatio || 0));
    const rr = Number(candidate.metrics?.rr || 0);
    const volumeRatio = Number(candidate.volumeRatio || 0);
    const eventPriority = Number(candidate.eventPriority || 0);
    const trendAgreement =
        (Number(candidate.metrics?.macd1h || 0) > 0 ? 3 : 0)
        + (Number(candidate.metrics?.macd6h || 0) > 0 ? 2 : 0)
        + (Number(candidate.metrics?.adx1h || 0) >= 20 ? 2 : 0);

    return (
        (tier === "ULTRA90" ? 1_000 : 500)
        + score * 4
        + confidence * 100
        + progress * 80
        + Math.min(rr, 4) * 24
        + Math.min(volumeRatio, 4) * 12
        + eventPriority
        + trendAgreement
    );
}

export function applyWin80Ultra90Top1Selection<T extends MainStrategyCandidateLike>(candidates: T[]): T[] {
    if (!WIN80_ULTRA90_MAIN_STRATEGY.enabled) return candidates;

    const top = [...candidates]
        .filter((candidate) => classifyMainStrategyCandidate(candidate) !== "BLOCKED")
        .sort((left, right) => scoreMainStrategyCandidate(right) - scoreMainStrategyCandidate(left))[0];

    if (!top) return [];

    return [{
        ...top,
        allocationWeight: 1,
        positionSizeMultiplier: WIN80_ULTRA90_MAIN_STRATEGY.initialNotionalFraction,
        positionSizeLabel: "0.5x",
        selectionEligible: true,
        fullSizeEligible: true,
        halfSizeEligible: false,
        probationaryEligible: false,
        tradeDecision: "Selected",
        autoTradeTarget: true,
        autoTradeLiveEligible: true,
        orderArmEligible: true,
    } as T];
}

export function resolveWin80Ultra90Overlap(input: {
    current?: MainStrategyPositionLike | null;
    incoming: MainStrategyCandidateLike;
}): MainStrategyOverlapDecision {
    const current = input.current;
    const incomingTier = classifyMainStrategyCandidate(input.incoming);

    if (!current) {
        return {
            action: "OPEN_FULL",
            sourceSellFraction: 0,
            incomingAllocation: 1,
            retainedAllocation: 0,
            reason: "No managed position is open; deploy 100% notional to the top signal.",
        };
    }

    if (current.symbol.toUpperCase() === input.incoming.symbol.toUpperCase()) {
        return {
            action: "HOLD_SAME",
            sourceSellFraction: 0,
            incomingAllocation: 0,
            retainedAllocation: 1,
            reason: "The same symbol is already managed; do not pyramid.",
        };
    }

    if (incomingTier === "ULTRA90") {
        const fraction = WIN80_ULTRA90_MAIN_STRATEGY.ultra90SwitchFraction;
        return {
            action: "SWITCH_70",
            sourceSellFraction: fraction,
            incomingAllocation: fraction,
            retainedAllocation: 1 - fraction,
            reason: "Ultra90 signal takes priority; rotate 70% and retain 30% of the existing position.",
        };
    }

    if (incomingTier === "WIN80" && current.pnlPct > 0) {
        const fraction = WIN80_ULTRA90_MAIN_STRATEGY.profitableOverlapSplitFraction;
        return {
            action: "SPLIT_50",
            sourceSellFraction: fraction,
            incomingAllocation: fraction,
            retainedAllocation: 1 - fraction,
            reason: "Existing position is profitable; realize 50% and diversify 50% into the new Win80 signal.",
        };
    }

    return {
        action: "REJECT",
        sourceSellFraction: 0,
        incomingAllocation: 0,
        retainedAllocation: 1,
        reason: incomingTier === "BLOCKED"
            ? "Incoming signal does not satisfy the Win80 gate."
            : "Existing position is not profitable, so a normal Win80 overlap is rejected.",
    };
}
