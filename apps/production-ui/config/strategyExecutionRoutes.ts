import { STRATEGY_SOLANA_EXPANSION_SYMBOLS, type StrategyUniverseChain } from "@/config/strategyUniverse";

export interface StrategyExecutionRoute {
    symbol: string;
    executionChain: StrategyUniverseChain;
    executionChainId: number;
    executionAddress?: string;
    executionDecimals?: number;
    executionRouteKind: "native" | "proxy" | "cross-chain";
    executionSource: "registry" | "manual-proxy" | "dynamic-proxy" | "cross-chain-aggregator";
}

const PROXY_SEARCH_ALIASES: Record<string, string[]> = {
    "SOL.SOL": ["SOL", "SOLANA", "BINANCE-PEG SOLANA"],
    "BONK.SOL": ["BONK", "BONK COIN"],
    "WIF.SOL": ["WIF", "DOGWIFHAT", "DOG WIF HAT"],
    "HONEY.SOL": ["HONEY", "HIVEMAPPER"],
    "RENDER.SOL": ["RENDER", "RNDR", "RENDER TOKEN"],
    "JTO.SOL": ["JTO", "JITO", "JITO GOVERNANCE TOKEN"],
    "KMNO.SOL": ["KMNO", "KAMINO"],
    "RAY.SOL": ["RAY", "RAYDIUM"],
    "ORCA.SOL": ["ORCA"],
};

const MANUAL_EXECUTION_ROUTES: Record<string, StrategyExecutionRoute> = {
    "SOL.SOL": {
        symbol: "SOL.SOL",
        executionChain: "BNB",
        executionChainId: 56,
        executionAddress: "0x570A5D26f7765Ecb712C0924E4De545B89fD43dF",
        executionDecimals: 18,
        executionRouteKind: "proxy",
        executionSource: "manual-proxy",
    },
    "BONK.SOL": {
        symbol: "BONK.SOL",
        executionChain: "BNB",
        executionChainId: 56,
        executionAddress: "0xA697e272a73744b343528C3Bc4702F2565b2F422",
        executionRouteKind: "proxy",
        executionSource: "manual-proxy",
    },
    "WIF.SOL": {
        symbol: "WIF.SOL",
        executionChain: "BNB",
        executionChainId: 56,
        executionAddress: "0x83E3C857Fc785e4487CAF0E682819b2e6Ab9733f",
        executionRouteKind: "proxy",
        executionSource: "manual-proxy",
    },
    "HONEY.SOL": {
        symbol: "HONEY.SOL",
        executionChain: "BNB",
        executionChainId: 56,
        executionAddress: "0xFa363022816aBf82f18a9C2809dCd2BB393F6AC5",
        executionRouteKind: "proxy",
        executionSource: "manual-proxy",
    },
};

const CROSS_CHAIN_AGGREGATOR_SYMBOLS = new Set([
    "SOL.SOL",
    "JUP.SOL",
    "PYTH.SOL",
    "RENDER.SOL",
    "BONK.SOL",
    "WIF.SOL",
    "JTO.SOL",
    "KMNO.SOL",
    "RAY.SOL",
    "ORCA.SOL",
    "DRIFT.SOL",
    "W.SOL",
    "FIDA.SOL",
    "CLOUD.SOL",
    "HONEY.SOL",
    ...STRATEGY_SOLANA_EXPANSION_SYMBOLS,
]);

export function getStrategyExecutionRoute(symbol: string) {
    return MANUAL_EXECUTION_ROUTES[String(symbol || "").toUpperCase()];
}

export function hasStrategyCrossChainAggregatorSupport(symbol: string) {
    return CROSS_CHAIN_AGGREGATOR_SYMBOLS.has(String(symbol || "").toUpperCase());
}

export function getStrategyExecutionSearchAliases(symbol: string, extras: string[] = []) {
    const normalizedSymbol = String(symbol || "").toUpperCase();
    return Array.from(
        new Set(
            [
                normalizedSymbol,
                ...(PROXY_SEARCH_ALIASES[normalizedSymbol] || []),
                ...extras,
            ]
                .map((value) => String(value || "").trim().toUpperCase())
                .filter(Boolean),
        ),
    );
}
