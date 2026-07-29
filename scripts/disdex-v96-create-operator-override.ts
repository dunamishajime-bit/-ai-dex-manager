import { copyFile, mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import { disDexV96ConfigFingerprint } from "../lib/disdex-v96-live-gates";
import {
    disDexV96OperatorOverrideArtifactSha256,
    type DisDexV96OperatorOverrideApproval,
} from "../lib/disdex-v96-live-risk-controls";

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function requireSha(value: string) {
    if (!/^[a-f0-9]{40}$/i.test(value)) throw new Error("DISDEX_V96_APPROVED_COMMIT_SHA must be an exact 40-character commit SHA.");
    return value.toLowerCase();
}

async function atomicWriteJson(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    await copyFile(path, `${path}.bak.${timestamp}`).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
    });
    const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
}

async function main() {
    const output = resolve(process.argv[2] || process.env.DISDEX_V96_OPERATOR_OVERRIDE_FILE || ".runtime-approval/disdex-v96-operator-override.json");
    const acknowledgement = required("DISDEX_V96_OPERATOR_OVERRIDE_ACKNOWLEDGEMENT");
    if (acknowledgement !== "I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE") {
        throw new Error("The exact Operator Override acknowledgement is required.");
    }
    const durationHours = numberEnv("DISDEX_V96_OPERATOR_OVERRIDE_HOURS", 24);
    if (!(durationHours > 0 && durationHours <= DISDEX_V96_LIVE_PROMOTION.maximumOverrideValidityHours)) {
        throw new Error(`Override validity must be between 0 and ${DISDEX_V96_LIVE_PROMOTION.maximumOverrideValidityHours} hours.`);
    }
    const initialPenguGrossCap = numberEnv("DISDEX_V96_INITIAL_PENGU_GROSS", DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross);
    const maximumPortfolioGross = numberEnv("DISDEX_V96_MAX_GROSS", DISDEX_V96_LIVE_PROMOTION.maximumPortfolioGross);
    const maximumDailyLossPct = numberEnv("DISDEX_V96_MAX_DAILY_LOSS_PCT", DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct);
    const maximumDailyLossUsdRaw = Number(process.env.DISDEX_V96_MAX_DAILY_LOSS_USD);
    const maximumDailyLossUsd = Number.isFinite(maximumDailyLossUsdRaw) && maximumDailyLossUsdRaw > 0
        ? maximumDailyLossUsdRaw
        : undefined;
    if (!(initialPenguGrossCap > 0 && initialPenguGrossCap <= DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross)) {
        throw new Error(`Initial PENGU Gross must not exceed ${DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross}.`);
    }
    if (!(maximumPortfolioGross > 0 && maximumPortfolioGross <= DISDEX_V96_LIVE_PROMOTION.maximumPortfolioGross)) {
        throw new Error(`Portfolio Gross must not exceed ${DISDEX_V96_LIVE_PROMOTION.maximumPortfolioGross}.`);
    }
    if (!(maximumDailyLossPct > 0 && maximumDailyLossPct <= DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct)) {
        throw new Error(`Daily loss limit must not exceed ${DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct}%.`);
    }
    const approvedAt = new Date();
    const expiresAt = new Date(approvedAt.getTime() + durationHours * 3_600_000);
    const base: Omit<DisDexV96OperatorOverrideApproval, "artifactSha256"> = {
        status: "APPROVED",
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        approvedCommitSha: requireSha(required("DISDEX_V96_APPROVED_COMMIT_SHA")),
        operator: required("DISDEX_V96_OPERATOR"),
        reason: required("DISDEX_V96_OPERATOR_OVERRIDE_REASON"),
        approvedAt: approvedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        forwardEvidenceBypassAccepted: true,
        initialPenguGrossCap,
        maximumPortfolioGross,
        maximumDailyLossPct,
        maximumDailyLossUsd,
        acknowledgement: "I_APPROVE_DISDEX_V96_OPERATOR_CONTROLLED_LIVE",
    };
    const approval: DisDexV96OperatorOverrideApproval = {
        ...base,
        artifactSha256: disDexV96OperatorOverrideArtifactSha256(base),
    };
    await atomicWriteJson(output, approval);
    console.log(JSON.stringify({
        status: "DISDEX_V96_OPERATOR_OVERRIDE_CREATED",
        output,
        strategyId: approval.strategyId,
        approvedCommitSha: approval.approvedCommitSha,
        operator: approval.operator,
        approvedAt: approval.approvedAt,
        expiresAt: approval.expiresAt,
        initialPenguGrossCap: approval.initialPenguGrossCap,
        maximumPortfolioGross: approval.maximumPortfolioGross,
        maximumDailyLossPct: approval.maximumDailyLossPct,
        maximumDailyLossUsd: approval.maximumDailyLossUsd,
        artifactSha256: approval.artifactSha256,
        secretsPrinted: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_OPERATOR_OVERRIDE_CREATE_FAILED",
        message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
});
