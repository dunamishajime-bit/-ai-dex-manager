export type ChainKey = "MAJOR" | "BNB" | "POLYGON";

export type TokenRef = {
    symbol: string;                 // BTC, ETH
    name?: string;
    chain: ChainKey;
    provider: "coincap" | "coinpaprika" | "dexscreener";
    providerId: string;             // coincap asset id / paprika coin id / dexscreener token/pair id
    contractAddress?: string;       // DEX solving
    image?: string;
};

export type PricePoint = {
    jpy: number;
    usd: number;
    change24hPct?: number;
    updatedAt: number;              // ms
    source: string;                 // provider
};

export type Universe = {
    majorsTop10: TokenRef[];
    bnbTop15: TokenRef[];
    polygonTop15: TokenRef[];
    favoritesByUser: Record<string, TokenRef[]>;
    updatedAt: number;
};
