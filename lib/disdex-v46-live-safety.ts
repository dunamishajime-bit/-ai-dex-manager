import type { DirectAccountSnapshot, DirectOpenOrder, DirectPosition } from "./direct-trade-executor";
import type { DisDexPenguV46History as DisDexV46History } from "./pengu-dual-engine-v46";

export const DISDEX_V46_MANAGED_SYMBOLS = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "PENGUUSDT"] as const;

export interface DisDexV46PositionSnapshot {
    symbol: string;
    quantity: number;
    positionSide: string;
    notionalUsd: number;
    entryPrice: number;
    markPrice: number;
    updatedAt: number;
}

export interface DisDexV46AccountSnapshot {
    walletBalance: number;
    availableBalance: number;
    equity: number;
    updatedAt: number;
}

function finite(value: unknown, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

export function snapshotPositions(positions: DirectPosition[]): DisDexV46PositionSnapshot[] {
    return positions
        .map((position) => ({
            symbol: position.symbol.toUpperCase(),
            quantity: finite(position.quantity),
            positionSide: position.positionSide || "BOTH",
            notionalUsd: Math.abs(finite(position.notionalUsd)),
            entryPrice: finite(position.entryPrice),
            markPrice: finite(position.markPrice),
            updatedAt: finite(position.updatedAt, Date.now()),
        }))
        .filter((position) => Math.abs(position.quantity) > 1e-12)
        .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function positionsMatch(saved: DisDexV46PositionSnapshot[], actual: DirectPosition[]) {
    const current = snapshotPositions(actual);
    if (saved.length !== current.length) return false;
    const savedMap = new Map(saved.map((position) => [`${position.symbol}:${position.positionSide}`, position]));
    for (const position of current) {
        const prior = savedMap.get(`${position.symbol}:${position.positionSide}`);
        if (!prior) return false;
        const tolerance = Math.max(1e-8, Math.abs(prior.quantity) * 0.0005);
        if (Math.abs(prior.quantity - position.quantity) > tolerance) return false;
    }
    return true;
}

function latestCandle(label: string, rows: Array<{ openTime: number; closeTime: number }>, now: number, maxAgeMs: number) {
    if (!rows.length) throw new Error(`LIVE market data missing for ${label}.`);
    const latest = rows.reduce((value, row) => Math.max(value, finite(row.closeTime)), 0);
    if (latest <= 0 || latest >= now) throw new Error(`LIVE market data for ${label} is not a completed candle.`);
    if (now - latest > maxAgeMs) throw new Error(`LIVE market data for ${label} is stale by ${now - latest}ms.`);
    return latest;
}

export interface DisDexV46MarketDataAgeLimits {
    core12hMs: number;
    hourlyMs: number;
}

export function assertMarketDataFreshness(
    history: DisDexV46History,
    now = Date.now(),
    limits: number | Partial<DisDexV46MarketDataAgeLimits> = {},
) {
    const core12hMs = typeof limits === "number" ? limits : limits.core12hMs ?? 13 * 60 * 60_000;
    const hourlyMs = typeof limits === "number" ? limits : limits.hourlyMs ?? 2 * 60 * 60_000;
    const latest: Record<string, number> = {};
    for (const [symbol, rows] of Object.entries(history.core12h) as Array<[string, Array<{ openTime: number; closeTime: number }> ]>) {
        latest[`core12h:${symbol}`] = latestCandle(`core12h:${symbol}`, rows, now, core12hMs);
    }
    latest.BTCUSDT_1h = latestCandle("BTCUSDT 1h", history.btc1h, now, hourlyMs);
    latest.PENGUUSDT_1h = latestCandle("PENGUUSDT 1h", history.pengu1h, now, hourlyMs);
    return latest;
}

export function calculateEquity(account: DirectAccountSnapshot, positions: DirectPosition[]) {
    const walletBalance = finite(account.walletBalance, Number.NaN);
    const availableBalance = finite(account.availableBalance, Number.NaN);
    const unrealizedPnl = positions.reduce((sum, position) => sum + finite(position.unrealizedPnl), 0);
    const equity = walletBalance + unrealizedPnl;
    if (!Number.isFinite(walletBalance) || !Number.isFinite(availableBalance) || !Number.isFinite(equity)) {
        throw new Error("LIVE account equity is non-finite.");
    }
    if (walletBalance <= 0 || equity <= 0) throw new Error("LIVE account equity is non-positive.");
    if (availableBalance < -1e-8) throw new Error("LIVE account available balance is negative.");
    const allowedAvailable = walletBalance + Math.max(10, Math.abs(unrealizedPnl) * 2) + 1;
    if (availableBalance > allowedAvailable) throw new Error("LIVE account available balance is abnormal.");
    return { walletBalance, availableBalance, equity, updatedAt: finite(account.updatedAt, Date.now()) } satisfies DisDexV46AccountSnapshot;
}

export function assertEquityContinuity(currentEquity: number, previousEquity?: number) {
    if (previousEquity === undefined || previousEquity <= 0) return;
    const ratio = currentEquity / previousEquity;
    if (!Number.isFinite(ratio) || ratio > 2.5 || ratio < 0.4) {
        throw new Error(`LIVE account equity changed abnormally (ratio=${ratio}).`);
    }
}

export function projectedGrossAfterPending(
    equity: number,
    positions: DirectPosition[],
    pending: { symbol: string; targetNotionalUsd: number; reduceOnly: boolean },
    maximumGross: number,
) {
    if (!Number.isFinite(equity) || equity <= 0) throw new Error("Cannot calculate LIVE projected gross without valid equity.");
    const symbol = pending.symbol.toUpperCase();
    const otherNotional = positions
        .filter((position) => position.symbol.toUpperCase() !== symbol)
        .reduce((sum, position) => sum + Math.abs(finite(position.notionalUsd)), 0);
    const targetNotional = pending.reduceOnly ? 0 : Math.abs(finite(pending.targetNotionalUsd));
    const projectedGross = (otherNotional + targetNotional) / equity;
    if (projectedGross > maximumGross + 1e-9) {
        throw new Error(`LIVE projected gross ${projectedGross} exceeds maximum ${maximumGross}.`);
    }
    return projectedGross;
}

export function isV46OwnedOrder(order: Pick<DirectOpenOrder, "clientOrderId">) {
    return String(order.clientOrderId || "").toLowerCase().startsWith("v46-");
}
