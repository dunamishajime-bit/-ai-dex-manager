import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_STRATEGY_ID } from "@/config/disdexV96Runtime";

export interface DisDexV96OperatorOverrideApproval {
    status: "APPROVED" | "REJECTED";
    strategyId: string;
    configFingerprint: string;
    approvedCommitSha: string;
    operator: string;
    reason: string;
    approvedAt: string;
    expiresAt: string;
    forwardEvidenceBypassAccepted: true;
    initialPenguGrossCap: number;
    maximumPortfolioGross: number;
    maximumDailyLossPct: number;
    maximumDailyLossUsd?: number;
    acknowledgement: "I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE";
    artifactSha256: string;
}

export interface DisDexV96KillSwitchCommand {
    active: boolean;
    strategyId: string;
    action: "FLATTEN_MANAGED";
    reason: string;
    operator: string;
    activatedAt: string;
}

export interface DisDexV96DailyRiskState {
    utcDay: string;
    dayStartEquity: number;
    lastEquity: number;
    lossUsd: number;
    lossPct: number;
    lossLimitUsd: number;
    tripped: boolean;
    trippedAt?: number;
    tripReason?: string;
    lastCheckedAt: number;
}

export interface DisDexV96OperatorOverrideResult {
    allowed: boolean;
    reasons: string[];
    approval?: DisDexV96OperatorOverrideApproval;
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function nonEmpty(value: unknown) {
    return typeof value === "string" && value.trim().length > 0;
}

function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object") {
        const object = value as Record<string, unknown>;
        return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

export function disDexV96OperatorOverrideArtifactSha256(
    approval: Omit<DisDexV96OperatorOverrideApproval, "artifactSha256">,
) {
    return createHash("sha256").update(canonical(approval)).digest("hex");
}

export function evaluateDisDexV96OperatorOverride(input: {
    approval?: DisDexV96OperatorOverrideApproval;
    configFingerprint: string;
    now?: number;
}): DisDexV96OperatorOverrideResult {
    const reasons: string[] = [];
    const approval = input.approval;
    const now = input.now ?? Date.now();
    if (!approval || approval.status !== "APPROVED") {
        return { allowed: false, reasons: ["Operator Override approval is missing."] };
    }
    if (approval.strategyId !== DISDEX_V96_STRATEGY_ID) reasons.push("Operator Override strategyId mismatch.");
    if (approval.configFingerprint !== input.configFingerprint) reasons.push("Operator Override config fingerprint mismatch.");
    if (!nonEmpty(approval.approvedCommitSha) || !nonEmpty(approval.operator) || !nonEmpty(approval.reason)) {
        reasons.push("Operator Override approval metadata is incomplete.");
    }
    if (approval.acknowledgement !== "I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE") {
        reasons.push("Operator Override acknowledgement is invalid.");
    }
    if (approval.forwardEvidenceBypassAccepted !== true) reasons.push("Forward Evidence bypass acceptance is missing.");
    const approvedAt = Date.parse(approval.approvedAt);
    const expiresAt = Date.parse(approval.expiresAt);
    if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) || expiresAt <= approvedAt) {
        reasons.push("Operator Override validity timestamps are invalid.");
    } else {
        if (now < approvedAt) reasons.push("Operator Override is not active yet.");
        if (now >= expiresAt) reasons.push("Operator Override has expired.");
        if (expiresAt - approvedAt > DISDEX_V96_LIVE_PROMOTION.maximumOverrideValidityHours * 3_600_000) {
            reasons.push("Operator Override validity exceeds the repository maximum.");
        }
    }
    if (!(approval.initialPenguGrossCap > 0
        && approval.initialPenguGrossCap <= DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross + 1e-12)) {
        reasons.push("Operator Override PENGU Gross cap exceeds the allowed initial limit.");
    }
    if (!(approval.maximumPortfolioGross > 0
        && approval.maximumPortfolioGross <= DISDEX_V96_LIVE_PROMOTION.maximumPortfolioGross + 1e-12)) {
        reasons.push("Operator Override portfolio Gross cap is invalid.");
    }
    if (!(approval.maximumDailyLossPct > 0
        && approval.maximumDailyLossPct <= DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct + 1e-12)) {
        reasons.push("Operator Override daily loss percentage is invalid.");
    }
    if (approval.maximumDailyLossUsd !== undefined && !(approval.maximumDailyLossUsd > 0)) {
        reasons.push("Operator Override daily loss USD limit must be positive when supplied.");
    }
    const expectedHash = disDexV96OperatorOverrideArtifactSha256({
        status: approval.status,
        strategyId: approval.strategyId,
        configFingerprint: approval.configFingerprint,
        approvedCommitSha: approval.approvedCommitSha,
        operator: approval.operator,
        reason: approval.reason,
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        forwardEvidenceBypassAccepted: approval.forwardEvidenceBypassAccepted,
        initialPenguGrossCap: approval.initialPenguGrossCap,
        maximumPortfolioGross: approval.maximumPortfolioGross,
        maximumDailyLossPct: approval.maximumDailyLossPct,
        maximumDailyLossUsd: approval.maximumDailyLossUsd,
        acknowledgement: approval.acknowledgement,
    });
    if (approval.artifactSha256 !== expectedHash) reasons.push("Operator Override artifact SHA-256 mismatch.");
    return { allowed: reasons.length === 0, reasons, approval };
}

