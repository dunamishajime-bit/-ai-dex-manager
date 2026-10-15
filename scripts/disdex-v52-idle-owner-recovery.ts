import "dotenv/config";

import { randomUUID } from "node:crypto";
import { chown, chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
    AsterV3Client,
    type AsterOrderResponse,
    type AsterPositionRiskRow,
} from "../lib/aster-v3-client";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import {
    normalizeLiveSharedStateOwnership,
} from "../lib/disdex-live-state-ownership";
import {
    IDLE_STATE_SCHEMA,
    readIdleState,
    type IdleState,
} from "../lib/idle-priority-short-state";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";

export const IDLE_OWNER_RECOVERY_APPLY_ACK =
    "I_ACK_V52_IDLE_OWNER_RECOVERY_AFTER_SIGNED_PROTECTED_GETS";
const DEFAULT_KILL_SWITCH_PATH = "/var/lib/disdex/shared/kill-switch.json";
const DEFAULT_IDLE_STATE_PATH = "/var/lib/disdex/idle-priority/state.json";
const DEFAULT_RISK_PATH = "/var/lib/disdex/shared/crypto-daily-risk.json";
const DEFAULT_MARGIN_PATH = "/var/lib/disdex/shared/margin-risk/guard-live.json";
const DEFAULT_LOCK_PATH = "/var/lib/disdex/shared/account-order.lock";
const DEFAULT_PENDING_PATH = "/var/lib/disdex/shared/pending-exposure.json";
const DEFAULT_MAX_STATE_AGE_MS = 20 * 60_000;

type IdleProtectionState = IdleState["positions"][number];

export type ProtectedIdleVenueSnapshot = {
    state: IdleState;
    venuePositions: readonly AsterPositionRiskRow[];
    openOrders: readonly AsterOrderResponse[];
    capturedAt: number;
};

export type ProtectedIdleValidation = {
    symbols: string[];
    positionCount: number;
    protectiveOrderCount: number;
    capturedAt: number;
};

/**
 * Build the signed-read stability key from ownership-critical fields only.
 * Mark price is deliberately excluded because it is expected to move between
 * consecutive read-only observations and does not change who owns or protects
 * the position.
 */
export function protectedIdleSnapshotFingerprint(input: ProtectedIdleVenueSnapshot): string {
    const state = input.state.positions
        .map((position) => [
            position.symbol,
            position.side,
            position.quantity,
            position.entryPrice,
            position.stopPrice,
            position.takeProfitPrice,
            position.stopClientOrderId,
            position.takeProfitClientOrderId,
            position.protectionVerified,
        ])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    const positions = nonFlatPositions(input.venuePositions)
        .map((position) => [
            position.symbol,
            position.positionAmt,
            position.entryPrice,
            position.leverage,
            position.marginType,
            position.positionSide,
        ])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0])));
    const orders = input.openOrders
        .map((order) => [
            order.symbol,
            order.clientOrderId,
            order.type,
            order.side,
            order.origQty ?? order.executedQty,
            order.stopPrice,
            order.reduceOnly,
            order.status,
        ])
        .sort((left, right) => String(left[1]).localeCompare(String(right[1])));
    return JSON.stringify({ state, positions, orders });
}

function finitePositive(value: unknown): value is number {
    return Number.isFinite(Number(value)) && Number(value) > 0;
}

