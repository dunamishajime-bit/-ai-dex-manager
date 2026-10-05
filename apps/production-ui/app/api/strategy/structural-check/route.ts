import { NextResponse } from "next/server";
import { buildContinuousStrategyMonitor, type ContinuousStrategyCandidate, type MarketSnapshot, type PriceSample, type StrategyEngineInput } from "@/lib/cycle-strategy";
import { STRATEGY_UNIVERSE_SEEDS } from "@/config/strategyUniverse";
import { STRATEGY_CONFIG } from "@/config/strategyConfig";

function seededPrice(index: number, symbol: string) {
    const base = symbol.endsWith(".SOL") ? 1.2 : 0.9;
    return Number((base + ((index % 11) * 0.17)).toFixed(4));
}

function buildMomentumSeries(referenceTs: number, basePrice: number): PriceSample[] {
    const samples: PriceSample[] = [];
    for (let step = 360; step >= 0; step -= 1) {
        const ts = referenceTs - step * 60_000;
        const wave = Math.sin(step / 18) * 0.008;
        const pullback = step > 28 ? -0.016 : ((28 - step) / 28) * 0.032;
        const drift = ((360 - step) / 360) * 0.065;
        const lateBreak = step <= 18 ? ((18 - step) / 18) * 0.028 : 0;
        samples.push({
            ts,
            price: Number((basePrice * (1 + wave + pullback + drift + lateBreak)).toFixed(6)),
        });
    }
    return samples;
}

function buildSyntheticRangeInput(): StrategyEngineInput {
    const marketSnapshots: Record<string, MarketSnapshot> = {};
    const priceHistory: Record<string, PriceSample[]> = {};
    const referenceTs = Date.UTC(2026, 2, 12, 3, 15, 0, 0);

    STRATEGY_UNIVERSE_SEEDS.forEach((seed, index) => {
        const isAllowlistedReference = ["SOL.SOL", "JUP.SOL", "RENDER.SOL", "BONK.SOL"].includes(seed.symbol);
        const isStrongPass = ["BNB", "WIF.SOL", "PUMP.SOL"].includes(seed.symbol);
        const rescueVolumeFactor = seed.profile === "core"
            ? 0.015
            : seed.profile === "secondary" || seed.profile === "bnb-ecosystem"
                ? 0.05
                : 0.12;
        const rescueLiquidityFactor = seed.profile === "core"
            ? 0.015
            : seed.profile === "secondary" || seed.profile === "bnb-ecosystem"
                ? 0.07
                : 0.18;
        const price = seededPrice(index, seed.symbol);
        if (isAllowlistedReference || isStrongPass) {
            priceHistory[seed.symbol] = buildMomentumSeries(referenceTs, price);
        }

        const change24h = isAllowlistedReference
            ? 6.1 - (index % 2) * 0.25
            : isStrongPass
                ? 3.2 + (index % 3) * 0.45
                : -1.8 + (index % 5) * 0.9;

        const liquidityBase = isStrongPass
            ? seed.liquidityUsd * 0.95
            : isAllowlistedReference
                ? seed.liquidityUsd * 0.92
                : seed.liquidityUsd * rescueLiquidityFactor;

        const volumeBase = isStrongPass
            ? seed.volume24hUsd * 0.92
            : isAllowlistedReference
                ? seed.volume24hUsd * 0.9
                : seed.volume24hUsd * rescueVolumeFactor;

        marketSnapshots[seed.symbol] = {
            price,
            change24h,
            chain: seed.chain,
            displaySymbol: seed.displaySymbol,
            volume: Number(volumeBase.toFixed(2)),
            liquidity: Number(liquidityBase.toFixed(2)),
            spreadBps: Number((seed.spreadBps * (isStrongPass ? 0.92 : 1.18)).toFixed(2)),
            marketCap: seed.marketCapUsd,
            tokenAgeDays: seed.tokenAgeDays,
            txns1h: isStrongPass ? 56 : isAllowlistedReference ? 72 : 18 + (index % 5) * 4,
            dexPairFound: true,
            executionSupported: true,
            executionChain: seed.chain,
            executionAddress: seed.address,
            executionDecimals: seed.decimals,
            executionRouteKind: seed.chain === "SOLANA"
                ? (seed.symbol === "SOL.SOL" || seed.symbol === "BONK.SOL" ? "proxy" : "cross-chain")
                : "native",
            executionSource: seed.chain === "SOLANA" ? "cross-chain-aggregator" : "registry",
            executionLiquidityUsd: Number((Math.max(liquidityBase * 0.95, isAllowlistedReference ? 1_600_000 : 0)).toFixed(2)),
            executionVolume24hUsd: Number((Math.max(volumeBase * 0.95, isAllowlistedReference ? 5_000_000 : 0)).toFixed(2)),
            executionTxns1h: isStrongPass ? 64 : isAllowlistedReference ? 84 : 20 + (index % 4) * 4,
            source: isAllowlistedReference ? "seed" : "dex",
        };
    });

    return {
        referenceTs,
        marketSnapshots,
        priceHistory,
        positions: [],
        cyclePerformance: [],
    };
}

