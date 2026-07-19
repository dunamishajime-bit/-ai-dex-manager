export type DisDexV35Regime = "BULL" | "BEAR" | "FLAT";

export interface DisDexV35FeatureSnapshot {
    btcCloseAboveSma20d: boolean;
    btcMomentum20dPct: number;
    btcMomentum3dPct: number;
    btcShock1dPct: number;
    coreDownsideVolatilitySkew: number;
}

export interface DisDexV35AllocationInput {
    regime: DisDexV35Regime;
    coreGross: number;
    /** Retained for input compatibility; V36/V38 rejected PENGU and it is ignored. */
    penguSignalActive: boolean;
    features: DisDexV35FeatureSnapshot;
}

export interface DisDexV35AllocationPlan {
    strategyId: typeof DISDEX_RESILIENT_PROFIT_MAIN_V35.id;
    regime: DisDexV35Regime;
    state: "STRONG_BULL" | "NORMAL_BULL" | "BRAKE" | "BEAR" | "FLAT";
    coreMultiplier: number;
    penguGross: number;
    rawGross: number;
    capScale: number;
    finalCoreGross: number;
    finalPenguGross: number;
    finalGross: number;
    shadowOnly: boolean;
    liveEligible: boolean;
    reasons: string[];
}

export interface DisDexV35ForwardEvidence {
    pristineForwardDays: number;
    completedPenguTrades: number;
    severeReturnPct: number;
    severeMaxDrawdownPct: number;
    dataCoveragePct: number;
}

export const DISDEX_RESILIENT_PROFIT_MAIN_V35 = {
    id: "DISDEX_RESILIENT_PROFIT_MAIN_V35",
    version: 35,
    status: "IMPLEMENTED_PAPER_ONLY_ASTER_REVALIDATION_FAILED",
    coreStrategy: "V28_VWM25_SKEW125",
    coreSymbols: ["BTC", "ETH", "BNB", "SOL"] as const,
    satelliteStrategy: "PENGU_EXCLUDED_V36_V38",
    satelliteSymbol: "PENGU",
    strongBullMultiplier: 1.4,
    normalBullMultiplier: 1.2,
    brakeMultiplier: 0.35,
    bearMultiplier: 1.0,
    penguSignalGross: 0,
    penguBrakeGross: 0,
    grossCap: 2.0,
    strongBullMomentum20dPct: 10,
    brakeShock1dPct: -4,
    brakeSkewRatio: 1.35,
    featureDecisionLagBars12h: 1,
    shadowOnly: false,
    paperOnly: true,
    realTradingDefaultEnabled: false,
    asterRevalidationEvidence: {
        source: "Aster public 1h OHLCV and funding",
        developmentPeriod: "2023-01-01/2025-12-31",
        developmentReturnPct: 319.3915,
        developmentCagrPct: 61.2473,
        developmentMaxDrawdownPct: -31.773,
        developmentMonthlyProfitFactor: 3.054,
        developmentSevereReturnPct: 10.1149,
        developmentSevereMaxDrawdownPct: -49.7769,
        reused2026H1ReturnPct: 3.0541,
        reused2026H1SevereReturnPct: -14.4419,
        reused2026H1SevereMaxDrawdownPct: -24.8182,
        fullReturnPct: 332.2003,
        fullCagrPct: 51.9917,
        robustCandidateFound: false,
    },
    rejectedEvidence: {
        fixedPenguTradesUsedByOldV35: 17,
        v36StableRuleFound: false,
        v38FrozenEnsembleFound: false,
        reason: "Fixed historical PENGU trade timestamps cannot generate future signals and are excluded from production evidence.",
    },
    liveGate: {
        minimumPristineForwardDays: 30,
        minimumDataCoveragePct: 95,
        minimumSevereReturnPct: 0,
        maximumSevereDrawdownPct: -25,
        requiresRobustAsterBacktest: true,
    },
} as const;

function finite(value: number, fallback = 0) {
    return Number.isFinite(value) ? value : fallback;
}