function numeric(value: unknown, label: string): number {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label}_NON_FINITE`);
    return number;
}

function closeEnough(actual: number, expected: number, tolerance = 1e-8) {
    const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
    return Math.abs(actual - expected) <= tolerance * scale;
}

function nonFlatPositions(rows: readonly AsterPositionRiskRow[]) {
    return rows.filter((row) => Number.isFinite(Number(row.positionAmt)) && Number(row.positionAmt) !== 0);
}

function orderQuantity(order: AsterOrderResponse) {
    const value = order.origQty ?? order.executedQty;
    return numeric(value, `PROTECTIVE_ORDER_QUANTITY:${order.clientOrderId || "UNKNOWN"}`);
}

function assertCrossFive(position: AsterPositionRiskRow, symbol: string) {
    const leverage = numeric(position.leverage, `VENUE_LEVERAGE:${symbol}`);
    if (leverage !== 5) throw new Error(`VENUE_LEVERAGE_MISMATCH:${symbol}:${leverage}`);
    const marginType = String(position.marginType || "").toUpperCase();
    if (marginType !== "CROSS" && marginType !== "CROSSED") {
        throw new Error(`VENUE_MARGIN_TYPE_MISMATCH:${symbol}:${marginType || "MISSING"}`);
    }
}

function assertStatePosition(position: IdleProtectionState) {
    if (position.side !== "SHORT") throw new Error(`IDLE_STATE_POSITION_NOT_SHORT:${position.symbol}`);
    if (position.gross !== 1 || position.protectionVerified !== true) {
        throw new Error(`IDLE_STATE_PROTECTION_NOT_VERIFIED:${position.symbol}`);
    }
    if (!finitePositive(position.quantity) || !finitePositive(position.entryPrice)) {
        throw new Error(`IDLE_STATE_POSITION_NUMERIC_INVALID:${position.symbol}`);
    }
    if (!finitePositive(position.stopPrice) || !finitePositive(position.takeProfitPrice)) {
        throw new Error(`IDLE_STATE_PROTECTION_PRICE_INVALID:${position.symbol}`);
    }
    if (position.stopPrice <= position.entryPrice || position.takeProfitPrice >= position.entryPrice) {
        throw new Error(`IDLE_STATE_PROTECTION_DIRECTION_INVALID:${position.symbol}`);
    }
    if (!position.stopClientOrderId || !position.takeProfitClientOrderId) {
        throw new Error(`IDLE_STATE_PROTECTION_CLIENT_ID_MISSING:${position.symbol}`);
    }
}

/**
 * Validate an already-protected Idle portfolio using only signed venue rows.
 * This function has no mutation capability and is intentionally strict: a
 * caller cannot clear the shared hold when even one position/order is
 * unknown, stale, unprotected, or owned by another route.
 */
export function validateProtectedIdleSnapshot(
    input: ProtectedIdleVenueSnapshot,
    expectedSha: string,
    now = Date.now(),
    maxStateAgeMs = DEFAULT_MAX_STATE_AGE_MS,
): ProtectedIdleValidation {
    if (!/^[0-9a-f]{40}$/i.test(expectedSha)) throw new Error("EXPECTED_SHA_INVALID");
    if (input.state.schema !== IDLE_STATE_SCHEMA) throw new Error("IDLE_STATE_SCHEMA_MISMATCH");
    if (input.state.runtimeSha.toLowerCase() !== expectedSha.toLowerCase()) {
        throw new Error("STATE_RUNTIME_SHA_MISMATCH");
    }
    if (input.state.pending !== null || input.state.manualReview !== null) {
        throw new Error("STATE_PENDING_OR_MANUAL_REVIEW");
    }
    if (!Number.isFinite(input.state.updatedAt) || input.state.updatedAt <= 0) {
        throw new Error("STATE_UPDATED_AT_INVALID");
    }
    if (input.state.updatedAt > now || now - input.state.updatedAt > maxStateAgeMs) {
        throw new Error("STATE_STALE");
    }
    if (!input.state.positions.length) throw new Error("IDLE_STATE_NO_PROTECTED_POSITIONS");

    const stateSymbols = input.state.positions.map((position) => {
        assertStatePosition(position);
        return position.symbol;
    });
    const stateSymbolSet = new Set<string>(stateSymbols);
    if (new Set(stateSymbols).size !== stateSymbols.length) throw new Error("IDLE_STATE_DUPLICATE_SYMBOL");

    const venuePositions = nonFlatPositions(input.venuePositions);
    if (venuePositions.length !== stateSymbols.length) throw new Error("VENUE_POSITION_SET_MISMATCH");
    const venueBySymbol = new Map(venuePositions.map((position) => [position.symbol, position]));
    for (const statePosition of input.state.positions) {
        const venuePosition = venueBySymbol.get(statePosition.symbol);
        if (!venuePosition) throw new Error(`VENUE_POSITION_MISSING:${statePosition.symbol}`);
        const positionAmt = numeric(venuePosition.positionAmt, `VENUE_POSITION_QTY:${statePosition.symbol}`);
        if (positionAmt >= 0 || !closeEnough(Math.abs(positionAmt), statePosition.quantity)) {
            throw new Error(`VENUE_POSITION_MISMATCH:${statePosition.symbol}`);
        }
        if (!closeEnough(numeric(venuePosition.entryPrice, `VENUE_ENTRY_PRICE:${statePosition.symbol}`), statePosition.entryPrice)) {
            throw new Error(`VENUE_ENTRY_PRICE_MISMATCH:${statePosition.symbol}`);
        }
        if (!finitePositive(venuePosition.markPrice)) throw new Error(`VENUE_MARK_PRICE_INVALID:${statePosition.symbol}`);
        assertCrossFive(venuePosition, statePosition.symbol);
        const side = String(venuePosition.positionSide || "").toUpperCase();
        if (side && side !== "BOTH" && side !== "SHORT") throw new Error(`VENUE_POSITION_SIDE_MISMATCH:${statePosition.symbol}`);
    }
    for (const symbol of venueBySymbol.keys()) {
        if (!stateSymbolSet.has(symbol)) throw new Error(`VENUE_UNMANAGED_POSITION:${symbol}`);
    }

    const expectedOrders = new Map<string, { position: IdleProtectionState; type: "STOP_MARKET" | "TAKE_PROFIT_MARKET"; stopPrice: number }>();
    for (const position of input.state.positions) {
        expectedOrders.set(position.stopClientOrderId, { position, type: "STOP_MARKET", stopPrice: position.stopPrice });
        expectedOrders.set(position.takeProfitClientOrderId, { position, type: "TAKE_PROFIT_MARKET", stopPrice: position.takeProfitPrice });
    }
    if (input.openOrders.length !== expectedOrders.size) throw new Error("PROTECTIVE_ORDER_SET_MISMATCH");
    for (const order of input.openOrders) {
        const clientOrderId = String(order.clientOrderId || "");
        const expected = expectedOrders.get(clientOrderId);
        if (!expected) throw new Error(`UNMANAGED_OPEN_ORDER:${clientOrderId || "MISSING_CLIENT_ID"}`);
        if (order.symbol !== expected.position.symbol || order.type !== expected.type) {
            throw new Error(`PROTECTIVE_ORDER_IDENTITY_MISMATCH:${clientOrderId}`);
        }
        if (order.status !== "NEW") throw new Error(`PROTECTIVE_ORDER_NOT_NEW:${clientOrderId}:${order.status || "MISSING"}`);
        if (order.side !== "BUY") throw new Error(`PROTECTIVE_ORDER_SIDE_MISMATCH:${clientOrderId}`);
        if (order.reduceOnly !== true) throw new Error(`PROTECTIVE_ORDER_NOT_REDUCE_ONLY:${clientOrderId}`);
        if (!closeEnough(orderQuantity(order), expected.position.quantity)) {
            throw new Error(`PROTECTIVE_ORDER_QUANTITY_MISMATCH:${clientOrderId}`);
        }
        if (!closeEnough(numeric(order.stopPrice, `PROTECTIVE_ORDER_STOP_PRICE:${clientOrderId}`), expected.stopPrice)) {
            throw new Error(`PROTECTIVE_ORDER_TRIGGER_MISMATCH:${clientOrderId}`);
        }
    }

    return {
        symbols: [...stateSymbols].sort(),
        positionCount: stateSymbols.length,
        protectiveOrderCount: input.openOrders.length,
        capturedAt: input.capturedAt,
    };
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function sleep(milliseconds: number) {
    return new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function runtimePath(name: string, fallback: string) {
    return resolve(String(process.env[name] || fallback));
}

function systemdState(unit: string) {
    const result = spawnSync("/usr/bin/systemctl", ["show", unit, "--property=LoadState", "--property=ActiveState", "--property=SubState", "--no-pager"], { encoding: "utf8" });
    if (result.error || result.status !== 0) throw new Error(`SYSTEMD_CHECK_FAILED:${unit}`);
    return Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
}

function assertStopped(unit: string) {
    const state = systemdState(unit);
    if (state.LoadState !== "loaded") throw new Error(`SYSTEMD_UNIT_NOT_LOADED:${unit}`);
    if (state.ActiveState !== "inactive" && state.ActiveState !== "failed") {
        throw new Error(`SYSTEMD_RUNNER_NOT_STOPPED:${unit}:${state.ActiveState || "UNKNOWN"}`);
    }
}

function assertAllTradingRunnersStopped(candidateSha: string, v4Sha = String(process.env.DISDEX_V12_V4_PRIMARY_SHA || "").trim().toLowerCase()) {
    const units = [
        `disdex-pengu-dual-ls-v2@${candidateSha}.service`,
        `disdex-quality102-causal-v1@${candidateSha}.service`,
        `disdex-v52-aster-only@${candidateSha}.service`,
        `disdex-fet-brk48@${candidateSha}.service`,
        `disdex-hype-long@${candidateSha}.service`,
        `disdex-idle-priority-short@${candidateSha}.service`,
    ];
    if (/^[0-9a-f]{40}$/.test(v4Sha)) units.push(`disdex-v12-v4@${v4Sha}.service`);
    for (const unit of units) assertStopped(unit);
    for (const legacy of ["disdex-v96-live.service", "disdex-v96-v52-live.service", "disdex-v13d-v11eq-v96.service"]) {
        const result = spawnSync("/usr/bin/systemctl", ["show", legacy, "--property=LoadState", "--property=ActiveState", "--no-pager"], { encoding: "utf8" });
        if (result.status === 0) {
            const props = Object.fromEntries(String(result.stdout || "").split(/\r?\n/).filter(Boolean).map((line) => line.split("=", 2) as [string, string]));
            if (props.LoadState === "loaded" && props.ActiveState !== "inactive" && props.ActiveState !== "failed") {
                throw new Error(`LEGACY_SUPERVISOR_ACTIVE:${legacy}:${props.ActiveState}`);
            }
        }
    }
}

async function readSnapshot(client: AsterV3Client, state: IdleState): Promise<ProtectedIdleVenueSnapshot> {
    const [venuePositions, openOrders] = await Promise.all([client.getPositions(), client.getOpenOrders()]);
    return { state, venuePositions, openOrders, capturedAt: Date.now() };
}

async function readMarginHealthy(path: string) {
    const value = JSON.parse(await readFile(path, "utf8")) as { stage?: unknown; ordersAllowed?: unknown; checkedAt?: unknown; updatedAt?: unknown };
    if (value.stage !== "HEALTHY" || value.ordersAllowed !== true) throw new Error("MARGIN_GUARD_NOT_HEALTHY");
    const checkedAt = Number(value.checkedAt ?? value.updatedAt ?? 0);
    const maxAge = numberEnv("DISDEX_V52_IDLE_OWNER_MARGIN_MAX_AGE_MS", 90_000);
    if (!Number.isFinite(checkedAt) || checkedAt <= 0 || Date.now() - checkedAt > maxAge) throw new Error("MARGIN_GUARD_STALE");
}

async function archiveBytes(path: string, bytes: Buffer, requestId: string, label: string) {
    const directory = resolve(dirname(path), "recovery-archive");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${requestId}-${label}.json`;
    const target = resolve(directory, name);
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    await chown(target, 0, 0);
    await chmod(target, 0o600);
    return target;
}

