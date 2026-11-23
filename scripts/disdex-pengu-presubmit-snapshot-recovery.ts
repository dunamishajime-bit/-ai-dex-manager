import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { FileQuality102CausalV1StateStore } from "../lib/disdex-quality102-causal-v1-state";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FilePenguDualLsV2RunnerStateStore, type PenguDualLsV2RunnerState } from "../lib/pengu-dual-ls-v2-runner-state";

const ACK = "I_ACK_PENGU_PRESUBMIT_SNAPSHOT_RECOVERY_AFTER_READONLY_FLAT";
const SHA = /^[0-9a-f]{40}$/;
const RECOVERABLE = new Set([
    "PENGU_DUAL_LS_PRE_SUBMIT_ACCOUNT_STALE_OR_INVALID",
    "PENGU_DUAL_LS_EXECUTION_RESULT_IDENTITY_MISMATCH",
]);

function arg(name: string) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; }
function exactSha(value: unknown) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!SHA.test(normalized)) throw new Error("PENGU_PRESUBMIT_RECOVERY_EXACT_SHA_REQUIRED");
    return normalized;
}
function assertStopped(unit: string) {
    const result = spawnSync("/usr/bin/systemctl", ["show", unit, "-p", "ActiveState", "--value"], { encoding: "utf8" });
    const state = String(result.stdout || "").trim();
    if (result.error || result.status !== 0 || !new Set(["inactive", "failed"]).has(state)) {
        throw new Error(`PENGU_PRESUBMIT_RECOVERY_UNIT_NOT_STOPPED:${unit}:${state}`);
    }
}
export function assertRecoverablePenguPreSubmitState(state: PenguDualLsV2RunnerState) {
    if (state.position) throw new Error("PENGU_PRESUBMIT_RECOVERY_LOCAL_POSITION_PRESENT");
    const pending = state.pending;
    if (!pending || pending.reduceOnly || pending.phase !== "manual_review" || !pending.clientOrderId) {
        throw new Error("PENGU_PRESUBMIT_RECOVERY_ENTRY_MANUAL_REVIEW_REQUIRED");
    }
    if (!RECOVERABLE.has(String(pending.lastError || ""))) throw new Error("PENGU_PRESUBMIT_RECOVERY_REASON_NOT_EXACT");
    return pending;
}
async function archive(path: string, bytes: Buffer, sha: string) {
    const root = resolve(dirname(path), "recovery-archive");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = resolve(root, `${stamp}-${sha.slice(0, 12)}-pengu-state.json`);
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    return target;
}

