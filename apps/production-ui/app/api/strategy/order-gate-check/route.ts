import { NextResponse } from "next/server";
import { STRATEGY_CONFIG } from "@/config/strategyConfig";
import { comparableStrategySymbol, deriveContinuousBasketCap, selectContinuousCandidatesV2, type ContinuousStrategyCandidate } from "@/lib/cycle-strategy";

const PASSIVE_WALLET_EXPOSURE = new Set(["SOL"]);

function isPrioritySyntheticCandidate(candidate: ContinuousStrategyCandidate) {
    const routeLiquidityUsd = Math.max(Number(candidate.executionLiquidityUsd || 0), Number(candidate.liquidity || 0));
    return routeLiquidityUsd >= Math.max(400_000, STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_LIQUIDITY * 0.7)
        && (
            candidate.rank === "A"
            || candidate.marketScore >= Math.max(78, STRATEGY_CONFIG.PRIORITY_EXECUTION_MIN_SCORE - 4)
        )
        && candidate.triggerProgressRatio >= STRATEGY_CONFIG.ORDER_SOFT_ARM_MIN_PROGRESS;
}

function countByChain(candidates: ContinuousStrategyCandidate[]) {
    return {
        SOLANA: candidates.filter((candidate) => candidate.chain === "SOLANA").length,
        BNB: candidates.filter((candidate) => candidate.chain === "BNB").length,
    };
}

function makeCandidate(overrides: Partial<ContinuousStrategyCandidate>): ContinuousStrategyCandidate {
    return {
        symbol: "TEST",
        displaySymbol: "TEST",
        chain: "SOLANA",
        mode: "MEAN_REVERSION",
        rank: "B",
        status: "Selected",
        executionStatus: "Pass",
        tradeDecision: "Half-size Eligible",
        marketScore: 70,
        score: 70,
        rawScore: 70,
        weightedScore: 70,
        maxPossibleScore: 100,
        confidence: 0.8,
        veto: false,
        vetoPass: true,
        vetoReasons: [],
        mainReason: "Synthetic triggered candidate",
        reasonTags: [],
        indicatorNotes: [],
        scoreBreakdown: {},
        supportDistancePct: 0.01,
        resistanceDistancePct: 0.02,
        atrPct: 0.012,
        volumeRatio: 0.7,
        relativeStrengthScore: 0.7,
        correlationGroup: "synthetic",
        positionSizeMultiplier: 0.5,
        positionSizeLabel: "0.5x",
        halfSizeEligible: true,
        fullSizeEligible: false,
        aHalfSizeEligible: false,
        bHalfSizeEligible: false,
        seedProxyHalfSizeEligible: false,
        conditionalReferencePass: false,
        probationaryEligible: false,
        selectionEligible: true,
        relativeStrengthPercentile: 0.62,
        volumeConfirmed: true,
        routeMissing: false,
        seedFallback: false,
        rrCheck: true,
        rrStatus: "OK",
        resistanceStatus: "Open",
        halfSizeMinRr: STRATEGY_CONFIG.RANGE_HALF_SIZE_MIN_RR,
        prefilterPass: true,
        prefilterReason: "Prefilter pass",
        price: 10,
        change24h: 2,
        volume: 1_000_000,
        liquidity: 2_000_000,
        spreadBps: 12,
        txns1h: 120,
        dexPairFound: true,
        historyBars: 160,
        dataCompleteness: 1,
        universeRankScore: 90,
        executionSupported: true,
        executionChain: "SOLANA",
        executionChainId: 101,
        executionAddress: "Synthetic1111111111111111111111111111111111",
        executionDecimals: 9,
        executionRouteKind: "cross-chain",
        executionSource: "cross-chain-aggregator",
        executionLiquidityUsd: 2_000_000,
        executionVolume24hUsd: 4_000_000,
        executionTxns1h: 120,
        marketSource: "dex",
        metrics: {
            r1: 0.001,
            r5: 0.004,
            r15: 0.003,
            r60: 0.002,
            r360: 0.01,
            r1440: 0.02,
            rsi1d: 53,
            rsi6h: 51,
            rsi1h: 49,
            macd1d: 0.1,
            macd6h: 0.08,
            macd1h: 0.04,
            vwap1h: -0.001,
            vwap15m: -0.002,
            adx1h: 14,
            plusDi1h: 20,
            minusDi1h: 18,
            emaBull1h: false,
            emaBull4h: false,
            emaSlope1h: 0,
            emaSlope4h: 0,
            bandWidth1h: 0.03,
            chop1h: 61,
            chop15m: 63,
            rr: 1.08,
        },
        regime: "Range",
        triggerType: "Support Bounce",
        triggerFamily: "Range",
        triggerState: "Triggered",
        triggerReason: "Synthetic support bounce",
        triggerScore: 84,
        triggerPassedCount: 4,
        triggerRuleCount: 5,
        triggerProgressRatio: 0.8,
        triggerMissingReasons: ["Volume slightly light"],
        autoTradeLiveEligible: true,
        autoTradeTarget: false,
        allocationWeight: 0,
        timedExitMinutes: 240,
        dynamicTakeProfit: 10.4,
        dynamicStopLoss: 9.8,
        eventPriority: 100,
        orderArmEligible: true,
        ...overrides,
    } as ContinuousStrategyCandidate;
}

