export type DisDexV35Regime = "BULL" | "BEAR" | "FLAT";

export interface DisDexV35FeatureSnapshot {
    /** BTC close compared with its prior completed 20-day SMA. */
    btcCloseAboveSma20d: boolean;
    /** BTC return over the prior completed 20 days, in percentage points. */
    btcMomentum20dPct: number;
    /** BTC return over the prior completed 3 days, in percentage points. */
    btcMomentum3dPct: number;
    /** BTC return over the prior completed day, in percentage points. */
    btcShock1dPct: number;
    /** Maximum downside/upside realized-volatility ratio of ETH/BNB/SOL. */
    coreDownsideVolatilitySkew: number;
}

export interface DisDexV35AllocationInput {
    regime: DisDexV35Regime;
    /** Gross exposure produced by the frozen V28 core before V35 scaling. */
    coreGross: number;
    /** Whether the frozen PENGU 72-hour sleeve currently has a signal. */
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
    status: "FROZEN_MAIN_SHADOW_CANDIDATE",
    coreStrategy: "V28_VWM25_SKEW125",
    coreSymbols: ["BTC", "ETH", "BNB", "SOL"] as const,
    satelliteStrategy: "PENGU_ADAPTIVE_72H_V2",
    satelliteSymbol: "PENGU",
    strongBullMultiplier: 1.4,
    normalBullMultiplier: 1.2,
    brakeMultiplier: 0.35,
    bearMultiplier: 1.0,
    penguSignalGross: 0.30,
    penguBrakeGross: 0.15,
    grossCap: 2.0,
    strongBullMomentum20dPct: 10,
    brakeShock1dPct: -4,
    brakeSkewRatio: 1.35,
    featureDecisionLagBars12h: 1,
    shadowOnly: true,
    realTradingDefaultEnabled: false,
    backtestEvidence: {
        developmentPeriod: "2023-01-01/2025-12-31",
        developmentReturnPct: 712.1907,
        developmentCagrPct: 100.9788,
        developmentMaxDrawdownPct: -34.2079,
        developmentMonthlyProfitFactor: 3.6949,
        developmentSevereReturnPct: 118.1794,
        developmentSevereMaxDrawdownPct: -54.0194,
        reused2026H1ReturnPct: 22.0712,
        reused2026H1SevereReturnPct: 0.5298,
        reused2026H1SevereMaxDrawdownPct: -15.4185,
        fullReturnPct: 891.4507,
        fullCagrPct: 92.7327,
    },
    liveGate: {
        minimumPristineForwardDays: 30,
        minimumCompletedPenguTrades: 12,
        minimumDataCoveragePct: 95,
        minimumSevereReturnPct: 0,
        maximumSevereDrawdownPct: -25,
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
        reasons.push("Frozen V28 bear hedge remains at 1.0x.");
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
        reasons.push("No frozen core exposure is allowed in a flat regime.");
    }

    const coreGross = nonNegative(input.coreGross) * coreMultiplier;
    const penguGross = input.penguSignalActive
        ? state === "BRAKE" ? config.penguBrakeGross : config.penguSignalGross
        : 0;
    const rawGross = coreGross + penguGross;
    const capScale = rawGross > 0 ? Math.min(1, config.grossCap / rawGross) : 1;
    const finalCoreGross = coreGross * capScale;
    const finalPenguGross = penguGross * capScale;

    return {
        strategyId: config.id,
        regime: input.regime,
        state,
        coreMultiplier,
        penguGross,
        rawGross,
        capScale,
        finalCoreGross,
        finalPenguGross,
        finalGross: finalCoreGross + finalPenguGross,
        shadowOnly: config.shadowOnly,
        liveEligible: false,
        reasons,
    };
}

export function evaluateDisDexV35LiveGate(evidence: DisDexV35ForwardEvidence) {
    const gate = DISDEX_RESILIENT_PROFIT_MAIN_V35.liveGate;
    const checks = {
        pristineForwardDays: finite(evidence.pristineForwardDays) >= gate.minimumPristineForwardDays,
        completedPenguTrades: finite(evidence.completedPenguTrades) >= gate.minimumCompletedPenguTrades,
        dataCoverage: finite(evidence.dataCoveragePct) >= gate.minimumDataCoveragePct,
        severeReturn: finite(evidence.severeReturnPct) > gate.minimumSevereReturnPct,
        severeDrawdown: finite(evidence.severeMaxDrawdownPct, -100) >= gate.maximumSevereDrawdownPct,
    };
    return {
        checks,
        passed: Object.values(checks).every(Boolean),
        liveEligible: false as const,
        reason: "V35 remains shadow-only until a separate reviewed promotion changes the immutable live flag.",
    };
}
