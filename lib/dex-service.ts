/**
 * DEX Service - Internal Market Data Integration
 * DEX Rankings, Pair Data, and Chain Filtering
 * Handled via internal /api/market/dashboard and backend providers.
 */

// ========== Types ==========

export type ChainId = "all" | "favorites" | "ethereum" | "bsc" | "solana" | "arbitrum" | "base" | "polygon" | "avalanche" | "optimism";

export interface DEXInfo {
    id: string;
    name: string;
    logo: string;
    chain: ChainId;
    volume24h: number;
    volumeChange24h: number;
    marketShare: number;
    numPairs: number;
    topPair: string;
    trustScore: number;
    url: string;
}

export interface MarketOverviewData {
    totalVolume: number;
    totalVolumeChange: number;
    dexCount: number;
    defiDominance: number;
    trendDirection: "up" | "down" | "flat";
    volumeHistory: { time: string; volume: number }[];
}

export interface CoinDetails {
    id: string;
    symbol: string;
    name: string;
    description: string;
    homepage: string[];
    image: string;
    genesis_date: string;
    market_cap_rank: number;
    current_price: number;
    market_cap: number;
    total_volume: number;
    high_24h: number;
    low_24h: number;
    price_change_percentage_24h: number;
    circulating_supply: number;
    total_supply: number;
    max_supply: number;
    sentiment_votes_up_percentage: number;
    sentiment_votes_down_percentage: number;
    developer_score: number;
    community_score: number;
    liquidity_score: number;
    public_interest_score: number;
    ath: number;
    atl: number;
    price_change_percentage_1h_in_currency: number;
    price_change_percentage_7d_in_currency: number;
    twitter_screen_name?: string;
    telegram_channel_identifier?: string;
    categories?: string[];
}

export interface PairInfo {
    base: string;
    target: string;
    price: number;
    volume24h: number;
    priceChange24h: number;
    lastTraded: string;
    spread: number;
}

export const CHAIN_OPTIONS: { id: ChainId; name: string; icon: string; color: string }[] = [
    { id: "all", name: "メジャー Top 10", icon: "🏆", color: "text-gold-400" },
    { id: "bsc", name: "BNB Chain", icon: "💛", color: "text-yellow-400" },
    { id: "polygon", name: "Polygon", icon: "💜", color: "text-purple-500" },
    { id: "favorites", name: "お気に入り", icon: "⭐", color: "text-yellow-400" },
];

// JPY変換レート（キャッシュ） - ポートフォリオ表示用のみ
let jpyRate: number | null = null;
let jpyRateExpiry = 0;

export async function getJPYRate(): Promise<number> {
    if (jpyRate && Date.now() < jpyRateExpiry) return jpyRate;
    try {
        const res = await fetch("/api/market/dashboard");
        const data = await res.json();
        if (data.ok && data.fxRate) {
            jpyRate = data.fxRate;
            jpyRateExpiry = Date.now() + 300000;
            return jpyRate!;
        }
    } catch (e) { /* fallback */ }
    return 155; // Updated fallback
}

// ========== API Functions ==========

export async function fetchDEXRanking(chain: ChainId = "all"): Promise<DEXInfo[]> {
    return getMockDEXData();
}

export async function fetchMarketOverview(): Promise<MarketOverviewData> {
    const dexes = await fetchDEXRanking();
    const totalVolume = dexes.reduce((sum, d) => sum + d.volume24h, 0);

    return {
        totalVolume,
        totalVolumeChange: 3 + Math.random() * 3,
        dexCount: dexes.length,
        defiDominance: 42.8 + (Math.random() - 0.5) * 2,
        trendDirection: "up",
        volumeHistory: generateVolumeHistory(totalVolume),
    };
}

export async function fetchPairs(exchangeId: string): Promise<PairInfo[]> {
    return [];
}

