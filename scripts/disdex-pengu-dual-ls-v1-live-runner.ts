import "dotenv/config";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { FileLiveRunnerLock, resolveLiveRunnerLockPath } from "../lib/live-runner-state";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { resolvePenguDualLsV1Runtime } from "../config/penguDualLsV1Runtime";
import { PenguDualLsV1AsterMarketDataProvider } from "../lib/pengu-dual-ls-v1-market-data-provider";
import { PenguDualLsV1PortfolioRunner } from "../lib/pengu-dual-ls-v1-portfolio-runner";
import { FilePenguDualLsV1RunnerStateStore } from "../lib/pengu-dual-ls-v1-runner-state";

function numberEnv(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
    const runtime = resolvePenguDualLsV1Runtime();
    const stateRoot = resolve(process.env.PENGU_DUAL_LS_V1_STATE_DIR || ".runtime-state/pengu-dual-ls-v1");
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-PENGU-Dual-LS-V1/1.0",
    });
    if (runtime.mode === "LIVE" && runtime.enabled && !client.hasTradingCredentials()) {
        throw new Error("PENGU_DUAL_LS_V1 LIVE requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }
    const aster = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const executor: DirectTradeExecutor = runtime.mode === "SHADOW" || runtime.mode === "PAPER"
        ? new SignedPaperDirectTradeExecutor(aster, {
            statePath: resolve(stateRoot, "paper-portfolio.json"),
            initialBalanceUsd: numberEnv("PENGU_DUAL_LS_V1_PAPER_INITIAL_BALANCE_USD", 1000),
            feeBpsPerSide: numberEnv("PENGU_DUAL_LS_V1_PAPER_FEE_BPS_PER_SIDE", 6),
            maxGross: runtime.maximumGross + 0.05,
        })
        : aster;
    const marketData = new PenguDualLsV1AsterMarketDataProvider(client, {
        hourlyLimit: numberEnv("PENGU_DUAL_LS_V1_HOURLY_LIMIT", 1000),
        fundingLimit: numberEnv("PENGU_DUAL_LS_V1_FUNDING_LIMIT", 1000),
        fundingBaseUrl: process.env.ASTER_PUBLIC_FUTURES_BASE_URL || "https://fapi.asterdex.com",
        cacheTtlMs: numberEnv("PENGU_DUAL_LS_V1_HISTORY_CACHE_TTL_MS", 5 * 60_000),
        fundingCacheTtlMs: numberEnv("PENGU_DUAL_LS_V1_FUNDING_CACHE_TTL_MS", 5 * 60_000),
    });
    const runner = new PenguDualLsV1PortfolioRunner({
        marketData,
        executor,
        stateStore: new FilePenguDualLsV1RunnerStateStore(resolve(stateRoot, `runner-${runtime.mode.toLowerCase()}.json`), runtime.mode),
        lock: new FileLiveRunnerLock(resolveLiveRunnerLockPath(process.env.PENGU_DUAL_LS_V1_LOCK_PATH, stateRoot, runtime.mode.toLowerCase() as "live" | "paper"), numberEnv("PENGU_DUAL_LS_V1_LOCK_STALE_MS", 10 * 60_000)),
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
            portfolioGrossCap: runtime.portfolioGrossCap,
            maximumDailyLossPct: runtime.maximumDailyLossPct,
            killSwitchPath: runtime.killSwitchPath,
            portfolioDailyLossStatePath: runtime.portfolioDailyLossStatePath,
        },
    });
    const daemon = process.argv.includes("--daemon");
    const intervalMs = Math.max(60_000, numberEnv("PENGU_DUAL_LS_V1_RUNNER_INTERVAL_MS", 60 * 60_000));
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    do {
        const result = await runner.tick();
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), mode: runtime.mode, strategyId: runtime.strategyId, ...result }));
        if (!daemon || stopping) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, intervalMs));
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", strategyId: "PENGU_DUAL_LS_V1", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