function nonNegative(value: number) {
    return Math.max(0, finite(value));
}

export function resolveDisDexV35Allocation(input: DisDexV35AllocationInput): DisDexV35AllocationPlan {
    const config = DISDEX_RESILIENT_PROFIT_MAIN_V35;
    const features = input.features;
    const reasons: string[] = [];
    let state: DisDexV35AllocationPlan["state"] = "FLAT";
    let coreMultiplier = 0;

    if (input.regime === "BEAR") {
        state = "BEAR";
        coreMultiplier = config.bearMultiplier;
        reasons.push("V28 BTC bear hedge remains at 1.0x.");
    } else if (input.regime === "BULL") {
        const strong = features.btcCloseAboveSma20d
            && finite(features.btcMomentum20dPct) >= config.strongBullMomentum20dPct
            && finite(features.btcMomentum3dPct) > 0;
        const brake = finite(features.btcShock1dPct) <= config.brakeShock1dPct
            || finite(features.coreDownsideVolatilitySkew, 1) > config.brakeSkewRatio
            || !features.btcCloseAboveSma20d;

        if (brake) {
            state = "BRAKE";
            coreMultiplier = config.brakeMultiplier;
            if (finite(features.btcShock1dPct) <= config.brakeShock1dPct) reasons.push("BTC one-day shock brake active.");
            if (finite(features.coreDownsideVolatilitySkew, 1) > config.brakeSkewRatio) reasons.push("Core downside-volatility skew brake active.");
            if (!features.btcCloseAboveSma20d) reasons.push("BTC is below its completed 20-day SMA.");
        } else if (strong) {
            state = "STRONG_BULL";
            coreMultiplier = config.strongBullMultiplier;
            reasons.push("BTC 20-day and 3-day momentum confirm the strong-bull multiplier.");
        } else {
            state = "NORMAL_BULL";
            coreMultiplier = config.normalBullMultiplier;
            reasons.push("Bull regime is valid but does not meet the strong-bull threshold.");
        }
    } else {
        reasons.push("No core exposure is allowed in a flat regime.");
    }

    if (input.penguSignalActive) {
        reasons.push("PENGU signal ignored: V36 and V38 found no robust reproducible production rule.");
    }
    const coreGross = nonNegative(input.coreGross) * coreMultiplier;
    const penguGross = 0;
    const rawGross = coreGross;
    const capScale = rawGross > 0 ? Math.min(1, config.grossCap / rawGross) : 1;
    const finalCoreGross = coreGross * capScale;

    return {
        strategyId: config.id,
        regime: input.regime,
        state,
        coreMultiplier,
        penguGross,
        rawGross,
        capScale,
        finalCoreGross,
        finalPenguGross: 0,
        finalGross: finalCoreGross,
        shadowOnly: config.shadowOnly,
        liveEligible: false,
        reasons,
    };
}

export function evaluateDisDexV35LiveGate(evidence: DisDexV35ForwardEvidence) {
    const gate = DISDEX_RESILIENT_PROFIT_MAIN_V35.liveGate;
    const checks = {
        robustAsterBacktest: DISDEX_RESILIENT_PROFIT_MAIN_V35.asterRevalidationEvidence.robustCandidateFound,
        pristineForwardDays: finite(evidence.pristineForwardDays) >= gate.minimumPristineForwardDays,
        dataCoverage: finite(evidence.dataCoveragePct) >= gate.minimumDataCoveragePct,
        severeReturn: finite(evidence.severeReturnPct) > gate.minimumSevereReturnPct,
        severeDrawdown: finite(evidence.severeMaxDrawdownPct, -100) >= gate.maximumSevereDrawdownPct,
    };
    return {
        checks,
        passed: Object.values(checks).every(Boolean),
        liveEligible: false as const,
        reason: "V35 dedicated runner is implemented, but Aster revalidation and PENGU reproducibility gates failed; live execution remains blocked.",
    };
}