function isRangeRescueCandidate(prefilterReason?: string) {
    const value = (prefilterReason || "").toLowerCase();
    return value.includes("range rank rescue") || value.includes("range reference include");
}

function buildLegacySelectionApprox(candidates: ContinuousStrategyCandidate[]) {
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

    const trySelect = (candidate: ContinuousStrategyCandidate) => {
        if (selected.some((existing) => existing.correlationGroup === candidate.correlationGroup)) return false;
        selected.push(candidate);
        return true;
    };

    for (const candidate of fullPool) {
        trySelect(candidate);
        if (selected.length >= STRATEGY_CONFIG.MAX_SELECTED_PER_CYCLE) break;
    }

    if (selected.length < STRATEGY_CONFIG.MAX_SELECTED_PER_CYCLE) {
        for (const candidate of halfPool) {
            if (selected.some((existing) => existing.symbol === candidate.symbol)) continue;
            trySelect(candidate);
            if (selected.length >= STRATEGY_CONFIG.MAX_SELECTED_PER_CYCLE) break;
        }
    }

    return selected;
}

export async function GET() {
    const input = buildSyntheticRangeInput();
    const monitor = buildContinuousStrategyMonitor(input, {
        openSymbols: [],
        pendingSymbols: [],
        recentTrades: [],
    });

    const baselineCandidates = monitor.candidates.filter((candidate) =>
        !candidate.conditionalReferencePass && !isRangeRescueCandidate(candidate.prefilterReason),
    );
    const legacySelected = buildLegacySelectionApprox(monitor.candidates.filter((candidate) => candidate.autoTradeLiveEligible));
    const newFeatureSymbols = monitor.candidates
        .filter((candidate) => candidate.conditionalReferencePass || isRangeRescueCandidate(candidate.prefilterReason))
        .map((candidate) => candidate.symbol);

    return NextResponse.json({
        scenario: "synthetic-range-day",
        current: {
            prefilter: monitor.stats.prefilterPassCount,
            prefilterMode: monitor.stats.prefilterMode,
            prefilterRescuedCount: monitor.stats.prefilterRescuedCount,
            selectionEligible: monitor.stats.selectionEligibleCount,
            triggered: monitor.stats.triggeredCount,
            selected: monitor.stats.selectedCount,
            orderArmed: monitor.stats.orderArmedCount,
            waitingForSlot: monitor.stats.waitingForSlotCount,
            autoTarget: monitor.candidates.filter((candidate) => candidate.autoTradeTarget).length,
        },
        beforeApprox: {
            prefilter: Math.max(0, monitor.stats.prefilterPassCount - (monitor.stats.prefilterRescuedCount || 0)),
            triggered: baselineCandidates.filter((candidate) => candidate.triggerState === "Triggered").length,
            selected: legacySelected.length,
            orderArmed: legacySelected.filter((candidate) => candidate.triggerState === "Triggered").length,
            autoTarget: legacySelected.length,
        },
        additions: {
            conditionalReference: monitor.candidates
                .filter((candidate) => candidate.conditionalReferencePass)
                .map((candidate) => candidate.symbol),
            rangeRescue: monitor.candidates
                .filter((candidate) => isRangeRescueCandidate(candidate.prefilterReason))
                .map((candidate) => candidate.symbol),
            newFeatureSymbols,
        },
        sample: monitor.candidates.slice(0, 12).map((candidate) => ({
            symbol: candidate.symbol,
            prefilterReason: candidate.prefilterReason,
            executionStatus: candidate.executionStatus,
            conditionalReferencePass: candidate.conditionalReferencePass,
            triggerState: candidate.triggerState,
            orderGateStatus: candidate.orderGateStatus,
            autoTradeTarget: candidate.autoTradeTarget,
            marketScore: candidate.marketScore,
        })),
    });
}