async function main() {
    if (process.argv.includes("--self-test")) {
        const pending = assertRecoverablePenguPreSubmitState({
            version: 2, strategyId: "PENGU_DUAL_LS_V2_FINAL", mode: "LIVE", updatedAt: 1, failures: [],
            pending: { idempotencyKey: "id", clientOrderId: "cid", phase: "manual_review", side: "SELL", quantity: 1, reduceOnly: false, expectedPrice: 1, reason: "entry", referenceTs: 1, targetGross: 0.75, createdAt: 1, updatedAt: 1, retryCount: 1, lastError: "PENGU_DUAL_LS_EXECUTION_RESULT_IDENTITY_MISMATCH" },
        });
        if (pending.clientOrderId !== "cid") throw new Error("PENGU_PRESUBMIT_RECOVERY_SELFTEST_FAILED");
        console.log("PENGU_PRESUBMIT_SNAPSHOT_RECOVERY_SELFTEST_PASS");
        return;
    }
    const sha = exactSha(arg("--sha"));
    if (arg("--ack") !== ACK) throw new Error("PENGU_PRESUBMIT_RECOVERY_ACK_REQUIRED");
    const current = (await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8")).trim().toLowerCase();
    if (current !== sha) throw new Error("PENGU_PRESUBMIT_RECOVERY_CURRENT_SHA_MISMATCH");
    assertStopped(`disdex-pengu-dual-ls-v2@${sha}.service`);

    const stateRoot = resolve(process.env.PENGU_DUAL_LS_V2_STATE_DIR || "/var/lib/disdex/pengu-dual-ls-v2");
    const statePath = resolve(stateRoot, "runner-live.json");
    const q102Path = resolve(process.env.QUALITY102_CAUSAL_V1_STATE_PATH || "/var/lib/disdex/quality102-causal-v1/state.json");
    const riskPath = resolve(process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || "/var/lib/disdex/shared/crypto-daily-risk.json");
    const marginPath = resolve(process.env.DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE || "/var/lib/disdex/shared/margin-risk/guard-live.json");
    const lockPath = resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock");
    const store = new FilePenguDualLsV2RunnerStateStore(statePath, "LIVE");
    const state = await store.load();
    const pending = assertRecoverablePenguPreSubmitState(state);
    const kill = await readSharedKillSwitch();
    if (kill.active) throw new Error(`PENGU_PRESUBMIT_RECOVERY_KILL_SWITCH_ACTIVE:${kill.reason}`);
    const now = Date.now();
    const q102 = await new FileQuality102CausalV1StateStore(q102Path, "LIVE", sha).load();
    if (q102.pending || q102.position || q102.runtimeCommitSha.toLowerCase() !== sha || q102.updatedAt > now + 5_000 || now - q102.updatedAt > 75 * 60_000) throw new Error("PENGU_PRESUBMIT_RECOVERY_Q102_NOT_FLAT_FRESH_CURRENT");
    const risk = await readSharedCryptoDailyRisk(riskPath, now);
    if (!risk.ok) throw new Error(`PENGU_PRESUBMIT_RECOVERY_SHARED_RISK_NOT_READY:${risk.reason}`);
    const margin = JSON.parse(await readFile(marginPath, "utf8")) as { stage?: unknown; ordersAllowed?: unknown };
    if (margin.stage !== "HEALTHY" || margin.ordersAllowed !== true) throw new Error("PENGU_PRESUBMIT_RECOVERY_MARGIN_NOT_HEALTHY");

    const client = new AsterV3Client({ baseUrl: process.env.ASTER_FUTURES_BASE_URL, userAddress: process.env.ASTER_USER_ADDRESS, privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined, readOnlyRateLimitMaxRetries: 0, userAgent: `DisDex-PENGU-PreSubmit-Recovery/${sha.slice(0, 12)}` });
    if (!client.hasTradingCredentials()) throw new Error("PENGU_PRESUBMIT_RECOVERY_CREDENTIALS_MISSING");
    const lock = new FileAccountOrderLock(lockPath, 120_000);
    const handle = await lock.acquire(`PENGU_PRESUBMIT_RECOVERY:${process.pid}`);
    if (!handle) throw new Error("PENGU_PRESUBMIT_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
    try {
        const gate = await runAsterReadOnlyRecoveryGate(client, { requiredConsecutiveSuccesses: 3, requestSpacingMs: 750, roundSpacingMs: 5_000, requireFlat: true });
        try { await client.getOrder("PENGUUSDT", pending.clientOrderId); throw new Error("PENGU_PRESUBMIT_RECOVERY_ORDER_EXISTS"); }
        catch (error) { if (!(error instanceof AsterApiError) || error.code !== -2013) throw error; }
        const bytes = await readFile(statePath);
        const stateBackup = await archive(statePath, bytes, sha);
        try {
            await store.save({ ...state, pending: undefined, lastCompletedIdempotencyKey: pending.idempotencyKey, lastRunAt: Date.now(), failures: [...state.failures, { occurredAt: Date.now(), message: "PENGU_PRE_SUBMIT_PENDING_RECONCILED_READONLY_ABSENT", idempotencyKey: pending.idempotencyKey }] });
        } catch (error) { await writeFile(statePath, bytes, { mode: 0o600 }).catch(() => undefined); throw error; }
        console.log(JSON.stringify({ status: "PENGU_PRESUBMIT_SNAPSHOT_RECOVERY_PASS", sha, pendingClientOrderId: pending.clientOrderId, orderConfirmedAbsent: true, stateBackup, ...gate, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    } finally { await handle.release(); }
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "PENGU_PRESUBMIT_SNAPSHOT_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    process.exitCode = 1;
});
