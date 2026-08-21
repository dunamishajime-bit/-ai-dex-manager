import "dotenv/config";

import { AsterV3Client } from "../lib/aster-v3-client";
import { resolveV12X1AllRuntime, V12_X1_ALL } from "../config/v12X1AllRuntime";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { reconcileV12Protection } from "../lib/v12-resident-stop-lifecycle";
import { FileV12X1AllRunnerStateStore } from "../lib/v12-x1-all-runner-state";

const EPS = 1e-12;
const V12_SYMBOLS = new Set(V12_X1_ALL.universe.map((base) => `${base}USDT`));
function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }
function actualSide(position: { quantity: number; positionSide: string }) {
    if (position.positionSide === "LONG") return "LONG" as const;
    if (position.positionSide === "SHORT") return "SHORT" as const;
    return position.quantity < 0 ? "SHORT" as const : "LONG" as const;
}

async function main() {
    const runtime = resolveV12X1AllRuntime();
    if (runtime.mode !== "LIVE" || !runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled) {
        throw new Error("V12_RUNTIME_STATUS_LIVE_GATES_NOT_ENABLED");
    }
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V12-Runtime-Status/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_RUNTIME_STATUS_REQUIRES_ASTER_CREDENTIALS");
    const adapter = new V12AsterLiveAdapter(client, {
        maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const stateStore = new FileV12X1AllRunnerStateStore(runtime.statePath, "LIVE");
    const [state, risk, killSwitch, _ping, positions, v12Orders] = await Promise.all([
        stateStore.load(),
        readSharedCryptoDailyRisk(runtime.riskPath),
        readSharedKillSwitch(),
        client.ping(),
        adapter.getPositions(),
        adapter.listV12Orders(),
    ]);
    void _ping;

    if (!risk.ok) throw new Error(`V12_RUNTIME_SHARED_RISK_INVALID:${risk.reason}`);
    if (killSwitch.active) throw new Error(`V12_RUNTIME_SHARED_KILL_SWITCH_ACTIVE:${killSwitch.reason || "UNSPECIFIED"}`);
    if (state.killSwitch?.active || state.manualReview) throw new Error(`V12_RUNTIME_LOCAL_KILL_SWITCH_ACTIVE:${state.killSwitch?.reason || state.manualReview}`);
    if (state.pending) throw new Error(`V12_RUNTIME_PENDING_REQUIRES_RECONCILIATION:${state.pending.action}:${state.pending.clientOrderId}`);

    const nonzero = positions.filter((row) => Math.abs(row.quantity) > EPS);
    for (const row of nonzero) {
        const classified = classifyAsterSymbol(row.symbol);
        if (!classified.tradable) throw new Error(`V12_RUNTIME_UNKNOWN_NONZERO_POSITION:${row.symbol}`);
    }
    const actualV12 = nonzero.filter((row) => V12_SYMBOLS.has(row.symbol.toUpperCase()));
    const activeV12Orders = v12Orders.filter((row) => ["NEW", "PARTIALLY_FILLED", "PENDING_NEW"].includes(String(row.status || "").toUpperCase()));

    const statePositions = state.activePositions?.length ? state.activePositions : state.active ? [state.active] : [];
    let protectionVerified = false;
    if (!statePositions.length) {
        if (actualV12.length) throw new Error(`V12_RUNTIME_POSITION_ONLY_MISMATCH:${actualV12.map((row) => row.symbol).join(",")}`);
        if (activeV12Orders.length) throw new Error(`V12_RUNTIME_ORDER_ONLY_MISMATCH:${activeV12Orders.map((row) => row.clientOrderId).join(",")}`);
    } else {
        if (actualV12.length !== statePositions.length) throw new Error(`V12_RUNTIME_POSITION_COUNT_MISMATCH:expected=${statePositions.length}:actual=${actualV12.length}`);
        const allowed = new Set<string>();
        for (const expected of statePositions) {
            const actual = actualV12.find((row) => row.symbol.toUpperCase() === expected.symbol.toUpperCase());
            if (!actual) throw new Error(`V12_RUNTIME_POSITION_SYMBOL_MISMATCH:${expected.symbol}`);
            if (actualSide(actual) !== expected.side) throw new Error(`V12_RUNTIME_POSITION_SIDE_MISMATCH:${expected.symbol}`);
            if (Math.abs(Math.abs(actual.quantity) - expected.quantity) > Math.max(1e-8, expected.quantity * 0.01)) throw new Error(`V12_RUNTIME_POSITION_QTY_MISMATCH:${expected.symbol}`);
            const reconciledProtection = await reconcileV12Protection(adapter, expected.protection);
            if (reconciledProtection.manualReview) throw new Error(reconciledProtection.manualReview);
            allowed.add(expected.protection.stopClientOrderId);
            allowed.add(expected.protection.takeProfitClientOrderId);
        }
        protectionVerified = true;
        const unknown = activeV12Orders.filter((row) => !allowed.has(row.clientOrderId));
        if (unknown.length) throw new Error(`V12_RUNTIME_UNKNOWN_ACTIVE_ORDER:${unknown.map((row) => row.clientOrderId).join(",")}`);
    }

    console.log(JSON.stringify({
        status: "V12_RUNTIME_RECONCILIATION_PASS",
        strategyId: V12_X1_ALL.strategyId,
        sourceSha: V12_X1_ALL.sourceSha,
        statePositionPresent: Boolean(state.active),
        actualV12PositionCount: actualV12.length,
        activeV12OrderCount: activeV12Orders.length,
        residentProtectionVerified: protectionVerified,
        sharedRiskFresh: true,
        sharedRiskLossPct: risk.state?.lossPct,
        sharedKillSwitchActive: false,
        localKillSwitchActive: false,
        pending: false,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "V12_RUNTIME_RECONCILIATION_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
