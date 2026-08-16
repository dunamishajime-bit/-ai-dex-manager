import { resolveV12X1AllRuntime, type V12RuntimeMode } from "@/config/v12X1AllRuntime";
import { buildV12Signal, sizeV12Position, type V12Bar, type V12Signal } from "@/lib/v12-x1-all";
import { FileAccountOrderLock } from "@/lib/disdex-account-order-lock";
import { readSharedCryptoDailyRisk } from "@/lib/disdex-shared-crypto-daily-risk";

export interface V12X1AllRunnerDependencies {
    marketData: { load(): Promise<Record<string, V12Bar[]>> };
    equity: () => Promise<number>;
    now?: () => number;
    lock?: FileAccountOrderLock;
    log?: (message: string, payload?: Record<string, unknown>) => void;
}

export interface V12RunnerState { strategyId: "V12_X1.00_ALL"; mode: V12RuntimeMode; updatedAt: number; lastReferenceTs?: number; active?: { symbol: string; side: string; gross: number }; manualReview?: string; }
export type V12TickResult = { status: "disabled" | "risk-blocked" | "locked" | "no-signal" | "shadow" | "paper" | "live-blocked"; reason: string; signal?: V12Signal; requestedGross?: number };

function logger(deps: V12X1AllRunnerDependencies) { return deps.log || ((message, payload) => console.log(JSON.stringify({ message, ...(payload || {}) }))); }

/**
 * Production-shaped runner. It deliberately has no venue client and cannot
 * submit an order. A future LIVE adapter must be added behind the explicit
 * gates and resident-stop lifecycle; today LIVE returns live-blocked.
 */
export async function runV12X1AllOnce(deps: V12X1AllRunnerDependencies, env: Partial<NodeJS.ProcessEnv> = process.env): Promise<V12TickResult> {
    const runtime = resolveV12X1AllRuntime(env);
    const log = logger(deps);
    if (!runtime.enabled || runtime.mode === "SHADOW" && env.V12_X1_ALL_SHADOW_DISABLED === "1") return { status: "disabled", reason: "V12_RUNTIME_DISABLED" };
    const risk = await readSharedCryptoDailyRisk(runtime.riskPath, (deps.now || Date.now)());
    if (!risk.ok && runtime.mode !== "SHADOW") return { status: "risk-blocked", reason: `SHARED_CRYPTO_RISK:${risk.reason}` };
    const data = await deps.marketData.load();
    const lengths = Object.values(data).map((bars) => bars.length);
    if (!lengths.length || lengths.some((length) => length !== lengths[0])) return { status: "no-signal", reason: "MARKET_DATA_ALIGNMENT_REQUIRED" };
    const index = lengths[0] - 1;
    const signal = buildV12Signal(data, index);
    if (!signal) return { status: "no-signal", reason: "NO_COMPLETED_BAR_SIGNAL" };
    const equity = await deps.equity();
    const sizing = sizeV12Position(equity, data[signal.symbol][index].close, signal.atr, signal.side);
    const lock = deps.lock || new FileAccountOrderLock(runtime.lockPath);
    const handle = await lock.acquire(`V12_X1.00_ALL:${process.pid}`);
    if (!handle) return { status: "locked", reason: "ACCOUNT_LOCK_BUSY", signal, requestedGross: sizing.requestedGross };
    try {
        await handle.reserve({ strategyId: runtime.strategyId, symbol: `${signal.symbol}USDT`, side: signal.side, gross: sizing.requestedGross, notionalUsd: sizing.requestedNotional });
        log("v12-signal", { strategyId: runtime.strategyId, mode: runtime.mode, signal, requestedGross: sizing.requestedGross, ordersSent: 0 });
        if (runtime.mode === "LIVE") return { status: "live-blocked", reason: "LIVE_ADAPTER_NOT_INSTALLED_AND_EXPLICIT_ACTIVATION_REQUIRED", signal, requestedGross: sizing.requestedGross };
        return { status: runtime.mode === "PAPER" ? "paper" : "shadow", reason: "PLAN_ONLY_NO_ORDER_SUBMISSION", signal, requestedGross: sizing.requestedGross };
    } finally { await handle.release(); }
}

if (process.argv.includes("--self-test")) {
    const now = Date.now();
    const bars = (symbol: string): V12Bar[] => Array.from({ length: 80 }, (_, index) => ({ ts: now - (80 - index) * 7_200_000, endTs: now - (79 - index) * 7_200_000, open: 100 + index, high: 101 + index, low: 99 + index, close: 100 + index, volume: 1000, sourceCount: 2 as const }));
    runV12X1AllOnce({ marketData: { load: async () => Object.fromEntries(["BTC", "ETH", ...["BNB", "SOL", "LINK", "AVAX", "DOGE", "INJ", "XRP", "ADA", "LTC", "ATOM", "AAVE", "NEAR"].map((symbol) => [symbol, bars(symbol)])]) }, equity: async () => 1000 }, { V12_X1_ALL_ENABLED: "false" }).then((result) => { if (result.status !== "disabled") throw new Error("V12_RUNNER_SELFTEST_FAILED"); console.log("V12_X1_ALL_RUNNER_SELFTEST_PASS"); });
}
