import { NextRequest, NextResponse } from "next/server";
import { STRATEGY_UNIVERSE_PROVIDER_MAP } from "@/config/strategyUniverse";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import { TOKEN_REGISTRY } from "@/lib/tokens";
import { TokenRef } from "@/lib/types/market";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYMBOL_TO_PROVIDER_ID: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    SOL: "solana",
    BNB: "binance-coin",
    XRP: "xrp",
    ADA: "cardano",
    TRX: "tron",
    AVAX: "avalanche",
    DOT: "polkadot",
    LTC: "litecoin",
    BCH: "bitcoin-cash",
    LINK: "chainlink",
    ARB: "arbitrum",
    OP: "optimism",
    POL: "polygon",
    MATIC: "polygon",
    NEAR: "near-protocol",
    FTM: "fantom",
    EOS: "eos",
    INJ: "injective-protocol",
    AXS: "axie-infinity",
    ALPACA: "alpaca-finance",
    DODO: "dodo",
    CAKE: "pancakeswap",
    XVS: "venus",
    UNI: "uniswap",
    AAVE: "aave",
    ATOM: "cosmos",
    ASTER: "astar",
    ASTR: "astar",
    WLFI: "world-liberty-financial",
    TWT: "trust-wallet-token",
    SHIB: "shiba-inu",
    ...STRATEGY_UNIVERSE_PROVIDER_MAP,
};

const DEX_PRICE_OVERRIDE_SYMBOLS = new Set(["ASTER"]);
const DEX_CHAIN_BY_ID: Record<number, string> = {
    56: "bsc",
    137: "polygon",
};
const PREFERRED_QUOTE_SYMBOLS: Record<string, Set<string>> = {
    bsc: new Set(["USDT", "USDC", "BUSD", "FDUSD", "WBNB", "BNB"]),
    polygon: new Set(["USDT", "USDC", "WMATIC", "MATIC"]),
};

function buildTokenRef(input: string): TokenRef {
    const trimmed = input.trim();
    const normalized = trimmed.toUpperCase();
    const mappedProviderId = SYMBOL_TO_PROVIDER_ID[normalized];
    const providerId = mappedProviderId || trimmed.toLowerCase();

    return {
        symbol: normalized,
        provider: "coincap",
        providerId,
        chain: "MAJOR",
    };
}

function pickBestDexPair(pairs: any[], expectedAddress: string, chainKey: string) {
    const normalizedAddress = expectedAddress.toLowerCase();
    return pairs
        .filter((pair) => String(pair?.chainId || "").toLowerCase() === chainKey)
        .map((pair) => {
            const baseAddress = String(pair?.baseToken?.address || "").toLowerCase();
            const quoteAddress = String(pair?.quoteToken?.address || "").toLowerCase();
            const liquidity = Number(pair?.liquidity?.usd || 0);
            const volume24h = Number(pair?.volume?.h24 || 0);
            const preferredQuote = PREFERRED_QUOTE_SYMBOLS[chainKey]?.has(String(pair?.quoteToken?.symbol || "").toUpperCase()) ? 1 : 0;

            let score = 0;
            if (baseAddress === normalizedAddress) score += 120;
            if (quoteAddress === normalizedAddress) score += 45;
            score += preferredQuote * 18;
            score += Math.log10(Math.max(1, liquidity)) * 8;
            score += Math.log10(Math.max(1, volume24h)) * 6;

            return { pair, score };
        })
        .sort((left, right) => right.score - left.score)[0]?.pair;
}

function deriveDexUsdPrice(pair: any, expectedAddress: string) {
    const normalizedAddress = expectedAddress.toLowerCase();
    const baseAddress = String(pair?.baseToken?.address || "").toLowerCase();
    const quoteAddress = String(pair?.quoteToken?.address || "").toLowerCase();
    const priceUsd = Number(pair?.priceUsd || 0);
    const priceNative = Number(pair?.priceNative || 0);

    if (baseAddress === normalizedAddress) {
        return priceUsd;
    }

    if (quoteAddress === normalizedAddress && priceUsd > 0 && priceNative > 0) {
        return priceUsd / priceNative;
    }

    return 0;
}

async function fetchDexPriceOverrides(symbols: string[]) {
    const requests = symbols.flatMap((symbol) => {
        const registryEntry = TOKEN_REGISTRY[56]?.[symbol];
        if (registryEntry) {
            return [{
                symbol,
                chainKey: DEX_CHAIN_BY_ID[56],
                address: registryEntry.address,
            }];
        }

        const polygonEntry = TOKEN_REGISTRY[137]?.[symbol];
        if (polygonEntry) {
            return [{
                symbol,
                chainKey: DEX_CHAIN_BY_ID[137],
                address: polygonEntry.address,
            }];
        }

        return [];
    });

    if (requests.length === 0) return {};

    const result: Record<string, { usd: number; usd_24h_change: number }> = {};

    for (let index = 0; index < requests.length; index += 20) {
        const chunk = requests.slice(index, index + 20);
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.map((entry) => entry.address).join(",")}`, {
            cache: "no-store",
        });
        if (!response.ok) continue;

        const json = await response.json();
        const pairs = Array.isArray(json?.pairs) ? json.pairs : [];

        chunk.forEach((entry) => {
            const bestPair = pickBestDexPair(pairs, entry.address, entry.chainKey);
            if (!bestPair) return;

            const usd = deriveDexUsdPrice(bestPair, entry.address);
            if (!Number.isFinite(usd) || usd <= 0) return;

            result[entry.symbol] = {
                usd,
                usd_24h_change: Number(bestPair?.priceChange?.h24 || 0),
            };
        });
    }

    return result;
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = req.nextUrl;
        const idsParam = searchParams.get("ids");
        const symbolsParam = searchParams.get("symbols");
        const rawInput = idsParam || symbolsParam || "";
        const ids = rawInput.split(",").map((item) => item.trim()).filter(Boolean);

        if (ids.length === 0) {
            return NextResponse.json({});
        }

        const uniqueInputs = Array.from(new Set(ids));
        const tokensToFetch: TokenRef[] = uniqueInputs.map(buildTokenRef);
        const freshPrices = await fetchPricesBatch(tokensToFetch);
        const dexOverrides = await fetchDexPriceOverrides(
            uniqueInputs
                .map((input) => input.toUpperCase())
                .filter((symbol) => DEX_PRICE_OVERRIDE_SYMBOLS.has(symbol)),
        );

        const out: Record<string, { usd: number; usd_24h_change: number }> = {};
        uniqueInputs.forEach((input) => {
            const upper = input.toUpperCase();
            const dexOverride = dexOverrides[upper];
            if (dexOverride) {
                out[input.toLowerCase()] = dexOverride;
                return;
            }

            const providerId = SYMBOL_TO_PROVIDER_ID[upper] || input.toLowerCase();
            const priceData = freshPrices[providerId];
            if (!priceData) return;

            out[input.toLowerCase()] = {
                usd: priceData.usd,
                usd_24h_change: priceData.change24hPct || 0,
            };
        });

        return NextResponse.json(out);
    } catch (error: any) {
        console.error("[PricesAPI] Failed:", error);
        return NextResponse.json({ ok: false, error: "Failed to fetch prices" }, { status: 500 });
    }
}
