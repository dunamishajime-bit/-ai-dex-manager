import fs from "fs/promises";
import path from "path";
import { TokenRef } from "../types/market";

const COINGECKO_ID_MAP: Record<string, string> = {
    "bitcoin": "bitcoin",
    "ethereum": "ethereum",
    "solana": "solana",
    "binance-coin": "binancecoin",
    tether: "tether",
    "xrp": "ripple",
    "cardano": "cardano",
    "avalanche": "avalanche-2",
    "tron": "tron",
    "chainlink": "chainlink",
    "dogecoin": "dogecoin",
    "arbitrum": "arbitrum",
    "optimism": "optimism",
    "polygon": "polygon-ecosystem-token",
    "pancakeswap": "pancakeswap-token",
    "venus": "venus",
    "alpaca-finance": "alpaca-finance",
    "dodo": "dodo",
    "stepn": "stepn",
    "hooked-protocol": "hooked-protocol",
    "filecoin": "filecoin",
    "compound-governance-token": "compound-governance-token",
    "chromia": "chromia",
    "alchemy-pay": "alchemy-pay",
    "astar": "astar",
    "world-liberty-financial": "world-liberty-financial",
    "trust-wallet-token": "trust-wallet-token",
    "shiba-inu": "shiba-inu",
    "pudgy-penguins": "pudgy-penguins",
    "injective-protocol": "injective-protocol",
    uniswap: "uniswap",
};

const PRICE_CACHE_PATH = path.join(process.cwd(), "data", "market-price-cache.json");
const BINANCE_SYMBOL_MAP: Record<string, string> = {
    "binance-coin": "BNBUSDT",
    tether: "USDTUSDT",
    bitcoin: "BTCUSDT",
    ethereum: "ETHUSDT",
    solana: "SOLUSDT",
    chainlink: "LINKUSDT",
    avalanche: "AVAXUSDT",
    dogecoin: "DOGEUSDT",
    "polygon-ecosystem-token": "MATICUSDT",
    arbitrum: "ARBUSDT",
    optimism: "OPUSDT",
    cardano: "ADAUSDT",
    tron: "TRXUSDT",
    litecoin: "LTCUSDT",
    "bitcoin-cash": "BCHUSDT",
    uniswap: "UNIUSDT",
    aave: "AAVEUSDT",
    cosmos: "ATOMUSDT",
    "shiba-inu": "SHIBUSDT",
    "pudgy-penguins": "PENGUUSDT",
    "injective-protocol": "INJUSDT",
    "trust-wallet-token": "TWTUSDT",
};

type CachedPriceEntry = { usd: number; change24hPct?: number; updatedAt: number };
type CachedPriceMap = Record<string, CachedPriceEntry>;
type CachedPriceFile = { updatedAt?: number; prices?: CachedPriceMap };

async function loadCachedPrices(): Promise<CachedPriceMap> {
    try {
        const raw = await fs.readFile(PRICE_CACHE_PATH, "utf8");
        const parsed = JSON.parse(raw) as CachedPriceFile | CachedPriceMap;
        if (parsed && typeof parsed === "object" && "prices" in parsed) {
            const file = parsed as CachedPriceFile;
            return file.prices || {};
        }
        return parsed && typeof parsed === "object" ? (parsed as CachedPriceMap) : {};
    } catch {
        return {};
    }
}

