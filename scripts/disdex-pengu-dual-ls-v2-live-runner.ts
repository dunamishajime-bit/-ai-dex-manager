import "dotenv/config";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { resolvePenguDualLsV2Runtime } from "../config/penguDualLsV2Runtime";
import { STRICT_BT33404708902 } from "../config/disdexStrictBt33404708902Runtime";
import { PenguDualLsV2AsterMarketDataProvider } from "../lib/pengu-dual-ls-v2-market-data-provider";
import { PenguDualLsV2PortfolioRunner } from "../lib/pengu-dual-ls-v2-portfolio-runner";
import { FilePenguDualLsV2RunnerStateStore } from "../lib/pengu-dual-ls-v2-runner-state";
import { evaluateQuality102LiveSelector } from "../lib/disdex-quality102-live-selector";
import { assertV12StrictLiveConfiguration } from "../lib/v12-strict-live-adapter";
import { classifyRunnerSafetyState, writeRunnerHeartbeat, type RunnerHeartbeat } from "../lib/disdex-runner-health";

const HOUR_MS = 60 * 60_000;
const ZERO_SHA = "0".repeat(40);

function penguSafety(status: string, message: string, liveEnabled: boolean): RunnerHeartbeat["safetyState"] {
    return classifyRunnerSafetyState(status, message, liveEnabled);
}

function penguHeartbeatPath() { return process.env.DISDEX_PENGU_RUNNER_HEARTBEAT_PATH || process.env.DISDEX_RUNNER_HEARTBEAT_PATH || `${process.env.DISDEX_RUNNER_HEALTH_ROOT || "/var/lib/disdex/runner-health"}/pengu-v8.json`; }

export function buildPenguRunnerHeartbeat(result: { status: string; message: string }, now = Date.now(), options: { mode: string; liveEnabled: boolean }): RunnerHeartbeat {
    const sha = String(process.env.DISDEX_RUNTIME_COMMIT_SHA || process.env.DISDEX_RELEASE_SHA || ZERO_SHA).trim().toLowerCase();
    const validSha = /^[0-9a-f]{40}$/.test(sha) ? sha : ZERO_SHA;
    const expectedSha = String(process.env.DISDEX_EXPECTED_RUNTIME_SHA || process.env.DISDEX_EXPECTED_SHA || "").trim().toLowerCase();
    const validExpectedSha = /^[0-9a-f]{40}$/.test(expectedSha) ? expectedSha : ZERO_SHA;
    const shaAvailable = validSha !== ZERO_SHA && validExpectedSha !== ZERO_SHA;
    return {
        schema: "disdex-runner-heartbeat/v1", runnerId: "PENGU_V8", serviceUnit: process.env.DISDEX_PENGU_RUNNER_SERVICE_UNIT || process.env.DISDEX_RUNNER_SERVICE_UNIT || "disdex-pengu-dual-ls-v2.service",
        runtimeSha: validSha, expectedSha: validExpectedSha, workingDirectory: process.cwd(), mode: options.mode, liveEnabled: options.liveEnabled,
        safetyState: shaAvailable ? penguSafety(result.status, result.message, options.liveEnabled) : "UNKNOWN", heartbeatAt: now, lastTickAt: now, lastReconciliationAt: null,
        lastDecision: result.status, reason: shaAvailable ? (result.message || result.status) : "runtime or expected SHA unavailable", symbols: [], caps: { strategy: 0.75, crypto: 2, total: 2.5 },
        restartAttempts: Math.max(0, Number.parseInt(process.env.DISDEX_RUNNER_RESTART_ATTEMPTS || "0", 10) || 0), updatedAt: now,
    };
}

async function publishPenguHeartbeat(result: { status: string; message: string }, now = Date.now(), runtime = resolvePenguDualLsV2Runtime()) {
    try { await writeRunnerHeartbeat(penguHeartbeatPath(), buildPenguRunnerHeartbeat(result, now, { mode: runtime.mode === "LIVE" ? "PENGU_DUAL_LS_V2_FINAL" : runtime.mode, liveEnabled: runtime.mode === "LIVE" && runtime.enabled && runtime.liveTradingEnabled && runtime.liveExecutionEnabled })); } catch (error) { console.error(JSON.stringify({ level: "warn", event: "runner-heartbeat-write-failed", runnerId: "PENGU_V8", reason: error instanceof Error ? error.message : String(error) })); }
}

