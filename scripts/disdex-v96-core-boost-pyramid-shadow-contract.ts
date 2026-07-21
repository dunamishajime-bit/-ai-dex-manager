import { createHash } from "node:crypto";

export const DISDEX_V96_BOOST_PYRAMID_SHADOW_CONFIG = Object.freeze({
    schemaVersion: 1,
    strategyId: "EXACT_BOOST_PYRAMID2P5_T6",
    completedTimeframeHours: 12,
    triggerCumulativeSignedMovePct: 6,
    requiredLatestSignedReturnExclusiveMinimumPct: 0,
    symbolWeightMultiplier: 1.025,
    maximumGross: 2,
    maximumAddsPerEpisode: 1,
    shadowOnly: true,
    orderSubmissionAllowed: false,
});

export type ShadowWeightMap = Record<string, number>;

export interface DisDexV96BoostPyramidShadowInput {
    runtimeCommitSha: string;
    referenceTs: number;
    latestCompletedCandleTs: number;
    completed12hChronologyPassed: boolean;
    dataCoveragePassed: boolean;
    symbol: string;
    episodeId: string;
    liveWeights: ShadowWeightMap;
    strongBoostActive: boolean;
    whipsawActive: boolean;
    drawdownStage: number;
    cumulativeSignedMovePct: number;
    latestSignedReturnPct: number;
    episodeAlreadyAdded: boolean;
}

export interface DisDexV96BoostPyramidShadowDecision {
    schemaVersion: 1;
    strategyId: "EXACT_BOOST_PYRAMID2P5_T6";
    configFingerprint: string;
    runtimeCommitSha: string;
    referenceTs: number;
    latestCompletedCandleTs: number;
    symbol: string;
    episodeId: string;
    eligible: boolean;
    failedReasons: string[];
    liveWeights: ShadowWeightMap;
    counterfactualWeights: ShadowWeightMap;
    liveGross: number;
    counterfactualGross: number;
    liveSymbolWeight: number;
    unclippedCounterfactualSymbolWeight: number;
    clippedCounterfactualSymbolWeight: number;
    counterfactualWeightDelta: number;
    orderSubmissionAllowed: false;
}

