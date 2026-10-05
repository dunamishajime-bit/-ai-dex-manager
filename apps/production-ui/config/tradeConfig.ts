export type SupportedChain = "BNB" | "SOLANA";

export const BNB_LIVE_ALLOWED_SYMBOLS = [
  "BNB",
  "USDT",
  "ETH",
  "LINK",
  "AVAX",
  "SOL",
  "PENGU",
] as const;

export const TRADE_CONFIG = {
  SUPPORTED_CHAINS: ["BNB", "SOLANA"] as SupportedChain[],
  ALLOWED_START_FUNDS: ["USDT", "USDC", "USD1", "BNB", "ETH", "AVAX", "SOL", "LINK", "PENGU"],
  DEMO_FUNDS: {
    "100_USDT": { symbol: "USDT", amount: 100 },
    "300_USD1": { symbol: "USD1", amount: 300 },
    "10_BNB": { symbol: "BNB", amount: 10 },
    "1_ETH": { symbol: "ETH", amount: 1 },
    "10_SOL": { symbol: "SOL", amount: 10 },
    "10_AVAX": { symbol: "AVAX", amount: 10 },
  },
  STABLECOINS: ["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDP", "USD1", "USD", "JPY"],
  FORBIDDEN_SUFFIXES: ["USD", "JPY"],
  MAX_TRADE_SIZE_PERCENT: 40,
  isTradeableVolatilityToken: (symbol: string) => {
    const upper = String(symbol || "").toUpperCase();
    if (TRADE_CONFIG.STABLECOINS.includes(upper)) return false;
    if (TRADE_CONFIG.FORBIDDEN_SUFFIXES.some((suffix) => upper.endsWith(suffix))) return false;
    if (upper.includes("-")) return false;
    if (["WETH", "WBTC"].includes(upper)) return false;
    return true;
  },
};
