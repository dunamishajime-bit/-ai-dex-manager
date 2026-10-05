import { NextRequest, NextResponse } from "next/server";
import {
    STRATEGY_CONFIG,
} from "@/config/strategyConfig";
import {
    getStrategyAssetMeta,
    getStrategyUniverseSeed,
    STRATEGY_UNIVERSE_SEED_MAP,
    STRATEGY_UNIVERSE_SYMBOLS,
    type StrategyUniverseChain,
    type StrategyUniverseSeed,
} from "@/config/strategyUniverse";
import {
    getStrategyExecutionRoute,
    getStrategyExecutionSearchAliases,
    hasStrategyCrossChainAggregatorSupport,
} from "@/config/strategyExecutionRoutes";
import { fetchPricesBatch } from "@/lib/providers/market-providers";
import type { TokenRef } from "@/lib/types/market";
import { NATIVE_TOKEN_ADDRESS, TOKEN_REGISTRY } from "@/lib/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 5 * 60_000;
const WRAPPED_BNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const CHAIN_ID_BY_UNIVERSE_CHAIN: Record<StrategyUniverseChain, string> = {
    BNB: "bsc",
    SOLANA: "solana",
};
const PREFERRED_QUOTE_SYMBOLS: Record<StrategyUniverseChain, Set<string>> = {
    BNB: new Set(["USDT", "USDC", "BUSD", "FDUSD", "BNB", "WBNB"]),
    SOLANA: new Set(["USDC", "USDT", "SOL", "WSOL"]),
};
const EXECUTION_QUOTE_SYMBOLS = new Set(["USDT", "USDC", "BUSD", "FDUSD", "BNB", "WBNB"]);
const responseCache = new Map<string, { expiresAt: number; data: Record<string, unknown> }>();

interface ResolvedExecutionRoute {
    executionSupported: boolean;
    executionChain?: StrategyUniverseChain;
    executionChainId?: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind?: "native" | "proxy" | "cross-chain";
    executionSource?: "registry" | "manual-proxy" | "dynamic-proxy" | "cross-chain-aggregator";
    executionPairUrl?: string;
    executionLiquidityUsd?: number;
    executionVolume24hUsd?: number;
    executionTxns1h?: number;
}

function normalizeSymbol(symbol: string) {
    const upper = symbol.trim().toUpperCase();
    if (upper === "ASTR") return "ASTER";
    return upper;
}

function buildCacheKey(symbols: string[]) {
    return symbols.map(normalizeSymbol).sort().join(",");
}

function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
}

function normalizeAddressForChain(address: string, chain: StrategyUniverseChain) {
    if (chain === "BNB") {
        if (address.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase()) {
            return WRAPPED_BNB_ADDRESS.toLowerCase();
        }
        return address.toLowerCase();
    }
    return address;
}

function buildTokenRef(seed: StrategyUniverseSeed): TokenRef {
    return {
        symbol: seed.symbol,
        provider: "coincap",
        providerId: seed.providerId,
        chain: seed.chain,
    };
}

function resolveSeedAddress(seed: StrategyUniverseSeed) {
    return normalizeAddressForChain(seed.address, seed.chain);
}

function estimateSpreadBps(liquidityUsd: number, volume24hUsd: number) {
    const liquidityMillions = Math.max(0.2, liquidityUsd / 1_000_000);
    const volumeMillions = Math.max(0.2, volume24hUsd / 1_000_000);
    const estimate = (36 / Math.sqrt(liquidityMillions)) + (28 / Math.sqrt(volumeMillions));
    return Number(clamp(estimate, 6, 180).toFixed(2));
}