function numberEnv(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
    const runtime = resolvePenguDualLsV2Runtime();
    const quality102Live = evaluateQuality102LiveSelector({ decisionTs: Date.now() });
    if (runtime.mode === "LIVE" && runtime.enabled) {
        const strict = assertV12StrictLiveConfiguration();
        if (Math.abs(runtime.maximumGross - STRICT_BT33404708902.penguMaximumGross) > 1e-9) {
            throw new Error(`PENGU_STRICT_GROSS_MISMATCH:${runtime.maximumGross}`);
        }
        console.log(JSON.stringify({
            event: "strict-portfolio-live-gate",
            strictPortfolioPlannerActive: true,
            penguGrossCap: STRICT_BT33404708902.penguMaximumGross,
            cryptoGrossCap: strict.cryptoGrossCap,
            totalGrossCap: strict.totalGrossCap,
        }));
    }
    console.log(JSON.stringify({
        event: "quality102-live-selector",
        quality102LiveSelectorParity: quality102Live.quality102LiveSelectorParity,
        quality102LiveBlockedFailClosed: quality102Live.quality102LiveBlockedFailClosed,
        reason: quality102Live.reason,
    }));
    const stateRoot = resolve(process.env.PENGU_DUAL_LS_V2_STATE_DIR || ".runtime-state/pengu-dual-ls-v2");
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-PENGU-Dual-LS-V2-Strict/1.0",
    });
    if (runtime.mode === "LIVE" && runtime.enabled && !client.hasTradingCredentials()) {
        throw new Error("PENGU_DUAL_LS_V2_FINAL LIVE requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    const aster = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const executor: DirectTradeExecutor = runtime.mode === "SHADOW" || runtime.mode === "PAPER"
        ? new SignedPaperDirectTradeExecutor(aster, {
            statePath: resolve(stateRoot, "paper-portfolio.json"),
            initialBalanceUsd: numberEnv("PENGU_DUAL_LS_V2_PAPER_INITIAL_BALANCE_USD", 1000),
            feeBpsPerSide: numberEnv("PENGU_DUAL_LS_V2_PAPER_FEE_BPS_PER_SIDE", 6),
            maxGross: runtime.maximumGross + 0.05,
        })
        : aster;
    const marketData = new PenguDualLsV2AsterMarketDataProvider(client, {
        hourlyLimit: numberEnv("PENGU_DUAL_LS_V2_HOURLY_LIMIT", 1000),
        cacheTtlMs: numberEnv("PENGU_DUAL_LS_V2_HISTORY_CACHE_TTL_MS", 5 * 60_000),
    });
    const accountLock = new FileAccountOrderLock(process.env.DISDEX_ACCOUNT_LOCK_PATH || ".runtime-state/shared/account-order.lock", numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000));
    const runner = new PenguDualLsV2PortfolioRunner({
        marketData,
        executor,
        stateStore: new FilePenguDualLsV2RunnerStateStore(resolve(stateRoot, `runner-${runtime.mode.toLowerCase()}.json`), runtime.mode),
        lock: accountLock,
        config: {
            mode: runtime.mode,
            enabled: runtime.enabled,
            liveExecutionEnabled: runtime.liveExecutionEnabled,
            productionConfigLiveEnabled: runtime.liveTradingEnabled,
            maximumGross: runtime.maximumGross,
            longGross: runtime.longGross,
            shortGross: runtime.shortGross,
            cashReservePct: runtime.cashReservePct,
            maxSlippageBps: runtime.maximumSlippageBps,
            minimumOrderNotionalUsd: runtime.minimumOrderNotionalUsd,
            maxTransactionRetries: runtime.maxTransactionRetries,
            maximumEntryDelayMs: runtime.maximumEntryDelayMs,
            // The verified strict portfolio has a 2.00x aggregate crypto cap.
            // PENGU's own sleeve remains capped at 0.75x by maximumGross.
            portfolioGrossCap: STRICT_BT33404708902.cryptoGrossCap,
            maximumDailyLossPct: runtime.maximumDailyLossPct,
            killSwitchPath: runtime.killSwitchPath,
            portfolioDailyLossStatePath: runtime.portfolioDailyLossStatePath,
        },
    });
    const daemon = process.argv.includes("--daemon");
    const boundaryDelayMs = Math.min(30_000, Math.max(1_000, numberEnv("PENGU_DUAL_LS_V2_BOUNDARY_DELAY_MS", 5_000)));
    let stopping = false;
    const boundaryWait = createInterruptibleDelay();
    const stop = () => {
        stopping = true;
        boundaryWait.interrupt();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const result = await runner.tick();
        await publishPenguHeartbeat(result);
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), mode: runtime.mode, strategyId: runtime.strategyId, ...result }));
        if (!daemon || stopping) break;
        const now = Date.now();
        const waitUntilNextClosedHour = HOUR_MS - (now % HOUR_MS) + boundaryDelayMs;
        await boundaryWait.wait(waitUntilNextClosedHour);
    } while (!stopping);
}

if (process.argv[1]?.endsWith("disdex-pengu-dual-ls-v2-live-runner.ts")) {
    main().catch((error) => {
        void publishPenguHeartbeat({ status: "fatal", message: error instanceof Error ? error.message : String(error) });
        console.error(JSON.stringify({ level: "fatal", strategyId: "PENGU_DUAL_LS_V2_FINAL", message: error instanceof Error ? error.message : String(error) }));
        process.exitCode = 1;
    });
}