function legacySelect(candidates: ContinuousStrategyCandidate[]) {
    const legacyMaxSelected = 3;
    const selected: ContinuousStrategyCandidate[] = [];
    const fullPool = candidates
        .filter((candidate) => candidate.fullSizeEligible)
        .sort((left, right) => right.eventPriority - left.eventPriority);
    const halfPool = candidates
        .filter((candidate) =>
            !candidate.fullSizeEligible
            && (candidate.aHalfSizeEligible || candidate.bHalfSizeEligible || candidate.seedProxyHalfSizeEligible || candidate.conditionalReferencePass),
        )
        .sort((left, right) => right.eventPriority - left.eventPriority);

    const trySelect = (candidate: ContinuousStrategyCandidate, sizeMultiplier: number) => {
        if (selected.some((existing) => existing.correlationGroup === candidate.correlationGroup)) return false;
        selected.push({
            ...candidate,
            positionSizeMultiplier: sizeMultiplier,
            positionSizeLabel:
                sizeMultiplier >= STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER
                    ? "0.5x"
                    : sizeMultiplier >= STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER
                        ? "0.3x"
                        : "0.2x",
            autoTradeTarget: true,
        });
        return true;
    };

    for (const candidate of fullPool) {
        trySelect(candidate, STRATEGY_CONFIG.FULL_SIZE_POSITION_MULTIPLIER);
        if (selected.length >= legacyMaxSelected) break;
    }

    if (selected.length < legacyMaxSelected) {
        for (const candidate of halfPool) {
            if (selected.some((existing) => existing.symbol === candidate.symbol)) continue;
            trySelect(candidate, STRATEGY_CONFIG.HALF_SIZE_POSITION_MULTIPLIER);
            if (selected.length >= legacyMaxSelected) break;
        }
    }

    return selected;
}

function countOrderReady(candidates: ContinuousStrategyCandidate[], allowMajorWalletOverlap: boolean, allowSoftArm: boolean) {
    return candidates.filter((candidate) => {
        if (!(candidate.triggerState === "Triggered" || (allowSoftArm && candidate.orderArmEligible))) return false;
        const comparable = comparableStrategySymbol(candidate.symbol);
        const passiveWalletBlocked =
            PASSIVE_WALLET_EXPOSURE.has(comparable)
            && !(allowMajorWalletOverlap && isPrioritySyntheticCandidate(candidate));
        return !passiveWalletBlocked;
    }).length;
}