async function saveCachedPrices(prices: Record<string, { usd: number; change24hPct?: number }>) {
    try {
        await fs.mkdir(path.dirname(PRICE_CACHE_PATH), { recursive: true });
        const cache = {
            updatedAt: Date.now(),
            prices: Object.fromEntries(
                Object.entries(prices)
                    .filter(([, value]) => Number(value?.usd || 0) > 0)
                    .map(([key, value]) => [key, { usd: Number(value.usd), change24hPct: Number(value.change24hPct || 0), updatedAt: Date.now() }]),
            ) as CachedPriceMap,
        };
        await fs.writeFile(PRICE_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
    } catch (error) {
        console.warn("[MarketCache] Failed to save price cache:", error);
    }
}

async function fetchBinanceFallback(providerIds: string[]): Promise<Record<string, { usd: number; change24hPct?: number }>> {
    const requests = providerIds
        .map((providerId) => ({
            providerId,
            symbol: BINANCE_SYMBOL_MAP[providerId],
        }))
        .filter((entry): entry is { providerId: string; symbol: string } => Boolean(entry.symbol));

    if (!requests.length) {
        return {};
    }

    const response = await fetch(
        `https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(requests.map((entry) => entry.symbol)))}`,
        {
            cache: "no-store",
            signal: AbortSignal.timeout(5000),
        },
    );

    if (!response.ok) {
        throw new Error(`Binance fallback failed with status ${response.status}`);
    }

    const json = await response.json();
    const entries = Array.isArray(json) ? json : [];
    const reverse = Object.fromEntries(requests.map((entry) => [entry.symbol, entry.providerId]));
    const out: Record<string, { usd: number; change24hPct?: number }> = {};

    entries.forEach((item) => {
        const providerId = reverse[String(item?.symbol || "")];
        if (!providerId) return;
        const usd = Number(item?.lastPrice || 0);
        if (!Number.isFinite(usd) || usd <= 0) return;
        out[providerId] = {
            usd,
            change24hPct: Number(item?.priceChangePercent || 0),
        };
    });

    return out;
}

export function priceKey(t: TokenRef): string {
    return `${t.symbol.toUpperCase()}@${t.chain}`;
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 4500): Promise<any> {
    const response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
        throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return response.json();
}

export async function fetchUsdJpy(): Promise<{ rate: number; updatedAt: number }> {
    const parseRate = (value: unknown) => {
        const rate = Number(value);
        return Number.isFinite(rate) && rate > 50 && rate < 300 ? rate : 0;
    };

    const sources = [
        {
            name: "Frankfurter",
            url: "https://api.frankfurter.app/latest?from=USD&to=JPY",
            readRate: (json: any) => json?.rates?.JPY,
        },
        {
            name: "ER API",
            url: "https://open.er-api.com/v6/latest/USD",
            readRate: (json: any) => json?.rates?.JPY,
        },
        {
            name: "ExchangeRate Host",
            url: "https://api.exchangerate.host/latest?base=USD&symbols=JPY",
            readRate: (json: any) => json?.rates?.JPY,
        },
    ] as const;

    let lastError: unknown;
    for (const source of sources) {
        try {
            const json = await fetchJson(source.url, { cache: "no-store" }, 3500);
            const rate = parseRate(source.readRate(json));
            if (!rate) {
                throw new Error(`Invalid rate from ${source.name}`);
            }
            return { rate, updatedAt: Date.now() };
        } catch (error) {
            lastError = error;
        }
    }

    console.warn("[FX] All providers failed, using static fallback:", lastError);

    return { rate: 157.0, updatedAt: Date.now() };
}

export function toJpy(usd: number, usdJpy: number): number {
    return Math.round(usd * usdJpy * 100) / 100;
}

export async function fetchPricesBatch(tokens: TokenRef[]): Promise<Record<string, { usd: number; change24hPct?: number }>> {
    const out: Record<string, { usd: number; change24hPct?: number }> = {};
    tokens.forEach((token) => {
        if (token.providerId === "tether") {
            out[token.providerId] = { usd: 1, change24hPct: 0 };
        }
    });
    const cached = await loadCachedPrices();
    const chunkArray = <T,>(values: T[], size: number) => {
        const chunks: T[][] = [];
        for (let index = 0; index < values.length; index += size) {
            chunks.push(values.slice(index, index + size));
        }
        return chunks;
    };

    const byProvider = tokens.reduce<Record<string, TokenRef[]>>((acc, t) => {
        acc[t.provider] ??= [];
        acc[t.provider].push(t);
        return acc;
    }, {});

    // --- CoinCap ---
    if (byProvider.coincap?.length) {
        const geckoIdToProviderIds = byProvider.coincap.reduce<Record<string, string[]>>((acc, token) => {
            const geckoId = COINGECKO_ID_MAP[token.providerId] || token.providerId;
            acc[geckoId] ??= [];
            acc[geckoId].push(token.providerId);
            return acc;
        }, {});

        try {
            const geckoIds = Object.keys(geckoIdToProviderIds);
            for (const geckoChunk of chunkArray(geckoIds, 80)) {
                const json = await fetchJson(
                    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(geckoChunk.join(","))}&vs_currencies=usd&include_24hr_change=true`,
                    { cache: "no-store" },
                    5000,
                );

                geckoChunk.forEach((geckoId) => {
                    const payload = json?.[geckoId];
                    const usd = Number(payload?.usd);
                    if (!usd) return;

                    geckoIdToProviderIds[geckoId].forEach((providerId) => {
                        out[providerId] = {
                            usd,
                            change24hPct: Number(payload?.usd_24h_change) || 0,
                        };
                    });
                });
            }
        } catch (e) {
            console.warn("[CoinGecko] Simple price fetch failed, continuing to CoinCap fallback:", e);
        }

        const unresolved = byProvider.coincap.filter((token) => !out[token.providerId]);
        if (unresolved.length) {
            try {
                const json = await fetchJson("https://api.coincap.io/v2/assets?limit=2000", { cache: "no-store" }, 5000);
                const list = json?.data ?? [];
                const need = new Set(unresolved.map((token) => token.providerId));

                for (const asset of list) {
                    if (!need.has(asset.id)) continue;
                    const usd = Number(asset.priceUsd);
                    if (!usd) continue;
                    out[asset.id] = {
                        usd,
                        change24hPct: Number(asset.changePercent24Hr),
                    };
                }
            } catch (e) {
                const message = e instanceof Error ? e.message : String(e);
                console.warn(
                    `[CoinCap] Unresolved batch fetch failed; using partial provider data for ${unresolved.length} assets: ${message}`,
                );
            }
        }

        const stillUnresolved = byProvider.coincap
            .map((token) => token.providerId)
            .filter((providerId) => !out[providerId]);
        if (stillUnresolved.length) {
            try {
                const binancePrices = await fetchBinanceFallback(stillUnresolved);
                for (const [providerId, priceData] of Object.entries(binancePrices)) {
                    if (priceData?.usd > 0) {
                        out[providerId] = priceData;
                    }
                }
            } catch (e) {
                console.warn("[Binance] Fallback fetch failed:", e);
            }
        }
    }

    // Note: Future providers like DexScreener or CoinPaprika can be added here

    for (const token of tokens) {
        if (!out[token.providerId] && cached[token.providerId] && Number(cached[token.providerId]?.usd || 0) > 0) {
            out[token.providerId] = {
                usd: Number(cached[token.providerId].usd),
                change24hPct: Number(cached[token.providerId].change24hPct || 0),
            };
        }
    }

    if (Object.keys(out).length > 0) {
        await saveCachedPrices(out);
    }

    return out;
}
export async function fetchHistory(id: string, interval: string = "d1"): Promise<any[]> {
    try {
        const json = await fetchJson(`https://api.coincap.io/v2/assets/${id}/history?interval=${interval}`, { cache: "no-store" }, 5000);
        return json?.data ?? [];
    } catch (e) {
        console.error(`[CoinCap] History fetch failed for ${id}:`, e);
        return [];
    }
}
