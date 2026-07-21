import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { DisDexV46AsterMarketDataProvider } from "../lib/disdex-v46-market-data-provider";
import { FileLiveRunnerLock } from "../lib/live-runner-state";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_RUNTIME } from "../config/disdexV96Runtime";
import {
    assertDisDexV96LiveGates,
    evaluateDisDexV96LiveGates,
    type DisDexV96ExecutionParityApproval,
    type DisDexV96ForwardEvidenceApproval,
} from "../lib/disdex-v96-live-gates";
import type { DisDexV96OperatorOverrideApproval } from "../lib/disdex-v96-live-risk-controls";
import { DisDexV96PortfolioRunner, buildDefaultDisDexV96RunnerConfig } from "../lib/disdex-v96-portfolio-runner";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function optionalNumberEnv(name: string) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

function mode(): "paper" | "live" {
    return String(process.env.DISDEX_V96_RUNNER_MODE || "paper").toLowerCase() === "live" ? "live" : "paper";
}

async function optionalJson<T>(pathValue?: string): Promise<T | undefined> {
    if (!pathValue) return undefined;
    try {
        return JSON.parse(await readFile(resolve(pathValue), "utf8")) as T;
    } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
        if (code === "ENOENT") return undefined;
        throw error;
    }
}

async function main() {
    const runnerMode = mode();
    const runtimeCommitSha = String(process.env.DISDEX_V96_RUNTIME_COMMIT_SHA || "").trim();
    const stateRoot = resolve(process.env.DISDEX_V96_STATE_DIR || DISDEX_V96_RUNTIME.stateDirectory);
    const [forwardEvidence, executionParity, operatorOverride] = await Promise.all([
        optionalJson<DisDexV96ForwardEvidenceApproval>(process.env.DISDEX_V96_FORWARD_EVIDENCE_FILE),
        optionalJson<DisDexV96ExecutionParityApproval>(process.env.DISDEX_V96_EXECUTION_PARITY_FILE),
        optionalJson<DisDexV96OperatorOverrideApproval>(process.env.DISDEX_V96_OPERATOR_OVERRIDE_FILE),
    ]);
    const liveGateInput = {
        runnerMode,
        environmentLiveExecutionEnabled: boolEnv("DISDEX_V96_LIVE_EXECUTION_ENABLED", false),
        activationAcknowledgement: process.env.DISDEX_V96_LIVE_ACKNOWLEDGEMENT,
        forwardEvidence,
        executionParity,
        operatorOverride,
        runtimeCommitSha,
    } as const;
    const liveGate = runnerMode === "live"
        ? assertDisDexV96LiveGates(liveGateInput)
        : evaluateDisDexV96LiveGates(liveGateInput);

    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V96-Reserved-PENGU/2.0",
    });
    if (runnerMode === "live" && !client.hasTradingCredentials()) {
        throw new Error("V96 live mode requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    const aster = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const executor: DirectTradeExecutor = runnerMode === "paper"
        ? new SignedPaperDirectTradeExecutor(aster, {
            statePath: resolve(stateRoot, "paper-portfolio.json"),
            initialBalanceUsd: numberEnv("DISDEX_V96_PAPER_INITIAL_BALANCE_USD", 1000),
            feeBpsPerSide: numberEnv("DISDEX_V96_PAPER_FEE_BPS_PER_SIDE", 6),
            maxGross: numberEnv("DISDEX_V96_PAPER_MAX_GROSS", DISDEX_V96_RUNTIME.maximumGross + 0.05),
        })
        : aster;
    const marketData = new DisDexV46AsterMarketDataProvider(client, {
        coreLimit: numberEnv("DISDEX_V96_CORE_12H_LIMIT", 400),
        hourlyLimit: numberEnv("DISDEX_V96_HOURLY_LIMIT", 1000),
        fundingLimit: numberEnv("DISDEX_V96_FUNDING_LIMIT", 1000),
        fundingBaseUrl: process.env.ASTER_PUBLIC_FUTURES_BASE_URL || "https://fapi.asterdex.com",
        cacheTtlMs: numberEnv("DISDEX_V96_HISTORY_CACHE_TTL_MS", 5 * 60_000),
        fundingCacheTtlMs: numberEnv("DISDEX_V96_FUNDING_CACHE_TTL_MS", 5 * 60_000),
    });
    const approvedOverride = liveGate.operatorOverrideApproved ? liveGate.operatorOverride : undefined;
    const requestedMaxGross = numberEnv("DISDEX_V96_MAX_GROSS", DISDEX_V96_RUNTIME.maximumGross);
    const maximumGross = approvedOverride
        ? Math.min(requestedMaxGross, approvedOverride.maximumPortfolioGross)
        : requestedMaxGross;
    const config = buildDefaultDisDexV96RunnerConfig({
        mode: runnerMode,
        liveGateAllowed: liveGate.allowed,
        cashReservePct: numberEnv("DISDEX_V96_CASH_RESERVE_PCT", DISDEX_V96_RUNTIME.cashReservePct),
        maxGross: maximumGross,
        maxSlippageBps: numberEnv("DISDEX_V96_MAX_SLIPPAGE_BPS", DISDEX_V96_RUNTIME.maximumSlippageBps),
        minOrderNotionalUsd: numberEnv("DISDEX_V96_MIN_ORDER_NOTIONAL_USD", DISDEX_V96_RUNTIME.minimumOrderNotionalUsd),
        rebalanceTolerancePct: numberEnv("DISDEX_V96_REBALANCE_TOLERANCE_PCT", DISDEX_V96_RUNTIME.rebalanceTolerancePct),
        maxTransactionRetries: numberEnv("DISDEX_V96_MAX_TRANSACTION_RETRIES", 3),
        closeUnmanagedPositions: boolEnv("DISDEX_V96_CLOSE_UNMANAGED_POSITIONS", DISDEX_V96_RUNTIME.closeUnmanagedPositions),
        penguTargetGrossCap: approvedOverride?.initialPenguGrossCap,
        maximumDailyLossPct: approvedOverride?.maximumDailyLossPct
            ?? numberEnv("DISDEX_V96_MAX_DAILY_LOSS_PCT", DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct),
        maximumDailyLossUsd: approvedOverride?.maximumDailyLossUsd
            ?? optionalNumberEnv("DISDEX_V96_MAX_DAILY_LOSS_USD"),
        killSwitchPath: process.env.DISDEX_V96_KILL_SWITCH_FILE,
        operatorOverride: approvedOverride,
    });
    const stateStore = new FileDisDexV96RunnerStateStore(resolve(stateRoot, `runner-${runnerMode}.json`), runnerMode);
    const runner = new DisDexV96PortfolioRunner({
        marketData,
        executor,
        config,
        stateStore,
        lock: new FileLiveRunnerLock(resolve(stateRoot, `runner-${runnerMode}.lock`), numberEnv("DISDEX_V96_LOCK_STALE_MS", 10 * 60_000)),
    });

    console.log(JSON.stringify({
        event: "disdex-v96-runner-start",
        strategyId: DISDEX_V96_RUNTIME.strategyId,
        repositoryMode: DISDEX_V96_RUNTIME.mode,
        runtimeCommitSha,
        runnerMode,
        executor: executor.constructor.name,
        maximumGross: config.maxGross,
        penguTargetGross: 1.15,
        activePenguGrossCap: config.penguTargetGrossCap || 1.15,
        minimumPenguClip: 0.50,
        maximumDailyLossPct: config.maximumDailyLossPct,
        maximumDailyLossUsd: config.maximumDailyLossUsd,
        killSwitchPath: config.killSwitchPath,
        liveGateAllowed: liveGate.allowed,
        liveGateReasons: liveGate.reasons,
        forwardEvidenceApproved: liveGate.forwardEvidenceApproved,
        operatorOverrideApproved: liveGate.operatorOverrideApproved,
        operatorOverrideExpiresAt: approvedOverride?.expiresAt,
        configFingerprint: liveGate.configFingerprint,
        forwardEvidenceStatus: forwardEvidence?.status || "NOT_APPROVED",
        executionParityStatus: executionParity?.status || "NOT_REVIEWED",
    }));

    const daemon = process.argv.includes("--daemon");
    const intervalMs = Math.max(30_000, numberEnv("DISDEX_V96_RUNNER_INTERVAL_MS", 5 * 60_000));
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const result = await runner.tick();
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), runnerMode, ...result }));
        if (result.status === "manual-review") stopping = true;
        if (!daemon || stopping) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, intervalMs));
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", event: "disdex-v96-runner-failed", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
