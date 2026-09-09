import "dotenv/config";

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { isAsterUpstreamKillReason, isRecoverableV12AsterManualReview } from "../lib/aster-upstream-recovery-policy";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

const APPLY_ACK = "I_ACK_ASTER_UPSTREAM_RECOVERY_AFTER_3X_READONLY_FLAT";

function argValue(flag: string) {
    const index = process.argv.indexOf(flag);
    return index >= 0 ? process.argv[index + 1] : undefined;
}
function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}
function exactSha(value: string) {
    return /^[0-9a-f]{40}$/.test(value);
}
function assertRecoveryRunnersStopped(candidateSha: string) {
    for (const unit of [`disdex-v12-x1-all@${candidateSha}.service`, `disdex-v52-aster-only@${candidateSha}.service`]) {
        const result = spawnSync("/usr/bin/systemctl", ["show", unit, "--property=LoadState", "--property=ActiveState", "--no-pager"], { encoding: "utf8" });
        if (result.error || result.status !== 0) throw new Error(`ASTER_UPSTREAM_RECOVERY_SYSTEMD_CHECK_FAILED:${unit}`);
        const props = Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
        if (props.LoadState !== "loaded") throw new Error(`ASTER_UPSTREAM_RECOVERY_RUNNER_NOT_LOADED:${unit}`);
        if (!new Set(["inactive", "failed"]).has(props.ActiveState)) throw new Error(`ASTER_UPSTREAM_RECOVERY_RUNNER_NOT_STOPPED:${unit}:${props.ActiveState || "UNKNOWN"}`);
    }
}
async function archive(path: string, bytes: Buffer, requestId: string, label: string) {
    const directory = resolve(dirname(path), "recovery-archive");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = resolve(directory, `${stamp}-${requestId}-${label}.json`);
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    return target;
}
async function atomicWrite(path: string, payload: unknown) {
    const temporary = `${path}.aster-recovery.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
}

async function main() {
    const verifyOnly = process.argv.includes("--verify-only");
    const apply = process.argv.includes("--apply");
    if (verifyOnly === apply) throw new Error("ASTER_UPSTREAM_RECOVERY_REQUIRES_EXACTLY_ONE_OF_--verify-only_OR_--apply");

    const candidateSha = String(argValue("--sha") || "").trim().toLowerCase();
    if (!exactSha(candidateSha)) throw new Error("ASTER_UPSTREAM_RECOVERY_EXACT_SHA_REQUIRED");
    const currentSha = String(process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim().toLowerCase();
    if (currentSha && currentSha !== candidateSha) throw new Error("ASTER_UPSTREAM_RECOVERY_RELEASE_SHA_MISMATCH");
    if (apply && String(argValue("--ack") || "") !== APPLY_ACK) throw new Error("ASTER_UPSTREAM_RECOVERY_APPLY_ACK_REQUIRED");

    assertRecoveryRunnersStopped(candidateSha);

    const runtime = resolveV12X1AllRuntime();
    if (runtime.mode !== "LIVE") throw new Error("ASTER_UPSTREAM_RECOVERY_V12_MODE_NOT_LIVE");
    const statePath = resolve(runtime.statePath);
    const stateStore = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
    const sharedKill = await readSharedKillSwitch();
    if (!sharedKill.active || !sharedKill.sourcePath) throw new Error("ASTER_UPSTREAM_RECOVERY_SHARED_KILL_SWITCH_NOT_ACTIVE");
    if (!isAsterUpstreamKillReason(sharedKill.reason)) throw new Error(`ASTER_UPSTREAM_RECOVERY_KILL_REASON_NOT_ALLOWLISTED:${sharedKill.reason || "UNSPECIFIED"}`);

    const state = await stateStore.load();
    if (state.active || state.pending) throw new Error("ASTER_UPSTREAM_RECOVERY_V12_NOT_FLAT_IN_LOCAL_STATE");
    if (!isRecoverableV12AsterManualReview(state.manualReview || state.killSwitch?.reason || "")) {
        throw new Error(`ASTER_UPSTREAM_RECOVERY_V12_OPERATOR_REVIEW_NOT_ALLOWLISTED:${state.manualReview || state.killSwitch?.reason || "UNKNOWN"}`);
    }
    const risk = await readSharedCryptoDailyRisk(runtime.riskPath);
    if (!risk.ok) throw new Error(`ASTER_UPSTREAM_RECOVERY_SHARED_RISK_NOT_READY:${risk.reason}`);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
        readOnlyRateLimitMaxRetries: 0,
        userAgent: `DisDex-Aster-Upstream-Recovery/${candidateSha.slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("ASTER_UPSTREAM_RECOVERY_ASTER_CREDENTIALS_MISSING");

    const lock = new FileAccountOrderLock(runtime.lockPath || "/var/lib/disdex/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const requestId = `aster-upstream-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${process.pid}`;
    const handle = await lock.acquire(`ASTER_UPSTREAM_RECOVERY:${requestId}`);
    if (!handle) throw new Error("ASTER_UPSTREAM_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
    try {
        const beforeState = await readFile(statePath);
        const beforeKill = await readFile(sharedKill.sourcePath);
        const stateBeforeGate = await stateStore.load();
        const killBeforeGate = await readSharedKillSwitch();
        if (stateBeforeGate.active || stateBeforeGate.pending || !isRecoverableV12AsterManualReview(stateBeforeGate.manualReview || stateBeforeGate.killSwitch?.reason || "")) {
            throw new Error("ASTER_UPSTREAM_RECOVERY_V12_STATE_CHANGED_BEFORE_GATE");
        }
        if (!killBeforeGate.active || killBeforeGate.reason !== sharedKill.reason) throw new Error("ASTER_UPSTREAM_RECOVERY_KILL_STATE_CHANGED_BEFORE_GATE");

        const gate = await runAsterReadOnlyRecoveryGate(client, {
            requiredConsecutiveSuccesses: numberEnv("DISDEX_ASTER_RECOVERY_CONSECUTIVE_SUCCESSES", 3),
            requestSpacingMs: numberEnv("DISDEX_ASTER_RECOVERY_REQUEST_SPACING_MS", 750),
            roundSpacingMs: numberEnv("DISDEX_ASTER_RECOVERY_ROUND_SPACING_MS", 5_000),
            requireFlat: true,
        });
        const afterStateBytes = await readFile(statePath);
        const afterKillBytes = await readFile(sharedKill.sourcePath);
        if (!beforeState.equals(afterStateBytes) || !beforeKill.equals(afterKillBytes)) throw new Error("ASTER_UPSTREAM_RECOVERY_STATE_CHANGED_DURING_READONLY_GATE");

        if (verifyOnly) {
            console.log(JSON.stringify({
                status: "ASTER_UPSTREAM_RECOVERY_VERIFY_PASS",
                candidateSha,
                operatorReviewClearEligible: true,
                killSwitchActive: true,
                killSwitchReason: sharedKill.reason,
                ...gate,
            }));
            return;
        }

        const stateArchive = await archive(statePath, beforeState, requestId, "v12-state");
        const killArchive = await archive(sharedKill.sourcePath, beforeKill, requestId, "kill-switch");
        const cleanState = { schema: "v12-x1-all-runner-state/v1" as const, strategyId: "V12_X1.00_ALL" as const, mode: "LIVE" as const, updatedAt: Date.now() };
        try {
            await stateStore.save(cleanState);
            await atomicWrite(sharedKill.sourcePath, {
                active: false,
                action: "FLATTEN_MANAGED",
                strategyId: "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
                reason: "Aster upstream communication recovered after three consecutive authenticated read-only flat-account checks.",
                operator: "ASTER_UPSTREAM_RECOVERY_V1",
                recoveredAt: new Date().toISOString(),
                previousReason: sharedKill.reason,
                candidateSha,
                requestId,
            });
            const clean = await stateStore.load();
            const killAfter = await readSharedKillSwitch();
            if (clean.active || clean.pending || clean.manualReview || clean.killSwitch?.active) throw new Error("ASTER_UPSTREAM_RECOVERY_V12_CLEAR_VERIFY_FAILED");
            if (killAfter.active) throw new Error("ASTER_UPSTREAM_RECOVERY_SHARED_KILL_CLEAR_VERIFY_FAILED");
        } catch (error) {
            await writeFile(statePath, beforeState, { mode: 0o600 }).catch(() => undefined);
            await writeFile(sharedKill.sourcePath, beforeKill, { mode: 0o600 }).catch(() => undefined);
            throw error;
        }
        console.log(JSON.stringify({
            status: "ASTER_UPSTREAM_RECOVERY_APPLY_PASS",
            candidateSha,
            operatorReviewCleared: true,
            sharedKillSwitchCleared: true,
            stateArchive,
            killArchive,
            ...gate,
        }));
    } finally {
        await handle.release();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "ASTER_UPSTREAM_RECOVERY_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    }));
    process.exitCode = 1;
});