function getPairContext(
    pair: any,
    seed: StrategyUniverseSeed,
    expectedAddress?: string,
    symbolAliases: string[] = [],
) {
    const expectedSymbols = new Set(
        [seed.displaySymbol, ...symbolAliases]
            .map((value) => String(value || "").trim().toUpperCase())
            .filter(Boolean),
    );
    const baseSymbol = String(pair?.baseToken?.symbol || "").toUpperCase();
    const quoteSymbol = String(pair?.quoteToken?.symbol || "").toUpperCase();
    const baseAddressRaw = String(pair?.baseToken?.address || "");
    const quoteAddressRaw = String(pair?.quoteToken?.address || "");
    const baseAddress = normalizeAddressForChain(baseAddressRaw, seed.chain);
    const quoteAddress = normalizeAddressForChain(quoteAddressRaw, seed.chain);
    const baseAddressMatch = Boolean(expectedAddress) && baseAddress === expectedAddress;
    const quoteAddressMatch = Boolean(expectedAddress) && quoteAddress === expectedAddress;
    const baseSymbolMatch = expectedSymbols.has(baseSymbol);
    const quoteSymbolMatch = expectedSymbols.has(quoteSymbol);
    const side = baseAddressMatch || baseSymbolMatch
        ? "base"
        : quoteAddressMatch || quoteSymbolMatch
            ? "quote"
            : "none";

    return {
        side,
        baseSymbol,
        quoteSymbol,
        baseAddress,
        quoteAddress,
        baseAddressMatch,
        quoteAddressMatch,
        preferredQuote: PREFERRED_QUOTE_SYMBOLS[seed.chain].has(quoteSymbol),
    };
}

function deriveDexUsdPrice(pair: any, seed: StrategyUniverseSeed, expectedAddress?: string, symbolAliases: string[] = []) {
    const context = getPairContext(pair, seed, expectedAddress, symbolAliases);
    const basePriceUsd = Number(pair?.priceUsd || 0);
    const priceNative = Number(pair?.priceNative || 0);

    if (context.side === "base") {
        return Number.isFinite(basePriceUsd) ? basePriceUsd : 0;
    }

    if (context.side === "quote" && basePriceUsd > 0 && priceNative > 0) {
        const derived = basePriceUsd / priceNative;
        return Number.isFinite(derived) ? derived : 0;
    }

    return 0;
}

function shouldUseDexPair(
    pair: any,
    seed: StrategyUniverseSeed,
    expectedAddress?: string,
    fallbackPrice?: number,
    symbolAliases: string[] = [],
) {
    const context = getPairContext(pair, seed, expectedAddress, symbolAliases);
    if (context.side === "none") return false;

    const liquidity = Number(pair?.liquidity?.usd || 0);
    const volume24h = Number(pair?.volume?.h24 || 0);
    const txns1h = Number(pair?.txns?.h1?.buys || 0) + Number(pair?.txns?.h1?.sells || 0);
    const dexPrice = deriveDexUsdPrice(pair, seed, expectedAddress, symbolAliases);
    const normalizedFallbackPrice = Number(fallbackPrice || 0);

    if (dexPrice <= 0) return false;

    if (normalizedFallbackPrice > 0) {
        const deviation = Math.abs(dexPrice - normalizedFallbackPrice) / normalizedFallbackPrice;
        const maxDeviation = context.side === "quote" ? 0.2 : 0.45;
        if (deviation > maxDeviation) return false;
    }

    if (context.baseAddressMatch || context.quoteAddressMatch) return true;
    if (context.side !== "base") return false;
    if (!context.preferredQuote) return false;
    if (txns1h < 2) return false;
    if (liquidity < 250_000) return false;
    if (volume24h < 100_000) return false;

    return true;
}

function pairScore(pair: any, seed: StrategyUniverseSeed, expectedAddress?: string, symbolAliases: string[] = []) {
    if (String(pair?.chainId || "").toLowerCase() !== CHAIN_ID_BY_UNIVERSE_CHAIN[seed.chain]) return -1;

    const context = getPairContext(pair, seed, expectedAddress, symbolAliases);
    if (context.side === "none") return -1;

    const liquidity = Number(pair?.liquidity?.usd || 0);
    const volume24h = Number(pair?.volume?.h24 || 0);
    const txns1h = Number(pair?.txns?.h1?.buys || 0) + Number(pair?.txns?.h1?.sells || 0);
    const derivedPrice = deriveDexUsdPrice(pair, seed, expectedAddress, symbolAliases);

    let score = 0;
    if (context.baseAddressMatch) score += 80;
    if (context.quoteAddressMatch) score += 34;
    if (context.side === "base") score += 30;
    if (context.side === "quote") score += 8;
    if (context.side === "base" && context.preferredQuote) score += 18;
    if (!expectedAddress && context.side === "quote") score -= 24;
    score += Math.log10(Math.max(1, liquidity)) * 8;
    score += Math.log10(Math.max(1, volume24h)) * 6;
    score += Math.log10(Math.max(1, txns1h + 1)) * 18;
    if (txns1h === 0) score -= 28;
    else if (txns1h < 2) score -= 12;
    if (derivedPrice > 0) score += 4;
    return score;
}

