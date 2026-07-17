#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


runner = ROOT / "lib" / "win80-ultra90-live-runner.ts"
replace_once(
    runner,
    """export interface AsterStrategyMarketDataProviderOptions {
    historyInterval?: string;
    historyLimit?: number;
    historyCacheTtlMs?: number;
    historyConcurrency?: number;
}
""",
    """export interface AsterStrategyMarketDataProviderOptions {
    historyInterval?: string;
    historyLimit?: number;
    historyCacheTtlMs?: number;
    historyConcurrency?: number;
    maxMarketAgeMs?: number;
}
""",
    "provider options",
)
replace_once(
    runner,
    """    private readonly historyCacheTtlMs: number;
    private readonly historyConcurrency: number;
    private exchangeCache?: { expiresAt: number; symbols: AsterExchangeSymbol[] };
""",
    """    private readonly historyCacheTtlMs: number;
    private readonly historyConcurrency: number;
    private readonly maxMarketAgeMs: number;
    private exchangeCache?: { expiresAt: number; symbols: AsterExchangeSymbol[] };
""",
    "provider field",
)
replace_once(
    runner,
    """        this.historyCacheTtlMs = Math.max(60_000, options.historyCacheTtlMs ?? 5 * 60_000);
        this.historyConcurrency = Math.max(1, options.historyConcurrency ?? 5);
""",
    """        this.historyCacheTtlMs = Math.max(60_000, options.historyCacheTtlMs ?? 5 * 60_000);
        this.historyConcurrency = Math.max(1, options.historyConcurrency ?? 5);
        this.maxMarketAgeMs = Math.max(5000, options.maxMarketAgeMs ?? 30_000);
""",
    "provider constructor",
)
replace_once(
    runner,
    """            const price = safeNumber(priceRow?.price ?? statsRow?.lastPrice);
            const bid = safeNumber(bookRow?.bidPrice);
            const ask = safeNumber(bookRow?.askPrice);
            if (price <= 0 || bid <= 0 || ask <= 0 || ask < bid || !history?.samples.length) continue;
            const mid = (bid + ask) / 2;
            const quoteVolume = safeNumber(statsRow?.quoteVolume);
            const topBookUsd = (safeNumber(bookRow?.bidQty) * bid) + (safeNumber(bookRow?.askQty) * ask);
            const timestamp = Math.max(
                safeNumber(priceRow?.time),
                safeNumber(bookRow?.time),
                safeNumber(statsRow?.closeTime),
                history.latestTimestamp,
                Date.now(),
            );
            latestMarketTimestamp = Math.max(latestMarketTimestamp, timestamp);
""",
    """            const lastPrice = safeNumber(priceRow?.price ?? statsRow?.lastPrice);
            const bid = safeNumber(bookRow?.bidPrice);
            const ask = safeNumber(bookRow?.askPrice);
            const bookTimestamp = safeNumber(bookRow?.time);
            const marketAgeMs = bookTimestamp > 0 ? Math.max(0, Date.now() - bookTimestamp) : Number.POSITIVE_INFINITY;
            if (
                lastPrice <= 0
                || bid <= 0
                || ask <= 0
                || ask < bid
                || bookTimestamp <= 0
                || marketAgeMs > this.maxMarketAgeMs
                || !history?.samples.length
            ) continue;
            const mid = (bid + ask) / 2;
            const price = mid;
            const quoteVolume = safeNumber(statsRow?.quoteVolume);
            const trades24h = safeNumber(statsRow?.count);
            const estimatedTxns1h = trades24h > 0 ? Math.max(1, Math.floor(trades24h / 24)) : 0;
            const topBookUsd = (safeNumber(bookRow?.bidQty) * bid) + (safeNumber(bookRow?.askQty) * ask);
            const timestamp = bookTimestamp;
            latestMarketTimestamp = latestMarketTimestamp === 0
                ? timestamp
                : Math.min(latestMarketTimestamp, timestamp);
""",
    "market timestamp and price",
)
replace_once(
    runner,
    """                txns1h: 100,
""",
    """                txns1h: estimatedTxns1h,
""",
    "market tx count",
)
replace_once(
    runner,
    """                executionTxns1h: 100,
""",
    """                executionTxns1h: estimatedTxns1h,
""",
    "execution tx count",
)
replace_once(
    runner,
    """        const unsupported = positions.filter((position) => position.quantity < 0 || position.positionSide === "SHORT");
        if (unsupported.length) {
            throw new Error(`Manual review required: short/negative positions detected (${unsupported.map((item) => item.symbol).join(", ")}).`);
        }
""",
    """        const unsupported = positions.filter((position) => position.quantity < 0 || position.positionSide !== "BOTH");
        if (unsupported.length) {
            throw new Error(`Manual review required: only one-way LONG positions with positionSide=BOTH are supported (${unsupported.map((item) => `${item.symbol}:${item.positionSide}`).join(", ")}).`);
        }
""",
    "position mode guard",
)

client = ROOT / "lib" / "aster-v3-client.ts"
replace_once(
    client,
    """    quoteVolume?: string;
    openTime?: number;
    closeTime?: number;
}
""",
    """    quoteVolume?: string;
    count?: number;
    openTime?: number;
    closeTime?: number;
}
""",
    "24h trade count",
)

entrypoint = ROOT / "scripts" / "win80-ultra90-live-runner.ts"
replace_once(
    entrypoint,
    """        historyCacheTtlMs: numberEnv("WIN80_HISTORY_CACHE_TTL_MS", 5 * 60_000),
        historyConcurrency: numberEnv("WIN80_HISTORY_CONCURRENCY", 5),
    });
""",
    """        historyCacheTtlMs: numberEnv("WIN80_HISTORY_CACHE_TTL_MS", 5 * 60_000),
        historyConcurrency: numberEnv("WIN80_HISTORY_CONCURRENCY", 5),
        maxMarketAgeMs: numberEnv("WIN80_MAX_MARKET_AGE_MS", 30_000),
    });
""",
    "entrypoint freshness config",
)

print("WIN80_ASTER_MARKET_FRESHNESS_PATCH_OK")
