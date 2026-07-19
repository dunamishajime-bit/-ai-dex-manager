import "dotenv/config";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { DisDexV35AsterMarketDataProvider } from "../lib/disdex-v35-market-data-provider";
import { DisDexV35PortfolioRunner, buildDefaultDisDexV35RunnerConfig } from "../lib/disdex-v35-portfolio-runner";
import { FileDisDexV35RunnerStateStore } from "../lib/disdex-v35-runner-state";
import { FileLiveRunnerLock } from "../lib/live-runner-state";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { DISDEX_V35_PENGU_RULE, DISDEX_V35_RUNTIME } from "../config/disdexV35Runtime";

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function mode(): "paper" | "live" {
    return String(process.env.DISDEX_V35_RUNNER_MODE || "paper").toLowerCase() === "live" ? "live" : "paper";
}

async function main() {
    const runnerMode = mode();
    const stateRoot = resolve(process.env.DISDEX_V35_STATE_DIR || ".runtime-state/disdex-v35");
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V35-PortfolioRunner/1.0",
    });
    if (runnerMode === "live" && !client.hasTradingCredentials()) {
        throw new Error("V35 live mode requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    const aster = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const executor: DirectTradeExecutor = runnerMode === "paper"
        ? new SignedPaperDirectTradeExecutor(aster, {
            statePath: resolve(stateRoot, "paper-portfolio.json"),
            initialBalanceUsd: numberEnv("DISDEX_V35_PAPER_INITIAL_BALANCE_USD", 1000),
            feeBpsPerSide: numberEnv("DISDEX_V35_PAPER_FEE_BPS_PER_SIDE", 6),
            maxGross: numberEnv("DISDEX_V35_PAPER_MAX_GROSS", DISDEX_V35_RUNTIME.maximumGross + 0.05),
        })
        : aster;
    const marketData = new DisDexV35AsterMarketDataProvider(client, {
        coreLimit: numberEnv("DISDEX_V35_CORE_12H_LIMIT", 400),
        hourlyLimit: numberEnv("DISDEX_V35_HOURLY_LIMIT", 1000),
        cacheTtlMs: numberEnv("DISDEX_V35_HISTORY_CACHE_TTL_MS", 5 * 60_000),
    });
    const config = buildDefaultDisDexV35RunnerConfig({
        mode: runnerMode,
        liveExecutionEnabled: boolEnv("DISDEX_V35_LIVE_EXECUTION_ENABLED", false),
        productionConfigLiveEnabled: DISDEX_V35_RUNTIME.liveTradingEnabled,
        cashReservePct: numberEnv("DISDEX_V35_CASH_RESERVE_PCT", DISDEX_V35_RUNTIME.cashReservePct),
        maxGross: numberEnv("DISDEX_V35_MAX_GROSS", DISDEX_V35_RUNTIME.maximumGross),
        maxSlippageBps: numberEnv("DISDEX_V35_MAX_SLIPPAGE_BPS", DISDEX_V35_RUNTIME.maximumSlippageBps),
        minOrderNotionalUsd: numberEnv("DISDEX_V35_MIN_ORDER_NOTIONAL_USD", DISDEX_V35_RUNTIME.minimumOrderNotionalUsd),
        rebalanceTolerancePct: numberEnv("DISDEX_V35_REBALANCE_TOLERANCE_PCT", DISDEX_V35_RUNTIME.rebalanceTolerancePct),
        maxTransactionRetries: numberEnv("DISDEX_V35_MAX_TRANSACTION_RETRIES", 5),
        closeUnmanagedPositions: boolEnv("DISDEX_V35_CLOSE_UNMANAGED_POSITIONS", DISDEX_V35_RUNTIME.closeUnmanagedPositions),
        penguRule: DISDEX_V35_PENGU_RULE,
    });
    const runner = new DisDexV35PortfolioRunner({
        marketData,
        executor,
        config,
        stateStore: new FileDisDexV35RunnerStateStore(resolve(stateRoot, `runner-${runnerMode}.json`), runnerMode),
        lock: new FileLiveRunnerLock(resolve(stateRoot, `runner-${runnerMode}.lock`), numberEnv("DISDEX_V35_LOCK_STALE_MS", 10 * 60_000)),
    });

    const daemon = process.argv.includes("--daemon");
    const intervalMs = Math.max(30_000, numberEnv("DISDEX_V35_RUNNER_INTERVAL_MS", 5 * 60_000));
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const result = await runner.tick();
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), runnerMode, ...result }));
        if (!daemon || stopping) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, intervalMs));
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
