import "dotenv/config";

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectPosition } from "../lib/direct-trade-executor";
import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import {
    canonicalManagedPositions,
    COMBINED_V96_POSITION_RECONCILIATION_ACK,
    loadCombinedV96Migration,
    managedPositionSnapshotsMatch,
    sha256File,
    writeCombinedV96PositionReconciliation,
    type CombinedV96PositionReconciliation,
} from "../lib/disdex-v96-combined-state-migration";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";

const execFileAsync = promisify(execFile);
const MANAGED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"]);

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

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

async function assertServiceStopped(serviceName: string) {
    try {
        await execFileAsync("systemctl", ["is-active", "--quiet", serviceName]);
        throw new Error(`V96 service is still active: ${serviceName}`);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("V96 service is still active")) throw error;
        const exitCode = error && typeof error === "object" && "code" in error ? Number((error as { code?: unknown }).code) : NaN;
        if (exitCode !== 3 && exitCode !== 4) {
            throw new Error(`Unable to verify stopped V96 service ${serviceName}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

function managedPositions(positions: DirectPosition[]) {
    return positions.filter((position) => MANAGED_SYMBOLS.has(position.symbol.toUpperCase()));
}

function canonicalDirectPositions(positions: DirectPosition[]) {
    return canonicalManagedPositions(positions.map((position) => ({
        symbol: position.symbol,
        positionAmt: position.quantity,
        positionSide: position.positionSide,
    })));
}

function managedGross(accountWalletBalance: number, positions: DirectPosition[]) {
    const equity = accountWalletBalance + positions.reduce((sum, position) => sum + Number(position.unrealizedPnl || 0), 0);
    if (!Number.isFinite(equity) || equity <= 0) throw new Error("V96 reconciliation account equity is not positive.");
    const grossNotional = managedPositions(positions).reduce((sum, position) => sum + Math.abs(Number(position.notionalUsd || 0)), 0);
    return grossNotional / equity;
}

async function main() {
    if (process.env.DISDEX_V96_POSITION_RECONCILIATION_ACKNOWLEDGEMENT !== COMBINED_V96_POSITION_RECONCILIATION_ACK) {
        throw new Error(`Position reconciliation requires acknowledgement ${COMBINED_V96_POSITION_RECONCILIATION_ACK}.`);
    }
    const serviceName = required("DISDEX_V96_SOURCE_SERVICE_NAME");
    await assertServiceStopped(serviceName);
    const combinedRoot = resolve(required("DISDEX_V13D_V11EQ_V96_COMBINED_STATE_ROOT"));
    const loaded = await loadCombinedV96Migration(combinedRoot);
    if (loaded.reconciliation) {
        console.log(JSON.stringify({
            status: "DISDEX_V96_POSITION_RECONCILIATION_ALREADY_EXISTS",
            reconciliationId: loaded.reconciliation.reconciliationId,
            migrationId: loaded.manifest.migrationId,
            ordersSent: false,
        }));
        return;
    }

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V96-Position-Reconciliation/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("Position reconciliation requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    const accountAddress = required("ASTER_USER_ADDRESS").toLowerCase();
    if (loaded.manifest.asterAccountAddress !== accountAddress) {
        throw new Error("Position reconciliation account does not match the V96 migration manifest.");
    }
    const executor = new AsterDirectTradeExecutor(client);
    const stateStore = new FileDisDexV96RunnerStateStore(loaded.paths.statePath, "live");
    const state = await stateStore.load();
    if (state.pending) throw new Error("V96 position reconciliation cannot proceed while a pending order exists.");
    if (state.manualReviewReason) throw new Error(`V96 state already requires manual review: ${state.manualReviewReason}`);

    const [accountBefore, positionsBefore, openOrdersBefore] = await Promise.all([
        executor.getAccountSnapshot(),
        executor.getPositions(),
        executor.getOpenOrders(),
    ]);
    const actualManagedBefore = canonicalDirectPositions(managedPositions(positionsBefore));
    const legacyRecordedPositions = canonicalManagedPositions(loaded.manifest.managedPositions);
    const grossBefore = managedGross(accountBefore.walletBalance, positionsBefore);
    if (openOrdersBefore.length) {
        state.manualReviewReason = `V96 position reconciliation found ${openOrdersBefore.length} open order(s); automated trading must remain stopped.`;
        await stateStore.save(state);
        throw new Error(state.manualReviewReason);
    }

    const positionsMatch = managedPositionSnapshotsMatch(actualManagedBefore, legacyRecordedPositions);
    if (!positionsMatch && actualManagedBefore.length > 0) {
        state.manualReviewReason = "V96 legacy state and authenticated Aster positions disagree while a real managed position exists; manual review is required and no position was changed.";
        await stateStore.save(state);
        throw new Error(state.manualReviewReason);
    }
    if (!positionsMatch && !boolEnv("DISDEX_V96_POSITION_RECONCILIATION_ALLOW_FLAT", false)) {
        state.manualReviewReason = "V96 legacy state differs from an authenticated flat Aster account; explicit flat reconciliation approval is required.";
        await stateStore.save(state);
        throw new Error(state.manualReviewReason);
    }

    const status: CombinedV96PositionReconciliation["status"] = positionsMatch ? "MATCHED" : "RESOLVED_FLAT";
    const stateShaBefore = await sha256File(loaded.paths.statePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const stateBackupPath = `${loaded.paths.statePath}.before-position-reconciliation-${timestamp}.json`;
    await copyFile(loaded.paths.statePath, stateBackupPath);
    const reconciliationId = createHash("sha256")
        .update([
            loaded.manifest.migrationId,
            stateShaBefore,
            accountAddress,
            JSON.stringify(legacyRecordedPositions),
            JSON.stringify(actualManagedBefore),
        ].join("|"))
        .digest("hex");
    const reconciledAt = new Date().toISOString();
    state.positionReconciliation = {
        reconciliationId,
        migrationId: loaded.manifest.migrationId,
        status,
        reconciledAt,
        legacyRecordedPositions,
        actualPositions: actualManagedBefore,
        openOrderCount: 0,
        grossBefore,
        grossAfter: grossBefore,
        ordersSent: false,
    };
    await stateStore.save(state);

    const [accountAfter, positionsAfter, openOrdersAfter] = await Promise.all([
        executor.getAccountSnapshot(),
        executor.getPositions(),
        executor.getOpenOrders(),
    ]);
    const actualManagedAfter = canonicalDirectPositions(managedPositions(positionsAfter));
    const grossAfter = managedGross(accountAfter.walletBalance, positionsAfter);
    if (openOrdersAfter.length || !managedPositionSnapshotsMatch(actualManagedAfter, actualManagedBefore)) {
        const failed = await stateStore.load();
        failed.manualReviewReason = "Aster positions or open orders changed during V96 reconciliation; manual review is required.";
        await stateStore.save(failed);
        throw new Error(failed.manualReviewReason);
    }
    const finalState = await stateStore.load();
    if (finalState.positionReconciliation) finalState.positionReconciliation.grossAfter = grossAfter;
    await stateStore.save(finalState);
    const stateShaAfter = await sha256File(loaded.paths.statePath);

    const reconciliation: CombinedV96PositionReconciliation = {
        version: 1,
        strategyId: DISDEX_V96_STRATEGY_ID,
        status,
        reconciliationId,
        migrationId: loaded.manifest.migrationId,
        createdAt: reconciledAt,
        reason: status === "RESOLVED_FLAT"
            ? "Authenticated Aster managed positions were flat; stale legacy position metadata was not inherited and no close order was sent."
            : "Authenticated Aster managed positions matched the migration record.",
        asterAccountAddress: accountAddress,
        statePath: loaded.paths.statePath,
        stateShaBefore,
        stateShaAfter,
        stateBackupPath,
        legacyRecordedPositions,
        actualPositionsBefore: actualManagedBefore,
        actualPositionsAfter: actualManagedAfter,
        openOrderCountBefore: openOrdersBefore.length,
        openOrderCountAfter: openOrdersAfter.length,
        managedGrossBefore: grossBefore,
        managedGrossAfter: grossAfter,
        closeUnmanagedPositions: false,
        ordersSent: false,
    };
    const reconciliationPath = await writeCombinedV96PositionReconciliation(reconciliation, combinedRoot);
    console.log(JSON.stringify({
        status: "DISDEX_V96_POSITION_RECONCILIATION_PASS_NO_ORDERS_SENT",
        reconciliationStatus: status,
        reconciliationId,
        migrationId: loaded.manifest.migrationId,
        reconciliationPath,
        stateBackupPath,
        legacyRecordedPositions,
        actualPositionsBefore: actualManagedBefore,
        actualPositionsAfter: actualManagedAfter,
        openOrderCountBefore: openOrdersBefore.length,
        openOrderCountAfter: openOrdersAfter.length,
        managedGrossBefore: grossBefore,
        managedGrossAfter: grossAfter,
        closeUnmanagedPositions: false,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "DISDEX_V96_POSITION_RECONCILIATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
        closeUnmanagedPositions: false,
        ordersSent: false,
    }));
    process.exitCode = 1;
});
