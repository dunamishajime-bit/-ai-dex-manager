import "dotenv/config";

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { resolveV12X1AllRuntime } from "../config/v12X1AllRuntime";
import { V12_X1_ALL } from "../config/v12X1AllRuntime";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { reconcileV12Protection } from "../lib/v12-resident-stop-lifecycle";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

const V96_CORE_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"]);
const EPS = 1e-12;

function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }
function actualSide(position: { quantity: number; positionSide: string }) {
    if (position.positionSide === "LONG") return "LONG" as const;
    if (position.positionSide === "SHORT") return "SHORT" as const;
    return position.quantity < 0 ? "SHORT" as const : "LONG" as const;
}

type AsterCredentialName = "ASTER_FUTURES_BASE_URL" | "ASTER_USER_ADDRESS" | "ASTER_API_PRIVATE_KEY";
const ASTER_CREDENTIAL_NAMES: AsterCredentialName[] = ["ASTER_FUTURES_BASE_URL", "ASTER_USER_ADDRESS", "ASTER_API_PRIVATE_KEY"];

function systemdAsterCredentials(): Partial<Record<AsterCredentialName, string>> {
    const dir = String(process.env.CREDENTIALS_DIRECTORY || "").trim();
    if (!dir) return {};
    let raw: string;
    try { raw = readFileSync(join(dir, "aster-env"), "utf8"); } catch { return {}; }
    const result: Partial<Record<AsterCredentialName, string>> = {};
    for (const line of raw.split(/\r?\n/)) {
        for (const name of ASTER_CREDENTIAL_NAMES) {
            const prefix = `${name}=`;
            if (!line.startsWith(prefix)) continue;
            let value = line.slice(prefix.length).trim();
            if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1);
            if (value) result[name] = value;
        }
    }
    return result;
}

