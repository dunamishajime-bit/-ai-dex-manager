import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { FileQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";

const ACK = "I_ACK_V12_PRESUBMIT_SNAPSHOT_RECOVERY_AFTER_READONLY_FLAT";
const REVIEW_REASON = "STRICT_PORTFOLIO_ACCOUNT_SNAPSHOT_STALE_OR_INVALID";
const SHARED_KILL_REASON = "V52 upstream state unavailable: QUALITY102_STATE_STALE";
const SHA = /^[0-9a-f]{40}$/;

function arg(name: string) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactSha(value: unknown) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!SHA.test(normalized)) throw new Error("V12_PRESUBMIT_RECOVERY_EXACT_SHA_REQUIRED");
    return normalized;
}

function activePositions(state: V12X1AllRunnerState) {
    return state.activePositions ?? (state.active ? [state.active] : []);
}

export function assertRecoverableV12PreSubmitState(state: V12X1AllRunnerState) {
    if (activePositions(state).length > 0) throw new Error("V12_PRESUBMIT_RECOVERY_LOCAL_POSITION_PRESENT");
    if (state.manualReview !== REVIEW_REASON || state.killSwitch?.active !== true || state.killSwitch.reason !== REVIEW_REASON) {
        throw new Error("V12_PRESUBMIT_RECOVERY_REASON_NOT_EXACT");
    }
    if (!state.pending || state.pending.action !== "ENTRY" || !state.pending.clientOrderId || !state.pending.symbol) {
        throw new Error("V12_PRESUBMIT_RECOVERY_ENTRY_PENDING_REQUIRED");
    }
    return state.pending;
}

function assertStopped(unit: string) {
    const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "--value"], { encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error(`V12_PRESUBMIT_RECOVERY_SYSTEMD_CHECK_FAILED:${unit}`);
    const state = String(result.stdout || "").trim();
    if (!new Set(["inactive", "failed"]).has(state)) throw new Error(`V12_PRESUBMIT_RECOVERY_UNIT_NOT_STOPPED:${unit}:${state}`);
}

