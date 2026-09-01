import { STRICT_BT33404708902 } from "@/config/disdexStrictBt33404708902Runtime";
import { classifyAsterSymbol } from "@/lib/disdex-aster-portfolio-classifier";
import { planStrictPortfolio, type StrictPortfolioPosition, type StrictStrategy } from "@/lib/disdex-strict-portfolio-planner";
import { V12AsterLiveAdapter, type V12AsterLiveAdapterOptions } from "@/lib/v12-aster-live-adapter";
import { AsterV3Client } from "@/lib/aster-v3-client";
import type { DirectPosition, DirectTradeResult } from "@/lib/direct-trade-executor";

const DEFAULT_MAX_DATA_AGE_MS = 5 * 60_000;
const EPSILON = 1e-9;

function enabled(value: string | undefined) {
    return /^(1|true|yes|on)$/i.test(String(value || "").trim());
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

function strictStrategy(position: DirectPosition): StrictStrategy {
    const classification = classifyAsterSymbol(position.symbol);
    if (!classification.tradable) throw new Error(`ASTER_UNKNOWN_NONZERO_POSITION:${position.symbol}`);
    if (classification.sleeve === "V12") return "V12";
    if (classification.sleeve === "PENGU_DUAL_LS_V2") return "PENGU_DUAL_LS_V2";
    if (classification.sleeve === "V11_EQ" || classification.sleeve === "V50_POST_OPEN_BASIS") return "V52";
    throw new Error(`STRICT_PORTFOLIO_UNKNOWN_STRATEGY_OWNERSHIP:${position.symbol}`);
}

function toStrictPosition(position: DirectPosition, now: number): StrictPortfolioPosition {
    const updatedAt = Number(position.updatedAt);
    return {
        id: `aster:${position.symbol.toUpperCase()}:${String(position.positionSide || "BOTH")}`,
        strategy: strictStrategy(position),
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
        const active = positions.map((row) => toStrictPosition(row, now));
        const requestedNotional = Math.abs(input.quantity * input.expectedPrice);
        const requestedGross = requestedNotional / account.walletBalance;
        const plan = planStrictPortfolio({
            equity: account.walletBalance,
            now,
            active,
            intents: [{
                idempotencyKey: input.clientOrderId || `v12-strict-${input.signalTs}-${input.symbol}-${input.side}`,
                strategy: "V12",
                symbol: input.symbol,
                side: input.side,
                gross: requestedGross,
                notionalUsd: requestedNotional,
                signalTs: input.signalTs,
            }],
            maxDataAgeMs,
        });
        if (plan.status !== "planned") throw new Error(`STRICT_PORTFOLIO_PLAN_BLOCKED:${plan.reason || "UNKNOWN"}`);
        if (plan.reductions.length > 0) {
            // Quality102 is not LIVE-enabled. Never let the V12 executor mutate
            // a Quality102 position as a side effect of making capacity.
            throw new Error("QUALITY102_MTM_REDUCTION_REQUIRES_DEDICATED_EXECUTOR_FAIL_CLOSED");
        }
        const accepted = plan.accepted.find((row) => row.strategy === "V12" && row.symbol.toUpperCase() === input.symbol.toUpperCase());
        if (!accepted || !(accepted.notionalUsd > 0) || !(requestedNotional > 0)) {
            throw new Error(`STRICT_PORTFOLIO_CAPACITY_BLOCKED:${plan.rejected[0]?.reason || "NO_ACCEPTED_V12_INTENT"}`);
        }
        const scale = Math.min(1, accepted.notionalUsd / requestedNotional);
        const quantity = input.quantity * scale;
        if (!(quantity > 0)) throw new Error("STRICT_PORTFOLIO_ZERO_EXECUTABLE_QUANTITY");
        return super.executeEntry({ ...input, quantity });
    }
}