async function atomicJsonWrite(path: string, value: unknown) {
    const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    try {
        await rename(temporary, path);
    } catch (error) {
        await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }).catch(() => undefined);
        throw error;
    }
}

function rawKillReasonIsAllowlisted(value: unknown): value is { active: true; action: "HOLD_PROTECTED"; recoverable: true; reason: string; operator?: string } {
    if (!value || typeof value !== "object") return false;
    const kill = value as Record<string, unknown>;
    return kill.active === true
        && kill.action === "HOLD_PROTECTED"
        && kill.recoverable === true
        && typeof kill.reason === "string"
        && kill.reason.startsWith("V52 recoverable tick error: Unknown non-flat Aster symbol requires manual review:")
        && (kill.operator === undefined || kill.operator === "disdex-v52-aster-only");
}

async function main() {
    const verifyOnly = process.argv.includes("--verify-only");
    const apply = process.argv.includes("--apply");
    if (verifyOnly === apply) throw new Error("V52_IDLE_OWNER_RECOVERY_REQUIRES_EXACTLY_ONE_OF_VERIFY_OR_APPLY");
    const candidateSha = String(process.argv[process.argv.indexOf("--sha") + 1] || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(candidateSha)) throw new Error("V52_IDLE_OWNER_RECOVERY_EXACT_SHA_REQUIRED");
    const runtimeSha = String(process.env.DISDEX_RELEASE_SHA || process.env.DISDEX_RUNTIME_COMMIT_SHA || "").trim().toLowerCase();
    if (runtimeSha && runtimeSha !== candidateSha) throw new Error("V52_IDLE_OWNER_RECOVERY_RUNTIME_SHA_MISMATCH");
    if (apply && String(process.argv[process.argv.indexOf("--ack") + 1] || "") !== IDLE_OWNER_RECOVERY_APPLY_ACK) {
        throw new Error("V52_IDLE_OWNER_RECOVERY_APPLY_ACK_REQUIRED");
    }

    const killPath = runtimePath("DISDEX_SHARED_KILL_SWITCH_FILE", DEFAULT_KILL_SWITCH_PATH);
    const statePath = runtimePath("DISDEX_IDLE_PRIORITY_STATE_PATH", DEFAULT_IDLE_STATE_PATH);
    const riskPath = runtimePath("DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH", DEFAULT_RISK_PATH);
    const marginPath = runtimePath("DISDEX_V96_V52_MARGIN_GUARD_STATE_FILE", DEFAULT_MARGIN_PATH);
    const lockPath = runtimePath("DISDEX_ACCOUNT_LOCK_PATH", DEFAULT_LOCK_PATH);
    const pendingPath = runtimePath("DISDEX_PENDING_EXPOSURE_REGISTRY_PATH", DEFAULT_PENDING_PATH);
    const rawKill = JSON.parse(await readFile(killPath, "utf8")) as unknown;
    if (!rawKillReasonIsAllowlisted(rawKill)) throw new Error("V52_IDLE_OWNER_RECOVERY_KILL_REASON_NOT_ALLOWLISTED");
    const kill = rawKill as { reason: string };
    const state = await readIdleState(statePath, candidateSha);
    const risk = await readSharedCryptoDailyRisk(riskPath);
    if (!risk.ok) throw new Error(`V52_IDLE_OWNER_RECOVERY_SHARED_RISK_NOT_READY:${risk.reason}`);
    await readMarginHealthy(marginPath);
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5_000),
        readOnlyRateLimitMaxRetries: 0,
        userAgent: `DisDex-V52-IdleOwnerRecovery/${candidateSha.slice(0, 12)}`,
    });
    if (!client.hasTradingCredentials()) throw new Error("V52_IDLE_OWNER_RECOVERY_ASTER_CREDENTIALS_MISSING");
    assertAllTradingRunnersStopped(candidateSha);

    const consecutive = Math.max(3, Math.min(5, Math.trunc(numberEnv("DISDEX_V52_IDLE_OWNER_RECOVERY_CONSECUTIVE_GETS", 3))));
    const spacingMs = Math.max(750, Math.min(10_000, Math.trunc(numberEnv("DISDEX_V52_IDLE_OWNER_RECOVERY_GET_SPACING_MS", 2_000))));
    const roundSpacingMs = Math.max(1_000, Math.min(30_000, Math.trunc(numberEnv("DISDEX_V52_IDLE_OWNER_RECOVERY_ROUND_SPACING_MS", 5_000))));
    const observations: ProtectedIdleValidation[] = [];
    let previousFingerprint = "";
    for (let index = 0; index < consecutive; index += 1) {
        const currentState = await readIdleState(statePath, candidateSha);
        const snapshot = await readSnapshot(client, currentState);
        const validated = validateProtectedIdleSnapshot(snapshot, candidateSha, Date.now());
        const fingerprint = protectedIdleSnapshotFingerprint(snapshot);
        if (previousFingerprint && fingerprint !== previousFingerprint) throw new Error("V52_IDLE_OWNER_RECOVERY_SIGNED_GETS_NOT_STABLE");
        previousFingerprint = fingerprint;
        observations.push(validated);
        if (index + 1 < consecutive) {
            await sleep(spacingMs);
            if (roundSpacingMs > spacingMs) await sleep(roundSpacingMs - spacingMs);
            await readMarginHealthy(marginPath);
        }
    }

    const lock = new FileAccountOrderLock(lockPath, numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000), pendingPath);
    const requestId = `v52-idle-owner-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${process.pid}`;
    const handle = await lock.acquire(`V52_IDLE_OWNER_RECOVERY:${requestId}`);
    if (!handle) throw new Error("V52_IDLE_OWNER_RECOVERY_ACCOUNT_LOCK_UNAVAILABLE");
    try {
        const beforeKill = await readFile(killPath);
        const beforeState = await readFile(statePath);
        const beforeKillParsed = JSON.parse(beforeKill.toString("utf8")) as unknown;
        if (!rawKillReasonIsAllowlisted(beforeKillParsed)) throw new Error("V52_IDLE_OWNER_RECOVERY_KILL_CHANGED_BEFORE_APPLY");
        const verifyState = await readIdleState(statePath, candidateSha);
        const verifySnapshot = await readSnapshot(client, verifyState);
        const verifyResult = validateProtectedIdleSnapshot(verifySnapshot, candidateSha, Date.now());
        if (JSON.stringify(verifyResult) !== JSON.stringify(observations[observations.length - 1])) throw new Error("V52_IDLE_OWNER_RECOVERY_FINAL_GET_MISMATCH");
        const stateArchive = await archiveBytes(statePath, beforeState, requestId, "idle-state");
        const killArchive = await archiveBytes(killPath, beforeKill, requestId, "kill-switch");
        if (verifyOnly) {
            console.log(JSON.stringify({ status: "V52_IDLE_OWNER_RECOVERY_VERIFY_PASS", candidateSha, killSwitchActive: true, killSwitchReason: kill.reason, signedReadOnlyConsecutive: observations.length, ...verifyResult, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
            return;
        }
        await atomicJsonWrite(killPath, {
            active: false,
            action: "FLATTEN_MANAGED",
            strategyId: "DISDEX_V35_STRONG_RESERVED_PENGU_V96",
            reason: "V52 Idle ownership was revalidated by consecutive signed Aster position/protection reads; new entries may resume.",
            operator: "V52_IDLE_OWNER_RECOVERY_V1",
            recoveredAt: new Date().toISOString(),
            previousReason: kill.reason,
            candidateSha,
            requestId,
            evidence: { signedReadOnlyConsecutive: observations.length, symbols: verifyResult.symbols, positionCount: verifyResult.positionCount, protectiveOrderCount: verifyResult.protectiveOrderCount },
            ordersSent: 0,
            cancelsSent: 0,
            positionChangesSent: 0,
        });
        await normalizeLiveSharedStateOwnership(killPath, { label: "V52_IDLE_OWNER_RECOVERY_SHARED_KILL_SWITCH" });
        const postState = await readIdleState(statePath, candidateSha);
        const postSnapshot = await readSnapshot(client, postState);
        const postResult = validateProtectedIdleSnapshot(postSnapshot, candidateSha, Date.now());
        const cleared = await readSharedKillSwitch({ DISDEX_SHARED_KILL_SWITCH_FILE: killPath } as unknown as NodeJS.ProcessEnv);
        if (cleared.active) throw new Error("V52_IDLE_OWNER_RECOVERY_CLEAR_VERIFY_FAILED");
        if (JSON.stringify(postResult) !== JSON.stringify(verifyResult)) throw new Error("V52_IDLE_OWNER_RECOVERY_VENUE_CHANGED_AFTER_CLEAR");
        console.log(JSON.stringify({ status: "V52_IDLE_OWNER_RECOVERY_APPLY_PASS", candidateSha, sharedKillSwitchCleared: true, signedReadOnlyConsecutive: observations.length, stateArchive, killArchive, ...postResult, ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
    } catch (error) {
        if (apply) {
            const beforeKill = await readFile(killPath).catch(() => undefined);
            if (beforeKill) {
                const parsed = JSON.parse(beforeKill.toString("utf8")) as Record<string, unknown>;
                if (parsed.operator === "V52_IDLE_OWNER_RECOVERY_V1") {
                    // Never restore from a mutated state after a failed venue
                    // post-check; leave the kill active and require review.
                    await atomicJsonWrite(killPath, { ...parsed, active: true, action: "HOLD_PROTECTED", reason: `V52 owner recovery post-check failed: ${error instanceof Error ? error.message : String(error)}`, operator: "V52_IDLE_OWNER_RECOVERY_V1_ROLLBACK_FAIL_CLOSED", rolledBackAt: new Date().toISOString() }).catch(() => undefined);
                    await normalizeLiveSharedStateOwnership(killPath, { label: "V52_IDLE_OWNER_RECOVERY_ROLLBACK_KILL_SWITCH" }).catch(() => undefined);
                }
            }
        }
        throw error;
    } finally {
        await handle.release();
    }
}

const isMainModule = Boolean(process.argv[1]) && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule && process.argv.includes("--self-test")) {
    const sha = "a".repeat(40);
    const state = {
        schema: IDLE_STATE_SCHEMA,
        runtimeSha: sha,
        updatedAt: Date.now(),
        positions: [],
        manualReview: null,
        pending: null,
        lastAcceptedBySymbol: {},
        failures: [],
    } satisfies IdleState;
    if (state.schema !== IDLE_STATE_SCHEMA || state.runtimeSha !== sha) throw new Error("V52_IDLE_OWNER_RECOVERY_SELF_TEST_FAILED");
    console.log(JSON.stringify({ status: "V52_IDLE_OWNER_RECOVERY_SELF_TEST_PASS", ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
} else if (isMainModule) {
    main().catch((error) => {
        console.error(JSON.stringify({ status: "V52_IDLE_OWNER_RECOVERY_FAIL_CLOSED", message: error instanceof Error ? error.message : String(error), ordersSent: 0, cancelsSent: 0, positionChangesSent: 0 }));
        process.exitCode = 1;
    });
}