async function atomicWrite(path: string, payload: unknown) {
    const temporary = `${path}.v12-presubmit-recovery.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, path);
}

async function archive(path: string, bytes: Buffer, label: string, sha: string) {
    const root = resolve(dirname(path), "recovery-archive");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = resolve(root, `${stamp}-${sha.slice(0, 12)}-${label}.json`);
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    return target;
}

async function main() {
    if (process.argv.includes("--self-test")) {
        const pending = assertRecoverableV12PreSubmitState({
            schema: "v12-x1-all-runner-state/v1",
            strategyId: "V12_X1.00_ALL",
            mode: "LIVE",
            updatedAt: 1,
            pending: { idempotencyKey: "id", action: "ENTRY", clientOrderId: "id", symbol: "DOGEUSDT", side: "SHORT", quantity: 1, signalTs: 1, createdAt: 1 },
            manualReview: REVIEW_REASON,
            killSwitch: { active: true, reason: REVIEW_REASON, trippedAt: 1 },
            activePositions: [],
        });
        if (pending.clientOrderId !== "id") throw new Error("V12_PRESUBMIT_RECOVERY_SELFTEST_FAILED");
        console.log("V12_PRESUBMIT_SNAPSHOT_RECOVERY_SELFTEST_PASS");
        return;
    }

    const sha = exactSha(arg("--sha"));
    if (arg("--ack") !== ACK) throw new Error("V12_PRESUBMIT_RECOVERY_ACK_REQUIRED");
    const current = await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8").then((value) => value.trim().toLowerCase());
    if (current !== sha) throw new Error("V12_PRESUBMIT_RECOVERY_CURRENT_SHA_MISMATCH");
    const v12Unit = `disdex-v12-x1-all@${sha}.service`;
    const v52Unit = `disdex-v52-aster-only@${sha}.service`;
    assertStopped(v12Unit);
    assertStopped(v52Unit);

    const v12StatePath = resolve(process.env.V12_X1_ALL_STATE_PATH || "/var/lib/disdex/v12-x1-all/runner.json");
    const q102StatePath = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json");
    const riskPath = resolve(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json");
    const marginPath = resolve(process.env.DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE || "/var/lib/disdex/shared/margin-risk/guard-live.json");
    const lockPath = resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock");
    const v12Store = new FileV12X1AllRunnerStateStore(v12StatePath, "LIVE");
    const state = await v12Store.load();
    const pending = assertRecoverableV12PreSubmitState(state);
    const sharedKill = await readSharedKillSwitch();
    if (!sharedKill.active || sharedKill.reason !== SHARED_KILL_REASON || !sharedKill.sourcePath) throw new Error("V12_PRESUBMIT_RECOVERY_SHARED_KILL_REASON_NOT_EXACT");

    const q102 = await new FileQuality102CausalV1StateStore(q102StatePath, "LIVE", sha).load();
    const now = Date.now();
    if (q102.pending || q102.position || q102.runtimeCommitSha.toLowerCase() !== sha || now - q102.updatedAt > 75 * 60_000 || q102.updatedAt > now + 5_000) {
        throw new Error("V12_PRESUBMIT_RECOVERY_Q102_STATE_NOT_FLAT_FRESH_CURRENT");
    }
    const risk = await readSharedCryptoDailyRisk(riskPath, now);
    if (!risk.ok) throw new Error(`V12_PRESUBMIT_RECOVERY_SHARED_RISK_NOT_READY:${risk.reason}`);
    const margin = JSON.parse(await readFile(marginPath, "utf8")) as { stage?: unknown; ordersAllowed?: unknown };
    if (margin.stage !== "HEALTHY" || margin.ordersAllowed !== true) throw new Error("V12_PRESUBMIT_RECOVERY_MARGIN_GUARD_NOT_HEALTHY");

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        readOnlyRateLimitMaxRetries: 0,
        userAgent: `DisDex-V12-PreSubmit-Recovery/${sha.slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_PRESUBMIT_RECOVERY_ASTER_CREDENTIALS_MISSING");
    const lock = new FileAccountOrderLock(lockPath, 120_000);
    const handle = await lock.acquire(`V12_PRESUBMIT_RECOVERY:${process.pid}`);
    if (!handle) throw new Error("V12_PRESUBMIT_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
    try {
        const gate = await runAsterReadOnlyRecoveryGate(client, { requiredConsecutiveSuccesses: 3, requestSpacingMs: 750, roundSpacingMs: 5_000, requireFlat: true });
        try {
            await client.getOrder(pending.symbol, pending.clientOrderId);
            throw new Error("V12_PRESUBMIT_RECOVERY_PENDING_ORDER_EXISTS");
        } catch (error) {
            if (!(error instanceof AsterApiError) || error.code !== -2013) throw error;
        }
        const stateBytes = await readFile(v12StatePath);
        const killBytes = await readFile(sharedKill.sourcePath);
        const stateBackup = await archive(v12StatePath, stateBytes, "v12-state", sha);
        const killBackup = await archive(sharedKill.sourcePath, killBytes, "kill-switch", sha);
        try {
            await v12Store.save({
                schema: "v12-x1-all-runner-state/v1",
                strategyId: "V12_X1.00_ALL",
                mode: "LIVE",
                updatedAt: Date.now(),
                lastReferenceTs: state.lastReferenceTs,
                lastCompletedIdempotencyKey: pending.idempotencyKey,
                activePositions: [],
            });
            await atomicWrite(sharedKill.sourcePath, {
                active: false,
                reason: "V12 pre-submit account snapshot failure reconciled read-only; no exchange order or position existed.",
                recoveredAt: new Date().toISOString(),
                previousReason: sharedKill.reason,
                runtimeCommitSha: sha,
                pendingClientOrderId: pending.clientOrderId,
                operator: "V12_PRESUBMIT_SNAPSHOT_RECOVERY_V1",
            });
        } catch (error) {
            await writeFile(v12StatePath, stateBytes, { mode: 0o600 }).catch(() => undefined);
            await writeFile(sharedKill.sourcePath, killBytes, { mode: 0o600 }).catch(() => undefined);
            throw error;
        }
        console.log(JSON.stringify({
            status: "V12_PRESUBMIT_SNAPSHOT_RECOVERY_PASS",
            sha,
            pendingClientOrderId: pending.clientOrderId,
            orderConfirmedAbsent: true,
            stateBackup,
            killBackup,
            ...gate,
            ordersSent: 0,
            cancelsSent: 0,
            positionChangesSent: 0,
        }));
    } finally {
        await handle.release();
    }
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "V12_PRESUBMIT_SNAPSHOT_RECOVERY_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
    }));
    process.exitCode = 1;
});