export async function GET() {
    const candidates = [
        makeCandidate({
            symbol: "SOL.SOL",
            displaySymbol: "SOL",
            rank: "A",
            marketScore: 94,
            score: 94,
            eventPriority: 118,
            conditionalReferencePass: true,
            fullSizeEligible: true,
            halfSizeEligible: false,
            tradeDecision: "Selected",
            positionSizeMultiplier: 1,
            positionSizeLabel: "0.5x",
            correlationGroup: "sol-major",
            executionStatus: "Seed Fallback",
            seedFallback: true,
            mainReason: "Route-backed conditional reference pass",
        }),
        makeCandidate({
            symbol: "RENDER.SOL",
            displaySymbol: "RENDER",
            rank: "A",
            marketScore: 90,
            score: 90,
            eventPriority: 116,
            conditionalReferencePass: true,
            correlationGroup: "render-major",
            executionStatus: "Seed Fallback",
            seedFallback: true,
            mainReason: "Route-backed conditional reference pass",
        }),
        makeCandidate({
            symbol: "BNB",
            displaySymbol: "BNB",
            chain: "BNB",
            mode: "TREND",
            regime: "Trend",
            triggerType: "Breakout",
            triggerFamily: "Trend",
            triggerState: "Triggered",
            triggerProgressRatio: 0.86,
            triggerPassedCount: 4,
            triggerRuleCount: 5,
            triggerMissingReasons: ["Volume slightly light"],
            rank: "B",
            marketScore: 72,
            score: 72,
            eventPriority: 114,
            correlationGroup: "bnb-trend",
            fullSizeEligible: false,
            halfSizeEligible: true,
            selectionEligible: true,
            positionSizeMultiplier: 0.5,
            positionSizeLabel: "0.5x",
            orderArmEligible: true,
            mainReason: "Trend continuation half-size",
            executionChain: "BNB",
            executionChainId: 56,
            executionAddress: "0x0000000000000000000000000000000000000BNB",
            executionRouteKind: "native",
            executionSource: "registry",
        }),
        makeCandidate({
            symbol: "JUP.SOL",
            displaySymbol: "JUP",
            mode: "TREND",
            regime: "Trend",
            triggerType: "VWAP Reclaim",
            triggerFamily: "Trend",
            triggerState: "Armed",
            triggerProgressRatio: 0.78,
            triggerPassedCount: 3,
            triggerRuleCount: 4,
            triggerMissingReasons: ["Volume slightly light"],
            rank: "B",
            marketScore: 68,
            score: 68,
            eventPriority: 113,
            correlationGroup: "jup-trend",
            halfSizeEligible: true,
            selectionEligible: true,
            positionSizeMultiplier: 0.5,
            positionSizeLabel: "0.5x",
            orderArmEligible: true,
            conditionalReferencePass: false,
            mainReason: "Trend VWAP reclaim soft-arm",
        }),
        makeCandidate({
            symbol: "PIPPIN.SOL",
            displaySymbol: "PIPPIN",
            rank: "B",
            marketScore: 63,
            score: 63,
            eventPriority: 112,
            correlationGroup: "pippin-range",
            conditionalReferencePass: false,
            halfSizeEligible: false,
            aHalfSizeEligible: false,
            bHalfSizeEligible: false,
            seedProxyHalfSizeEligible: false,
            probationaryEligible: true,
            positionSizeMultiplier: 0.25,
            positionSizeLabel: "0.2x",
            orderArmEligible: true,
            triggerState: "Armed",
            mainReason: "Range probation volume-soft pass",
        }),
        makeCandidate({
            symbol: "BTC",
            displaySymbol: "BTC",
            chain: "BNB",
            rank: "B",
            marketScore: 66,
            score: 66,
            eventPriority: 110,
            correlationGroup: "btc-range",
            conditionalReferencePass: false,
            halfSizeEligible: false,
            probationaryEligible: true,
            selectionEligible: true,
            positionSizeMultiplier: 0.25,
            positionSizeLabel: "0.2x",
            triggerState: "Armed",
            orderArmEligible: true,
            mainReason: "Range probation lane / volume slightly light",
            executionChain: "BNB",
            executionChainId: 56,
            executionAddress: "0x0000000000000000000000000000000000000BTC",
            executionRouteKind: "native",
            executionSource: "registry",
        }),
        makeCandidate({
            symbol: "POPCAT.SOL",
            displaySymbol: "POPCAT",
            rank: "B",
            marketScore: 61,
            score: 61,
            eventPriority: 108,
            correlationGroup: "popcat-range",
            conditionalReferencePass: false,
            aHalfSizeEligible: false,
            bHalfSizeEligible: false,
            seedProxyHalfSizeEligible: false,
            mainReason: "Range 0.5x supplemental",
        }),
        makeCandidate({
            symbol: "TRUMP.SOL",
            displaySymbol: "TRUMP",
            rank: "B",
            marketScore: 59,
            score: 59,
            eventPriority: 106,
            correlationGroup: "trump-range",
            conditionalReferencePass: false,
            halfSizeEligible: false,
            aHalfSizeEligible: false,
            bHalfSizeEligible: false,
            seedProxyHalfSizeEligible: false,
            probationaryEligible: true,
            selectionEligible: true,
            positionSizeMultiplier: 0.25,
            positionSizeLabel: "0.2x",
            triggerState: "Armed",
            orderArmEligible: true,
            mainReason: "Range probation / retest bounce volume-soft pass",
        }),
        makeCandidate({
            symbol: "RISKY.SOL",
            displaySymbol: "RISKY",
            rank: "C",
            marketScore: 54,
            score: 54,
            eventPriority: 74,
            halfSizeEligible: false,
            selectionEligible: false,
            tradeDecision: "Blocked",
            correlationGroup: "risky-blocked",
            mainReason: "RR blocked",
        }),
        makeCandidate({
            symbol: "FORM",
            displaySymbol: "FORM",
            chain: "BNB",
            executionStatus: "Seed Fallback",
            seedFallback: true,
            conditionalReferencePass: false,
            selectionEligible: false,
            tradeDecision: "Blocked",
            correlationGroup: "form-blocked",
            mainReason: "Seed fallback / reference only",
            executionRouteKind: "native",
            executionSource: "registry",
        }),
        makeCandidate({
            symbol: "ASTER",
            displaySymbol: "ASTER",
            chain: "BNB",
            executionStatus: "Seed Fallback",
            seedFallback: true,
            conditionalReferencePass: false,
            selectionEligible: false,
            tradeDecision: "Blocked",
            correlationGroup: "aster-blocked",
            mainReason: "Reference only",
            executionRouteKind: "native",
            executionSource: "registry",
        }),
        makeCandidate({
            symbol: "ETH",
            displaySymbol: "ETH",
            chain: "BNB",
            executionStatus: "VETO NG",
            veto: true,
            vetoPass: false,
            selectionEligible: false,
            tradeDecision: "Blocked",
            correlationGroup: "eth-blocked",
            mainReason: "VETO / liquidity thin",
            executionRouteKind: "native",
            executionSource: "registry",
        }),
    ];
    const correlations = Object.fromEntries(candidates.map((candidate) => [candidate.symbol, {}]));
    const basketCap = deriveContinuousBasketCap({
        selectionEligibleCount: candidates.filter((candidate) => candidate.selectionEligible).length,
        probationaryCount: candidates.filter((candidate) => candidate.probationaryEligible).length,
        conditionalReferenceCount: candidates.filter((candidate) => candidate.conditionalReferencePass).length,
        rangeCandidateCount: candidates.filter((candidate) => candidate.regime === "Range" && candidate.selectionEligible).length,
        prefilterMode: "Range",
        prefilterPassCount: candidates.length,
    });
    const currentSelected = selectContinuousCandidatesV2(candidates, correlations, { prefilterMode: "Range", prefilterPassCount: candidates.length });
    const legacySelectedRows = legacySelect(candidates);
    const universeAdjusted = currentSelected.filter((candidate) =>
        (candidate.triggerState === "Armed" && candidate.orderArmEligible)
        || candidate.probationaryEligible
        || candidate.conditionalReferencePass,
    );

    return NextResponse.json({
        scenario: "synthetic-order-gate",
        beforeApprox: {
            selected: legacySelectedRows.length,
            order: countOrderReady(legacySelectedRows, false, false),
            autoTarget: legacySelectedRows.length,
            byChain: countByChain(legacySelectedRows),
        },
        current: {
            basketCap,
            selectionEligible: candidates.filter((candidate) => candidate.selectionEligible).length,
            selected: currentSelected.length,
            order: countOrderReady(currentSelected, true, true),
            orderArmed: currentSelected.filter((candidate) => candidate.triggerState === "Triggered" || candidate.orderArmEligible).length,
            autoTarget: currentSelected.length,
            probationary: currentSelected.filter((candidate) => candidate.positionSizeLabel === "0.2x").length,
            byChain: countByChain(currentSelected),
            universeAdjusted: {
                total: universeAdjusted.length,
                byChain: countByChain(universeAdjusted),
            },
        },
        newlySelectable: currentSelected
            .filter((candidate) => !legacySelectedRows.some((legacy) => legacy.symbol === candidate.symbol))
            .map((candidate) => candidate.symbol),
        stillBlocked: candidates
            .filter((candidate) => !currentSelected.some((selected) => selected.symbol === candidate.symbol) && !candidate.selectionEligible)
            .map((candidate) => ({
                symbol: candidate.symbol,
                executionStatus: candidate.executionStatus,
                reason: candidate.mainReason,
            })),
        sample: currentSelected.map((candidate) => ({
            symbol: candidate.symbol,
            positionSize: candidate.positionSizeLabel,
            conditionalReferencePass: candidate.conditionalReferencePass,
            triggerState: candidate.triggerState,
            eventPriority: candidate.eventPriority,
            reason: candidate.mainReason,
        })),
    });
}