function utcDay(now: number) {
    return new Date(now).toISOString().slice(0, 10);
}

export function updateDisDexV96DailyRisk(input: {
    previous?: DisDexV96DailyRiskState;
    equity: number;
    maximumDailyLossPct: number;
    maximumDailyLossUsd?: number;
    now?: number;
}): DisDexV96DailyRiskState {
    const now = input.now ?? Date.now();
    const day = utcDay(now);
    const equity = Math.max(0, finite(input.equity));
    const prior = input.previous?.utcDay === day ? input.previous : undefined;
    const dayStartEquity = prior?.dayStartEquity && prior.dayStartEquity > 0 ? prior.dayStartEquity : equity;
    const percentageLimitUsd = dayStartEquity * Math.max(0, finite(input.maximumDailyLossPct)) / 100;
    const absoluteLimit = input.maximumDailyLossUsd && input.maximumDailyLossUsd > 0
        ? input.maximumDailyLossUsd
        : Number.POSITIVE_INFINITY;
    const lossLimitUsd = Math.min(percentageLimitUsd, absoluteLimit);
    const lossUsd = Math.max(0, dayStartEquity - equity);
    const lossPct = dayStartEquity > 0 ? lossUsd / dayStartEquity * 100 : 0;
    const tripped = Boolean(prior?.tripped) || (lossLimitUsd > 0 && lossUsd + 1e-9 >= lossLimitUsd);
    const trippedAt = prior?.trippedAt || (tripped ? now : undefined);
    return {
        utcDay: day,
        dayStartEquity,
        lastEquity: equity,
        lossUsd,
        lossPct,
        lossLimitUsd,
        tripped,
        trippedAt,
        tripReason: tripped
            ? prior?.tripReason || `V96 daily equity loss limit reached: ${lossUsd.toFixed(2)} USD / ${lossPct.toFixed(4)}%.`
            : undefined,
        lastCheckedAt: now,
    };
}

export async function readDisDexV96KillSwitch(path?: string): Promise<DisDexV96KillSwitchCommand | undefined> {
    if (!path) return undefined;
    try {
        const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DisDexV96KillSwitchCommand>;
        if (parsed.active !== true) return undefined;
        if (parsed.strategyId !== DISDEX_V96_STRATEGY_ID
            || parsed.action !== "FLATTEN_MANAGED"
            || !nonEmpty(parsed.reason)
            || !nonEmpty(parsed.operator)
            || !nonEmpty(parsed.activatedAt)) {
            throw new Error("V96 Kill Switch file is active but invalid.");
        }
        return parsed as DisDexV96KillSwitchCommand;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return undefined;
        throw error;
    }
}
