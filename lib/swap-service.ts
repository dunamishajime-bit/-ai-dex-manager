export const getZeroExQuote = async (sellToken: string, buyToken: string, sellAmount: string, chainId: number, userAddress: string) => {
    // Basic 0x API Integration. Requires a key in prod, but there is sometimes a grace rate limit, or we can use Matcha.
    // For demo purposes and reliability without a key, we might need to use a public endpoint or simulate the calldata.
    // Real endpoint: https://api.0x.org/swap/v1/quote

    // We'll map chainId to the 0x network prefixes
    const chainMap: Record<number, string> = {
        1: '', // Ethereum mainnet is just api.0x.org
        137: 'polygon.',
        56: 'bsc.',
        42161: 'arbitrum.',
        10: 'optimism.',
        8453: 'base.'
    };

    const networkPrefix = chainMap[chainId];
    if (networkPrefix === undefined) {
        throw new Error("Unsupported chain for swap");
    }

    const url = `https://${networkPrefix}api.0x.org/swap/v1/quote?sellToken=${sellToken}&buyToken=${buyToken}&sellAmount=${sellAmount}&takerAddress=${userAddress}`;

    const headers = {
        // "0x-api-key": process.env.NEXT_PUBLIC_ZEROEX_API_KEY // If available
    };

    try {
        const response = await fetch(url, { headers });
        if (!response.ok) {
            const errorText = await response.text();
            console.error("0x API Error:", errorText);
            throw new Error(`Failed to fetch quote: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return {
            to: data.to,
            data: data.data,
            value: data.value,
            estimatedGas: data.estimatedGas,
            buyAmount: data.buyAmount,
            sellAmount: data.sellAmount,
            price: data.price,
            guaranteedPrice: data.guaranteedPrice,
            allowanceTarget: data.allowanceTarget // Contract to approve
        };
    } catch (error) {
        console.error("Quote fetch error:", error);
        throw error;
    }
}

// Token Address Mappings (for testing)
export const TOKEN_ADDRESSES: Record<number, Record<string, string>> = {
    // Polygon (137)
    137: {
        "MATIC": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // Native
        "POL": "0x455e53C3EE152Edce5920Efcc20c02E4edebD551", // Actual POL contract on Polygon
        "USDT": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
        "USDC": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
    },
    // BSC (56)
    56: {
        "BNB": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", // Native
        "USDT": "0x55d398326f99059fF775485246999027B3197955",
        "BUSD": "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56"
    }
};

export function getTokenAddress(symbol: string, chainId: number): string | null {
    const chainTokens = TOKEN_ADDRESSES[chainId];
    if (!chainTokens) return null;
    return chainTokens[symbol.toUpperCase()] || null;
}