function pickBestPair(seed: StrategyUniverseSeed, pairs: any[], expectedAddress?: string, symbolAliases: string[] = []) {
    return [...pairs]
        .map((pair) => ({ pair, score: pairScore(pair, seed, expectedAddress, symbolAliases) }))
        .filter((item) => item.score >= 0)
        .sort((left, right) => right.score - left.score)[0]?.pair;
}

async function fetchDexPairsForAddresses(addresses: string[]) {
    const out = new Map<string, any[]>();

    for (let index = 0; index < addresses.length; index += 20) {
        const chunk = addresses.slice(index, index + 20);
        const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`, { cache: "no-store" });
        if (!response.ok) continue;

        const json = await response.json();
        const pairs = Array.isArray(json?.pairs) ? json.pairs : [];
        chunk.forEach((address) => {
            const related = pairs.filter((pair: any) => {
                const base = String(pair?.baseToken?.address || "");
                const quote = String(pair?.quoteToken?.address || "");
                return base === address || quote === address || base.toLowerCase() === address.toLowerCase() || quote.toLowerCase() === address.toLowerCase();
            });
            out.set(address, related);
        });
    }

    return out;
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, handler: (value: T) => Promise<R>) {
    const out: R[] = [];
    const queue = [...values];

    await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
        while (queue.length > 0) {
            const next = queue.shift();
            if (typeof next === "undefined") return;
            out.push(await handler(next));
        }
    }));

    return out;
}

async function fetchDexPairsBySearch(seeds: StrategyUniverseSeed[]) {
    const rows = await mapWithConcurrency(seeds, 12, async (seed) => {
        try {
            const query = seed.displaySymbol || seed.name || seed.symbol;
            const response = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(query)}`, { cache: "no-store" });
            if (!response.ok) return [seed.symbol, []] as const;
            const json = await response.json();
            return [seed.symbol, Array.isArray(json?.pairs) ? json.pairs : []] as const;
        } catch {
            return [seed.symbol, []] as const;
        }
    });

    return new Map<string, any[]>(rows);
}

async function fetchExecutionProxyPairsBySearch(seeds: StrategyUniverseSeed[]) {
    const rows = await mapWithConcurrency(seeds, 8, async (seed) => {
        const aliases = getStrategyExecutionSearchAliases(seed.symbol, [seed.displaySymbol, seed.name || ""]);
        const queries = Array.from(new Set([
            `${seed.displaySymbol} bsc`,
            `${seed.name} bsc`,
            seed.displaySymbol,
            ...aliases.map((alias) => `${alias} bsc`),
            ...aliases,
        ]));

        const pairs: any[] = [];
        for (const query of queries) {
            try {
                const response = await fetch(`https://api.dexscreener.com/latest/dex/search/?q=${encodeURIComponent(query)}`, { cache: "no-store" });
                if (!response.ok) continue;
                const json = await response.json();
                const hits = Array.isArray(json?.pairs) ? json.pairs : [];
                pairs.push(...hits);
            } catch {
                continue;
            }
        }

        const deduped = Array.from(
            new Map(
                pairs.map((pair) => [String(pair?.pairAddress || pair?.url || Math.random()), pair]),
            ).values(),
        );
        return [seed.symbol, deduped] as const;
    });

    return new Map<string, any[]>(rows);
}