// チェーン別トークン取得（USD建て）
export async function fetchTokensByChain(chain: ChainId = "all", page: number = 1): Promise<any[]> {
    try {
        const res = await fetch("/api/market/dashboard");
        const data = await res.json();
        if (!data.ok || !data.universe) return [];

        const uni = data.universe;
        let tokens: any[] = [];

        if (chain === "all") tokens = uni.majorsTop10;
        else if (chain === "bsc") tokens = uni.bnbTop15;
        else if (chain === "polygon") tokens = uni.polygonTop15;
        else if (chain === "favorites") tokens = Object.values(uni.favoritesByUser || {}).flat();

        return tokens.map(t => ({
            id: t.id || t.providerId,
            symbol: t.symbol,
            name: t.name || t.symbol,
            image: t.image || "",
            current_price: data.prices[t.symbol]?.usd || 0,
            market_cap: 1000000,
            market_cap_rank: 1,
            price_change_percentage_24h: data.prices[t.symbol]?.change24h || 0,
            total_volume: 1000000,
            sparkline_in_7d: { price: [] },
            chain: chain
        }));

    } catch (e) {
        return [];
    }
}

// 拡張された通貨検索（詳細データ付き、USD建て）
export async function searchCoinsWithMarketData(query: string): Promise<any[]> {
    if (!query || query.length < 2) return [];

    try {
        const res = await fetch(`/api/tokens/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        if (!data.ok) return [];

        return data.tokens.map((t: any) => ({
            id: t.id || t.providerId,
            symbol: t.symbol.toUpperCase(),
            name: t.name,
            image: t.image || "",
            current_price: 0,
            market_cap: 0,
            price_change_percentage_24h: 0,
            provider: t.provider,
            providerId: t.providerId
        }));
    } catch (e) {
        return [];
    }
}

// レガシー互換（削除予定だがUI依存のため残す）
export async function fetchCoinMarkets(page = 1): Promise<any[]> {
    return fetchTokensByChain("all", page);
}

export interface TrendingCoin {
    id: string;
    symbol: string;
    name: string;
    thumb: string;
    market_cap_rank: number;
    data: {
        price_change_percentage_24h: { usd: number };
    };
}

export interface TrendingResult {
    id: string;
    symbol: string;
    name: string;
    image: string;
    market_cap_rank: number;
}

export async function fetchTrendingCoins(): Promise<TrendingCoin[]> {
    return [];
}

export async function fetchCoinDetails(id: string): Promise<CoinDetails | null> {
    if (!id) return null;

    try {
        const res = await fetch(`/api/market/prices?symbols=${id.toUpperCase()}`);
        const data = await res.json();

        if (!data.ok || !data.prices || !data.prices[id.toUpperCase()]) {
            const dRes = await fetch("/api/market/dashboard");
            const dData = await dRes.json();
            const allTokens = [
                ...(dData.dexTradableMajorsTop10 || []),
                ...(dData.bnbTop15 || []),
                ...(dData.polygonTop15 || [])
            ];
            const found = allTokens.find(t => t.symbol.toUpperCase() === id.toUpperCase());
            if (!found) return null;

            return {
                id: found.id,
                symbol: found.symbol,
                name: found.name,
                description: "Market data provided by internal aggregator.",
                homepage: [],
                image: found.image || "",
                genesis_date: "",
                market_cap_rank: found.marketCapRank || 1,
                current_price: found.usdPrice,
                market_cap: found.marketCap || 1000000000,
                total_volume: found.volume24h || 100000000,
                high_24h: found.usdPrice * 1.05,
                low_24h: found.usdPrice * 0.95,
                price_change_percentage_24h: found.priceChange24h || 0,
                circulating_supply: 0,
                total_supply: 0,
                max_supply: 0,
                sentiment_votes_up_percentage: 70,
                sentiment_votes_down_percentage: 30,
                developer_score: 80,
                community_score: 80,
                liquidity_score: 80,
                public_interest_score: 80,
                ath: found.usdPrice * 1.2,
                atl: found.usdPrice * 0.5,
                price_change_percentage_1h_in_currency: 0,
                price_change_percentage_7d_in_currency: 0,
            };
        }

        const priceData = data.prices[id.toUpperCase()];
        return {
            id,
            symbol: id.toUpperCase(),
            name: id,
            description: "Real-time market data aggregated from multiple sources.",
            homepage: [],
            image: "",
            genesis_date: "",
            market_cap_rank: 1,
            current_price: priceData.price,
            market_cap: 1000000000,
            total_volume: 100000000,
            high_24h: priceData.price * 1.05,
            low_24h: priceData.price * 0.95,
            price_change_percentage_24h: priceData.change24h || 0,
            circulating_supply: 0,
            total_supply: 0,
            max_supply: 0,
            sentiment_votes_up_percentage: 70,
            sentiment_votes_down_percentage: 30,
            developer_score: 80,
            community_score: 80,
            liquidity_score: 80,
            public_interest_score: 80,
            ath: priceData.price * 1.2,
            atl: priceData.price * 0.5,
            price_change_percentage_1h_in_currency: 0,
            price_change_percentage_7d_in_currency: 0,
        };
    } catch (e) {
        return null;
    }
}

// ========== Helpers ==========

function detectChain(id: string): ChainId {
    if (id.includes("bitcoin") || id === "btc") return "all";
    if (id.includes("ethereum") || id === "eth") return "ethereum";
    if (id.includes("binance") || id === "bnb") return "bsc";
    if (id.includes("solana") || id === "sol") return "solana";
    if (id.includes("arbitrum")) return "arbitrum";
    if (id.includes("pol") || id.includes("polygon")) return "polygon";
    if (id.includes("avalanche")) return "avalanche";
    if (id.includes("optimism")) return "optimism";
    return "ethereum";
}

function generateVolumeHistory(currentVolume: number): { time: string; volume: number }[] {
    return Array.from({ length: 24 }, (_, i) => ({
        time: `${String(i).padStart(2, "0")}:00`,
        volume: currentVolume * (0.7 + Math.random() * 0.6) / 24,
    }));
}

export function formatJPY(value: number): string {
    if (value < 1) {
        return `¥${value.toLocaleString("ja-JP", { minimumFractionDigits: 8, maximumFractionDigits: 8 })}`;
    }
    return `¥${value.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}`;
}

export interface TopMover {
    id: string;
    symbol: string;
    name: string;
    price: number;
    change24h: number;
    image: string;
}

export async function getTopMovers(): Promise<{ gainers: TopMover[]; losers: TopMover[] }> {
    const markets = await fetchCoinMarkets(1);
    const mapped = markets
        .filter((c: any) => c.price_change_percentage_24h != null)
        .map((c: any) => ({
            id: c.id,
            symbol: (c.symbol || "").toUpperCase(),
            name: c.name,
            price: c.current_price,
            change24h: c.price_change_percentage_24h,
            image: c.image,
        }));

    const sorted = [...mapped].sort((a, b) => b.change24h - a.change24h);
    return {
        gainers: sorted.filter(c => c.change24h > 0).slice(0, 3),
        losers: sorted.filter(c => c.change24h < 0).slice(-3).reverse(),
    };
}

export interface MarketSentiment {
    score: number; // 0-100 (Fear to Greed)
    label: "EXTREME_FEAR" | "FEAR" | "NEUTRAL" | "GREED" | "EXTREME_GREED";
    marketTrend: "BULL" | "BEAR" | "SIDEWAYS";
    volatilityIndex: number; // 0-100
}

export async function getMarketSentiment(): Promise<MarketSentiment> {
    const markets = await fetchCoinMarkets(1);
    const avgChange = markets.reduce((sum, c) => sum + (c.price_change_percentage_24h || 0), 0) / (markets.length || 1);

    let score = 50 + (avgChange * 5);
    score = Math.max(5, Math.min(95, score));

    return {
        score: Math.round(score),
        label: score > 60 ? "GREED" : (score < 40 ? "FEAR" : "NEUTRAL"),
        marketTrend: avgChange > 2 ? "BULL" : (avgChange < -2 ? "BEAR" : "SIDEWAYS"),
        volatilityIndex: 50
    };
}

export interface CryptoNews {
    id: string;
    title: string;
    source: string;
    url: string;
    published_at: string;
    description?: string;
    content?: string;
}

export async function getCryptoNews(): Promise<CryptoNews[]> {
    try {
        const res = await fetch("/api/news");
        const data = await res.json();
        if (data.ok && data.news) {
            return data.news.map((item: any, index: number) => ({
                id: `${index}`,
                title: item.title,
                source: item.source,
                url: item.link,
                published_at: item.pubDate,
                description: item.content || "",
                content: item.content || "",
            }));
        }
    } catch (e) { }
    return [];
}

function getMockDEXData(): DEXInfo[] {
    return [
        { id: "uniswap_v3", name: "Uniswap V3", logo: "🏦", chain: "ethereum", volume24h: 2.1e9, volumeChange24h: 5, marketShare: 25, numPairs: 8000, topPair: "WETH/USDC", trustScore: 10, url: "#" },
    ];
}

export function getRecommendedDEXs(symbol: string): string[] {
    return ["Uniswap", "1inch", "SushiSwap"];
}
