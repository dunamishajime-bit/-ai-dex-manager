import "dotenv/config";
import { resolve } from "node:path";
import { STRATEGY_CONFIG } from "../config/strategyConfig";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { AsterRealtimeMarketDataProvider } from "../lib/aster-realtime-market-data-provider";
import { FileLiveRunnerLock, FileLiveRunnerStateStore } from "../lib/live-runner-state";
import { OneWayLongDirectTradeExecutor } from "../lib/one-way-long-direct-trade-executor";
import { PaperDirectTradeExecutor } from "../lib/paper-direct-trade-executor";
import {
    Win80Ultra90LiveRunner,
    buildDefaultLiveRunnerConfig,
} from "../lib/win80-ultra90-live-runner";

function boolEnv(name: string, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined) return fallback;
    return /^(1|true|yes|on)$/i.test(raw.trim());
}

function numberEnv(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function listEnv(name: string) {
    return String(process.env[name] || "")
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
}

function runnerMode(): "paper" | "live" {
    return String(process.env.WIN80_RUNNER_MODE || "paper").toLowerCase() === "live" ? "live" : "paper";
}

async function main() {
    const mode = runnerMode();
    const stateRoot = resolve(process.env.WIN80_RUNNER_STATE_DIR || ".runtime-state");
    const maxMarketAgeMs = numberEnv("WIN80_MAX_MARKET_AGE_MS", 30_000);
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
    });
    if (mode === "live" && !client.hasTradingCredentials()) {
        throw new Error("Live mode requires ASTER_USER_ADDRESS and ASTER_API_PRIVATE_KEY.");
    }

    const asterExecutor = new AsterDirectTradeExecutor(client, {
        exchangeInfoTtlMs: numberEnv("ASTER_EXCHANGE_INFO_TTL_MS", 15 * 60_000),
        reconciliationAttempts: numberEnv("ASTER_ORDER_RECONCILE_ATTEMPTS", 6),
        reconciliationDelayMs: numberEnv("ASTER_ORDER_RECONCILE_DELAY_MS", 1500),
    });
    const rawExecutor: DirectTradeExecutor = mode === "paper"
        ? new PaperDirectTradeExecutor(asterExecutor, {
            statePath: resolve(stateRoot, "paper-portfolio.json"),
            initialBalanceUsd: numberEnv("WIN80_PAPER_INITIAL_BALANCE_USD", 1000),
            feeBpsPerSide: numberEnv("WIN80_PAPER_FEE_BPS_PER_SIDE", 6),
        })
        : asterExecutor;
    const executor: DirectTradeExecutor = new OneWayLongDirectTradeExecutor(rawExecutor);
    const marketData = new AsterRealtimeMarketDataProvider(client, {
        historyInterval: process.env.WIN80_HISTORY_INTERVAL || "1h",
        historyLimit: numberEnv("WIN80_HISTORY_LIMIT", 220),
        historyCacheTtlMs: numberEnv("WIN80_HISTORY_CACHE_TTL_MS", 5 * 60_000),
        historyConcurrency: numberEnv("WIN80_HISTORY_CONCURRENCY", 5),
        maxMarketAgeMs,
    });
    const configuredSymbols = listEnv("WIN80_ASTER_SYMBOLS");
    const config = buildDefaultLiveRunnerConfig({
        mode,
        liveExecutionEnabled: boolEnv("WIN80_LIVE_EXECUTION_ENABLED", false),
        productionConfigLiveEnabled: STRATEGY_CONFIG.MAIN_STRATEGY_REAL_TRADING_ENABLED,
        symbols: configuredSymbols.length ? configuredSymbols : undefined,
        maxMarketAgeMs,
        cashReservePct: numberEnv("WIN80_CASH_RESERVE_PCT", 2),
        leverage: numberEnv("WIN80_ACCOUNT_NOTIONAL_LEVERAGE", 1),
        maxInitialNotionalUsd: numberEnv("WIN80_MAX_INITIAL_NOTIONAL_USD", 10_000),
        maxSlippageBps: numberEnv("WIN80_MAX_SLIPPAGE_BPS", 35),
        maxConcurrentPositions: numberEnv("WIN80_MAX_CONCURRENT_POSITIONS", 2),
        maxTransactionRetries: numberEnv("WIN80_MAX_TRANSACTION_RETRIES", 5),
        minOrderNotionalUsd: numberEnv("WIN80_MIN_ORDER_NOTIONAL_USD", 5),
    });
    const runner = new Win80Ultra90LiveRunner({
        marketData,
        executor,
        config,
        stateStore: new FileLiveRunnerStateStore(
            resolve(stateRoot, "win80-ultra90-runner.json"),
            STRATEGY_CONFIG.MAIN_STRATEGY_ID,
            mode,
        ),
        lock: new FileLiveRunnerLock(
            resolve(stateRoot, "win80-ultra90-runner.lock"),
            numberEnv("WIN80_LOCK_STALE_MS", 5 * 60_000),
        ),
    });

    const daemon = process.argv.includes("--daemon");
    const intervalMs = Math.max(10_000, numberEnv("WIN80_RUNNER_INTERVAL_MS", 30_000));
    let stopping = false;
    const stop = () => { stopping = true; };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);

    do {
        const result = await runner.tick();
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            mode,
            ...result,
        }));
        if (!daemon || stopping) break;
        await new Promise<void>((resolveWait) => setTimeout(resolveWait, intervalMs));
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({
        level: "fatal",
        message: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
});