function buildBnbProxySeed(seed: StrategyUniverseSeed, expectedAddress?: string): StrategyUniverseSeed {
    return {
        ...seed,
        chain: "BNB",
        address: expectedAddress || seed.address,
    };
}

function buildExecutionPairStats(pair: any | undefined) {
    return {
        executionPairUrl: pair ? String(pair?.url || "") : undefined,
        executionLiquidityUsd: pair ? Number(pair?.liquidity?.usd || 0) : undefined,
        executionVolume24hUsd: pair ? Number(pair?.volume?.h24 || 0) : undefined,
        executionTxns1h: pair ? Number(pair?.txns?.h1?.buys || 0) + Number(pair?.txns?.h1?.sells || 0) : undefined,
    };
}

function resolveExecutionRoute(seed: StrategyUniverseSeed, proxyPairs: any[]): ResolvedExecutionRoute {
    if (seed.chain === "BNB") {
        const tokenInfo = TOKEN_REGISTRY[56]?.[seed.displaySymbol];
        return {
            executionSupported: Boolean(tokenInfo),
            executionChain: tokenInfo ? "BNB" : undefined,
            executionChainId: tokenInfo ? 56 : undefined,
            executionAddress: tokenInfo?.address,
            executionDecimals: tokenInfo?.decimals,
            executionRouteKind: tokenInfo ? "native" : undefined,
            executionSource: tokenInfo ? "registry" : undefined,
            executionPairUrl: undefined,
            executionLiquidityUsd: undefined,
            executionVolume24hUsd: undefined,
            executionTxns1h: undefined,
        };
    }

    const manualRoute = getStrategyExecutionRoute(seed.symbol);
    const symbolAliases = getStrategyExecutionSearchAliases(seed.symbol, [seed.displaySymbol, seed.name || ""]);
    const bnbSeed = buildBnbProxySeed(seed, manualRoute?.executionAddress);
    const expectedAddress = manualRoute?.executionAddress ? normalizeAddressForChain(manualRoute.executionAddress, "BNB") : undefined;
    const bestPair = pickBestPair(bnbSeed, proxyPairs, expectedAddress, symbolAliases);
    const pairStats = buildExecutionPairStats(bestPair);

    if (bestPair) {
        const context = getPairContext(bestPair, bnbSeed, expectedAddress, symbolAliases);
        const liquidity = Number(bestPair?.liquidity?.usd || 0);
        const txns1h = Number(bestPair?.txns?.h1?.buys || 0) + Number(bestPair?.txns?.h1?.sells || 0);
        const symbolMatch = context.side === "base"
            ? symbolAliases.includes(context.baseSymbol)
            : symbolAliases.includes(context.quoteSymbol);
        const quoteSymbol = context.side === "base" ? context.quoteSymbol : context.baseSymbol;
        const routeAddress = context.side === "base" ? context.baseAddress : context.quoteAddress;

        if (
            symbolMatch
            && EXECUTION_QUOTE_SYMBOLS.has(quoteSymbol)
            && liquidity >= STRATEGY_CONFIG.SOLANA_PROXY_MIN_LIQUIDITY
            && txns1h >= STRATEGY_CONFIG.SOLANA_PROXY_MIN_TXNS_1H
        ) {
            return {
                executionSupported: true,
                executionChain: "BNB",
                executionChainId: 56,
                executionAddress: routeAddress,
                executionDecimals: manualRoute?.executionAddress?.toLowerCase() === routeAddress?.toLowerCase()
                    ? manualRoute.executionDecimals
                    : undefined,
                executionRouteKind: "proxy",
                executionSource: manualRoute ? manualRoute.executionSource : "dynamic-proxy",
                ...pairStats,
            };
        }
    }

    if (manualRoute?.executionAddress) {
        return {
            executionSupported: true,
            executionChain: manualRoute.executionChain,
            executionChainId: manualRoute.executionChainId,
            executionAddress: manualRoute.executionAddress,
            executionDecimals: manualRoute.executionDecimals,
            executionRouteKind: manualRoute.executionRouteKind,
            executionSource: manualRoute.executionSource,
            ...pairStats,
        };
    }

    if (seed.chain === "SOLANA" && hasStrategyCrossChainAggregatorSupport(seed.symbol)) {
        return {
            executionSupported: true,
            executionChain: "SOLANA",
            executionChainId: 101,
            executionAddress: seed.address,
            executionDecimals: seed.decimals,
            executionRouteKind: "cross-chain",
            executionSource: "cross-chain-aggregator",
            executionPairUrl: undefined,
            executionLiquidityUsd: undefined,
            executionVolume24hUsd: undefined,
            executionTxns1h: undefined,
        };
    }

    return {
        executionSupported: false,
    };
}

