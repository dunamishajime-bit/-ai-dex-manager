import "dotenv/config";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { AsterApiError, AsterV3Client } from "../lib/aster-v3-client";
import { runAsterReadOnlyRecoveryGate } from "../lib/aster-readonly-recovery-gate";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { isV12BenignEntryQuantityGateError } from "../lib/v12-live-execution-engine";
import { FileV12X1AllRunnerStateStore, type V12X1AllRunnerState } from "../lib/v12-x1-all-runner-state";

const ACK = "I_ACK_V12_BENIGN_ENTRY_GATE_RECOVERY_AFTER_READONLY_ABSENCE";
const SHA = /^[0-9a-f]{40}$/;

function arg(name: string) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function exactSha(value: unknown, label: string) {
    const normalized = String(value || "").trim().toLowerCase();
    if (!SHA.test(normalized)) throw new Error(`V12_BENIGN_GATE_RECOVERY_${label}_SHA_REQUIRED`);
    return normalized;
}

function activePositions(state: V12X1AllRunnerState) {
    return state.activePositions ?? (state.active ? [state.active] : []);
}

export function assertRecoverableV12BenignEntryGateState(state: V12X1AllRunnerState, fromSha: string) {
    if (state.schema !== "v12-x1-all-runner-state/v2") throw new Error("V12_BENIGN_GATE_RECOVERY_V2_STATE_REQUIRED");
    if (String(state.runtimeCommitSha || "").toLowerCase() !== fromSha) throw new Error("V12_BENIGN_GATE_RECOVERY_SOURCE_SHA_MISMATCH");
    if (activePositions(state).length > 0) throw new Error("V12_BENIGN_GATE_RECOVERY_LOCAL_POSITION_PRESENT");
    if (!state.pending || state.pending.action !== "ENTRY" || !state.pending.clientOrderId || !state.pending.symbol) {
        throw new Error("V12_BENIGN_GATE_RECOVERY_ENTRY_PENDING_REQUIRED");
    }
    const manual = String(state.manualReview || "");
    const killReason = String(state.killSwitch?.reason || "");
    if (state.killSwitch?.active !== true || !isV12BenignEntryQuantityGateError(new Error(manual))
        || !isV12BenignEntryQuantityGateError(new Error(killReason))) {
        throw new Error("V12_BENIGN_GATE_RECOVERY_REASON_NOT_EXACT");
    }
    return state.pending;
}

