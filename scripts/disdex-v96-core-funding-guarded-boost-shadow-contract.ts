import { createHash } from "node:crypto";

export const DISDEX_V96_FUNDING_GUARDED_BOOST_SHADOW_CONFIG = Object.freeze({
    schemaVersion: 1,
    strategyId: "EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1",
    completedTimeframeHours: 12,
    triggerCumulativeSignedMovePct: 6,
    requiredLatestSignedReturnExclusiveMinimumPct: 0,
    maximumCompleted12hFundingBps: 1,
    fundingLookbackCompleted12hBuckets: 1,
    symbolWeightMultiplier: 1.025,
    maximumGross: 2,
    maximumAddsPerEpisode: 1,
    shadowOnly: true,
    orderSubmissionAllowed: false,
});

export type FundingGuardedShadowWeightMap = Record<string, number>;

export interface DisDexV96FundingGuardedBoostShadowInput {
    runtimeCommitSha: string;
    referenceTs: number;
    latestCompletedCandleTs: number;
    completed12hChronologyPassed: boolean;
    dataCoveragePassed: boolean;
    fundingCoveragePassed: boolean;
    symbol: string;
    episodeId: string;
    liveWeights: FundingGuardedShadowWeightMap;
    strongBoostActive: boolean;
    whipsawActive: boolean;
    drawdownStage: number;
    cumulativeSignedMovePct: number;
    latestSignedReturnPct: number;
    latestCompleted12hFundingBps: number;
    episodeAlreadyAdded: boolean;
}

export interface DisDexV96FundingGuardedBoostShadowDecision {
    schemaVersion: 1;
    strategyId: "EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1";
    configFingerprint: string;
    runtimeCommitSha: string;
    referenceTs: number;
    latestCompletedCandleTs: number;
    symbol: string;
    episodeId: string;
    eligible: boolean;
    failedReasons: string[];
    liveWeights: FundingGuardedShadowWeightMap;
    counterfactualWeights: FundingGuardedShadowWeightMap;
    liveGross: number;
    counterfactualGross: number;
    liveSymbolWeight: number;
    latestCompleted12hFundingBps: number;
    unclippedCounterfactualSymbolWeight: number;
    clippedCounterfactualSymbolWeight: number;
    counterfactualWeightDelta: number;
    orderSubmissionAllowed: false;
}

