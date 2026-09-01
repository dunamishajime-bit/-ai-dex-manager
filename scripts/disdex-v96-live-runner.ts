import "dotenv/config";

import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AsterV3Client, type AsterPositionRiskRow } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { DisDexV46AsterMarketDataProvider } from "../lib/disdex-v46-market-data-provider";
import { FileAccountOrderLock } from "../lib/disdex-account-order-lock";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { DISDEX_V96_LIVE_PROMOTION, DISDEX_V96_RUNTIME, DISDEX_V96_STRATEGY_ID } from "../config/disdexV96Runtime";
import {
    assertDisDexV96LiveGates,
    evaluateDisDexV96LiveGates,
    type DisDexV96ExecutionParityApproval,
    type DisDexV96ForwardEvidenceApproval,
} from "../lib/disdex-v96-live-gates";
import type { DisDexV96OperatorOverrideApproval } from "../lib/disdex-v96-live-risk-controls";
import { DisDexV96PortfolioRunner, buildDefaultDisDexV96RunnerConfig } from "../lib/disdex-v96-portfolio-runner";
import { FileDisDexV96RunnerStateStore } from "../lib/disdex-v96-runner-state";

const ALL_MANAGED_ASTER_SYMBOLS = [
    "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT",
    "AMZNUSDT", "METAUSDT", "MSFTUSDT", "NVDAUSDT", "TSLAUSDT",
] as const;

type ExtendedPositionRiskRow = AsterPositionRiskRow & {
    marginType?: string;
    isolated?: boolean;
};

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

function normalizedMarginType(row: ExtendedPositionRiskRow) {
    const raw = String(row.marginType || "").trim().toLowerCase();
    if (raw === "cross" || raw === "crossed") return "cross";
    if (raw === "isolated" || raw === "isolate") return "isolated";
    if (row.isolated === false) return "cross";
    if (row.isolated === true) return "isolated";
    return "unknown";
}

