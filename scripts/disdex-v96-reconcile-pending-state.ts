import "dotenv/config";

import assert from "node:assert/strict";
import { copyFile, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeResult } from "../lib/direct-trade-executor";
import { FileDisDexV96RunnerStateStore, type DisDexV96PendingOrder, type DisDexV96RunnerState } from "../lib/disdex-v96-runner-state";

const execFileAsync = promisify(execFile);
const MANAGED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"]);
const PREORDER_BLOCK_REASON = "Fresh V96/V52 pre-order Margin Guard blocked exposure increase";

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function statePath() {
    const root = resolve(required("DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT"));
    return resolve(process.env.DISDEX_V96_STATE_DIR || resolve(root, "crypto-v96"), "runner-live.json");
}

function isReconciliablePreOrderPending(pending: DisDexV96PendingOrder) {
    return pending.phase === "manual_review"
        && pending.reduceOnly === false
        && String(pending.lastError || "").includes(PREORDER_BLOCK_REASON);
}

function isNoFillTerminal(result: DirectTradeResult) {
    if (["CANCELED", "REJECTED", "EXPIRED"].includes(result.status)) return result.executedQuantity <= 1e-12;
    // A missing order is safe only when the authenticated lookup explicitly
    // reports a not-found condition. Network/auth ambiguity remains blocked.
    return result.status === "UNKNOWN"
        && /not found|does not exist|unknown order|order.*(404|2013)/i.test(String(result.error || ""));
}

async function assertStopped(serviceName: string) {
    try {
        await execFileAsync("systemctl", ["is-active", "--quiet", serviceName]);
        throw new Error(`Service must remain stopped: ${serviceName}`);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Service must remain stopped")) throw error;
        const code = error && typeof error === "object" && "code" in error ? Number((error as { code?: unknown }).code) : NaN;
        if (code !== 3 && code !== 4) throw new Error(`Unable to verify stopped service: ${serviceName}`);
    }
}

function makeClient() {
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: Number(process.env.ASTER_REQUEST_TIMEOUT_MS) || 10_000,
        recvWindowMs: Number(process.env.ASTER_RECV_WINDOW_MS) || 5000,
        userAgent: "DisDex-V96-Pending-Reconciliation/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("Authenticated Aster credentials are required.");
    return new AsterDirectTradeExecutor(client, { reconciliationAttempts: 3, reconciliationDelayMs: 1000 });
}

export function preparePendingReconciliation(state: DisDexV96RunnerState, now = Date.now()) {
    const pending = state.pending;
    if (!pending || !isReconciliablePreOrderPending(pending)) return undefined;
    return {
        ...state,
        pending: undefined,
        manualReviewReason: undefined,
        failures: [...state.failures, {
            occurredAt: now,
            message: "Formal reconciliation cleared a pre-order Margin Guard-blocked pending state; authenticated order lookup showed no fill and no order was sent.",
            idempotencyKey: pending.idempotencyKey,
            symbol: pending.symbol,
        }].slice(-100),
    };
}

async function main() {
    if (process.argv.includes("--self-test")) {
        const pending = {
            idempotencyKey: "x",
            clientOrderId: "x",
            phase: "manual_review" as const,
            symbol: "SOLUSDT",
            side: "BUY" as const,
            requestedQuantity: 1,
            normalizedQuantity: 1,
            reduceOnly: false,
            expectedPrice: 1,
            targetWeight: 0.1,
            targetNotionalUsd: 1,
            deltaNotionalUsd: 1,
            referenceTs: 1,
            createdAt: 1,
            updatedAt: 1,
            retryCount: 3,
            reason: "test",
            lastError: `${PREORDER_BLOCK_REASON}: blocked before submission`,
        } satisfies DisDexV96PendingOrder;
        assert.equal(isReconciliablePreOrderPending(pending), true);
        assert.equal(isNoFillTerminal({ status: "CANCELED", executedQuantity: 0 } as DirectTradeResult), true);
        assert.equal(isNoFillTerminal({ status: "FILLED", executedQuantity: 0 } as DirectTradeResult), false);
        assert.equal(isNoFillTerminal({ status: "UNKNOWN", executedQuantity: 0, error: "network timeout" } as DirectTradeResult), false);
        const state = {
            pending,
            failures: [],
        } as unknown as DisDexV96RunnerState;
        const prepared = preparePendingReconciliation(state, 2);
        assert.equal(prepared?.pending, undefined);
        assert.equal(prepared?.failures.length, 1);
        console.log("V96 pending pre-order reconciliation self-test: PASS");
        return;
    }

    const serviceName = required("DISDEX_V96_SOURCE_SERVICE_NAME");
    await assertStopped(serviceName);
    const path = statePath();
    const store = new FileDisDexV96RunnerStateStore(path, "live");
    const state = await store.load();
    const pending = state.pending;
    if (!pending) {
        console.log(JSON.stringify({ status: "NO_PENDING_STATE", ordersSent: false, positionChangesSent: false }));
        return;
    }
    if (!isReconciliablePreOrderPending(pending)) {
        throw new Error("Pending state is not an authenticated pre-order Margin Guard block; manual review remains required.");
    }
    if (state.manualReviewReason
        && !state.manualReviewReason.includes(pending.idempotencyKey)
        && !state.manualReviewReason.includes(PREORDER_BLOCK_REASON)) {
        throw new Error("V96 state contains an unrelated manual-review reason; pending reconciliation remains blocked.");
    }

    const executor = makeClient();
    const result = await executor.reconcileOrder(pending.symbol, pending.clientOrderId);
    const [positions, openOrders] = await Promise.all([executor.getPositions(), executor.getOpenOrders()]);
    const managedPositions = positions.filter((position) => MANAGED_SYMBOLS.has(position.symbol.toUpperCase()));
    const managedOpenOrders = openOrders.filter((order) => MANAGED_SYMBOLS.has(order.symbol.toUpperCase()));
    if (!isNoFillTerminal(result)) throw new Error("Authenticated order lookup was not a terminal zero-fill/not-found result.");
    if (managedPositions.length || managedOpenOrders.length) throw new Error("Authenticated Aster account is not flat; pending state remains unchanged.");

    const raw = await readFile(path, "utf8");
    const backup = `${path}.before-pending-reconciliation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await copyFile(path, backup);
    const prepared = preparePendingReconciliation(state);
    if (!prepared) throw new Error("Pending state changed during reconciliation; manual review remains required.");
    await store.save(prepared);
    const verified = await store.load();
    if (verified.pending) throw new Error("Pending state remained after formal reconciliation.");
    console.log(JSON.stringify({
        status: "DISDEX_V96_PENDING_RECONCILIATION_PASS_NO_ORDERS_SENT",
        statePath: path,
        backupPath: backup,
        priorStateBytes: Buffer.byteLength(raw, "utf8"),
        orderLookupStatus: result.status,
        managedPositions: managedPositions.length,
        managedOpenOrders: managedOpenOrders.length,
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_PENDING_RECONCILIATION_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        cancelSent: false,
        positionChangesSent: false,
    }));
    process.exitCode = 1;
});
