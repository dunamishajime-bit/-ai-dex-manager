import "dotenv/config";

import { AsterV3Client } from "../lib/aster-v3-client";
import { V12AsterLiveAdapter } from "../lib/v12-aster-live-adapter";
import { reduceV12DynamicResidualForCoreConflict } from "../lib/v12-dynamic-residual-live-reduction";

function arg(name: string): string | undefined {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}

function finiteArg(name: string): number {
    const value = Number(arg(name));
    if (!Number.isFinite(value) || value <= 0) throw new Error(`INVALID_ARGUMENT:${name}`);
    return value;
}

function numberEnv(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
    const caller = String(arg("--caller") || "").trim().toUpperCase();
    if (!["V52_CORE", "PENGU_CORE", "V12_BASE"].includes(caller)) {
        throw new Error("V12_DYNAMIC_TRIM_CALLER_NOT_ALLOWED");
    }
    if (arg("--shared-lock-held") !== "true") {
        throw new Error("V12_DYNAMIC_TRIM_SHARED_LOCK_ASSERTION_REQUIRED");
    }
    const gross = finiteArg("--gross");
    const equity = finiteArg("--equity");
    const cause = String(arg("--cause") || "").trim();
    if (!cause) throw new Error("V12_DYNAMIC_TRIM_CAUSE_REQUIRED");
    const statePath = String(arg("--state-path") || process.env.V12_X1_ALL_STATE_PATH || ".runtime-state/v12-x1-all/runner.json").trim();
    if (!statePath) throw new Error("V12_DYNAMIC_TRIM_STATE_PATH_REQUIRED");

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V12-Dynamic-Trim/1.0",
    });
    if (!client.hasTradingCredentials()) throw new Error("V12_DYNAMIC_TRIM_ASTER_CREDENTIALS_REQUIRED");

    const adapter = new V12AsterLiveAdapter(client, {
        maxSlippageBps: numberEnv("V12_X1_ALL_MAX_SLIPPAGE_BPS", 20),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
        readRequestSpacingMs: numberEnv("V12_X1_ALL_REQUEST_SPACING_MS", 100),
    });
    const result = await reduceV12DynamicResidualForCoreConflict({
        adapter,
        requiredGross: gross,
        equity,
        causeIdempotencyKey: cause,
        statePath,
    });
    console.log(JSON.stringify({ caller, gross, equity, cause, ...result }));
    if (result.status === "blocked") process.exitCode = 2;
}

main().catch((error) => {
    console.error(JSON.stringify({
        status: "blocked",
        message: error instanceof Error ? error.message : String(error),
        trimmedGross: 0,
    }));
    process.exitCode = 2;
});
