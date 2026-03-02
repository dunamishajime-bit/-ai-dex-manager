// tradeConfig.ts
// 自動売買とデモ運用で共有する設定です。

export type SupportedChain = "BNB" | "POLYGON";

export const TRADE_CONFIG = {
    SUPPORTED_CHAINS: ["BNB", "POLYGON"] as SupportedChain[],

    // ライブ口座で開始資金として認識する通貨
    ALLOWED_START_FUNDS: ["USDT", "USDC", "USD1", "BNB", "POL", "ETH", "WLFI", "ASTER", "LINK", "CAKE", "SHIB"],

    DEMO_FUNDS: {
        "100_USDT": { symbol: "USDT", amount: 100 },
        "300_USD1": { symbol: "USD1", amount: 300 },
        "100_USDC": { symbol: "USDC", amount: 100 },
        "10_BNB": { symbol: "BNB", amount: 10 },
        "50_SOL": { symbol: "SOL", amount: 50 },
        "1000_POL": { symbol: "POL", amount: 1000 },
    },

    STABLECOINS: ["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "USD", "JPY"],
    FORBIDDEN_SUFFIXES: ["USD", "JPY"],
    MAX_TRADE_SIZE_PERCENT: 50,

    isTradeableVolatilityToken: (symbol: string) => {
        const upper = symbol.toUpperCase();
        if (TRADE_CONFIG.STABLECOINS.includes(upper)) return false;
        if (TRADE_CONFIG.FORBIDDEN_SUFFIXES.some((suffix) => upper.endsWith(suffix))) return false;
        if (upper.includes("-")) return false;
        if (["WETH", "WBTC", "BTC", "SOL", "DOGE", "TRX", "ADA", "AVAX", "XRP"].includes(upper)) return false;
        return true;
    }
};
