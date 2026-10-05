import { getStrategyAssetMeta } from "@/config/strategyUniverse";

function normalizeSymbol(symbol: string) {
    return symbol.trim().toUpperCase();
}

export function getStrategyProviderId(symbol: string) {
    return getStrategyAssetMeta(symbol).providerId;
}

export function getStrategyExternalLinks(
    symbol: string,
    options?: {
        chain?: "BNB" | "SOLANA";
        displaySymbol?: string;
        contractAddress?: string;
        dexPairUrl?: string;
    },
) {
    const normalized = normalizeSymbol(symbol);
    const meta = getStrategyAssetMeta(normalized);
    const displaySymbol = normalizeSymbol(options?.displaySymbol || meta.displaySymbol);
    const chain = options?.chain || meta.chain;
    const providerId = meta.providerId;
    const dexscreenerChain = chain === "SOLANA" ? "solana" : "bsc";
    const tradingViewQuery = chain === "SOLANA"
        ? `${displaySymbol}USD`
        : displaySymbol === "WLFI"
            ? "BNBUSDT"
            : `${displaySymbol}USDT`;

    return {
        cmc: `https://coinmarketcap.com/currencies/${encodeURIComponent(providerId)}/`,
        tradingView: chain === "SOLANA"
            ? `https://www.tradingview.com/symbols/?exchange=CRYPTO&q=${encodeURIComponent(tradingViewQuery)}`
            : `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`BINANCE:${tradingViewQuery}`)}`,
        dexscreener: options?.dexPairUrl
            || (options?.contractAddress
                ? `https://dexscreener.com/${dexscreenerChain}/${options.contractAddress}`
                : `https://dexscreener.com/search?q=${encodeURIComponent(displaySymbol)}`),
    };
}
