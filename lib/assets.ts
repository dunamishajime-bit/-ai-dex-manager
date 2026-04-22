export interface Asset {
    id: string;
    name: string;
    symbol: string;
    type: string;
    performance: number;
    riskScore: number;
    status: "ACTIVE" | "STABLE" | "VOLATILE" | "OPTIMIZING";
    description: string;
    metrics: {
        name: string;
        value: string;
    }[];
}

const ASSETS: Asset[] = [
    {
        id: "nx-01",
        name: "Nexo Core Index",
        symbol: "NCI",
        type: "PRIMARY_INDEX",
        performance: 12.4,
        riskScore: 24,
        status: "ACTIVE",
        description: "The primary high-frequency trading index managed by NEXO AI.",
        metrics: [
            { name: "Liquidity", value: "89%" },
            { name: "Volatility", value: "Low" },
            { name: "AI Preference", value: "High" }
        ]
    },
    {
        id: "nx-02",
        name: "Quantum Yield Optimized",
        symbol: "QYO",
        type: "YIELD_STRATEGY",
        performance: 8.2,
        riskScore: 15,
        status: "STABLE",
        description: "Focuses on maximizing yield through cross-chain arbitrage and LP optimization.",
        metrics: [
            { name: "APR", value: "34.2%" },
            { name: "Drawdown", value: "2.1%" },
            { name: "Nodes", value: "128" }
        ]
    },
    {
        id: "nx-03",
        name: "Neural Sentiment Pool",
        symbol: "NSP",
        type: "SENTIMENT_DRIVEN",
        performance: 25.7,
        riskScore: 68,
        status: "VOLATILE",
        description: "Trades based on real-time neural processing of global sentiment data.",
        metrics: [
            { name: "Refresh Rate", value: "400ms" },
            { name: "Certainty", value: "92%" },
            { name: "Signals", value: "Direct" }
        ]
    }
];

export async function fetchAssetList(limit = 10): Promise<Asset[]> {
    // Simulating API delay
    await new Promise(resolve => setTimeout(resolve, 500));
    return ASSETS.slice(0, limit);
}

export async function fetchAssetById(id: string): Promise<Asset | null> {
    await new Promise(resolve => setTimeout(resolve, 300));
    return ASSETS.find(a => a.id === id) || null;
}