function verifyManagedAccountConfiguration(positionRows: AsterPositionRiskRow[]) {
    const requiredLeverage = numberEnv(
        "DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE",
        DISDEX_V96_LIVE_PROMOTION.requiredInitialLeverage,
    );
    if (requiredLeverage !== DISDEX_V96_LIVE_PROMOTION.requiredInitialLeverage) {
        throw new Error(`Managed Aster leverage policy must be exactly ${DISDEX_V96_LIVE_PROMOTION.requiredInitialLeverage}x.`);
    }
    const bySymbol = new Map(positionRows.map((row) => [String(row.symbol).toUpperCase(), row as ExtendedPositionRiskRow]));
    for (const symbol of ALL_MANAGED_ASTER_SYMBOLS) {
        const row = bySymbol.get(symbol);
        if (!row) throw new Error(`Managed Aster position-risk row missing during tick: ${symbol}.`);
        const leverage = Number(row.leverage);
        const marginType = normalizedMarginType(row);
        if (leverage !== requiredLeverage) {
            throw new Error(`Managed Aster leverage changed for ${symbol}: expected ${requiredLeverage}, got ${leverage}.`);
        }
        if (marginType !== DISDEX_V96_LIVE_PROMOTION.requiredMarginType) {
            throw new Error(`Managed Aster margin type changed for ${symbol}: expected cross, got ${marginType}.`);
        }
    }
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
    const killSwitchPath = process.env.DISDEX_V96_KILL_SWITCH_FILE;
    const requestedMaxGross = numberEnv("DISDEX_V96_MAX_GROSS", DISDEX_V96_RUNTIME.maximumGross);
    const requestedDailyLossPct = numberEnv("DISDEX_V96_MAX_DAILY_LOSS_PCT", DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct);
    const requestedPenguGrossCap = numberEnv("DISDEX_V96_INITIAL_PENGU_GROSS", DISDEX_V96_LIVE_PROMOTION.maximumOverridePenguGross);
    if (runnerMode === "live" && !killSwitchPath) {
        throw new Error("V96 live mode requires DISDEX_V96_KILL_SWITCH_FILE.");
    }
    if (runnerMode === "live" && Math.abs(requestedMaxGross - DISDEX_V96_RUNTIME.maximumGross) > 1e-12) {
        throw new Error(`V96 Crypto sleeve Gross must be ${DISDEX_V96_RUNTIME.maximumGross}, got ${requestedMaxGross}.`);
    }
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
        maximumGross: requestedMaxGross,
        maximumDailyLossPct: requestedDailyLossPct,
        initialPenguGrossCap: requestedPenguGrossCap,
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
        userAgent: "DisDex-V96-Reserved-PENGU/3.0",
    });
    if (runnerMode === "live" && !client.hasTradingCredentials()) {
        throw new Error("V96 live mode requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    if (runnerMode === "live") verifyManagedAccountConfiguration(await client.getPositions());

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
    const liveGateCheck = runnerMode === "live"
        ? async () => {
            const [freshForwardEvidence, freshExecutionParity, freshOperatorOverride, freshPositionRows] = await Promise.all([
                optionalJson<DisDexV96ForwardEvidenceApproval>(process.env.DISDEX_V96_FORWARD_EVIDENCE_FILE),
                optionalJson<DisDexV96ExecutionParityApproval>(process.env.DISDEX_V96_EXECUTION_PARITY_FILE),
                optionalJson<DisDexV96OperatorOverrideApproval>(process.env.DISDEX_V96_OPERATOR_OVERRIDE_FILE),
                client.getPositions(),
            ]);
            try {
                verifyManagedAccountConfiguration(freshPositionRows);
            } catch (error) {
                return {
                    allowed: false,
                    message: `V96 LIVE leverage/margin gate failed during tick: ${error instanceof Error ? error.message : String(error)}`,
                };
            }
            const freshGate = evaluateDisDexV96LiveGates({
                ...liveGateInput,
                forwardEvidence: freshForwardEvidence,
                executionParity: freshExecutionParity,
                operatorOverride: freshOperatorOverride,
            });
            return {
                allowed: freshGate.allowed,
                message: freshGate.allowed ? undefined : `V96 LIVE approval gate failed during tick: ${freshGate.reasons.join("; ")}`,
            };
        }
        : undefined;
    const approvedOverride = liveGate.operatorOverrideApproved ? liveGate.operatorOverride : undefined;
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
        oneTimeSkippedSignalReferenceTs: numberEnv("DISDEX_V96_ONE_TIME_SKIP_REFERENCE_TS", 1785024000000),
        roundTripFeeBps: numberEnv("DISDEX_V96_ROUND_TRIP_FEE_BPS", 8),
        minimumExecutionHeadroomUsd: numberEnv("DISDEX_V96_MIN_EXECUTION_HEADROOM_USD", 4),
        maximumDailyLossPct: approvedOverride?.maximumDailyLossPct
            ?? numberEnv("DISDEX_V96_MAX_DAILY_LOSS_PCT", DISDEX_V96_LIVE_PROMOTION.maximumDailyLossPct),
        maximumDailyLossUsd: approvedOverride?.maximumDailyLossUsd
            ?? optionalNumberEnv("DISDEX_V96_MAX_DAILY_LOSS_USD"),
        killSwitchPath,
        operatorOverride: approvedOverride,
        liveGateCheck,
    });
    const stateStore = new FileDisDexV96RunnerStateStore(resolve(stateRoot, `runner-${runnerMode}.json`), runnerMode);
    const runner = new DisDexV96PortfolioRunner({
        marketData,
        executor,
        config,
        stateStore,
        lock: new FileAccountOrderLock(
            process.env.DISDEX_ACCOUNT_LOCK_PATH || resolve(stateRoot, `runner-${runnerMode}.lock`),
            numberEnv("DISDEX_V96_LOCK_STALE_MS", 10 * 60_000),
        ),
    });

    console.log(JSON.stringify({
        event: "disdex-v96-runner-start",
        strategyId: DISDEX_V96_RUNTIME.strategyId,
        repositoryMode: DISDEX_V96_RUNTIME.mode,
        runtimeCommitSha,
        runnerMode,
        executor: executor.constructor.name,
        v96CryptoSleeveGross: config.maxGross,
        combinedPortfolioGross: numberEnv("DISDEX_V52_PORTFOLIO_GROSS_CAP", config.maxGross),
        requiredInitialLeverage: numberEnv("DISDEX_V96_V52_REQUIRED_INITIAL_LEVERAGE", DISDEX_V96_LIVE_PROMOTION.requiredInitialLeverage),
        requiredMarginType: DISDEX_V96_LIVE_PROMOTION.requiredMarginType,
        maximumInitialMarginFraction: numberEnv("DISDEX_V96_V52_MAX_INITIAL_MARGIN_FRACTION", 0.70),
        minimumAvailableBalanceFractionAfterOrder: numberEnv("DISDEX_V96_V52_MIN_AVAILABLE_BALANCE_FRACTION", 0.20),
        cashReservePct: config.cashReservePct,
        roundTripFeeBps: config.roundTripFeeBps,
        minimumExecutionHeadroomUsd: config.minimumExecutionHeadroomUsd,
        oneTimeSkippedSignalReferenceTs: config.oneTimeSkippedSignalReferenceTs,
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
        configFingerprint: liveGate.configFingerprint,
        forwardEvidenceStatus: forwardEvidence?.status || "NOT_APPROVED",
        executionParityStatus: executionParity?.status || "NOT_REVIEWED",
    }));

    const daemon = process.argv.includes("--daemon");
    const intervalMs = Math.max(30_000, numberEnv("DISDEX_V96_RUNNER_INTERVAL_MS", 5 * 60_000));
    let stopping = false;
    const intervalWait = createInterruptibleDelay();
    const stop = () => {
        stopping = true;
        intervalWait.interrupt();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const result = await runner.tick();
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), runnerMode, ...result }));
        if (result.status === "manual-review") stopping = true;
        if (!daemon || stopping) break;
        await intervalWait.wait(intervalMs);
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", event: "disdex-v96-runner-failed", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
