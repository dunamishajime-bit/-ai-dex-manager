import { createHash } from "node:crypto";
import { IDLE_PRIORITY_SHORT_POLICY, type IdlePrioritySymbol } from "../config/idlePriorityShortPolicy";

export type IdleLiveAdmissionInput = {
    runtimeMode: "SHADOW" | "LIVE";
    operatorArmed: boolean;
    candidateAccepted: boolean;
    candidateSide: "SHORT" | "LONG" | "FLAT";
    decisionTs: number;
    baselineDecisionTs: number;
    baselineFresh: boolean;
    baselineSourceComplete: boolean;
    baselineOpenPositions: number;
    baselinePendingExposure: number;
    baselineAcceptedThisTimestamp: number;
    nonBaselineCryptoExposure: number;
    nonBaselinePendingExposure: number;
    sharedRiskHealthy: boolean;
    marginGuardHealthy: boolean;
    killSwitchActive: boolean;
    venueFiveXCrossConfirmed: boolean;
    fullCryptoGrossAvailable: number;
    fullTotalGrossAvailable: number;
    sameSymbolIdleActive: boolean;
};

export const IDLE_BASELINE_ADMISSION_SCHEMA = "disdex-idle-baseline-admission/v1" as const;
// Canonical audit label for the LIVE operator-activation boundary.  The
// concrete operator gate remains OPERATOR_LIVE_ACTIVATION_REQUIRED:*.
export const IDLE_LIVE_ACTIVATION_REQUIRED = "IDLE_LIVE_ACTIVATION_REQUIRED" as const;
export type IdleBaselineAdmission = {
    schema: typeof IDLE_BASELINE_ADMISSION_SCHEMA;
    runtimeSha: string;
    decisionTs: number;
    updatedAt: number;
    sourceComplete: true;
    baselineOpenPositions: number;
    baselinePendingExposure: number;
    baselineAcceptedThisTimestamp: number;
};

export function normalizeIdleBaselineAdmission(raw: unknown, expectedRuntimeSha: string, decisionTs: number, now = Date.now(), maxAgeMs = 90_000): IdleBaselineAdmission {
    if (!raw || typeof raw !== "object") throw new Error("BASELINE_ADMISSION_MALFORMED");
    const value = raw as Partial<IdleBaselineAdmission>;
    if (value.schema !== IDLE_BASELINE_ADMISSION_SCHEMA) throw new Error("BASELINE_ADMISSION_SCHEMA_MISMATCH");
    if (String(value.runtimeSha || "").toLowerCase() !== expectedRuntimeSha.toLowerCase()) throw new Error("BASELINE_ADMISSION_RUNTIME_SHA_MISMATCH");
    if (Number(value.decisionTs) !== decisionTs || !Number.isFinite(Number(value.updatedAt)) || Number(value.updatedAt) > now || now - Number(value.updatedAt) > maxAgeMs) {
        throw new Error("BASELINE_ADMISSION_STALE_OR_TS_MISMATCH");
    }
    if (value.sourceComplete !== true) throw new Error("BASELINE_ADMISSION_INCOMPLETE");
    const numeric = [value.baselineOpenPositions, value.baselinePendingExposure, value.baselineAcceptedThisTimestamp];
    if (numeric.some((item) => !Number.isFinite(Number(item)) || Number(item) < 0)) throw new Error("BASELINE_ADMISSION_NUMERIC_INVALID");
    return {
        schema: IDLE_BASELINE_ADMISSION_SCHEMA,
        runtimeSha: expectedRuntimeSha.toLowerCase(),
        decisionTs,
        updatedAt: Number(value.updatedAt),
        sourceComplete: true,
        baselineOpenPositions: Number(value.baselineOpenPositions),
        baselinePendingExposure: Number(value.baselinePendingExposure),
        baselineAcceptedThisTimestamp: Number(value.baselineAcceptedThisTimestamp),
    };
}

export type IdleLiveAdmissionResult = {
    accepted: boolean;
    reason: string;
    gross: 0 | 1;
};

const EPSILON = 1e-9;