async function main() {
    const v12 = resolveV12X1AllRuntime();
    const systemdCredentials = systemdAsterCredentials();
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL?.trim() || systemdCredentials.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS?.trim() || systemdCredentials.ASTER_USER_ADDRESS,
        privateKey: (process.env.ASTER_API_PRIVATE_KEY?.trim() || systemdCredentials.ASTER_API_PRIVATE_KEY) as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V96-Stop-Recheck/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("V96_STOP_RECHECK_REQUIRES_ASTER_CREDENTIALS");

    const stateStore = new FileV12X1AllRunnerStateStore(v12.statePath, "LIVE");
    const [state, risk, sharedKillSwitch, _ping, positions, openOrders] = await Promise.all([
        stateStore.load(),
        readSharedCryptoDailyRisk(v12.riskPath),
        readSharedKillSwitch(),
        client.ping(),
        client.getPositions(),
        client.getOpenOrders(),
    ]);
    void _ping;

    if (!risk.ok) throw new Error(`V96_STOP_RECHECK_SHARED_RISK_INVALID:${risk.reason}`);
    if (sharedKillSwitch.active) throw new Error(`V96_STOP_RECHECK_SHARED_KILL_SWITCH_ACTIVE:${sharedKillSwitch.reason || "UNSPECIFIED"}`);
    if (state.pending) throw new Error(`V96_STOP_RECHECK_V12_PENDING:${state.pending.clientOrderId}`);
    if (state.killSwitch?.active || state.manualReview) throw new Error(`V96_STOP_RECHECK_V12_MANUAL_REVIEW:${state.killSwitch?.reason || state.manualReview}`);

    const nonzero = positions.filter((row) => Math.abs(Number(row.positionAmt) || 0) > EPS);
    const unknownPositions = nonzero.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownPositions.length) throw new Error(`V96_STOP_RECHECK_UNKNOWN_POSITION:${unknownPositions.map((row) => row.symbol).join(",")}`);
    const unknownOrders = openOrders.filter((row) => !classifyAsterSymbol(row.symbol).tradable);
    if (unknownOrders.length) throw new Error(`V96_STOP_RECHECK_UNKNOWN_ORDER:${unknownOrders.map((row) => row.symbol).join(",")}`);

    // SOLUSDT can already be owned by a reconciled V12 activation even
    // though it was part of the legacy V96 core universe.  Only non-V12
    // state is a V96 residual here; the exact V12 state/protection match is
    // verified below and remains fail-closed on any mismatch.
    const reconciledV12Symbol = state.active ? String(state.active.symbol).toUpperCase() : undefined;
    const v96Positions = nonzero.filter((row) => {
        const symbol = String(row.symbol).toUpperCase();
        return V96_CORE_SYMBOLS.has(symbol) && symbol !== reconciledV12Symbol;
    });
    if (v96Positions.length) throw new Error(`V96_STOP_RECHECK_POSITION_REMAINS:${v96Positions.map((row) => `${row.symbol}:${row.positionAmt}`).join(",")}`);
    const v12ProtectionIds = new Set(state.active
        ? [state.active.protection.stopClientOrderId, state.active.protection.takeProfitClientOrderId].filter(Boolean)
        : []);
    const v96Orders = openOrders.filter((row) => {
        const symbol = String(row.symbol).toUpperCase();
        const clientOrderId = String(row.clientOrderId || "");
        return V96_CORE_SYMBOLS.has(symbol) && !v12ProtectionIds.has(clientOrderId);
    });
    if (v96Orders.length) throw new Error(`V96_STOP_RECHECK_ORDER_REMAINS:${v96Orders.map((row) => `${row.symbol}:${row.clientOrderId || row.orderId || "unknown"}`).join(",")}`);
    const adapter = new V12AsterLiveAdapter(client, {
        maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const actualPositions = await adapter.getPositions();
    const activeV12Orders = (await adapter.listV12Orders()).filter((row) => ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase()));
    let v12StateActive = false;
    if (state.active) {
        const actualV12 = actualPositions.filter((row) => Math.abs(row.quantity) > EPS && V12_X1_ALL.universe.some((base) => `${base}USDT` === row.symbol.toUpperCase()));
        if (actualV12.length !== 1) throw new Error(`V96_STOP_RECHECK_V12_ACTIVE_POSITION_COUNT_MISMATCH:${actualV12.length}`);
        const actual = actualV12[0];
        if (actual.symbol.toUpperCase() !== state.active.symbol.toUpperCase()) throw new Error("V96_STOP_RECHECK_V12_ACTIVE_POSITION_SYMBOL_MISMATCH");
        if (actualSide(actual) !== state.active.side) throw new Error("V96_STOP_RECHECK_V12_ACTIVE_POSITION_SIDE_MISMATCH");
        if (Math.abs(Math.abs(actual.quantity) - state.active.quantity) > Math.max(1e-8, state.active.quantity * 0.01)) throw new Error("V96_STOP_RECHECK_V12_ACTIVE_POSITION_QTY_MISMATCH");
        const protection = await reconcileV12Protection(adapter, state.active.protection);
        if (protection.manualReview) throw new Error(`V96_STOP_RECHECK_${protection.manualReview}`);
        const allowed = new Set([state.active.protection.stopClientOrderId, state.active.protection.takeProfitClientOrderId].filter(Boolean));
        const unknown = activeV12Orders.filter((row) => !allowed.has(row.clientOrderId));
        if (unknown.length) throw new Error(`V96_STOP_RECHECK_V12_UNKNOWN_ACTIVE_ORDER:${unknown.map((row) => row.clientOrderId).join(",")}`);
        v12StateActive = true;
    } else {
        const actualV12 = actualPositions.filter((row) => Math.abs(row.quantity) > EPS && V12_X1_ALL.universe.some((base) => `${base}USDT` === row.symbol.toUpperCase()));
        if (actualV12.length) throw new Error(`V96_STOP_RECHECK_V12_POSITION_ONLY_MISMATCH:${actualV12.map((row) => row.symbol).join(",")}`);
        if (activeV12Orders.length) throw new Error(`V96_STOP_RECHECK_V12_ORDER_ONLY_MISMATCH:${activeV12Orders.map((row) => row.clientOrderId).join(",")}`);
    }

    const lock = new FileAccountOrderLock(v12.lockPath || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const handle = await lock.acquire(`V96_STOP_RECHECK:${process.pid}:${randomUUID()}`);
    if (!handle) throw new Error("V96_STOP_RECHECK_SHARED_LOCK_UNAVAILABLE");
    await handle.release();

    const preserved = nonzero.filter((row) => {
        const symbol = String(row.symbol).toUpperCase();
        return !V96_CORE_SYMBOLS.has(symbol) || symbol === reconciledV12Symbol;
    });
    console.log(JSON.stringify({
        status: "V96_STOP_RECHECK_PASS",
        v96CorePositions: 0,
        v96CoreOpenOrders: 0,
        v12PreexistingOrders: 0,
        v12StateActive,
        v12Pending: false,
        sharedKillSwitchActive: false,
        sharedRiskFresh: true,
        sharedAccountLockAvailable: true,
        preservedPositions: preserved.map((row) => ({ symbol: row.symbol, positionAmt: row.positionAmt })),
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V96_STOP_RECHECK_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
