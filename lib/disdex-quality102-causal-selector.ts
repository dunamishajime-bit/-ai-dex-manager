import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";

export type Quality102SourceKind = "dynamic-selector" | "frozen-historical-csv" | string;
export type Quality102Layer = "S1" | "S2" | "S3" | "S4";
export type Quality102S34Family = "PB" | "MR" | "BRK" | "REV" | string;

/**
 * Compile-time capabilities are intentionally not caller-attested. A manifest
 * can prove where decision data came from, but it cannot make missing source
 * code exist. These legacy aggregate flags remain conservative until the full
 * end-to-end selector is provenance-backed in this repository.
 */
export const QUALITY102_CAUSAL_CAPABILITIES = Object.freeze({
    s1s2RawGeneratorProven: false,
    s34RawGeneratorProven: false,
    selectorImplemented: false,
});

/**
 * Granular recovery ledger. This separates code/evidence that has actually
 * been recovered from the two still-unproven causal links. None of these
 * fields is caller-attested and none can arm LIVE by itself.
 *
 * Historical HIGH_VOL parity counts are recovered evidence from the completed
 * reconstruction work (137 old-universe + 388 expanded-universe = 525 raw
 * candidates). They do NOT prove the missing 525 -> 30 selector.
 */
export const QUALITY102_RECOVERY_CAPABILITIES = Object.freeze({
    highVolRawGeneratorImplemented: true,
    highVolHistoricalParity: Object.freeze({
        oldUniverseExact: Object.freeze({ expected: 137, matched: 137 }),
        expandedUniverseExact: Object.freeze({ expected: 388, matched: 388 }),
        combinedRawExpected: 525,
    }),
    highVol525To30SelectorProven: false,
    recoveredHighVolSelectedShape: Object.freeze({ stage1: 8, stage2: 22, total: 30 }),
    pbMrRevPostGenerationRecovered: true,
    brkStrengthFormulaProven: false,
    quality124TransformRecovered: true,
    oneSlotRouterRecovered: true,
    selectorImplemented: false,
});

export function getQuality102RecoveryCapabilities(): typeof QUALITY102_RECOVERY_CAPABILITIES {
    return QUALITY102_RECOVERY_CAPABILITIES;
}

export const QUALITY102_RECOVERED_POST_GENERATION_SOURCE = Object.freeze({
    commit: "450f8fae800d3f509ef868ab035f0cd731216279",
    script: "scripts/research_quality102_selector_recovered.py",
    scope: "POST_GENERATION_TRANSFORMS_QUALITY_GATE_AND_ONE_SLOT_ONLY" as const,
});

export const QUALITY102_DEFAULT_MAX_DATA_AGE_MS = 65 * 60_000;

export interface Quality102CausalManifest {
    sourceKind: Quality102SourceKind;
    sourceRun: string;
    sourceSha: string;
    noLookahead: boolean;
    fixedHistoricalTimestamps: boolean;
    selectorParity: boolean;
    /** Timestamp at which every datum used by the decision was available. */
    availableAtTs: number;
}

export interface Quality102CausalReadinessInput {
    decisionTs: number;
    manifest?: Quality102CausalManifest;
    maxDataAgeMs?: number;
    /** Independent operator/runtime arm. It cannot bypass missing code. */
    liveArmed?: boolean;
}

export interface Quality102CausalReadinessResult {
    status: "CAUSAL_SELECTOR_READY" | "LIVE_BLOCKED_FAIL_CLOSED";
    reason: string;
    sourceRun: string;
    sourceSha: string;
    s1s2RawGeneratorProven: boolean;
    s34RawGeneratorProven: boolean;
    selectorImplemented: boolean;
    liveArmed: boolean;
}

/**
 * Legacy aggregate status. It deliberately stays false until the recovered
 * HIGH_VOL raw generator is connected to the still-missing 525 -> 30 selector
 * and proven as one complete S1/S2 producer.
 */
export function getS1S2RawGeneratorStatus(): {
    status: "UNAVAILABLE_FAIL_CLOSED";
    reason: "QUALITY102_S1S2_RAW_GENERATOR_NOT_AVAILABLE";
    proven: false;
} {
    return {
        status: "UNAVAILABLE_FAIL_CLOSED",
        reason: "QUALITY102_S1S2_RAW_GENERATOR_NOT_AVAILABLE",
        proven: false,
    };
}

/**
 * Legacy aggregate S34 status. PB/MR/REV post-generation behavior is recovered,
 * but the BRK strength feature is still upstream/unproven, so the complete S34
 * causal producer remains unavailable.
 */
