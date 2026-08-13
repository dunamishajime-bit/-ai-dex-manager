import "dotenv/config";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { FileLiveRunnerLock, resolveLiveRunnerLockPath } from "../lib/live-runner-state";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { sendEmail } from "../lib/mail-service";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { resolvePenguDualLsV2Runtime } from "../config/penguDualLsV2Runtime";
import { PenguDualLsV2AsterMarketDataProvider } from "../lib/pengu-dual-ls-v2-market-data-provider";
import { PenguDualLsV2PortfolioRunner } from "../lib/pengu-dual-ls-v2-portfolio-runner";
import { FilePenguDualLsV2RunnerStateStore } from "../lib/pengu-dual-ls-v2-runner-state";

const HOUR_MS = 60 * 60_000;
const DEFAULT_ORDER_FILL_EMAIL = "dunamis.hajime@gmail.com";

function numberEnv(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function main() {
    const runtime = resolvePenguDualLsV2Runtime();
    const stateRoot = resolve(process.env.PENGU_DUAL_LS_V2_STATE_DIR || ".runtime-state/pengu-dual-ls-v2");
    const client = new AsterV3Client({
        baseUrl: process.env.ASTER_FUTURES_BASE_URL,
        userAddress: process.env.ASTER_USER_ADDRESS,
        privateKey: process.env.ASTER_API_PRIVATE_KEY as `0x${string}` | undefined,
        requestTimeoutMs: numberEnv("ASTER_REQUEST_TIMEOUT_MS", 10_000),
        recvWindowMs: numberEnv("ASTER_RECV_WINDOW_MS", 5000),
        userAgent: "DisDex-PENGU-Dual-LS-V2/1.0",
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
    const runner = new PenguDualLsV2PortfolioRunner({
        marketData,
        executor,
        stateStore: new FilePenguDualLsV2RunnerStateStore(resolve(stateRoot, `runner-${runtime.mode.toLowerCase()}.json`), runtime.mode),
        lock: new FileLiveRunnerLock(resolveLiveRunnerLockPath(process.env.PENGU_DUAL_LS_V2_LOCK_PATH, stateRoot, runtime.mode.toLowerCase() as "live" | "paper"), numberEnv("PENGU_DUAL_LS_V2_LOCK_STALE_MS", 10 * 60_000)),
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
            portfolioGrossCap: runtime.portfolioGrossCap,
            maximumDailyLossPct: runtime.maximumDailyLossPct,
            killSwitchPath: runtime.killSwitchPath,
            portfolioDailyLossStatePath: runtime.portfolioDailyLossStatePath,
        },
    });
    const daemon = process.argv.includes("--daemon");
    const boundaryDelayMs = Math.min(30_000, Math.max(1_000, numberEnv("PENGU_DUAL_LS_V2_BOUNDARY_DELAY_MS", 5_000)));
    const orderFillEmail = (process.env.PENGU_ORDER_FILL_EMAIL || DEFAULT_ORDER_FILL_EMAIL).trim();
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
        const timestamp = new Date().toISOString();
        console.log(JSON.stringify({ timestamp, mode: runtime.mode, strategyId: runtime.strategyId, ...result }));
        // Notify only after the portfolio runner has durably recorded a confirmed LIVE fill.
        // Notification failure must never retry or fail the trading cycle.
        if (runtime.mode === "LIVE" && result.status === "completed" && orderFillEmail) {
            const subject = `[DisDex][FILLED] ${runtime.strategyId} 豕ｨ譁・ｴ・ｮ啻;
            const text = [
                "DisDex縺ｧ豕ｨ譁・′邏・ｮ壹＠縺ｾ縺励◆縲・,
                "",
                "Status: FILLED",
                `Strategy: ${runtime.strategyId}`,
                `Mode: ${runtime.mode}`,
                `Result: ${result.message}`,
                `Timestamp: ${timestamp}`,
                `IdempotencyKey: ${result.idempotencyKey || "-"}`,
                `SignalSide: ${result.signal?.side ?? "-"}`,
                `Reason: ${result.signal?.reason || "-"}`,
            ].join("\n");
            try {
                const mailResult = await sendEmail(orderFillEmail, subject, text);
                if (mailResult.success && !mailResult.simulated) {
                    console.log(JSON.stringify({ level: "info", event: "PENGU_ORDER_FILL_EMAIL_SENT", to: orderFillEmail, idempotencyKey: result.idempotencyKey }));
                } else {
                    console.error(JSON.stringify({ level: "error", event: "PENGU_ORDER_FILL_EMAIL_FAILED", to: orderFillEmail, simulated: mailResult.simulated, error: mailResult.error instanceof Error ? mailResult.error.message : String(mailResult.error || "mail provider not configured") }));
                }
            } catch (error) {
                console.error(JSON.stringify({ level: "error", event: "PENGU_ORDER_FILL_EMAIL_FAILED", to: orderFillEmail, error: error instanceof Error ? error.message : String(error) }));
            }
        }
        if (!daemon || stopping) break;
        const now = Date.now();
        const waitUntilNextClosedHour = HOUR_MS - (now % HOUR_MS) + boundaryDelayMs;
        await boundaryWait.wait(waitUntilNextClosedHour);
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", strategyId: "PENGU_DUAL_LS_V2_FINAL", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
