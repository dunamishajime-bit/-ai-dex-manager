const CACHE_TTL_MS = 45_000;
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const CHAIN_PRICE_SOURCES: Record<number, { coingeckoPlatform: string; dexscreenerChain: string }> = {
    56: {
        coingeckoPlatform: "binance-smart-chain",
        dexscreenerChain: "bsc",
    },
    101: {
        coingeckoPlatform: "solana",
        dexscreenerChain: "solana",
    },
    137: {
        coingeckoPlatform: "polygon-pos",
        dexscreenerChain: "polygon",
    },
};

const responseCache = new Map<string, { expiresAt: number; data: Record<string, number> }>();

export function normalizeContractPriceSymbol(symbol: string, chainId?: number) {
    const trimmed = symbol.trim();
    if (chainId === 101 && SOLANA_ADDRESS_RE.test(trimmed)) {
        return trimmed;
    }
    const upper = trimmed.toUpperCase();
    if (upper === "ASTR") return "ASTER";
    return upper;
}

export function normalizeContractPriceAddress(chainId: number, address: string) {
    const trimmed = address.trim();
    return chainId === 101 ? trimmed : trimmed.toLowerCase();
}

function buildCacheKey(chainId: number, symbols: string[], keyedAddresses: Array<{ key: string; address: string }>) {
    const symbolKey = symbols.map((symbol) => normalizeContractPriceSymbol(symbol, chainId)).sort().join(",");
    const addressKey = keyedAddresses
        .map(({ key, address }) => `${normalizeContractPriceSymbol(key, chainId)}@${normalizeContractPriceAddress(chainId, address)}`)
        .sort()
        .join(",");
    return `${chainId}:${symbolKey}::${addressKey}`;
}

async function fetchCoinGeckoPrices(
    platform: string,
    addresses: string[],
): Promise<Record<string, number>> {
    if (addresses.length === 0) return {};

    const url =
        `https://api.coingecko.com/api/v3/simple/token_price/${platform}`
        + `?contract_addresses=${encodeURIComponent(addresses.join(","))}&vs_currencies=usd`;

    const response = await fetch(url, { cache: "no-store" });
    if (response.status === 429) {
        return {};
    }
    if (!response.ok) {
        throw new Error(`CoinGecko contract price request failed (${response.status})`);
    }

    const json = await response.json();
    const out: Record<string, number> = {};

    addresses.forEach((address) => {
        const usd = Number(json?.[address]?.usd);
        if (Number.isFinite(usd) && usd > 0) {
            out[address] = usd;
        }
    });

    return out;
}

async function fetchDexScreenerPrices(
    chainKey: string,
    addresses: string[],
    chainId?: number,
): Promise<Record<string, number>> {
    const out: Record<string, number> = {};

    for (let index = 0; index < addresses.length; index += 20) {
        const chunk = addresses.slice(index, index + 20);
        const url = `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`;
        const response = await fetch(url, { cache: "no-store" });
        if (response.status === 429 || !response.ok) continue;

        const json = await response.json();
        const pairs = Array.isArray(json?.pairs) ? json.pairs : [];

        chunk.forEach((address) => {
            const related = pairs
                .filter((pair: any) => {
                    if (String(pair?.chainId || "").toLowerCase() !== chainKey) return false;

                    const baseAddress = normalizeContractPriceAddress(chainId || 0, String(pair?.baseToken?.address || ""));
                    const quoteAddress = normalizeContractPriceAddress(chainId || 0, String(pair?.quoteToken?.address || ""));
                    const normalizedTarget = normalizeContractPriceAddress(chainId || 0, address);
                    return baseAddress === normalizedTarget || quoteAddress === normalizedTarget;
                })
                .sort((left: any, right: any) =>
                    Number(right?.liquidity?.usd || 0) - Number(left?.liquidity?.usd || 0),
                );

            if (related.length === 0) return;

            const usd = Number(related[0]?.priceUsd);
            if (Number.isFinite(usd) && usd > 0) {
                out[address] = usd;
            }
        });
    }

    return out;
}

export async function getContractPricesByAddress(
    chainId: number,
    keyedAddresses: Array<{ key: string; address: string }>,
) {
    const sourceConfig = CHAIN_PRICE_SOURCES[chainId];
    if (!sourceConfig || keyedAddresses.length === 0) {
        return {};
    }

    const normalizedEntries = keyedAddresses
        .map(({ key, address }) => ({
            key: normalizeContractPriceSymbol(key, chainId),
            address: normalizeContractPriceAddress(chainId, address),
        }))
        .filter((entry) => Boolean(entry.key) && Boolean(entry.address));

    if (normalizedEntries.length === 0) {
        return {};
    }

    const cacheKey = buildCacheKey(chainId, [], normalizedEntries);
    const cached = responseCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.data;
    }

    const symbolByAddress = new Map<string, string>();
    normalizedEntries.forEach(({ key, address }) => {
        symbolByAddress.set(address, key);
    });
    const addresses = Array.from(symbolByAddress.keys());

    const pricesBySymbol: Record<string, number> = {};

    try {
        const geckoPrices = await fetchCoinGeckoPrices(sourceConfig.coingeckoPlatform, addresses);
        Object.entries(geckoPrices).forEach(([address, usd]) => {
            const symbol = symbolByAddress.get(address);
            if (symbol) {
                pricesBySymbol[symbol] = usd;
            }
        });
    } catch (error) {
        console.warn("[ContractPrices] CoinGecko fetch failed:", error);
    }

    const unresolvedAddresses = addresses.filter((address) => {
        const symbol = symbolByAddress.get(address);
        return symbol ? !pricesBySymbol[symbol] : false;
    });

    if (unresolvedAddresses.length > 0) {
        try {
            const dexPrices = await fetchDexScreenerPrices(sourceConfig.dexscreenerChain, unresolvedAddresses, chainId);
            Object.entries(dexPrices).forEach(([address, usd]) => {
                const symbol = symbolByAddress.get(address);
                if (symbol) {
                    pricesBySymbol[symbol] = usd;
                }
            });
        } catch (error) {
            console.warn("[ContractPrices] DexScreener fetch failed:", error);
        }
    }

    if (Object.keys(pricesBySymbol).length > 0) {
        responseCache.set(cacheKey, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            data: pricesBySymbol,
        });
    }

    return pricesBySymbol;
}
