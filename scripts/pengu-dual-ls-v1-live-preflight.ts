import "dotenv/config";

import { resolve } from "node:path";

import { PENGU_DUAL_LS_V1, resolvePenguDualLsV1Runtime } from "../config/penguDualLsV1Runtime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { readDisDexV96KillSwitch } from "../lib/disdex-v96-live-risk-controls";
import { FilePenguDualLsV1RunnerStateStore } from "../lib/pengu-dual-ls-v1-runner-state";

const EPSILON = 1e-12;

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function actualSide(positionAmt: number): -1 | 1 {
    return positionAmt < 0 ? -1 : 1;
}

async function runPreflight() {
    const runtime = resolvePenguDualLsV1Runtime();
    if (runtime.mode !== "LIVE") throw new Error(`PENGU_PREFLIGHT_MODE_NOT_LIVE:${runtime.mode}`);
    if (!runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled) {
        throw new Error("PENGU_PREFLIGHT_LIVE_GATES_DISABLED");
    }
    if (boolEnv("DISDEX_ENABLE_LEGACY_V96_LIVE", false)) {
        throw new Error("PENGU_PREFLIGHT_LEGACY_V96_LIVE_MUST_BE_DISABLED");
    }
    if (boolEnv("PENGU_LEGACY_CORE_ENABLED", false)) {
        throw new Error("PENGU_PREFLIGHT_LEGACY_CORE_MUST_BE_DISABLED");
    }
    if (!runtime.killSwitchPath) throw new Error("PENGU_PREFLIGHT_KILL_SWITCH_PATH_MISSING");
    const killSwitch = await readDisDexV96KillSwitch(runtime.killSwitchPath);
    if (killSwitch?.active) throw new Error(`PENGU_PREFLIGHT_KILL_SWITCH_ACTIVE:${killSwitch.reason}`);

    const stateRoot = resolve(process.env.PENGU_DUAL_LS_V1_STATE_DIR || ".runtime-state/pengu-dual-ls-v1");
    const statePath = resolve(stateRoot, "runner-live.json");
    const stateStore = new FilePenguDualLsV1RunnerStateStore(statePath, "LIVE");
    const state = await stateStore.load();
    if (state.pending) {
        throw new Error(`PENGU_PREFLIGHT_PENDING_ORDER:${state.pending.clientOrderId}:${state.pending.phase}`);
    }

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-PENGU-Dual-LS-V1-Preflight/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("PENGU_PREFLIGHT_ASTER_CREDENTIALS_MISSING");

    const [ping, serverTime, positions, openOrders] = await Promise.all([
        client.ping(),
        client.getServerTime(),
        client.getPositions(PENGU_DUAL_LS_V1.symbol),
        client.getOpenOrders(PENGU_DUAL_LS_V1.symbol),
    ]);
    void ping;
    if (!Number.isFinite(Number(serverTime.serverTime))) throw new Error("PENGU_PREFLIGHT_SERVER_TIME_INVALID");
    if (!Array.isArray(positions)) throw new Error("PENGU_PREFLIGHT_POSITIONS_UNAVAILABLE");
    if (!Array.isArray(openOrders)) throw new Error("PENGU_PREFLIGHT_OPEN_ORDERS_UNAVAILABLE");
    if (openOrders.length > 0) throw new Error(`PENGU_PREFLIGHT_OPEN_ORDER_COUNT:${openOrders.length}`);

    const activeRows = positions.filter((row) => row.symbol.toUpperCase() === PENGU_DUAL_LS_V1.symbol && Math.abs(Number(row.positionAmt) || 0) > EPSILON);
    if (activeRows.length > 1) throw new Error(`PENGU_PREFLIGHT_MULTIPLE_POSITION_ROWS:${activeRows.length}`);
    const actual = activeRows[0];
    if (actual) {
        const amount = Number(actual.positionAmt);
        const markPrice = Number(actual.markPrice);
        const entryPrice = Number(actual.entryPrice);
        if (!Number.isFinite(amount) || !Number.isFinite(markPrice) || markPrice <= 0 || !Number.isFinite(entryPrice) || entryPrice <= 0) {
            throw new Error("PENGU_PREFLIGHT_INVALID_POSITION_OR_MARK_PRICE");
        }
        if (String(actual.positionSide || "BOTH").toUpperCase() !== "BOTH") {
            throw new Error(`PENGU_PREFLIGHT_HEDGE_MODE:${String(actual.positionSide)}`);
        }
    }

    if (!state.position && actual) throw new Error("PENGU_PREFLIGHT_UNMANAGED_PENGU_POSITION");
    if (state.position && !actual) throw new Error("PENGU_PREFLIGHT_STATE_POSITION_MISSING_ON_EXCHANGE");
    if (state.position && actual) {
        const amount = Number(actual.positionAmt);
        if (actualSide(amount) !== state.position.side) throw new Error("PENGU_PREFLIGHT_POSITION_SIDE_MISMATCH");
        const tolerance = Math.max(1e-8, state.position.quantity * 0.01);
        if (Math.abs(Math.abs(amount) - state.position.quantity) > tolerance) {
            throw new Error("PENGU_PREFLIGHT_POSITION_QUANTITY_MISMATCH");
        }
    }

    return {
        status: "PENGU_DUAL_LS_V1_PREFLIGHT_PASS",
        strategyId: PENGU_DUAL_LS_V1.id,
        symbol: PENGU_DUAL_LS_V1.symbol,
        authenticated: true,
        legacyV96LiveEnabled: false,
        legacyPenguCoreEnabled: false,
        killSwitchActive: false,
        pendingOrder: false,
        openOrderCount: 0,
        managedPositionCount: activeRows.length,
        durablePositionPresent: Boolean(state.position),
        statePath,
        ordersSent: false,
        cancelsSent: false,
        positionsChanged: false,
        stateChanged: false,
    };
}

runPreflight().then((result) => {
    console.log(JSON.stringify(result));
}).catch((error) => {
    console.error(JSON.stringify({
        status: "PENGU_DUAL_LS_V1_PREFLIGHT_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        cancelsSent: false,
        positionsChanged: false,
        stateChanged: false,
    }));
    process.exitCode = 1;
});
