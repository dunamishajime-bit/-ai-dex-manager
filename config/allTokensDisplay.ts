// allTokensDisplay.ts
// UI表示用: Ethereumチェーンなどの情報も含む、包括的なトークンリストです。
// これは単なる情報表示用であり、実際のトレードロジック (tradeConfig.ts) には影響しません。

export const ALL_DISPLAY_TOKENS = [
    { symbol: "BTC", name: "Bitcoin", network: "Bitcoin", icon: "https://cryptologos.cc/logos/bitcoin-btc-logo.png?v=026" },
    { symbol: "ETH", name: "Ethereum", network: "Ethereum", icon: "https://cryptologos.cc/logos/ethereum-eth-logo.png?v=026" },
    { symbol: "SOL", name: "Solana", network: "Solana", icon: "https://cryptologos.cc/logos/solana-sol-logo.png?v=026" },
    { symbol: "BNB", name: "BNB", network: "BNB Chain", icon: "https://cryptologos.cc/logos/bnb-bnb-logo.png?v=026" },
    { symbol: "POL", name: "Polygon Ecosystem Token", network: "Polygon", icon: "https://cryptologos.cc/logos/polygon-matic-logo.png?v=026" }, // MATIC replacement
    { symbol: "MATIC", name: "Polygon", network: "Polygon", icon: "https://cryptologos.cc/logos/polygon-matic-logo.png?v=026" }, // Keeping MATIC for display/historical
    { symbol: "AVAX", name: "Avalanche", network: "Avalanche C-Chain", icon: "https://cryptologos.cc/logos/avalanche-avax-logo.png?v=026" },
    { symbol: "ARB", name: "Arbitrum", network: "Arbitrum One", icon: "https://cryptologos.cc/logos/arbitrum-arb-logo.png?v=026" },
    { symbol: "OP", name: "Optimism", network: "Optimism", icon: "https://cryptologos.cc/logos/optimism-ethereum-op-logo.png?v=026" },
    { symbol: "DOGE", name: "Dogecoin", network: "Dogecoin", icon: "https://cryptologos.cc/logos/dogecoin-doge-logo.png?v=026" },
    { symbol: "SHIB", name: "Shiba Inu", network: "Ethereum", icon: "https://cryptologos.cc/logos/shiba-inu-shib-logo.png?v=026" },
    { symbol: "LINK", name: "Chainlink", network: "Ethereum", icon: "https://cryptologos.cc/logos/chainlink-link-logo.png?v=026" },
    { symbol: "UNI", name: "Uniswap", network: "Ethereum", icon: "https://cryptologos.cc/logos/uniswap-uni-logo.png?v=026" },
    { symbol: "USDT", name: "Tether USD", network: "Ethereum/BNB/Polygon", icon: "https://cryptologos.cc/logos/tether-usdt-logo.png?v=026" },
    { symbol: "USDC", name: "USD Coin", network: "Ethereum/BNB/Polygon", icon: "https://cryptologos.cc/logos/usd-coin-usdc-logo.png?v=026" },
    { symbol: "DAI", name: "Dai", network: "Ethereum", icon: "https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.png?v=026" },
];
