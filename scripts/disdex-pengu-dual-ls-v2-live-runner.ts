import "dotenv/config";
import { resolve } from "node:path";
import { AsterV3Client } from "../lib/aster-v3-client";
import { AsterDirectTradeExecutor, type DirectTradeExecutor } from "../lib/direct-trade-executor";
import { DEFAULT_ACCOUNT_SCOPE, FileAccountOrderLock, type AccountLockHandle } from "../lib/disdex-account-order-lock";
import { createInterruptibleDelay } from "../lib/interruptible-delay";
import { sendEmail } from "../lib/mail-service";
import { SignedPaperDirectTradeExecutor } from "../lib/signed-paper-direct-trade-executor";
import { resolvePenguDualLsV2Runtime } from "../config/penguDualLsV2Runtime";
import { PenguDualLsV2AsterMarketDataProvider } from "../lib/pengu-dual-ls-v2-market-data-provider";
import { PenguDualLsV2PortfolioRunner } from "../lib/pengu-dual-ls-v2-portfolio-runner";
import { FilePenguDualLsV2RunnerStateStore, type PenguDualLsV2RunnerState } from "../lib/pengu-dual-ls-v2-runner-state";

const HOUR_MS = 60 * 60_000;
const SYMBOL = "PENGUUSDT";
const DEFAULT_ORDER_FILL_EMAIL = "dunamis.hajime@gmail.com";

function numberEnv(name: string, fallback: number) {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function penguAccountPriority(state: PenguDualLsV2RunnerState) {
    // An existing position may require a stop/trailing/exit decision on this
    // tick; pending reduce-only recovery is definitively risk-reducing. Both are
    // P1. Flat/new-exposure work is P3, behind V52 entry and every P1 action.
    return state.position || state.pending?.reduceOnly ? 1 : 3;
}

class PenguPriorityAccountOrderLock extends FileAccountOrderLock {
    constructor(
        path: string,
        leaseMs: number,
        private readonly stateStore: FilePenguDualLsV2RunnerStateStore,
        statePath: string,
    ) {
        super(path, leaseMs, {
            ownerPrefix: "PENGU_DUAL_LS_V2:",
            strategyId: "PENGU_DUAL_LS_V2_FINAL",
            pendingStatePath: statePath,
            fixedSymbol: SYMBOL,
        });
    }

    override async acquire(ownerId: string, accountScope = DEFAULT_ACCOUNT_SCOPE): Promise<AccountLockHandle | null> {
        const state = await this.stateStore.load();
        const priority = penguAccountPriority(state);
        return super.acquire(`PENGU_DUAL_LS_V2:P${priority}:${process.pid}:${ownerId}`, accountScope);
    }
}

function notifyPenguFill(result: { status: string; message: string; idempotencyKey?: string }, mode: string) {
    if (mode !== "LIVE" || result.status !== "completed") return;
    const to = (process.env.PENGU_ORDER_FILL_EMAIL || process.env.DISDEX_ORDER_FILL_EMAIL || DEFAULT_ORDER_FILL_EMAIL).trim();
    if (!to) return;
    const subject = "[DisDex][FILLED] PENGU_DUAL_LS_V2 order fill";
    const text = ["DisDex PENGU order fill confirmed.", "", "Status: FILLED", "Strategy: PENGU_DUAL_LS_V2_FINAL", `Mode: ${mode}`, `Result: ${result.message}`, `Timestamp: ${new Date().toISOString()}`, `IdempotencyKey: ${result.idempotencyKey || "-"}`].join("\n");
    void sendEmail(to, subject, text).then((mailResult) => {
        if (!mailResult.success || mailResult.simulated) console.error(JSON.stringify({ level: "error", event: "PENGU_ORDER_FILL_EMAIL_FAILED", to, simulated: mailResult.simulated, error: String(mailResult.error || "mail provider not configured") }));
    }).catch((error) => console.error(JSON.stringify({ level: "error", event: "PENGU_ORDER_FILL_EMAIL_FAILED", to, error: error instanceof Error ? error.message : String(error) })));
}

async function main() {
    const runtime = resolvePenguDualLsV2Runtime();
    const stateRoot = resolve(process.env.PENGU_DUAL_LS_V2_STATE_DIR || ".runtime-state/pengu-dual-ls-v2");
    const statePath = resolve(stateRoot, `runner-${runtime.mode.toLowerCase()}.json`);
    const stateStore = new FilePenguDualLsV2RunnerStateStore(statePath, runtime.mode);
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
    const accountLock = new PenguPriorityAccountOrderLock(
        process.env.DISDEX_ACCOUNT_LOCK_PATH || ".runtime-state/shared/account-order.lock",
        numberEnv("DISDEX_ACCOUNT_LOCK_LEASE_MS", 120_000),
        stateStore,
        statePath,
    );
    const runner = new PenguDualLsV2PortfolioRunner({
        marketData,
        executor,
        stateStore,
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
            portfolioGrossCap: runtime.portfolioGrossCap,
            combinedPortfolioGrossCap: runtime.combinedPortfolioGrossCap,
            maximumDailyLossPct: runtime.maximumDailyLossPct,
            killSwitchPath: runtime.killSwitchPath,
            portfolioDailyLossStatePath: runtime.portfolioDailyLossStatePath,
        },
    });
    const daemon = process.argv.includes("--daemon");
    const boundaryDelayMs = Math.min(30_000, Math.max(1_000, numberEnv("PENGU_DUAL_LS_V2_BOUNDARY_DELAY_MS", 5_000)));
    const lockRetryMs = Math.min(30_000, Math.max(1_000, numberEnv("PENGU_DUAL_LS_V2_LOCK_RETRY_MS", 5_000)));
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
        console.log(JSON.stringify({ timestamp: new Date().toISOString(), mode: runtime.mode, strategyId: runtime.strategyId, ...result }));
        notifyPenguFill(result, runtime.mode);
        if (!daemon || stopping) break;
        if (result.status === "locked") {
            // A simultaneous higher-priority P1/P2 critical section must not make
            // PENGU miss its still-valid entry/exit window. Retry shortly.
            await boundaryWait.wait(lockRetryMs);
            continue;
        }
        const now = Date.now();
        const waitUntilNextClosedHour = HOUR_MS - (now % HOUR_MS) + boundaryDelayMs;
        await boundaryWait.wait(waitUntilNextClosedHour);
    } while (!stopping);
}

main().catch((error) => {
    console.error(JSON.stringify({ level: "fatal", strategyId: "PENGU_DUAL_LS_V2_FINAL", message: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
});
