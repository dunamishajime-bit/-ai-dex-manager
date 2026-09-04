import { STRICT_BT33404708902 } from "@/config/disdexStrictBt33404708902Runtime";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { planStrictPortfolio, type StrictPortfolioIntent, type StrictPortfolioPosition, type StrictStrategy } from "@/lib/disdex-strict-portfolio-planner";
import { V12AsterLiveAdapter, type V12AsterLiveAdapterOptions } from "@/lib/v12-aster-live-adapter";
import { AsterV3Client } from "@/lib/aster-v3-client";
import { readQuality102CausalV1Ownership, quality102OwnsPosition, type Quality102CausalV1OwnershipSnapshot } from "@/lib/disdex-quality102-causal-v1-ownership";
import { reduceQuality102CausalV1ForBaseConflict } from "@/lib/disdex-quality102-causal-v1-live-reduction";
import type { DirectMarketQuote, DirectPosition, DirectTradeResult } from "@/lib/direct-trade-executor";

const DEFAULT_MAX_DATA_AGE_MS = 5 * 60_000;
const EPSILON = 1e-9;

function enabled(value: string | undefined) {
    return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function validQuality102LiveQuote(quote: DirectMarketQuote, symbol: string, now: number, maxAgeMs: number) {
    return quote.symbol.toUpperCase() === symbol.toUpperCase()
        && Number.isFinite(quote.bidPrice) && quote.bidPrice > 0
        && Number.isFinite(quote.askPrice) && quote.askPrice > 0
        && quote.askPrice >= quote.bidPrice
        && Number.isFinite(quote.midPrice) && quote.midPrice > 0
        && Number.isFinite(quote.spreadBps) && quote.spreadBps >= 0
        && Number.isFinite(quote.bidQuantity) && quote.bidQuantity > 0
        && Number.isFinite(quote.askQuantity) && quote.askQuantity > 0
        && Number.isFinite(quote.updatedAt) && quote.updatedAt > 0
        && quote.updatedAt <= now && now - quote.updatedAt <= maxAgeMs;
}

function assertConfiguredCap(env: NodeJS.ProcessEnv, name: string, expected: number) {
    const raw = env[name];
    if (raw === undefined || raw === "") return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || Math.abs(parsed - expected) > EPSILON) {
        throw new Error(`STRICT_PORTFOLIO_CONFIG_MISMATCH:${name}:${raw}:EXPECTED_${expected}`);
    }
}

/**
 * Production activation contract for the strict BT #33404708902 portfolio.
 * The planner is fail-closed: a release may not silently fall back to legacy
 * 1.50x crypto gross or enable Quality102 while selector parity is unproven.
 */
export function assertV12StrictLiveConfiguration(env: NodeJS.ProcessEnv = process.env) {
    if (!enabled(env.STRICT_PORTFOLIO_PLANNER_ACTIVE)) {
        throw new Error("STRICT_PORTFOLIO_PLANNER_NOT_ACTIVE");
    }
    assertConfiguredCap(env, "V12_GROSS_CAP", STRICT_BT33404708902.v12MaximumGross);
    assertConfiguredCap(env, "PENGU_GROSS_CAP", STRICT_BT33404708902.penguMaximumGross);
    assertConfiguredCap(env, "STOCK_GROSS_CAP", STRICT_BT33404708902.stockGrossCap);
    assertConfiguredCap(env, "CRYPTO_GROSS_CAP", STRICT_BT33404708902.cryptoGrossCap);
    assertConfiguredCap(env, "TOTAL_GROSS_CAP", STRICT_BT33404708902.totalGrossCap);
    if (enabled(env.QUALITY102_LIVE_ENABLED) || enabled(env.QUALITY102_LIVE_SELECTOR_PARITY)) {
        throw new Error("QUALITY102_LIVE_BLOCKED_FAIL_CLOSED");
    }
    return {
        v12GrossCap: STRICT_BT33404708902.v12MaximumGross,
        penguGrossCap: STRICT_BT33404708902.penguMaximumGross,
        stockGrossCap: STRICT_BT33404708902.stockGrossCap,
        cryptoGrossCap: STRICT_BT33404708902.cryptoGrossCap,
        totalGrossCap: STRICT_BT33404708902.totalGrossCap,
        quality102LiveSelectorParity: false as const,
        quality102LiveBlockedFailClosed: true as const,
    };
}

