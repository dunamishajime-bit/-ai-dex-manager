import "dotenv/config";

import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { resolvePenguDualLsV2Runtime } from "../config/penguDualLsV2Runtime";
import { readSharedCryptoDailyRisk } from "../lib/disdex-shared-crypto-daily-risk";
import { readSharedKillSwitch } from "../lib/disdex-shared-kill-switch";
import { FilePenguDualLsV2RunnerStateStore } from "../lib/pengu-dual-ls-v2-runner-state";

const SYMBOL = "PENGUUSDT";
const EPS = 1e-12;

function numberEnv(name: string, fallback: number) { const value = Number(process.env[name]); return Number.isFinite(value) ? value : fallback; }

async function main() {
    const runtime = resolvePenguDualLsV2Runtime();
    if (runtime.mode !== "LIVE" || !runtime.enabled || !runtime.liveTradingEnabled || !runtime.liveExecutionEnabled) {
        throw new Error("PENGU_V2_LIVE_GATES_NOT_ALL_ENABLED");
    }
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-PENGU-V2-Readiness/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("PENGU_V2_READINESS_REQUIRES_ASTER_CREDENTIALS");

    const stateRoot = resolve(process.env.PENGU_DUAL_LS_V2_STATE_DIR || ".runtime-state/pengu-dual-ls-v2");
    const stateStore = new FilePenguDualLsV2RunnerStateStore(resolve(stateRoot, "runner-live.json"), "LIVE");
    const riskPath = runtime.portfolioDailyLossStatePath || process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH || ".runtime-state/shared/crypto-daily-risk.json";
    const [state, risk, sharedKillSwitch, _ping, positions, openOrders] = await Promise.all([
        stateStore.load(),
        readSharedCryptoDailyRisk(riskPath),
        readSharedKillSwitch(),
        client.ping(),
        client.getPositions(SYMBOL),
        client.getOpenOrders(SYMBOL),
    ]);
    void _ping;

    if (!risk.ok) throw new Error(`PENGU_V2_SHARED_RISK_NOT_READY:${risk.reason}`);
    if (sharedKillSwitch.active) throw new Error(`PENGU_V2_SHARED_KILL_SWITCH_ACTIVE:${sharedKillSwitch.reason || "UNSPECIFIED"}`);
    if (state.pending) throw new Error(`PENGU_V2_PENDING_REQUIRES_RECONCILIATION:${state.pending.clientOrderId}:${state.pending.phase}`);
    if (openOrders.length) throw new Error(`PENGU_V2_OPEN_ORDER_REQUIRES_RECONCILIATION:${openOrders.map((row) => row.clientOrderId || row.orderId || "unknown").join(",")}`);

    const actualRows = positions.filter((row) => String(row.symbol).toUpperCase() === SYMBOL && Math.abs(Number(row.positionAmt) || 0) > EPS);
    if (actualRows.length > 1) throw new Error("PENGU_V2_MULTIPLE_POSITION_ROWS_UNSUPPORTED");
    const actual = actualRows[0];
    if (!state.position && actual) throw new Error("PENGU_V2_POSITION_ONLY_MISMATCH");
    if (state.position && !actual) throw new Error("PENGU_V2_STATE_ONLY_POSITION_MISMATCH");
    if (state.position && actual) {
        const qty = Number(actual.positionAmt);
        const actualSide = qty < 0 ? -1 : 1;
        if (actualSide !== state.position.side) throw new Error("PENGU_V2_POSITION_SIDE_MISMATCH");
        if (Math.abs(Math.abs(qty) - state.position.quantity) > Math.max(1e-8, state.position.quantity * 0.01)) throw new Error("PENGU_V2_POSITION_QTY_MISMATCH");
    }

    console.log(JSON.stringify({
        status: "PENGU_V2_LIVE_READINESS_PASS",
        positionPresent: Boolean(state.position),
        pending: false,
        openOrders: 0,
        sharedRiskFresh: true,
        sharedKillSwitchActive: false,
        ordersSent: false,
    }));
}

main().catch((error) => {
    console.error(JSON.stringify({ status: "PENGU_V2_LIVE_READINESS_FAILED", message: error instanceof Error ? error.message : String(error), ordersSent: false }));
    process.exitCode = 1;
});
