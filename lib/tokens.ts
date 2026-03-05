export const NATIVE_TOKEN_ADDRESS = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export interface TokenInfo {
    address: string;
    decimals: number;
}

export const TOKEN_REGISTRY: Record<number, Record<string, TokenInfo>> = {
    // BSC (56)
    56: {
        "BNB": { address: NATIVE_TOKEN_ADDRESS, decimals: 18 },
        "ETH": { address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18 },
        "DOGE": { address: "0xba2ae424d960c26247dd6c32edc70b295c744c43", decimals: 8 },
        "LINK": { address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", decimals: 18 },
        "SHIB": { address: "0x2859e4544c4bb03966803b044a93563bd2d0dd4d", decimals: 18 },
        "USDT": { address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18 },
        "USD1": { address: "0x8d0d000ee44948fc98c9b98a4fa4921476f08b0d", decimals: 18 },
        "WLFI": { address: "0x47474747477b199288bF72a1D702f7Fe0Fb1DEeA", decimals: 18 },
        "ASTER": { address: "0x000Ae314E2A2172a039B26378814C252734f556A", decimals: 18 },
    },
    // Polygon (137)
    137: {
        "MATIC": { address: NATIVE_TOKEN_ADDRESS, decimals: 18 },
        "USDT": { address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6 },
        "USDC": { address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6 },
    }
};

export function resolveToken(symbol: string, chainId: number): TokenInfo {
    let s = symbol.toUpperCase();
    if (s === "ASTR") s = "ASTER";

    const chainTokens = TOKEN_REGISTRY[chainId];
    if (!chainTokens) throw new Error(`Chain ${chainId} not found in Token Registry`);

    const info = chainTokens[s];
    if (!info) throw new Error(`Token ${s} unsupported on chain ${chainId}. Symbol searching is forbidden.`);

    return info;
}