function assertAllV12UnitsStopped() {
    const result = spawnSync("/usr/bin/systemctl", ["list-units", "--all", "--type=service", "--no-legend", "disdex-v12-x1-all@*.service"], { encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error("V12_BENIGN_GATE_RECOVERY_SYSTEMD_CHECK_FAILED");
    const active = String(result.stdout || "").split(/\r?\n/)
        .map((line) => line.trim().split(/\s+/))
        .filter((parts) => parts.length >= 4 && ["active", "activating", "reloading"].includes(parts[2]))
        .map((parts) => parts[0]);
    if (active.length) throw new Error(`V12_BENIGN_GATE_RECOVERY_V12_UNIT_ACTIVE:${active.join(",")}`);
}

async function archive(path: string, bytes: Buffer, label: string, sha: string) {
    const root = resolve(dirname(path), "recovery-archive");
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const target = resolve(root, `${stamp}-${sha.slice(0, 12)}-${label}.json`);
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    return target;
}

async function atomicWrite(path: string, payload: unknown) {
    const temporary = `${path}.benign-entry-recovery.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
}

async function main() {
    if (process.argv.includes("--self-test")) {
        const fromSha = "a".repeat(40);
        const state: V12X1AllRunnerState = {
            schema: "v12-x1-all-runner-state/v2",
            strategyId: "V12_X1.00_ALL",
            mode: "LIVE",
            runtimeCommitSha: fromSha,
            updatedAt: 1,
            pending: {
                idempotencyKey: "v12-entry-test",
                action: "ENTRY",
                clientOrderId: "v12-entry-test",
                symbol: "BTCUSDT",
                side: "LONG",
                quantity: 0.000795,
                signalTs: 1,
                createdAt: 1,
            },
            manualReview: "Quantity 0 is below Aster minQty 0.001 for BTCUSDT.",
            killSwitch: { active: true, reason: "Quantity 0 is below Aster minQty 0.001 for BTCUSDT.", trippedAt: 1 },
        };
        const pending = assertRecoverableV12BenignEntryGateState(state, fromSha);
        if (pending.symbol !== "BTCUSDT") throw new Error("V12_BENIGN_GATE_RECOVERY_SELFTEST_FAILED");
        let rejected = false;
        try {
            assertRecoverableV12BenignEntryGateState({ ...state, manualReview: "Aster exchange info unavailable." }, fromSha);
        } catch {
            rejected = true;
        }
        if (!rejected) throw new Error("V12_BENIGN_GATE_RECOVERY_UNKNOWN_REASON_SELFTEST_FAILED");
        console.log("V12_BENIGN_ENTRY_GATE_RECOVERY_SELFTEST_PASS");
        return;
    }

    const sha = exactSha(arg("--sha"), "TARGET");
    const fromSha = exactSha(arg("--from-sha"), "SOURCE");
    if (arg("--ack") !== ACK) throw new Error("V12_BENIGN_GATE_RECOVERY_ACK_REQUIRED");

    const current = (await readFile("/home/deploy/disdex-trading/current/.disdex-release-sha", "utf8")).trim().toLowerCase();
    if (current !== sha) throw new Error("V12_BENIGN_GATE_RECOVERY_CURRENT_SHA_MISMATCH");
    assertAllV12UnitsStopped();

    const statePath = resolve(process.env.V12_X1_ALL_STATE_PATH || "/var/lib/disdex/v12-x1-all/runner.json");
    const lockPath = resolve(process.env.DISDEX_ACCOUNT_LOCK_PATH || "/var/lib/disdex/shared/account-order.lock");
    const store = new FileV12X1AllRunnerStateStore(statePath, "LIVE");
    const state = await store.load();
    const pending = assertRecoverableV12BenignEntryGateState(state, fromSha);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        readOnlyRateLimitMaxRetries: 0,
        userAgent: `DisDex-V12-Benign-Entry-Gate-Recovery/${sha.slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_BENIGN_GATE_RECOVERY_ASTER_CREDENTIALS_MISSING");

    const lock = new FileAccountOrderLock(lockPath, 120_000);
    const handle = await lock.acquire(`V12_BENIGN_GATE_RECOVERY:${process.pid}`);
    if (!handle) throw new Error("V12_BENIGN_GATE_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
    try {
        const gate = await runAsterReadOnlyRecoveryGate(client, {
            requiredConsecutiveSuccesses: 3,
            requestSpacingMs: 750,
            roundSpacingMs: 5_000,
            requireFlat: false,
        });
        const pendingPositions = await client.getPositions(pending.symbol);
        if (pendingPositions.some((position) =>
            position.symbol.toUpperCase() === pending.symbol.toUpperCase()
            && Math.abs(Number(position.positionAmt)) > 1e-12)) {
            throw new Error("V12_BENIGN_GATE_RECOVERY_PENDING_SYMBOL_POSITION_EXISTS");
        }
        try {
            await client.getOrder(pending.symbol, pending.clientOrderId);
            throw new Error("V12_BENIGN_GATE_RECOVERY_PENDING_ORDER_EXISTS");
        } catch (error) {
            if (!(error instanceof AsterApiError) || error.code !== -2013) throw error;
        }
        const open = await client.getOpenOrders(pending.symbol);
        if (open.some((order) => String(order.clientOrderId || "") === pending.clientOrderId)) {
            throw new Error("V12_BENIGN_GATE_RECOVERY_PENDING_OPEN_ORDER_EXISTS");
        }

        const bytes = await readFile(statePath);
        const stateBackup = await archive(statePath, bytes, "v12-benign-entry-state", fromSha);
        const recovered: V12X1AllRunnerState = {
            ...state,
            schema: "v12-x1-all-runner-state/v2",
            runtimeCommitSha: sha,
            updatedAt: Date.now(),
            active: undefined,
            activePositions: undefined,
            pending: undefined,
            manualReview: undefined,
            killSwitch: undefined,
            lastCompletedIdempotencyKey: pending.idempotencyKey,
            reconciliationStatus: "PASS",
        };
        try {
            await atomicWrite(statePath, recovered);
            await store.load();
        } catch (error) {
            await writeFile(statePath, bytes, { mode: 0o600 }).catch(() => undefined);
            throw error;
        }

        console.log(JSON.stringify({
            status: "V12_BENIGN_ENTRY_GATE_RECOVERY_PASS",
            sha,
            fromSha,
            pendingClientOrderId: pending.clientOrderId,
            pendingSymbol: pending.symbol,
            orderConfirmedAbsent: true,
            stateBackup,
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
        status: "V12_BENIGN_ENTRY_GATE_RECOVERY_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: 0,
        cancelsSent: 0,
        positionChangesSent: 0,
    }));
    process.exitCode = 1;
});
