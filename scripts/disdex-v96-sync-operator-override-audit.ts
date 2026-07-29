import "dotenv/config";

import { copyFile, readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import {
    assertDisDexV96LiveGates,
    type DisDexV96ExecutionParityApproval,
    type DisDexV96ForwardEvidenceApproval,
} from "../lib/disdex-v96-live-gates";
import {
    readDisDexV96KillSwitch,
    type DisDexV96OperatorOverrideApproval,
} from "../lib/disdex-v96-live-risk-controls";
import {
    disDexV96OperatorOverrideAuditFromApproval,
    disDexV96OperatorOverrideAuditMatches,
} from "../lib/disdex-v96-operator-override-audit";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";

const ACKNOWLEDGEMENT = "I_SYNC_CURRENT_EXACT_OPERATOR_OVERRIDE_AUDIT";
const CURRENT_LINK = "/home/deploy/disdex-trading/current";

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

async function optionalJson<T>(pathValue?: string): Promise<T | undefined> {
    if (!pathValue) return undefined;
    try {
        return JSON.parse(await readFile(resolve(pathValue), "utf8")) as T;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return undefined;
        throw error;
    }
}

async function main() {
    if (required("DISDEX_V96_OPERATOR_AUDIT_SYNC_ACKNOWLEDGEMENT") !== ACKNOWLEDGEMENT) {
        throw new Error("Exact Operator Override audit-sync acknowledgement is required.");
    }
    const runtimeCommitSha = required("DISDEX_V96_RUNTIME_COMMIT_SHA").toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(runtimeCommitSha)) throw new Error("Runtime commit SHA must be exact.");

    const releaseRoot = resolve(process.cwd());
    const markerSha = (await readFile(resolve(releaseRoot, ".disdex-release-sha"), "utf8")).trim().toLowerCase();
    if (markerSha !== runtimeCommitSha) throw new Error("Release marker does not match runtime commit SHA.");
    if (await realpath(CURRENT_LINK) !== releaseRoot) throw new Error("Current release link does not target the audit-sync release.");

    const [forwardEvidence, executionParity, operatorOverride] = await Promise.all([
        optionalJson<DisDexV96ForwardEvidenceApproval>(process.env.DISDEX_V96_FORWARD_EVIDENCE_FILE),
        optionalJson<DisDexV96ExecutionParityApproval>(process.env.DISDEX_V96_EXECUTION_PARITY_FILE),
        optionalJson<DisDexV96OperatorOverrideApproval>(process.env.DISDEX_V96_OPERATOR_OVERRIDE_FILE),
    ]);
    const gate = assertDisDexV96LiveGates({
        runnerMode: "live",
        environmentLiveExecutionEnabled: boolEnv("DISDEX_V96_LIVE_EXECUTION_ENABLED", false),
        activationAcknowledgement: process.env.DISDEX_V96_LIVE_ACKNOWLEDGEMENT,
        forwardEvidence,
        executionParity,
        operatorOverride,
        runtimeCommitSha,
    });
    if (!gate.operatorOverrideApproved || !gate.operatorOverride) {
        throw new Error("Audit sync requires an approved exact-commit Operator Override.");
    }

    const killSwitch = await readDisDexV96KillSwitch(process.env.DISDEX_V96_KILL_SWITCH_FILE);
    if (killSwitch?.active) throw new Error(`V96 Kill Switch is active: ${killSwitch.reason}`);

    const stateRoot = resolve(required("DISDEX_V96_STATE_DIR") || DISDEX_V96_RUNTIME.stateDirectory);
    const statePath = resolve(stateRoot, "runner-live.json");
    const stateStore = new FileDisDexV96RunnerStateStore(statePath, "live");
    const state = await stateStore.load();
    if (state.bootstrapRequired) throw new Error("Operator Override audit sync requires an established migrated state.");
    if (state.pending) throw new Error("Operator Override audit sync is blocked by a pending order.");
    if (state.manualReviewReason) throw new Error(`Operator Override audit sync is blocked by manual review: ${state.manualReviewReason}`);

    const unchanged = disDexV96OperatorOverrideAuditMatches(state.operatorOverride, gate.operatorOverride);
    let backupPath: string | undefined;
    if (!unchanged) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        backupPath = `${statePath}.before-override-audit-sync-${timestamp}.json`;
        await copyFile(statePath, backupPath);
        state.operatorOverride = disDexV96OperatorOverrideAuditFromApproval(gate.operatorOverride);
        await stateStore.save(state);
    }

    console.log(JSON.stringify({
        status: "DISDEX_V96_OPERATOR_OVERRIDE_AUDIT_SYNC_PASS_NO_ORDERS_SENT",
        runtimeCommitSha,
        statePath,
        backupPath,
        auditChanged: !unchanged,
        artifactSha256: gate.operatorOverride.artifactSha256,
        approvedCommitSha: gate.operatorOverride.approvedCommitSha,
        expiresAt: gate.operatorOverride.expiresAt,
        ordersSent: false,
        positionsChanged: false,
        killSwitchChanged: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_OPERATOR_OVERRIDE_AUDIT_SYNC_FAILED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        positionsChanged: false,
        killSwitchChanged: false,
    }));
    process.exitCode = 1;
});
