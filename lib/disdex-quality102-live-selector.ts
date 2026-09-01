import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";

export interface Quality102LiveSelectorManifest {
    sourceKind: "dynamic-selector" | "frozen-historical-csv" | string;
    sourceRun: string;
    sourceSha: string;
    noLookahead: boolean;
    fixedHistoricalTimestamps: boolean;
    selectorParity: boolean;
    availableAtTs: number;
}

export interface Quality102LiveSelectorInput {
    decisionTs: number;
    manifest?: Quality102LiveSelectorManifest;
}

export interface Quality102LiveSelectorResult {
    status: "LIVE_SELECTOR_READY" | "LIVE_BLOCKED_FAIL_CLOSED";
    reason: string;
    sourceRun: string;
    sourceSha: string;
    quality102LiveSelectorParity: boolean;
    quality102LiveBlockedFailClosed: boolean;
}

/**
 * A frozen research event list is evidence for a backtest, never a live
 * selector. A future dynamic selector may pass only with an explicit,
 * source-identified, no-lookahead manifest whose data was available at the
 * decision timestamp.
 */
export function evaluateQuality102LiveSelector(input: Quality102LiveSelectorInput): Quality102LiveSelectorResult {
    const blocked = (reason: string): Quality102LiveSelectorResult => ({
        status: "LIVE_BLOCKED_FAIL_CLOSED",
        reason,
        sourceRun: STRICT_BT33404708902.sourceRun,
        sourceSha: STRICT_BT33404708902.sourceSha,
        quality102LiveSelectorParity: false,
        quality102LiveBlockedFailClosed: true,
    });
    if (!Number.isFinite(input.decisionTs) || input.decisionTs <= 0) return blocked("DECISION_TIMESTAMP_INVALID");
    const manifest = input.manifest;
    if (!manifest) return blocked("SELECTOR_MANIFEST_MISSING");
    if (manifest.sourceKind === "frozen-historical-csv") return blocked("FIXED_HISTORICAL_SIGNAL_FORBIDDEN");
    if (manifest.sourceKind !== "dynamic-selector") return blocked("SELECTOR_SOURCE_KIND_UNAPPROVED");
    if (manifest.fixedHistoricalTimestamps) return blocked("FIXED_HISTORICAL_TIMESTAMP_FORBIDDEN");
    if (!manifest.noLookahead) return blocked("LOOKAHEAD_PROOF_MISSING");
    if (!manifest.selectorParity) return blocked("SELECTOR_PARITY_PROOF_MISSING");
    if (manifest.sourceRun !== STRICT_BT33404708902.sourceRun || manifest.sourceSha !== STRICT_BT33404708902.sourceSha) {
        return blocked("SELECTOR_SOURCE_IDENTITY_MISMATCH");
    }
    if (!Number.isFinite(manifest.availableAtTs) || manifest.availableAtTs > input.decisionTs) {
        return blocked("SELECTOR_DATA_NOT_AVAILABLE_AT_DECISION");
    }
    return {
        status: "LIVE_SELECTOR_READY",
        reason: "DYNAMIC_SELECTOR_MANIFEST_VERIFIED",
        sourceRun: STRICT_BT33404708902.sourceRun,
        sourceSha: STRICT_BT33404708902.sourceSha,
        quality102LiveSelectorParity: true,
        quality102LiveBlockedFailClosed: false,
    };
}