export function evaluateIdleLiveAdmission(input: IdleLiveAdmissionInput): IdleLiveAdmissionResult {
    if (input.runtimeMode !== "LIVE" || !input.operatorArmed) return { accepted: false, reason: "OPERATOR_LIVE_ACTIVATION_REQUIRED", gross: 0 };
    if (!input.baselineFresh || !input.baselineSourceComplete || input.baselineDecisionTs !== input.decisionTs) {
        return { accepted: false, reason: "BASELINE_ADMISSION_UNAVAILABLE", gross: 0 };
    }
    if (input.baselineAcceptedThisTimestamp > 0) return { accepted: false, reason: "BASELINE_ACCEPTED_SAME_TIMESTAMP", gross: 0 };
    if (input.baselineOpenPositions > EPSILON || input.baselinePendingExposure > EPSILON) {
        return { accepted: false, reason: "BASELINE_OPEN_OR_PENDING", gross: 0 };
    }
    if (input.sameSymbolIdleActive) return { accepted: false, reason: "IDLE_SAME_SYMBOL_ACTIVE", gross: 0 };
    if (input.nonBaselineCryptoExposure > EPSILON || input.nonBaselinePendingExposure > EPSILON) {
        return { accepted: false, reason: "NON_BASELINE_SIDECAR_EXPOSURE", gross: 0 };
    }
    if (!input.sharedRiskHealthy) return { accepted: false, reason: "SHARED_RISK_NOT_HEALTHY", gross: 0 };
    if (!input.marginGuardHealthy) return { accepted: false, reason: "MARGIN_GUARD_NOT_HEALTHY", gross: 0 };
    if (input.killSwitchActive) return { accepted: false, reason: "SHARED_KILL_SWITCH_ACTIVE", gross: 0 };
    if (!input.venueFiveXCrossConfirmed) return { accepted: false, reason: "VENUE_5X_CROSS_UNCONFIRMED", gross: 0 };
    if (!input.candidateAccepted || input.candidateSide !== "SHORT") return { accepted: false, reason: "SHORT_SIGNAL_NOT_ACCEPTED", gross: 0 };
    if (input.fullCryptoGrossAvailable < 1 - EPSILON || input.fullTotalGrossAvailable < 1 - EPSILON) {
        return { accepted: false, reason: "FULL_1X_CAPACITY_UNAVAILABLE", gross: 0 };
    }
    return { accepted: true, reason: "IDLE_LIVE_ADMISSION_ACCEPTED", gross: 1 };
}

export function deterministicIdleClientOrderId(input: { action: "ENTRY" | "EXIT" | "STOP" | "TP"; symbol: string; signalTs: number }) {
    const digest = createHash("sha256")
        .update(["IDLE_PRIORITY_SHORT", input.action, input.symbol.toUpperCase(), input.signalTs].join("|"))
        .digest("hex")
        .slice(0, 22);
    return `idle-${input.action.toLowerCase()}-${digest}`.slice(0, 36);
}

export type IdleProtectionPlan = {
    symbol: IdlePrioritySymbol;
    side: "SHORT";
    quantity: number;
    stopPrice: number;
    takeProfitPrice: number;
    stopClientOrderId: string;
    takeProfitClientOrderId: string;
};

export function buildIdleProtectionPlan(input: { symbol: IdlePrioritySymbol; signalTs: number; entryPrice: number; quantity: number }): IdleProtectionPlan {
    if (!(input.entryPrice > 0) || !(input.quantity > 0)) throw new Error("IDLE_PROTECTION_INPUT_INVALID");
    const stopPrice = Number((input.entryPrice * (1 + IDLE_PRIORITY_SHORT_POLICY.emergencyStopPct / 100)).toFixed(12));
    const takeProfitPrice = Number((input.entryPrice * (1 - IDLE_PRIORITY_SHORT_POLICY.emergencyTakeProfitPct / 100)).toFixed(12));
    if (!(stopPrice > input.entryPrice) || !(takeProfitPrice > 0 && takeProfitPrice < input.entryPrice)) throw new Error("IDLE_PROTECTION_PRICE_INVALID");
    return {
        symbol: input.symbol,
        side: "SHORT",
        quantity: input.quantity,
        stopPrice,
        takeProfitPrice,
        stopClientOrderId: deterministicIdleClientOrderId({ action: "STOP", symbol: input.symbol, signalTs: input.signalTs }),
        takeProfitClientOrderId: deterministicIdleClientOrderId({ action: "TP", symbol: input.symbol, signalTs: input.signalTs }),
    };
}

export function normalizeIdleProtectionPrice(value: number, tickSize: number) {
    if (!(value > 0) || !(tickSize > 0)) throw new Error("IDLE_PROTECTION_TICK_INVALID");
    const decimals = Math.min(12, Math.max(0, String(tickSize).split(".")[1]?.replace(/0+$/, "").length || 0));
    const rounded = Math.round(value / tickSize) * tickSize;
    return { value: rounded, text: rounded.toFixed(decimals) };
}