export function getS34RawGeneratorStatus(): {
    status: "UNAVAILABLE_FAIL_CLOSED";
    reason: "QUALITY102_S34_RAW_GENERATOR_NOT_AVAILABLE";
    proven: false;
} {
    return {
        status: "UNAVAILABLE_FAIL_CLOSED",
        reason: "QUALITY102_S34_RAW_GENERATOR_NOT_AVAILABLE",
        proven: false,
    };
}

function readinessResult(
    status: Quality102CausalReadinessResult["status"],
    reason: string,
    liveArmed: boolean,
): Quality102CausalReadinessResult {
    return {
        status,
        reason,
        sourceRun: STRICT_BT33404708902.sourceRun,
        sourceSha: STRICT_BT33404708902.sourceSha,
        s1s2RawGeneratorProven: QUALITY102_CAUSAL_CAPABILITIES.s1s2RawGeneratorProven,
        s34RawGeneratorProven: QUALITY102_CAUSAL_CAPABILITIES.s34RawGeneratorProven,
        selectorImplemented: QUALITY102_CAUSAL_CAPABILITIES.selectorImplemented,
        liveArmed,
    };
}

/**
 * Evaluate whether a causal Quality102 selector is safe to expose to LIVE.
 *
 * Recovery evidence is checked at the narrowest unresolved boundary first.
 * The current repository deliberately cannot return READY because the exact
 * HIGH_VOL 525 -> 30 selector and upstream BRK strength formula remain
 * unproven. `liveArmed` is checked only after executable capability checks so
 * a caller cannot self-attest missing code/provenance.
 */
export function evaluateQuality102CausalReadiness(
    input: Quality102CausalReadinessInput,
): Quality102CausalReadinessResult {
    const liveArmed = input.liveArmed === true;
    const blocked = (reason: string) => readinessResult("LIVE_BLOCKED_FAIL_CLOSED", reason, liveArmed);

    if (!Number.isFinite(input.decisionTs) || input.decisionTs <= 0) return blocked("DECISION_TIMESTAMP_INVALID");
    const manifest = input.manifest;
    if (!manifest) return blocked("CAUSAL_MANIFEST_MISSING");
    if (manifest.sourceKind === "frozen-historical-csv") return blocked("FIXED_HISTORICAL_SIGNAL_FORBIDDEN");
    if (manifest.sourceKind !== "dynamic-selector") return blocked("SELECTOR_SOURCE_KIND_UNAPPROVED");
    if (manifest.fixedHistoricalTimestamps) return blocked("FIXED_HISTORICAL_TIMESTAMP_FORBIDDEN");
    if (!manifest.noLookahead) return blocked("LOOKAHEAD_PROOF_MISSING");
    if (!manifest.selectorParity) return blocked("SELECTOR_PARITY_PROOF_MISSING");
    if (manifest.sourceRun !== STRICT_BT33404708902.sourceRun || manifest.sourceSha !== STRICT_BT33404708902.sourceSha) {
        return blocked("SELECTOR_SOURCE_IDENTITY_MISMATCH");
    }
    if (!Number.isFinite(manifest.availableAtTs) || manifest.availableAtTs <= 0 || manifest.availableAtTs > input.decisionTs) {
        return blocked("SELECTOR_DATA_NOT_AVAILABLE_AT_DECISION");
    }

    const maxDataAgeMs = input.maxDataAgeMs ?? QUALITY102_DEFAULT_MAX_DATA_AGE_MS;
    if (!Number.isFinite(maxDataAgeMs) || maxDataAgeMs < 0) return blocked("MAX_DATA_AGE_INVALID");
    if (input.decisionTs - manifest.availableAtTs > maxDataAgeMs) return blocked("SELECTOR_DATA_STALE");

    const recovery = getQuality102RecoveryCapabilities();
    if (!recovery.highVol525To30SelectorProven) return blocked("HIGH_VOL_525_TO_30_SELECTOR_PROOF_MISSING");
    if (!recovery.brkStrengthFormulaProven) return blocked("BRK_STRENGTH_FORMULA_PROOF_MISSING");
    if (!QUALITY102_CAUSAL_CAPABILITIES.s1s2RawGeneratorProven) return blocked("S1S2_RAW_GENERATOR_PROOF_MISSING");
    if (!QUALITY102_CAUSAL_CAPABILITIES.s34RawGeneratorProven) return blocked("S34_RAW_GENERATOR_PROOF_MISSING");
    if (!QUALITY102_CAUSAL_CAPABILITIES.selectorImplemented) return blocked("QUALITY102_SELECTOR_IMPLEMENTATION_INCOMPLETE");
    if (!liveArmed) return blocked("QUALITY102_LIVE_NOT_ARMED");

    return readinessResult("CAUSAL_SELECTOR_READY", "READY", true);
}

export interface Quality102S34QualityGateInput {
    family: Quality102S34Family;
    variant: string;
    side: number;
    strength: number;
    ret14: number;
}

