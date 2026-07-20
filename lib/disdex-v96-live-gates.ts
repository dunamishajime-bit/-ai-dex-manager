import { createHash } from "node:crypto";
import {
    DISDEX_V96_ALLOCATION,
    DISDEX_V96_FORWARD_REQUIREMENTS,
    DISDEX_V96_RUNTIME,
    DISDEX_V96_STRATEGY_ID,
} from "@/config/disdexV96Runtime";

export interface DisDexV96ForwardEvidenceApproval {
    status: "APPROVED" | "NOT_APPROVED";
    strategyId: string;
    configFingerprint: string;
    completedCalendarDays: number;
    completedDecisionBars: number;
    closedLongTrades: number;
    closedShortTrades: number;
    grossCapBreaches: number;
    unknownOrderEvents: number;
    stateRecoveryFailures: number;
    minimumObservedPenguClip: number;
    artifactSha256: string;
    approvedCommitSha: string;
    approvedAt: string;
}

export interface DisDexV96ExecutionParityApproval {
    status: "APPROVED" | "NOT_REVIEWED" | "REJECTED";
    strategyId: string;
    configFingerprint: string;
    researchCommitSha: string;
    productionCommitSha: string;
    goldenVectorArtifactSha256: string;
    allocationParityPassed: boolean;
    signalChronologyParityPassed: boolean;
    orderQuantityParityPassed: boolean;
    restartRecoveryPassed: boolean;
    reviewer: string;
    reviewedAt: string;
}

export interface DisDexV96LiveGateResult {
    allowed: boolean;
    reasons: string[];
    configFingerprint: string;
}

export function disDexV96ConfigFingerprint() {
    return createHash("sha256")
        .update(JSON.stringify({ allocation: DISDEX_V96_ALLOCATION, forward: DISDEX_V96_FORWARD_REQUIREMENTS }))
        .digest("hex");
}

function nonEmpty(value: unknown) {
    return typeof value === "string" && value.trim().length > 0;
}

export function evaluateDisDexV96LiveGates(input: {
    runnerMode: "paper" | "live";
    environmentLiveExecutionEnabled: boolean;
    activationAcknowledgement?: string;
    forwardEvidence?: DisDexV96ForwardEvidenceApproval;
    executionParity?: DisDexV96ExecutionParityApproval;
}): DisDexV96LiveGateResult {
    const reasons: string[] = [];
    const configFingerprint = disDexV96ConfigFingerprint();
    if (input.runnerMode !== "live") reasons.push("Runner mode is not live.");
    if (!input.environmentLiveExecutionEnabled) reasons.push("DISDEX_V96_LIVE_EXECUTION_ENABLED is not true.");
    if (DISDEX_V96_RUNTIME.liveTradingEnabled !== true) reasons.push("Production runtime liveTradingEnabled is false.");
    if (input.activationAcknowledgement !== "I_ACKNOWLEDGE_DISDEX_V96_LIVE_RISK") {
        reasons.push("Explicit V96 LIVE activation acknowledgement is missing.");
    }

    const forward = input.forwardEvidence;
    if (!forward || forward.status !== "APPROVED") {
        reasons.push("Forward Evidence approval is missing.");
    } else {
        if (forward.strategyId !== DISDEX_V96_STRATEGY_ID) reasons.push("Forward Evidence strategyId mismatch.");
        if (forward.configFingerprint !== configFingerprint) reasons.push("Forward Evidence config fingerprint mismatch.");
        if (forward.completedCalendarDays < DISDEX_V96_FORWARD_REQUIREMENTS.minimumCalendarDays) reasons.push("Forward Evidence calendar-day requirement is not met.");
        if (forward.completedDecisionBars < DISDEX_V96_FORWARD_REQUIREMENTS.minimumCompletedDecisionBars) reasons.push("Forward Evidence decision-bar requirement is not met.");
        if (forward.closedLongTrades < DISDEX_V96_FORWARD_REQUIREMENTS.minimumClosedLongTrades) reasons.push("Forward Evidence Long-trade requirement is not met.");
        if (forward.closedShortTrades < DISDEX_V96_FORWARD_REQUIREMENTS.minimumClosedShortTrades) reasons.push("Forward Evidence Short-trade requirement is not met.");
        if (forward.grossCapBreaches > DISDEX_V96_FORWARD_REQUIREMENTS.maximumGrossCapBreaches) reasons.push("Forward Evidence contains a Gross-cap breach.");
        if (forward.unknownOrderEvents > DISDEX_V96_FORWARD_REQUIREMENTS.maximumUnknownOrderEvents) reasons.push("Forward Evidence contains UNKNOWN order events.");
        if (forward.stateRecoveryFailures > DISDEX_V96_FORWARD_REQUIREMENTS.maximumStateRecoveryFailures) reasons.push("Forward Evidence contains state-recovery failures.");
        if (forward.minimumObservedPenguClip + 1e-12 < DISDEX_V96_FORWARD_REQUIREMENTS.requiredMinimumObservedPenguClip) reasons.push("Observed PENGU clip is below 50%.");
        if (!/^[a-f0-9]{64}$/i.test(forward.artifactSha256)) reasons.push("Forward Evidence artifact SHA-256 is invalid.");
        if (!nonEmpty(forward.approvedCommitSha) || !nonEmpty(forward.approvedAt)) reasons.push("Forward Evidence approval metadata is incomplete.");
    }

    const parity = input.executionParity;
    if (!parity || parity.status !== "APPROVED") {
        reasons.push("Execution-parity review is not approved.");
    } else {
        if (parity.strategyId !== DISDEX_V96_STRATEGY_ID) reasons.push("Execution-parity strategyId mismatch.");
        if (parity.configFingerprint !== configFingerprint) reasons.push("Execution-parity config fingerprint mismatch.");
        if (!parity.allocationParityPassed) reasons.push("V96 allocation parity did not pass.");
        if (!parity.signalChronologyParityPassed) reasons.push("Signal chronology parity did not pass.");
        if (!parity.orderQuantityParityPassed) reasons.push("Order-quantity parity did not pass.");
        if (!parity.restartRecoveryPassed) reasons.push("Restart/recovery parity did not pass.");
        if (!/^[a-f0-9]{64}$/i.test(parity.goldenVectorArtifactSha256)) reasons.push("Parity artifact SHA-256 is invalid.");
        if (!nonEmpty(parity.researchCommitSha) || !nonEmpty(parity.productionCommitSha) || !nonEmpty(parity.reviewer) || !nonEmpty(parity.reviewedAt)) {
            reasons.push("Execution-parity approval metadata is incomplete.");
        }
    }

    return { allowed: reasons.length === 0, reasons, configFingerprint };
}

export function assertDisDexV96LiveGates(input: Parameters<typeof evaluateDisDexV96LiveGates>[0]) {
    const result = evaluateDisDexV96LiveGates(input);
    if (!result.allowed) throw new Error(`V96 LIVE gate blocked: ${result.reasons.join(" ")}`);
    return result;
}