function strictStrategy(position: DirectPosition, quality102Ownership?: Quality102CausalV1OwnershipSnapshot): StrictStrategy {
    if (quality102OwnsPosition(quality102Ownership, position)) return "QUALITY102_CAUSAL_V1";
    const classification = classifyAsterSymbol(position.symbol);
    if (!classification.tradable) throw new Error(`ASTER_UNKNOWN_NONZERO_POSITION:${position.symbol}`);
    if (classification.sleeve === "V12") return "V12";
    if (classification.sleeve === "PENGU_DUAL_LS_V2") return "PENGU_DUAL_LS_V2";
    if (classification.sleeve === "V11_EQ" || classification.sleeve === "V50_POST_OPEN_BASIS") return "V52";
    throw new Error(`STRICT_PORTFOLIO_UNKNOWN_STRATEGY_OWNERSHIP:${position.symbol}`);
}

function toStrictPosition(position: DirectPosition, now: number, quality102Ownership?: Quality102CausalV1OwnershipSnapshot, quality102Quote?: DirectMarketQuote): StrictPortfolioPosition {
    const updatedAt = Number(position.updatedAt);
    const strategy = strictStrategy(position, quality102Ownership);
    if (strategy === "QUALITY102_CAUSAL_V1") {
        if (!quality102Quote || !validQuality102LiveQuote(quality102Quote, position.symbol, now, DEFAULT_MAX_DATA_AGE_MS) || !(Number(position.entryPrice) > 0) || !quality102Ownership?.position || !(quality102Ownership.position.entryTs > 0) || quality102Ownership.position.entryTs > now) {
            throw new Error(`QUALITY102_CAUSAL_V1_LIVE_QUOTE_REQUIRED:${position.symbol}`);
        }
        return {
            id: `aster:q102:${position.symbol.toUpperCase()}`,
            strategy,
            symbol: position.symbol.toUpperCase(),
            side: position.quantity < 0 || position.positionSide === "SHORT" ? "SHORT" : "LONG",
            quantity: Math.abs(position.quantity),
            entryPrice: Number(position.entryPrice),
            markPrice: quality102Quote.midPrice,
            entryTs: quality102Ownership.position.entryTs,
            updatedAt: quality102Quote.updatedAt,
            markSource: "LIVE_MARKET_QUOTE",
            markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: quality102Quote.updatedAt, price: quality102Quote.midPrice, crossChecked: true },
        };
    }
    return {
        id: `aster:${position.symbol.toUpperCase()}:${String(position.positionSide || "BOTH")}`,
        strategy,
        symbol: position.symbol.toUpperCase(),
        side: position.quantity < 0 || position.positionSide === "SHORT" ? "SHORT" : "LONG",
        quantity: Math.abs(position.quantity),
        entryPrice: Number(position.entryPrice),
        markPrice: Number(position.markPrice),
        entryTs: Number.isFinite(updatedAt) && updatedAt > 0 ? Math.min(updatedAt, now) : 1,
        updatedAt,
        markSource: "LIVE_MARKET_QUOTE",
    };
}

export class V12StrictAsterLiveAdapter extends V12AsterLiveAdapter {
    constructor(client: AsterV3Client, options: V12AsterLiveAdapterOptions = {}) {
        super(client, options);
    }

