import "dotenv/config";

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeResult } from "../lib/direct-trade-executor";
import { DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import { disDexV96ConfigFingerprint } from "../lib/disdex-v96-live-gates";
import type { DisDexV96PendingOrder, DisDexV96RunnerState } from "../lib/disdex-v96-runner-state";
import {
    canonicalManagedPositions,
    combinedV96MigrationPaths,
    COMBINED_V96_MIGRATION_ACK,
    sha256File,
    type CombinedV96MigrationManifest,
} from "../lib/disdex-v96-combined-state-migration";

const execFileAsync = promisify(execFile);

function required(name: string) {
    const value = String(process.env[name] || "").trim();
    if (!value) throw new Error(`${name} is required.`);
    return value;
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

async function assertServiceStopped(serviceName: string) {
    try {
        await execFileAsync("systemctl", ["is-active", "--quiet", serviceName]);
        throw new Error(`Existing V96 service is still active: ${serviceName}`);
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("Existing V96 service")) throw error;
        const exitCode = error && typeof error === "object" && "code" in error ? Number((error as { code?: unknown }).code) : NaN;
        if (exitCode !== 3 && exitCode !== 4) throw new Error(`Unable to verify stopped V96 service ${serviceName}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function assertRawState(raw: Partial<DisDexV96RunnerState>) {
    if (raw.strategyId !== DISDEX_V96_STRATEGY_ID) throw new Error(`V96 state strategyId mismatch: ${String(raw.strategyId)}`);
    if (raw.version !== 2) throw new Error(`Only V96 state schema 2 is supported; found ${String(raw.version)}.`);
    if (raw.configFingerprint !== disDexV96ConfigFingerprint()) throw new Error("Existing V96 state fingerprint does not match the combined runner V96 configuration.");
    if (raw.mode !== "live") throw new Error(`Existing V96 state must be live; found ${String(raw.mode)}.`);
    if (raw.bootstrapRequired !== false) throw new Error("Existing V96 state is not established; bootstrapRequired must be false.");
    if (raw.manualReviewReason) throw new Error(`Existing V96 state requires manual review: ${raw.manualReviewReason}`);
    if (!Array.isArray(raw.completedExecutions) || !Array.isArray(raw.failures) || !raw.forwardEvidence) {
        throw new Error("Existing V96 state is incomplete.");
    }
}

function completedFromResult(pending: DisDexV96PendingOrder, result: DirectTradeResult) {
    return {
        idempotencyKey: pending.idempotencyKey,
        clientOrderId: pending.clientOrderId,
        orderId: result.orderId,
        symbol: result.symbol || pending.symbol,
        side: result.side,
        reduceOnly: pending.reduceOnly,
        requestedQuantity: result.requestedQuantity,
        submittedQuantity: result.submittedQuantity,
        executedQuantity: result.executedQuantity,
        averagePrice: result.averagePrice,
        quoteQuantity: result.quoteQuantity,
        status: result.status,
        completedAt: Date.now(),
        referenceTs: pending.referenceTs,
    };
}

async function resolvePending(state: DisDexV96RunnerState, executor: AsterDirectTradeExecutor) {
    const pending = state.pending;
    if (!pending) return "NONE" as const;
    if (pending.phase === "manual_review") throw new Error("Existing V96 pending order is already in manual_review.");
    if (pending.phase === "planned") {
        state.failures = [...state.failures, {
            occurredAt: Date.now(),
            message: "Planned, unsubmitted order was cleared during verified combined-runner migration.",
            idempotencyKey: pending.idempotencyKey,
            symbol: pending.symbol,
        }].slice(-100);
        state.pending = undefined;
        return "PLANNED_DROPPED" as const;
    }
    const result = await executor.reconcileOrder(pending.symbol, pending.clientOrderId);
    if (result.status === "FILLED" && result.executedQuantity > 0 && result.executedQuantity + 1e-12 >= result.submittedQuantity) {
        if (!state.completedExecutions.some((row) => row.idempotencyKey === pending.idempotencyKey)) {
            state.completedExecutions = [...state.completedExecutions, completedFromResult(pending, result)].slice(-500);
        }
        state.lastCompletedIdempotencyKey = pending.idempotencyKey;
        state.pending = undefined;
        return "TERMINAL_RECONCILED" as const;
    }
    if (["CANCELED", "REJECTED", "EXPIRED"].includes(result.status) && result.executedQuantity <= 1e-12) {
        state.failures = [...state.failures, {
            occurredAt: Date.now(),
            message: `Submitted order resolved terminal with ${result.status} and zero fill during migration.`,
            idempotencyKey: pending.idempotencyKey,
            symbol: pending.symbol,
        }].slice(-100);
        state.pending = undefined;
        return "TERMINAL_RECONCILED" as const;
    }
    throw new Error(`Pending V96 order cannot be safely migrated (${result.status}, executed=${result.executedQuantity}).`);
}

export function prepareDestinationState(raw: DisDexV96RunnerState) {
    return {
        ...raw,
        version: 2 as const,
        strategyId: DISDEX_V96_STRATEGY_ID,
        configFingerprint: disDexV96ConfigFingerprint(),
        mode: "live" as const,
        updatedAt: Date.now(),
        lastRunAt: undefined,
        operatorOverride: undefined,
        bootstrapRequired: false,
        manualReviewReason: undefined,
        pending: undefined,
        completedExecutions: raw.completedExecutions.slice(-500),
        failures: raw.failures.slice(-100),
    } satisfies DisDexV96RunnerState;
}

async function main() {
    if (process.argv.includes("--self-test")) {
        const now = Date.now();
        const state = prepareDestinationState({
            version: 2,
            strategyId: DISDEX_V96_STRATEGY_ID,
            configFingerprint: disDexV96ConfigFingerprint(),
            mode: "live",
            updatedAt: now,
            createdAt: now,
            completedExecutions: [],
            failures: [],
            forwardEvidence: { completedDecisionBars: 1, closedLongTrades: 0, closedShortTrades: 0, grossCapBreaches: 0, unknownOrderEvents: 0, stateRecoveryFailures: 0, minimumObservedPenguClip: 1 },
            bootstrapRequired: false,
        });
        if (state.bootstrapRequired || state.pending || state.operatorOverride) throw new Error("Migration self-test failed.");
        console.log("Combined V96 state migration self-test: PASS");
        return;
    }
    if (process.env.DISDEX_V96_COMBINED_MIGRATION_ACKNOWLEDGEMENT !== COMBINED_V96_MIGRATION_ACK) {
        throw new Error(`Migration requires acknowledgement ${COMBINED_V96_MIGRATION_ACK}.`);
    }
    const sourceServiceName = required("DISDEX_V96_SOURCE_SERVICE_NAME");
    await assertServiceStopped(sourceServiceName);
    const sourceRoot = resolve(required("DISDEX_V96_SOURCE_STATE_DIR"));
    const sourceStatePath = resolve(sourceRoot, "runner-live.json");
    const paths = combinedV96MigrationPaths();
    try {
        await stat(paths.manifestPath);
        throw new Error(`Migration manifest already exists: ${paths.manifestPath}`);
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code !== "ENOENT") throw error;
    }
    try {
        await stat(paths.statePath);
        throw new Error(`Combined destination state already exists: ${paths.statePath}`);
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code !== "ENOENT") throw error;
    }
    const sourceText = await readFile(sourceStatePath, "utf8");
    const raw = JSON.parse(sourceText) as DisDexV96RunnerState;
    assertRawState(raw);
    const sourceStateSha256 = createHash("sha256").update(sourceText).digest("hex");
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V96-Combined-Migration/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("Migration requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    const executor = new AsterDirectTradeExecutor(client, {
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const state = structuredClone(raw);
    const pendingResolution = await resolvePending(state, executor);
    const [positions, openOrders] = await Promise.all([client.getPositions(), executor.getOpenOrders()]);
    if (openOrders.length) throw new Error(`Migration requires zero Aster open orders; found ${openOrders.length}.`);
    const managedSymbols = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"]);
    const managedPositions = canonicalManagedPositions(positions.filter((row) => managedSymbols.has(String(row.symbol).toUpperCase())));
    const migrated = prepareDestinationState(state);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${sourceStatePath}.before-combined-${timestamp}.json`;
    await mkdir(dirname(paths.statePath), { recursive: true });
    await copyFile(sourceStatePath, backupPath);
    const temporaryState = `${paths.statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryState, `${JSON.stringify(migrated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryState, paths.statePath);
    const destinationStateSha256 = await sha256File(paths.statePath);
    const accountAddress = required("ASTER_USER_ADDRESS").toLowerCase();
    const migrationId = createHash("sha256").update([sourceStateSha256, destinationStateSha256, accountAddress, JSON.stringify(managedPositions)].join("|")).digest("hex");
    const manifest: CombinedV96MigrationManifest = {
        version: 1,
        strategyId: DISDEX_V96_STRATEGY_ID,
        status: "READY",
        migrationId,
        createdAt: new Date().toISOString(),
        sourceStatePath,
        sourceStateSha256,
        sourceStateUpdatedAt: Number(raw.updatedAt),
        destinationStatePath: paths.statePath,
        destinationStateSha256,
        backupPath,
        pendingResolution,
        asterAccountAddress: accountAddress,
        managedPositions,
        openOrderCount: 0,
        ordersSent: false,
    };
    const temporaryManifest = `${paths.manifestPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryManifest, paths.manifestPath);
    console.log(JSON.stringify({
        status: "DISDEX_V96_COMBINED_STATE_MIGRATION_PASS_NO_ORDERS_SENT",
        migrationId,
        sourceServiceName,
        sourceStatePath,
        destinationStatePath: paths.statePath,
        manifestPath: paths.manifestPath,
        backupPath,
        pendingResolution,
        managedPositions,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "DISDEX_V96_COMBINED_STATE_MIGRATION_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