function buildMetricRow(
    symbol: string,
    seed: StrategyUniverseSeed,
    pair: any | undefined,
    priceFallback: { usd?: number; change24hPct?: number } | undefined,
    executionRoute: ResolvedExecutionRoute,
) {
    const expectedAddress = resolveSeedAddress(seed);
    const context = pair ? getPairContext(pair, seed, expectedAddress) : null;
    const fallbackPrice = Number(priceFallback?.usd || 0);
    const dexPrice = pair ? deriveDexUsdPrice(pair, seed, expectedAddress) : 0;
    const useDexPair = Boolean(pair && shouldUseDexPair(pair, seed, expectedAddress, fallbackPrice));
    const matchingAddress = (() => {
        if (!pair || !context) return expectedAddress;
        if (expectedAddress && (context.baseAddressMatch || context.quoteAddressMatch)) return expectedAddress;
        if (context.side === "base") return context.baseAddress || expectedAddress;
        if (context.side === "quote") return context.quoteAddress || expectedAddress;
        return expectedAddress;
    })();

    const liquidity = Number((useDexPair ? pair?.liquidity?.usd : 0) || seed.liquidityUsd || 0);
    const volume24h = Number((useDexPair ? pair?.volume?.h24 : 0) || seed.volume24hUsd || 0);
    const marketCap = Number(((useDexPair && context?.side === "base") ? (pair?.marketCap || pair?.fdv) : 0) || seed.marketCapUsd || 0);
    const price = Number((useDexPair ? dexPrice : 0) || fallbackPrice || 0);
    const change24h = Number((useDexPair ? pair?.priceChange?.h24 : 0) || priceFallback?.change24hPct || 0);
    const pairCreatedAt = Number(pair?.pairCreatedAt || 0);
    const tokenAgeDays = pairCreatedAt > 0
        ? Math.max(1, Math.round((Date.now() - pairCreatedAt) / (24 * 60 * 60 * 1000)))
        : Number(seed.tokenAgeDays || 0);
    const txns1h = Number((pair?.txns?.h1?.buys || 0) + (pair?.txns?.h1?.sells || 0));

    return {
        symbol,
        displaySymbol: seed.displaySymbol,
        chain: seed.chain,
        price,
        change24h,
        volume: volume24h,
        liquidity,
        spreadBps: estimateSpreadBps(liquidity, volume24h),
        marketCap,
        tokenAgeDays,
        txns1h,
        dexPairFound: Boolean(pair),
        contractAddress: matchingAddress,
        dexPairUrl: String(pair?.url || ""),
        executionSupported: executionRoute.executionSupported,
        executionChain: executionRoute.executionChain,
        executionChainId: executionRoute.executionChainId,
        executionAddress: executionRoute.executionAddress,
        executionDecimals: executionRoute.executionDecimals,
        executionRouteKind: executionRoute.executionRouteKind,
        executionSource: executionRoute.executionSource,
        executionPairUrl: executionRoute.executionPairUrl || (executionRoute.executionSupported && executionRoute.executionChain === "BNB" ? String(pair?.url || "") : undefined),
        executionLiquidityUsd: executionRoute.executionLiquidityUsd ?? (executionRoute.executionSupported && executionRoute.executionChain === "BNB" ? liquidity : undefined),
        executionVolume24hUsd: executionRoute.executionVolume24hUsd ?? (executionRoute.executionSupported && executionRoute.executionChain === "BNB" ? volume24h : undefined),
        executionTxns1h: executionRoute.executionTxns1h ?? (executionRoute.executionSupported && executionRoute.executionChain === "BNB" ? txns1h : undefined),
        updatedAt: Date.now(),
        source: useDexPair ? "dex" : "seed",
    };
}

