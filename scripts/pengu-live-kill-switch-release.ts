import "dotenv/config";

import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import { AsterV3Client } from "../lib/aster-v3-client";
import { readDisDexV96KillSwitch } from "../lib/disdex-v96-live-risk-controls";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";
import { FilePenguDualLsV1RunnerStateStore } from "../lib/pengu-dual-ls-v1-runner-state";

const MANAGED_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"]);
const RELEASE_ACK = "RELEASE_KILL_SWITCH_AFTER_RECONCILIATION" as const;

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

async function latestAppliedReconciliation(stateRoot: string) {
    const directory = resolve(stateRoot, "reconciliation");
    const entries = await readdir(directory).catch(() => [] as string[]);
    const candidates = entries.filter((name) => /^legacy-v96-\d+\.json$/.test(name)).sort().reverse();
    for (const name of candidates) {
        const path = resolve(directory, name);
        const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
        if (parsed.status === "LEGACY_V96_RECONCILE_APPLIED" && parsed.pendingStateCleared === true) {
            return { path, parsed };
        }
    }
    throw new Error("KILL_SWITCH_RELEASE_APPLIED_RECONCILIATION_MISSING");
}

async function main() {
    const apply = process.argv.includes("--apply");
    if (DISDEX_V96_RUNTIME.liveTradingEnabled !== false) {
        throw new Error("KILL_SWITCH_RELEASE_LEGACY_V96_RUNTIME_NOT_RETIRED");
    }
    if (boolEnv("DISDEX_ENABLE_LEGACY_V96_LIVE", false)) {
        throw new Error("KILL_SWITCH_RELEASE_LEGACY_V96_ENV_ENABLED");
    }
    if (boolEnv("PENGU_LEGACY_CORE_ENABLED", false)) {
        throw new Error("KILL_SWITCH_RELEASE_PENGU_LEGACY_CORE_ENABLED");
    }

    const combinedRoot = resolve(process.env.DISDEX_V13D_V11EQ_V96_STATE_DIR || ".runtime-state/disdex-v96");
    const legacyStateRoot = resolve(process.env.DISDEX_V96_STATE_DIR || resolve(combinedRoot, "crypto-v96"));
    const penguStateRoot = resolve(process.env.PENGU_DUAL_LS_V1_STATE_DIR || resolve(combinedRoot, "pengu-dual-ls-v1"));
    const killSwitchPath = resolve(process.env.PENGU_DUAL_LS_V1_KILL_SWITCH_FILE || process.env.DISDEX_V96_KILL_SWITCH_FILE || resolve(combinedRoot, "kill-switch.json"));

    const killSwitch = await readDisDexV96KillSwitch(killSwitchPath);
    if (!killSwitch?.active) throw new Error("KILL_SWITCH_RELEASE_NOT_ACTIVE");

    const [legacyState, penguState, reconciliation] = await Promise.all([
        new FileDisDexV96RunnerStateStore(resolve(legacyStateRoot, "runner-live.json"), "live").load(),
        new FilePenguDualLsV1RunnerStateStore(resolve(penguStateRoot, "runner-live.json"), "LIVE").load(),
        latestAppliedReconciliation(legacyStateRoot),
    ]);
    if (legacyState.pending) throw new Error(`KILL_SWITCH_RELEASE_LEGACY_PENDING:${legacyState.pending.clientOrderId}`);
    if (penguState.pending) throw new Error(`KILL_SWITCH_RELEASE_PENGU_PENDING:${penguState.pending.clientOrderId}`);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-PENGU-KillSwitch-Release/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("KILL_SWITCH_RELEASE_ASTER_CREDENTIALS_MISSING");
    const [positions, openOrders] = await Promise.all([client.getPositions(), client.getOpenOrders()]);
    if (!Array.isArray(positions) || !Array.isArray(openOrders)) throw new Error("KILL_SWITCH_RELEASE_EXCHANGE_STATE_UNAVAILABLE");
    const managedPositions = positions.filter((row) => MANAGED_SYMBOLS.has(String(row.symbol).toUpperCase()) && Math.abs(Number(row.positionAmt) || 0) > 1e-12);
    if (managedPositions.length) throw new Error(`KILL_SWITCH_RELEASE_MANAGED_POSITIONS_PRESENT:${managedPositions.length}`);
    if (openOrders.length) throw new Error(`KILL_SWITCH_RELEASE_OPEN_ORDERS_PRESENT:${openOrders.length}`);

    const evidence = {
        status: apply ? "KILL_SWITCH_RELEASE_VERIFIED" : "KILL_SWITCH_RELEASE_READY",
        killSwitchPath,
        originalReason: killSwitch.reason,
        reconciliationAuditPath: reconciliation.path,
        legacyPending: false,
        penguPending: false,
        managedPositionCount: 0,
        openOrderCount: 0,
        legacyV96RuntimeLiveEnabled: false,
        legacyV96EnvEnabled: false,
        penguLegacyCoreEnabled: false,
        ordersSent: false,
        cancelsSent: false,
        positionsChanged: false,
    } as const;

    if (!apply) {
        console.log(JSON.stringify(evidence));
        return;
    }
    if (process.env.PENGU_KILL_SWITCH_RELEASE_ACKNOWLEDGEMENT !== RELEASE_ACK) {
        throw new Error(`KILL_SWITCH_RELEASE_REQUIRES_ACK:${RELEASE_ACK}`);
    }

    const releasedAt = new Date().toISOString();
    const released = {
        active: false,
        strategyId: killSwitch.strategyId,
        action: killSwitch.action,
        reason: killSwitch.reason,
        operator: killSwitch.operator,
        activatedAt: killSwitch.activatedAt,
        releasedAt,
        releasedBy: "pengu-live-kill-switch-release",
        reconciliationAuditPath: reconciliation.path,
    };
    const temporary = `${killSwitchPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(released, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, killSwitchPath);
    console.log(JSON.stringify({ ...evidence, status: "KILL_SWITCH_RELEASED", releasedAt }));
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "KILL_SWITCH_RELEASE_FAIL_CLOSED",
        message: error instanceof Error ? error.message : String(error),
        ordersSent: false,
        cancelsSent: false,
        positionsChanged: false,
    }));
    process.exitCode = 1;
});
