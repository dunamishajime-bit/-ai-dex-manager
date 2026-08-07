import "dotenv/config";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { FileLiveRunnerLock } from "../lib/live-runner-state";
import { DISDEX_V97_RUNTIME, resolveDisDexV97Runtime } from "../config/disdexV97Runtime";
import { DisDexV97AsterMarketDataProvider } from "../lib/disdex-v97-market-data-provider";
import { DisDexV97PortfolioRunner } from "../lib/disdex-v97-portfolio-runner";
import { FileDisDexV97RunnerStateStore } from "../lib/disdex-v97-runner-state";

function numberEnv(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
    const runtime = resolveDisDexV97Runtime();
    const stateRoot = resolve(process.env.DISDEX_V97_STATE_DIR || DISDEX_V97_RUNTIME.stateDirectory);
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-V97/1.0",
    });
    if (runtime.mode === "LIVE" && runtime.enabled && !client.hasTradingCredentials()) {
        throw new Error("V97 LIVE requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    const aster = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const executor: DirectTradeExecutor = runtime.mode === "LIVE"
        ? aster
        : new SignedPaperDirectTradeExecutor(aster, {
            statePath: resolve(stateRoot, "paper-portfolio.json"),
            initialBalanceUsd: numberEnv("DISDEX_V97_PAPER_INITIAL_BALANCE_USD", 1000),
            feeBpsPerSide: numberEnv("DISDEX_V97_PAPER_FEE_BPS_PER_SIDE", 5),
            maxGross: runtime.maximumGross + 0.05,
        });
    const marketData = new DisDexV97AsterMarketDataProvider(client, {
        klineLimit: numberEnv("DISDEX_V97_4H_LIMIT", 1500),
        fundingLimit: numberEnv("DISDEX_V97_FUNDING_LIMIT", 1000),
        fundingBaseUrl: process.env.ASTER_PUBLIC_FUTURES_BASE_URL || "https://fapi.asterdex.com",
        cacheTtlMs: numberEnv("DISDEX_V97_HISTORY_CACHE_TTL_MS", 5 * 60_000),
    });
    const runner = new DisDexV97PortfolioRunner({
        marketData,
        executor,
        stateStore: new FileDisDexV97RunnerStateStore(resolve(stateRoot, `runner-${runtime.mode.toLowerCase()}.json`), runtime.mode),
        lock: new FileLiveRunnerLock(resolve(process.env.DISDEX_V97_LOCK_PATH || stateRoot, `runner-${runtime.mode.toLowerCase()}.lock`), numberEnv("DISDEX_V97_LOCK_STALE_MS", 10 * 60_000)),
        config: {
            mode: runtime.mode,
            enabled: runtime.enabled,
            liveExecutionEnabled: runtime.liveExecutionEnabled,
            productionConfigLiveEnabled: runtime.liveTradingEnabled,
            maximumGross: runtime.maximumGross,
            baseGross: runtime.baseGross,
            portfolioGrossCap: runtime.portfolioGrossCap,
            maximumDailyLossPct: runtime.maximumDailyLossPct,
            maxSlippageBps: runtime.maxSlippageBps,
            minimumOrderNotionalUsd: runtime.minimumOrderNotionalUsd,
            cashReservePct: 2,
            maxTransactionRetries: runtime.maxTransactionRetries,
            killSwitchPath: runtime.killSwitchPath,
            portfolioDailyLossStatePath: runtime.portfolioDailyLossStatePath,
            // Adaptive resolver remains fixed until the chronological V97 research
            // selects and pins an exact controller. Repository LIVE is disabled meanwhile.
            targetGrossResolver: () => runtime.baseGross,
        },
    });
    console.log(JSON.stringify({
        event: "disdex-v97-runner-start",
        strategyId: runtime.strategyId,
        mode: runtime.mode,
        enabled: runtime.enabled,
        repositoryLiveEnabled: runtime.liveTradingEnabled,
        liveExecutionEnabled: runtime.liveExecutionEnabled,
        baseGross: runtime.baseGross,
        maximumGross: runtime.maximumGross,
        portfolioGrossCap: runtime.portfolioGrossCap,
        maximumDailyLossPct: runtime.maximumDailyLossPct,
        adaptiveEnabled: runtime.adaptiveEnabled,
        orderSubmissionPossible: runtime.mode === "LIVE" && runtime.enabled && runtime.liveTradingEnabled && runtime.liveExecutionEnabled,
    }));
    const daemon = process.argv.includes("--daemon");
    const intervalMs = Math.max(30_000, numberEnv("DISDEX_V97_RUNNER_INTERVAL_MS", 30_000));
    let stopping = false;
    const stop = () => { stopping = true; };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    do {
        const result = await runner.tick();
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), mode: runtime.mode, strategyId: runtime.strategyId, ...result }));
        if (result.status === "manual-review") stopping = true;
        if (!daemon || stopping) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, intervalMs));
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", strategyId: "V97_ADAPTIVE_EVENT_CORE_V1", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
