import "dotenv/config";

import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import { disDexV96ConfigFingerprint, type DisDexV96ExecutionParityApproval } from "../lib/disdex-v96-live-gates";

const ACKNOWLEDGEMENT = "I_REVIEWED_DISDEX_V96_EXECUTION_PARITY_FOR_EXACT_COMMIT" as const;

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function requireSha(value: string, label: string) {
    if (!/^[a-f0-9]{40}$/i.test(value)) throw new Error(`${label} must be an exact 40-character commit SHA.`);
    return value.toLowerCase();
}

async function atomicWriteJson(path: string, value: unknown) {
    await mkdir(dirname(path), { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${path}.bak.${timestamp}`;
    await copyFile(path, backup).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
    });
    const temporary = `${path}.tmp.${process.pid}.${Date.now()}`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
}

async function main() {
    if (required("DISDEX_V96_EXECUTION_PARITY_REVIEW_ACKNOWLEDGEMENT") !== ACKNOWLEDGEMENT) {
        throw new Error(`The exact acknowledgement ${ACKNOWLEDGEMENT} is required.`);
    }
    const path = resolve(required("DISDEX_V96_EXECUTION_PARITY_FILE"));
    const targetCommitSha = requireSha(required("DISDEX_V96_APPROVED_COMMIT_SHA"), "DISDEX_V96_APPROVED_COMMIT_SHA");
    const reviewer = required("DISDEX_V96_EXECUTION_PARITY_REVIEWER");
    const current = JSON.parse(await readFile(path, "utf8")) as DisDexV96ExecutionParityApproval;
    if (current.status !== "APPROVED") throw new Error("Existing execution parity must already be APPROVED.");
    if (current.strategyId !== DISDEX_V96_STRATEGY_ID) throw new Error("Existing execution parity strategyId mismatch.");
    if (!current.allocationParityPassed || !current.signalChronologyParityPassed || !current.orderQuantityParityPassed || !current.restartRecoveryPassed) {
        throw new Error("Existing execution parity contains a failed parity assertion.");
    }
    if (!/^[a-f0-9]{64}$/i.test(current.goldenVectorArtifactSha256)) {
        throw new Error("Existing execution parity golden vector SHA-256 is invalid.");
    }
    if (!/^[a-f0-9]{40}$/i.test(current.researchCommitSha)) {
        throw new Error("Existing execution parity research commit SHA is invalid.");
    }
    const renewed: DisDexV96ExecutionParityApproval = {
        ...current,
        status: "APPROVED",
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        productionCommitSha: targetCommitSha,
        reviewer,
        reviewedAt: new Date().toISOString(),
    };
    await atomicWriteJson(path, renewed);
    console.log(JSON.stringify({
        status: "DISDEX_V96_EXECUTION_PARITY_RENEWED",
        path,
        productionCommitSha: renewed.productionCommitSha,
        researchCommitSha: renewed.researchCommitSha,
        configFingerprint: renewed.configFingerprint,
        reviewer: renewed.reviewer,
        reviewedAt: renewed.reviewedAt,
        allocationParityPassed: renewed.allocationParityPassed,
        signalChronologyParityPassed: renewed.signalChronologyParityPassed,
        orderQuantityParityPassed: renewed.orderQuantityParityPassed,
        restartRecoveryPassed: renewed.restartRecoveryPassed,
        secretsPrinted: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_EXECUTION_PARITY_RENEWAL_FAILED",
        message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
});