function finite(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function isFiniteNumber(value: unknown): boolean {
    return Number.isFinite(Number(value));
}

function cleanWeights(weights: FundingGuardedShadowWeightMap): FundingGuardedShadowWeightMap {
    return Object.fromEntries(
        Object.entries(weights)
            .map(([symbol, weight]) => [symbol.toUpperCase(), finite(weight)] as const)
            .filter(([, weight]) => Math.abs(weight) > 1e-12),
    );
}

function gross(weights: FundingGuardedShadowWeightMap): number {
    return Object.values(weights).reduce((sum, weight) => sum + Math.abs(finite(weight)), 0);
}

function capWeights(weights: FundingGuardedShadowWeightMap): FundingGuardedShadowWeightMap {
    const clean = cleanWeights(weights);
    const currentGross = gross(clean);
    const scale = currentGross > 0
        ? Math.min(1, DISDEX_V96_FUNDING_GUARDED_BOOST_SHADOW_CONFIG.maximumGross / currentGross)
        : 1;
    return Object.fromEntries(
        Object.entries(clean)
            .map(([symbol, weight]) => [symbol, weight * scale] as const)
            .filter(([, weight]) => Math.abs(weight) > 1e-12),
    );
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

export function disDexV96FundingGuardedBoostShadowConfigFingerprint(): string {
    return createHash("sha256")
        .update(canonical(DISDEX_V96_FUNDING_GUARDED_BOOST_SHADOW_CONFIG))
        .digest("hex");
}

export function evaluateDisDexV96FundingGuardedBoostShadow(
    input: DisDexV96FundingGuardedBoostShadowInput,
): DisDexV96FundingGuardedBoostShadowDecision {
    const config = DISDEX_V96_FUNDING_GUARDED_BOOST_SHADOW_CONFIG;
    const symbol = String(input.symbol || "").toUpperCase();
    const liveWeights = capWeights(input.liveWeights || {});
    const liveGross = gross(liveWeights);
    const liveSymbolWeight = finite(liveWeights[symbol]);
    const fundingBps = finite(input.latestCompleted12hFundingBps);
    const failedReasons: string[] = [];

    if (!/^[0-9a-f]{40}$/i.test(String(input.runtimeCommitSha || ""))) failedReasons.push("INVALID_RUNTIME_COMMIT_SHA");
    if (!(finite(input.referenceTs) > 0)) failedReasons.push("INVALID_REFERENCE_TS");
    if (!(finite(input.latestCompletedCandleTs) > 0)) failedReasons.push("INVALID_COMPLETED_CANDLE_TS");
    if (!input.completed12hChronologyPassed) failedReasons.push("COMPLETED_12H_CHRONOLOGY_FAILED");
    if (!input.dataCoveragePassed) failedReasons.push("DATA_COVERAGE_FAILED");
    if (!input.fundingCoveragePassed) failedReasons.push("FUNDING_COVERAGE_FAILED");
    if (!isFiniteNumber(input.latestCompleted12hFundingBps)) failedReasons.push("FUNDING_VALUE_INVALID");
    if (fundingBps > config.maximumCompleted12hFundingBps) failedReasons.push("FUNDING_ABOVE_CROWDING_CAP");
    if (!symbol) failedReasons.push("SYMBOL_MISSING");
    if (!String(input.episodeId || "").trim()) failedReasons.push("EPISODE_ID_MISSING");
    if (Math.abs(liveSymbolWeight) <= 1e-12) failedReasons.push("SYMBOL_NOT_ACTIVE");
    if (!input.strongBoostActive) failedReasons.push("STRONG_BOOST_INACTIVE");
    if (input.whipsawActive) failedReasons.push("WHIPSAW_ACTIVE");
    if (Math.trunc(finite(input.drawdownStage)) !== 0) failedReasons.push("DRAWDOWN_STAGE_NONZERO");
    if (finite(input.cumulativeSignedMovePct) < config.triggerCumulativeSignedMovePct) {
        failedReasons.push("CUMULATIVE_MOVE_BELOW_TRIGGER");
    }
    if (finite(input.latestSignedReturnPct) <= config.requiredLatestSignedReturnExclusiveMinimumPct) {
        failedReasons.push("LATEST_SIGNED_RETURN_NOT_POSITIVE");
    }
    if (input.episodeAlreadyAdded) failedReasons.push("EPISODE_ADD_ALREADY_USED");

    const eligible = failedReasons.length === 0;
    const unclippedCounterfactualSymbolWeight = eligible
        ? liveSymbolWeight * config.symbolWeightMultiplier
        : liveSymbolWeight;
    const rawCounterfactual = {
        ...liveWeights,
        ...(Math.abs(unclippedCounterfactualSymbolWeight) > 1e-12
            ? { [symbol]: unclippedCounterfactualSymbolWeight }
            : {}),
    };
    const counterfactualWeights = eligible ? capWeights(rawCounterfactual) : { ...liveWeights };
    const clippedCounterfactualSymbolWeight = finite(counterfactualWeights[symbol]);

    return {
        schemaVersion: 1,
        strategyId: "EXACT_BOOST_PYRAMID2P5_T6_FUND1_L1",
        configFingerprint: disDexV96FundingGuardedBoostShadowConfigFingerprint(),
        runtimeCommitSha: String(input.runtimeCommitSha || ""),
        referenceTs: finite(input.referenceTs),
        latestCompletedCandleTs: finite(input.latestCompletedCandleTs),
        symbol,
        episodeId: String(input.episodeId || ""),
        eligible,
        failedReasons,
        liveWeights,
        counterfactualWeights,
        liveGross,
        counterfactualGross: gross(counterfactualWeights),
        liveSymbolWeight,
        latestCompleted12hFundingBps: fundingBps,
        unclippedCounterfactualSymbolWeight,
        clippedCounterfactualSymbolWeight,
        counterfactualWeightDelta: clippedCounterfactualSymbolWeight - liveSymbolWeight,
        orderSubmissionAllowed: false,
    };
}

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function near(left: number, right: number, tolerance = 1e-12): boolean {
    return Math.abs(left - right) <= tolerance;
}

function validInput(
    overrides: Partial<DisDexV96FundingGuardedBoostShadowInput> = {},
): DisDexV96FundingGuardedBoostShadowInput {
    return {
        runtimeCommitSha: "0123456789abcdef0123456789abcdef01234567",
        referenceTs: 1_700_000_000_000,
        latestCompletedCandleTs: 1_700_000_000_000,
        completed12hChronologyPassed: true,
        dataCoveragePassed: true,
        fundingCoveragePassed: true,
        symbol: "ETHUSDT",
        episodeId: "ETHUSDT:LONG:1700000000000",
        liveWeights: { ETHUSDT: 0.5, BNBUSDT: 0.4 },
        strongBoostActive: true,
        whipsawActive: false,
        drawdownStage: 0,
        cumulativeSignedMovePct: 6,
        latestSignedReturnPct: 0.5,
        latestCompleted12hFundingBps: 1,
        episodeAlreadyAdded: false,
        ...overrides,
    };
}

export function selfTestDisDexV96FundingGuardedBoostShadow(): void {
    const eligible = evaluateDisDexV96FundingGuardedBoostShadow(validInput());
    assert(eligible.eligible, "funding boundary fixture should pass");
    assert(near(eligible.unclippedCounterfactualSymbolWeight, 0.5125), "2.5% multiplier mismatch");
    assert(near(eligible.counterfactualWeightDelta, 0.0125), "counterfactual delta mismatch");
    assert(eligible.orderSubmissionAllowed === false, "shadow contract must never allow orders");

    const crowded = evaluateDisDexV96FundingGuardedBoostShadow(validInput({
        latestCompleted12hFundingBps: 1.000001,
    }));
    assert(
        !crowded.eligible && crowded.failedReasons.includes("FUNDING_ABOVE_CROWDING_CAP"),
        "funding above 1 bps must fail closed",
    );

    const missingFunding = evaluateDisDexV96FundingGuardedBoostShadow(validInput({
        fundingCoveragePassed: false,
    }));
    assert(
        !missingFunding.eligible && missingFunding.failedReasons.includes("FUNDING_COVERAGE_FAILED"),
        "missing funding coverage must fail closed",
    );

    const invalidFunding = evaluateDisDexV96FundingGuardedBoostShadow(validInput({
        latestCompleted12hFundingBps: Number.NaN,
    }));
    assert(
        !invalidFunding.eligible && invalidFunding.failedReasons.includes("FUNDING_VALUE_INVALID"),
        "invalid funding value must fail closed",
    );

    const belowMove = evaluateDisDexV96FundingGuardedBoostShadow(validInput({ cumulativeSignedMovePct: 5.999 }));
    assert(!belowMove.eligible && belowMove.failedReasons.includes("CUMULATIVE_MOVE_BELOW_TRIGGER"), "move threshold should fail closed");

    const duplicate = evaluateDisDexV96FundingGuardedBoostShadow(validInput({ episodeAlreadyAdded: true }));
    assert(!duplicate.eligible && duplicate.failedReasons.includes("EPISODE_ADD_ALREADY_USED"), "duplicate add should block");

    const capped = evaluateDisDexV96FundingGuardedBoostShadow(validInput({
        liveWeights: { ETHUSDT: 1, BNBUSDT: 1 },
    }));
    assert(capped.eligible, "capped fixture should remain eligible");
    assert(near(capped.counterfactualGross, 2), "counterfactual gross cap mismatch");
    assert(capped.clippedCounterfactualSymbolWeight > 1, "selected symbol should increase after proportional cap");
    assert(finite(capped.counterfactualWeights.BNBUSDT) < 1, "other weights should scale proportionally at cap");

    const fingerprint1 = disDexV96FundingGuardedBoostShadowConfigFingerprint();
    const fingerprint2 = disDexV96FundingGuardedBoostShadowConfigFingerprint();
    assert(/^[0-9a-f]{64}$/.test(fingerprint1), "fingerprint format mismatch");
    assert(fingerprint1 === fingerprint2, "fingerprint must be deterministic");
}

if (process.argv.includes("--selftest")) {
    selfTestDisDexV96FundingGuardedBoostShadow();
    console.log(JSON.stringify({
        status: "DISDEX_V96_FUNDING_GUARDED_BOOST_SHADOW_CONTRACT_OK",
        strategyId: DISDEX_V96_FUNDING_GUARDED_BOOST_SHADOW_CONFIG.strategyId,
        configFingerprint: disDexV96FundingGuardedBoostShadowConfigFingerprint(),
        maximumCompleted12hFundingBps: DISDEX_V96_FUNDING_GUARDED_BOOST_SHADOW_CONFIG.maximumCompleted12hFundingBps,
        orderSubmissionAllowed: false,
    }));
}