export async function GET(req: NextRequest) {
    try {
        const { searchParams } = req.nextUrl;
        const symbols = (searchParams.get("symbols") || STRATEGY_UNIVERSE_SYMBOLS.join(","))
            .split(",")
            .map(normalizeSymbol)
            .filter(Boolean);

        if (symbols.length === 0) {
            return NextResponse.json({});
        }

        const cacheKey = buildCacheKey(symbols);
        const cached = responseCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json(cached.data);
        }

        const uniqueSymbols = Array.from(new Set(symbols));
        const seeds = uniqueSymbols
            .map((symbol) => getStrategyUniverseSeed(symbol))
            .filter((seed): seed is StrategyUniverseSeed => Boolean(seed));

        const prices = await fetchPricesBatch(seeds.map(buildTokenRef));
        const addressBySymbol = new Map<string, string>();
        seeds.forEach((seed) => {
            addressBySymbol.set(seed.symbol, resolveSeedAddress(seed));
        });

        const addressPairs = await fetchDexPairsForAddresses(Array.from(addressBySymbol.values()));
        const candidatePairsBySymbol = new Map<string, any[]>();
        seeds.forEach((seed) => {
            candidatePairsBySymbol.set(seed.symbol, addressPairs.get(addressBySymbol.get(seed.symbol) || "") || []);
        });

        const unresolvedSeeds = seeds.filter((seed) => (candidatePairsBySymbol.get(seed.symbol)?.length || 0) === 0);
        const searchedPairs = await fetchDexPairsBySearch(unresolvedSeeds);
        searchedPairs.forEach((pairs, symbol) => {
            candidatePairsBySymbol.set(symbol, [...(candidatePairsBySymbol.get(symbol) || []), ...pairs]);
        });
        const executionProxyPairs = await fetchExecutionProxyPairsBySearch(seeds.filter((seed) => seed.chain === "SOLANA"));

        const out = Object.fromEntries(uniqueSymbols.map((symbol) => {
            const seed = STRATEGY_UNIVERSE_SEED_MAP[symbol];
            if (!seed) {
                const meta = getStrategyAssetMeta(symbol);
                return [symbol, {
                    symbol,
                    displaySymbol: meta.displaySymbol,
                    chain: meta.chain,
                    price: 0,
                    change24h: 0,
                    volume: 0,
                    liquidity: 0,
                    spreadBps: 0,
                    marketCap: 0,
                    tokenAgeDays: 0,
                    txns1h: 0,
                    dexPairFound: false,
                    contractAddress: meta.address,
                    dexPairUrl: "",
                    executionSupported: false,
                    executionChain: undefined,
                    executionChainId: undefined,
                    executionAddress: undefined,
                    executionDecimals: undefined,
                    executionRouteKind: undefined,
                    executionSource: undefined,
                    executionPairUrl: undefined,
                    executionLiquidityUsd: undefined,
                    executionVolume24hUsd: undefined,
                    executionTxns1h: undefined,
                    updatedAt: Date.now(),
                    source: "seed",
                }];
            }
            const bestPair = pickBestPair(seed, candidatePairsBySymbol.get(symbol) || [], addressBySymbol.get(symbol));
            const executionRoute = resolveExecutionRoute(seed, executionProxyPairs.get(symbol) || []);
            return [symbol, buildMetricRow(symbol, seed, bestPair, prices[seed.providerId], executionRoute)];
        }));

        responseCache.set(cacheKey, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            data: out,
        });

        return NextResponse.json(out);
    } catch (error) {
        console.error("[UniverseMetrics] Failed:", error);
        return NextResponse.json({ ok: false, error: "Failed to fetch strategy universe metrics" }, { status: 500 });
    }
}