    override async executeEntry(input: {
        signalTs: number;
        symbol: string;
        side: "LONG" | "SHORT";
        quantity: number;
        expectedPrice: number;
        clientOrderId?: string;
    }): Promise<DirectTradeResult> {
        assertV12StrictLiveConfiguration();
        const now = Date.now();
        const [account, positions] = await Promise.all([
            this.getAccountSnapshot(),
            this.getPositions(),
        ]);
        const maxDataAgeMs = Math.max(1_000, Number(process.env.STRICT_PORTFOLIO_MAX_DATA_AGE_MS || DEFAULT_MAX_DATA_AGE_MS));
        if (!(account.walletBalance > 0) || !Number.isFinite(account.updatedAt) || account.updatedAt <= 0 || account.updatedAt > now || now - account.updatedAt > maxDataAgeMs) {
            throw new Error("STRICT_PORTFOLIO_ACCOUNT_SNAPSHOT_STALE_OR_INVALID");
        }
        const openOrders = await this.getOpenOrders();
        if (openOrders.length > 0) throw new Error("STRICT_PORTFOLIO_OPEN_ORDER_CONFLICT");
        let workingAccount = account;
        let workingPositions = positions;
        let quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_RUNTIME_COMMIT_SHA });
        const requestedNotional = Math.abs(input.quantity * input.expectedPrice);
        if (!(requestedNotional > 0)) throw new Error("STRICT_PORTFOLIO_REQUESTED_NOTIONAL_INVALID");
        let accepted: StrictPortfolioIntent | undefined;
        let acceptedNotional = 0;
        for (let attempt = 0; attempt < 3; attempt += 1) {
            const plannerNow = Date.now();
            const active = await Promise.all(workingPositions.map(async (row) => quality102OwnsPosition(quality102Ownership, row)
                ? toStrictPosition(row, plannerNow, quality102Ownership, await this.executor.getMarketQuote(row.symbol))
                : toStrictPosition(row, plannerNow, quality102Ownership)));
            const plan = planStrictPortfolio({
                equity: workingAccount.walletBalance,
                now: plannerNow,
                active,
                intents: [{
                    idempotencyKey: input.clientOrderId || `v12-strict-${input.signalTs}-${input.symbol}-${input.side}`,
                    strategy: "V12",
                    symbol: input.symbol,
                    side: input.side,
                    gross: requestedNotional / workingAccount.walletBalance,
                    notionalUsd: requestedNotional,
                    signalTs: input.signalTs,
                }],
                maxDataAgeMs,
            });
            if (plan.status !== "planned") throw new Error(`STRICT_PORTFOLIO_PLAN_BLOCKED:${plan.reason || "UNKNOWN"}`);
            const reductions = plan.reductions.filter((reduction) => reduction.strategy === "QUALITY102_CAUSAL_V1");
            if (plan.reductions.some((reduction) => reduction.strategy !== "QUALITY102_CAUSAL_V1")) throw new Error("STRICT_PORTFOLIO_UNEXPECTED_BASE_REDUCTION");
            if (reductions.length > 0) {
                for (const reduction of reductions) {
                    const reduced = await reduceQuality102CausalV1ForBaseConflict({
                        executor: this.executor,
                        reduction,
                        causeIdempotencyKey: input.clientOrderId || `v12-strict-${input.signalTs}-${input.symbol}-${input.side}`,
                        maxSlippageBps: this.maxSlippageBps,
                        maxDataAgeMs,
                        expectedRuntimeSha: process.env.DISDEX_RUNTIME_COMMIT_SHA,
                    });
                    if (reduced.status !== "reduced") throw new Error(`QUALITY102_MTM_REDUCTION_BLOCKED:${reduced.message}`);
                }
                [workingAccount, workingPositions] = await Promise.all([this.getAccountSnapshot(), this.getPositions()]);
                quality102Ownership = await readQuality102CausalV1Ownership({ expectedRuntimeSha: process.env.DISDEX_RUNTIME_COMMIT_SHA });
                continue;
            }
            const row = plan.accepted.find((intent) => intent.strategy === "V12" && intent.symbol.toUpperCase() === input.symbol.toUpperCase());
            if (!row || !(row.notionalUsd > 0)) throw new Error(`STRICT_PORTFOLIO_CAPACITY_BLOCKED:${plan.rejected[0]?.reason || "NO_ACCEPTED_V12_INTENT"}`);
            acceptedNotional = row.notionalUsd;
            accepted = row;
            break;
        }
        if (!accepted || !(acceptedNotional > 0)) throw new Error("STRICT_PORTFOLIO_REDUCTION_RETRY_EXHAUSTED");
        const scale = Math.min(1, acceptedNotional / requestedNotional);
        const quantity = input.quantity * scale;
        if (!(quantity > 0)) throw new Error("STRICT_PORTFOLIO_ZERO_EXECUTABLE_QUANTITY");
        return super.executeEntry({ ...input, quantity });
    }
}
