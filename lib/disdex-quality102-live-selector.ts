import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";
import {
    evaluateQuality102CausalReadiness,
    type Quality102CausalManifest,
} from "./disdex-quality102-causal-selector";

export interface Quality102LiveSelectorManifest extends Quality102CausalManifest {}

export interface Quality102LiveSelectorInput {
    decisionTs: number;
    manifest?: Quality102LiveSelectorManifest;
    maxDataAgeMs?: number;
    /** Independent runtime/operator arm. It cannot bypass causal capability gates. */
    liveArmed?: boolean;
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
 * selector. LIVE readiness is delegated to the causal selector boundary,
 * which derives executable capability from repository code rather than
 * caller-supplied manifest booleans.
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

    const causal = evaluateQuality102CausalReadiness({
        decisionTs: input.decisionTs,
        manifest: input.manifest,
        maxDataAgeMs: input.maxDataAgeMs,
        liveArmed: input.liveArmed,
    });

    if (causal.status !== "CAUSAL_SELECTOR_READY") {
        if (causal.reason === "CAUSAL_MANIFEST_MISSING") return blocked("SELECTOR_MANIFEST_MISSING");
        if (causal.reason === "S34_RAW_GENERATOR_PROOF_MISSING") {
            return blocked("QUALITY102_LIVE_SELECTOR_IMPLEMENTATION_NOT_PRESENT:S34_RAW_GENERATOR_PROOF_MISSING");
        }
        if (causal.reason === "QUALITY102_SELECTOR_IMPLEMENTATION_INCOMPLETE") {
            return blocked("QUALITY102_LIVE_SELECTOR_IMPLEMENTATION_NOT_PRESENT");
        }
        return blocked(causal.reason);
    }

    // Even after causal code exists and an operator arm is present, the strict
    // runtime contract must be explicitly migrated away from research-only.
    if (!STRICT_BT33404708902.quality102LiveSelectorParity || STRICT_BT33404708902.quality102LiveBlockedFailClosed) {
        return blocked("STRICT_RUNTIME_QUALITY102_LIVE_DISABLED");
    }

    return {
        status: "LIVE_SELECTOR_READY",
        reason: "READY",
        sourceRun: STRICT_BT33404708902.sourceRun,
        sourceSha: STRICT_BT33404708902.sourceSha,
        quality102LiveSelectorParity: true,
        quality102LiveBlockedFailClosed: false,
    };
}