export interface Quality102S34QualityGateResult {
    accepted: boolean;
    reason:
        | "PB_WEAK_VARIANT_REMOVED"
        | "MR_REGIME_GATE"
        | "BRK_QUALITY_GATE"
        | "UNCHANGED"
        | "UNKNOWN_S34_FAMILY"
        | "INVALID_S34_SIDE"
        | "INVALID_S34_NUMERIC_INPUT"
        | "INVALID_S34_VARIANT";
}

/** Exact post-generation S34 quality rules recovered in commit 450f8fa... . */
export function evaluateS34QualityGate(input: Quality102S34QualityGateInput): Quality102S34QualityGateResult {
    if (input.side !== -1 && input.side !== 1) return { accepted: false, reason: "INVALID_S34_SIDE" };
    if (!Number.isFinite(input.strength) || !Number.isFinite(input.ret14)) {
        return { accepted: false, reason: "INVALID_S34_NUMERIC_INPUT" };
    }
    if (typeof input.variant !== "string" || input.variant.trim().length === 0) {
        return { accepted: false, reason: "INVALID_S34_VARIANT" };
    }

    switch (input.family) {
        case "PB":
            return {
                accepted: input.variant !== "PB168_0.1_P24_0.04_H12",
                reason: "PB_WEAK_VARIANT_REMOVED",
            };
        case "MR":
            return {
                accepted: input.side === -1 || input.ret14 >= -0.025,
                reason: "MR_REGIME_GATE",
            };
        case "BRK":
            return {
                accepted: input.strength >= 0.03 && input.side * input.ret14 >= -0.05,
                reason: "BRK_QUALITY_GATE",
            };
        case "REV":
            return { accepted: true, reason: "UNCHANGED" };
        default:
            return { accepted: false, reason: "UNKNOWN_S34_FAMILY" };
    }
}

export interface Quality102OneSlotCandidate {
    id: string;
    entryTs: number;
    exitTs: number;
    layer: Quality102Layer;
}

export interface Quality102OneSlotBlockedCandidate extends Quality102OneSlotCandidate {
    blockedReason: "ONE_SLOT_OCCUPIED" | "INVALID_CANDIDATE";
}

export interface Quality102OneSlotRouteResult {
    accepted: Quality102OneSlotCandidate[];
    blocked: Quality102OneSlotBlockedCandidate[];
}

const LAYER_PRIORITY: Readonly<Record<Quality102Layer, number>> = Object.freeze({
    S1: 0,
    S2: 1,
    S3: 2,
    S4: 3,
});

function validLayer(value: string): value is Quality102Layer {
    return value === "S1" || value === "S2" || value === "S3" || value === "S4";
}

function validCandidate(candidate: Quality102OneSlotCandidate): boolean {
    return typeof candidate.id === "string"
        && candidate.id.length > 0
        && Number.isFinite(candidate.entryTs)
        && Number.isFinite(candidate.exitTs)
        && candidate.entryTs > 0
        && candidate.exitTs >= candidate.entryTs
        && validLayer(candidate.layer);
}

/**
 * Exact recovered one-slot semantics: chronological order, then S1>S2>S3>S4;
 * a new candidate is blocked while entryTs < activeExitTs. Entry exactly at
 * the prior exit timestamp is eligible.
 */
export function routeQuality102OneSlot(candidates: Quality102OneSlotCandidate[]): Quality102OneSlotRouteResult {
    const accepted: Quality102OneSlotCandidate[] = [];
    const blocked: Quality102OneSlotBlockedCandidate[] = [];

    const ordered = candidates
        .map((candidate, index) => ({ candidate, index }))
        .sort((a, b) => {
            const entryDiff = a.candidate.entryTs - b.candidate.entryTs;
            if (entryDiff !== 0) return entryDiff;
            const aPriority = validLayer(a.candidate.layer) ? LAYER_PRIORITY[a.candidate.layer] : Number.MAX_SAFE_INTEGER;
            const bPriority = validLayer(b.candidate.layer) ? LAYER_PRIORITY[b.candidate.layer] : Number.MAX_SAFE_INTEGER;
            return aPriority - bPriority || a.index - b.index;
        });

    let activeExitTs: number | undefined;
    for (const { candidate } of ordered) {
        if (!validCandidate(candidate)) {
            blocked.push({ ...candidate, blockedReason: "INVALID_CANDIDATE" });
            continue;
        }
        if (activeExitTs !== undefined && candidate.entryTs < activeExitTs) {
            blocked.push({ ...candidate, blockedReason: "ONE_SLOT_OCCUPIED" });
            continue;
        }
        accepted.push(candidate);
        activeExitTs = candidate.exitTs;
    }

    return { accepted, blocked };
}