function finite(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function cleanWeights(weights: ShadowWeightMap): ShadowWeightMap {
    return Object.fromEntries(
        Object.entries(weights)
            .map(([symbol, weight]) => [symbol.toUpperCase(), finite(weight)] as const)
            .filter(([, weight]) => Math.abs(weight) > 1e-12),
    );
}

function gross(weights: ShadowWeightMap): number {
    return Object.values(weights).reduce((sum, weight) => sum + Math.abs(finite(weight)), 0);
}

function capWeights(weights: ShadowWeightMap): ShadowWeightMap {
    const clean = cleanWeights(weights);
    const currentGross = gross(clean);
    const scale = currentGross > 0
        ? Math.min(1, DISDEX_V96_BOOST_PYRAMID_SHADOW_CONFIG.maximumGross / currentGross)
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

export function disDexV96BoostPyramidShadowConfigFingerprint(): string {
    return createHash("sha256")
        .update(canonical(DISDEX_V96_BOOST_PYRAMID_SHADOW_CONFIG))
        .digest("hex");
}

export function evaluateDisDexV96BoostPyramidShadow(
    input: DisDexV96BoostPyramidShadowInput,
): DisDexV96BoostPyramidShadowDecision {
    const config = DISDEX_V96_BOOST_PYRAMID_SHADOW_CONFIG;
    const symbol = String(input.symbol || "").toUpperCase();
    const liveWeights = capWeights(input.liveWeights || {});
    const liveGross = gross(liveWeights);
    const liveSymbolWeight = finite(liveWeights[symbol]);
    const failedReasons: string[] = [];

    if (!/^[0-9a-f]{40}$/i.test(String(input.runtimeCommitSha || ""))) failedReasons.push("INVALID_RUNTIME_COMMIT_SHA");
    if (!(finite(input.referenceTs) > 0)) failedReasons.push("INVALID_REFERENCE_TS");
    if (!(finite(input.latestCompletedCandleTs) > 0)) failedReasons.push("INVALID_COMPLETED_CANDLE_TS");
    if (!input.completed12hChronologyPassed) failedReasons.push("COMPLETED_12H_CHRONOLOGY_FAILED");
    if (!input.dataCoveragePassed) failedReasons.push("DATA_COVERAGE_FAILED");
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
        strategyId: "EXACT_BOOST_PYRAMID2P5_T6",
        configFingerprint: disDexV96BoostPyramidShadowConfigFingerprint(),
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

function validInput(overrides: Partial<DisDexV96BoostPyramidShadowInput> = {}): DisDexV96BoostPyramidShadowInput {
    return {
        runtimeCommitSha: "0123456789abcdef0123456789abcdef01234567",
        referenceTs: 1_700_000_000_000,
        latestCompletedCandleTs: 1_700_000_000_000,
        completed12hChronologyPassed: true,
        dataCoveragePassed: true,
        symbol: "ETHUSDT",
        episodeId: "ETHUSDT:LONG:1700000000000",
        liveWeights: { ETHUSDT: 0.5, BNBUSDT: 0.4 },
        strongBoostActive: true,
        whipsawActive: false,
        drawdownStage: 0,
        cumulativeSignedMovePct: 6,
        latestSignedReturnPct: 0.5,
        episodeAlreadyAdded: false,
        ...overrides,
    };
}

export function selfTestDisDexV96BoostPyramidShadow(): void {
    const eligible = evaluateDisDexV96BoostPyramidShadow(validInput());
    assert(eligible.eligible, "eligible fixture should pass");
    assert(near(eligible.unclippedCounterfactualSymbolWeight, 0.5125), "2.5% multiplier mismatch");
    assert(near(eligible.counterfactualWeightDelta, 0.0125), "counterfactual delta mismatch");
    assert(eligible.orderSubmissionAllowed === false, "shadow contract must never allow orders");

    const below = evaluateDisDexV96BoostPyramidShadow(validInput({ cumulativeSignedMovePct: 5.999 }));
    assert(!below.eligible && below.failedReasons.includes("CUMULATIVE_MOVE_BELOW_TRIGGER"), "threshold should fail closed");

    const whipsaw = evaluateDisDexV96BoostPyramidShadow(validInput({ whipsawActive: true }));
    assert(!whipsaw.eligible && whipsaw.failedReasons.includes("WHIPSAW_ACTIVE"), "whipsaw should block");

    const duplicate = evaluateDisDexV96BoostPyramidShadow(validInput({ episodeAlreadyAdded: true }));
    assert(!duplicate.eligible && duplicate.failedReasons.includes("EPISODE_ADD_ALREADY_USED"), "duplicate add should block");

    const capped = evaluateDisDexV96BoostPyramidShadow(validInput({
        liveWeights: { ETHUSDT: 1, BNBUSDT: 1 },
    }));
    assert(capped.eligible, "capped fixture should remain eligible");
    assert(near(capped.counterfactualGross, 2), "counterfactual gross cap mismatch");
    assert(capped.clippedCounterfactualSymbolWeight > 1, "selected symbol should increase after proportional cap");
    assert(finite(capped.counterfactualWeights.BNBUSDT) < 1, "other weights should scale proportionally at cap");

    const fingerprint1 = disDexV96BoostPyramidShadowConfigFingerprint();
    const fingerprint2 = disDexV96BoostPyramidShadowConfigFingerprint();
    assert(/^[0-9a-f]{64}$/.test(fingerprint1), "fingerprint format mismatch");
    assert(fingerprint1 === fingerprint2, "fingerprint must be deterministic");
}

if (process.argv.includes("--selftest")) {
    selfTestDisDexV96BoostPyramidShadow();
    console.log(JSON.stringify({
        status: "DISDEX_V96_BOOST_PYRAMID_SHADOW_CONTRACT_OK",
        strategyId: DISDEX_V96_BOOST_PYRAMID_SHADOW_CONFIG.strategyId,
        configFingerprint: disDexV96BoostPyramidShadowConfigFingerprint(),
        orderSubmissionAllowed: false,
    }));
}
