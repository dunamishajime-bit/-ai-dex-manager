"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ChainId, CHAIN_OPTIONS, fetchTrendingCoins, TrendingCoin, fetchTokensByChain, searchCoinsWithMarketData } from "@/lib/dex-service";

import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";
import {
    ArrowUpRight, ArrowDownRight, Search, ChevronDown, Maximize2, Minimize2,
    Star, RefreshCw, ExternalLink, TrendingUp, BarChart3, ChevronLeft, ChevronRight
} from "lucide-react";
import { cn } from "@/lib/utils";

// Token info derived from Market Data
export interface TradableToken {
    id: string;
    symbol: string;
    name: string;
    image: string;
    currentPrice: number;          // USD
    priceChange24h: number;        // %
    priceChange7d: number;         // %
    volume24h: number;             // USD
    marketCap: number;             // USD
    marketCapRank: number;
    sparkline: number[];
    availableDEXs: string[];       // DEXs where this token can be traded
    high24h: number;
    low24h: number;
}

// ... (getAvailableDEXs, getDEXColor functions omitted for brevity, keep distinct)
// Map tokens to their available DEX platforms
function getAvailableDEXs(tokenId: string, symbol: string): string[] {
    const dexMap: Record<string, string[]> = {
        // Major tokens available on most DEXs
        ethereum: ["Uniswap", "SushiSwap", "1inch", "Balancer"],
        bitcoin: ["Uniswap (WBTC)", "PancakeSwap (BTCB)", "Curve"],
        solana: ["Raydium", "Jupiter", "Orca"],
        "bnb": ["PancakeSwap", "Uniswap", "1inch"],
        "polygon": ["Uniswap", "QuickSwap", "Balancer"],
        avalanche: ["Trader Joe", "Pangolin", "GMX"],
        arbitrum: ["Camelot", "GMX", "Uniswap"],
        optimism: ["Velodrome", "Uniswap"],
        cardano: ["SundaeSwap", "Minswap"],
        polkadot: ["Acala", "HydraDX"],
        chainlink: ["Uniswap", "SushiSwap", "1inch"],
        uniswap: ["Uniswap", "SushiSwap"],
        aave: ["Uniswap", "Balancer", "1inch"],
        "wrapped-bitcoin": ["Uniswap", "Curve", "Balancer"],
        tether: ["Uniswap", "Curve", "PancakeSwap"],
        "usd-coin": ["Uniswap", "Curve", "PancakeSwap"],
        dai: ["Uniswap", "Curve", "Balancer"],
        "shiba-inu": ["Uniswap", "SushiSwap", "1inch"],
        pepe: ["Uniswap", "1inch"],
        dogecoin: ["PancakeSwap (DOGE Bridge)", "Gate.io DEX"],
        ripple: ["Sologenic DEX"],
        litecoin: ["PancakeSwap (LTC Bridge)"],
        tron: ["SunSwap", "JustSwap"],
    };

    if (dexMap[tokenId]) return dexMap[tokenId];

    // Default: most ERC-20 tokens available on Uniswap
    const defaultDexs = ["Uniswap", "1inch"];
    const sym = symbol.toLowerCase();
    // BSC tokens
    if (["cake", "xvs", "bake", "alpaca"].includes(sym)) return ["PancakeSwap"];
    // SOL tokens
    if (["ray", "srm", "orca", "mngo", "jto", "bonk", "wif"].includes(sym)) return ["Raydium", "Jupiter"];

    return defaultDexs;
}

// Color for DEX badges
function getDEXColor(dexName: string): string {
    const colors: Record<string, string> = {
        "Uniswap": "bg-pink-500/20 text-pink-400 border-pink-500/30",
        "PancakeSwap": "bg-amber-500/20 text-amber-400 border-amber-500/30",
        "SushiSwap": "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
        "1inch": "bg-orange-500/20 text-orange-400 border-orange-500/30",
        "Curve": "bg-blue-500/20 text-blue-400 border-blue-500/30",
        "Balancer": "bg-violet-500/20 text-violet-400 border-violet-500/30",
        "Raydium": "bg-teal-500/20 text-teal-400 border-teal-500/30",
        "Jupiter": "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
        "Trader Joe": "bg-red-500/20 text-red-400 border-red-500/30",
        "QuickSwap": "bg-sky-500/20 text-sky-400 border-sky-500/30",
        "Camelot": "bg-amber-600/20 text-amber-300 border-amber-600/30",
        "GMX": "bg-blue-600/20 text-blue-300 border-blue-600/30",
    };
    return colors[dexName] || "bg-gray-500/20 text-gray-400 border-gray-500/30";
}

interface Props {
    onSelectToken?: (token: TradableToken) => void;
    selectedChain?: ChainId;
    initialTokenSymbol?: string | null;
}

const ITEMS_PER_PAGE = 20;

export function TradableTokensTable({ onSelectToken, selectedChain = "all", initialTokenSymbol }: Props) {
    const router = useRouter(); // Use App Router
    const { formatPrice, formatLarge, currency, setJpyRate } = useCurrency();
    const [tokens, setTokens] = useState<TradableToken[]>([]);
    const [trendingCoins, setTrendingCoins] = useState<TrendingCoin[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchLoading, setSearchLoading] = useState(false);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [sortBy, setSortBy] = useState<"volume24h" | "marketCap" | "priceChange24h">("marketCap");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [refreshing, setRefreshing] = useState(false);
    const [wasSearched, setWasSearched] = useState(false);
    const [refreshingRows, setRefreshingRows] = useState<Set<string>>(new Set());

    // Pagination state
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [lastFetchedPage, setLastFetchedPage] = useState(1);
    const [loadingMore, setLoadingMore] = useState(false);

    const { favorites, toggleFavorite } = useSimulation();

    // Track if initial selection has been handled to prevent re-selection
    const [initialSelectionHandled, setInitialSelectionHandled] = useState(false);

    // ... (useEffect for localstorage)

    // Debounce search input (400ms)
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 400);
        return () => clearTimeout(timer);
    }, [search]);

    // Fetch token data from Centralized Dashboard API
    const loadTokens = useCallback(async () => {
        if (!debouncedSearch || debouncedSearch.length < 2) {
            setLoading(true);
        } else {
            setSearchLoading(true);
        }
        try {
            const res = await fetch("/api/market/dashboard");
            const data = await res.json();

            if (!data.ok) throw new Error(data.error);

            // Sync server JPY rate
            if (data.fxRate) setJpyRate(data.fxRate);

            let marketData: any[] = [];

            if (debouncedSearch && debouncedSearch.length >= 2) {
                // SERVER-SIDE SEARCH
                const sRes = await fetch(`/api/tokens/search?q=${encodeURIComponent(debouncedSearch)}`);
                const sData = await sRes.json();

                if (sData.ok) {
                    marketData = sData.tokens;
                    // If results are from external search, they might lack price. 
                    // This is OK as the table will show prices from the next poll or N/A
                } else if (sData.status === 429) {
                    console.warn("Search rate limited");
                    // Fallback to local search in current tokens
                    marketData = tokens.filter(t => t.symbol.toLowerCase().includes(debouncedSearch.toLowerCase()));
                }
                setHasMore(false);
                setWasSearched(true);
            } else {
                setWasSearched(false);
                setHasMore(false); // Categories are fixed size now (10-15 tokens)

                if (selectedChain === "all") {
                    marketData = data.dexTradableMajorsTop10;
                } else if (selectedChain === "bsc") {
                    marketData = data.bnbTop15;
                } else if (selectedChain === "polygon") {
                    marketData = data.polygonTop15;
                } else if (selectedChain === "favorites") {
                    // Current user defaults to "default" in simulated backend
                    marketData = data.favoritesByUser["default"] || [];
                } else {
                    marketData = data.dexTradableMajorsTop10;
                }
            }

            if (marketData && marketData.length > 0) {
                const mapped: TradableToken[] = marketData.map((coin: any) => ({
                    id: coin.id || coin.providerId,
                    symbol: (coin.symbol || "").toUpperCase(),
                    name: coin.name,
                    image: coin.image || "",
                    currentPrice: coin.usdPrice || coin.current_price || 0, // Use USD as base
                    priceChange24h: coin.priceChange24h || coin.price_change_percentage_24h || 0,
                    priceChange7d: 0,
                    volume24h: coin.volume24h || coin.total_volume || 0,
                    marketCap: coin.marketCap || coin.market_cap || 0,
                    marketCapRank: coin.marketCapRank || coin.market_cap_rank || 999,
                    sparkline: coin.sparkline_in_7d?.price || [],
                    availableDEXs: coin.availableDEXs || getAvailableDEXs(coin.id, coin.symbol || ""),
                    high24h: coin.high_24h || 0,
                    low24h: coin.low_24h || 0,
                }));
                setTokens(mapped);
                setLastUpdated(new Date());
                setCurrentPage(1);
            } else if (debouncedSearch.length >= 2) {
                setTokens([]);
            }
        } catch (e) {
            console.error("Token fetch failed:", e);
        } finally {
            setLoading(false);
            setRefreshing(false);
            setSearchLoading(false);
        }
    }, [debouncedSearch, selectedChain, setJpyRate]);

    // Refresh a single token's data
    const handleIndividualRefresh = async (tokenId: string, symbol: string) => {
        setRefreshingRows(prev => new Set(prev).add(tokenId));
        try {
            const res = await fetch(`/api/market/prices?ids=${tokenId}`);
            const data = await res.json();

            if (data && data[tokenId]) {
                const coin = data[tokenId];
                setTokens(prev => prev.map(t => {
                    if (t.id === tokenId) {
                        return {
                            ...t,
                            currentPrice: coin.usd,
                            priceChange24h: coin.usd_24h_change || t.priceChange24h
                        };
                    }
                    return t;
                }));
            }
        } catch (e) {
            console.error("Individual refresh failed:", e);
        } finally {
            setRefreshingRows(prev => {
                const next = new Set(prev);
                next.delete(tokenId);
                return next;
            });
        }
    };

    const loadMoreTokens = async () => {
        if (loadingMore || !hasMore) return;
        setLoadingMore(true);
        try {
            // Paging currently disabled for static/dashboard universe
            setHasMore(false);
        } catch (e) {
            console.error("Load more failed:", e);
        } finally {
            setLoadingMore(false);
        }
    };

    // Handle initial token selection from URL
    useEffect(() => {
        if (!initialSelectionHandled && initialTokenSymbol && tokens.length > 0) {
            const token = tokens.find(t => t.symbol === initialTokenSymbol);
            if (token && onSelectToken) {
                onSelectToken(token);
                setInitialSelectionHandled(true);
            }
        }
    }, [tokens, initialTokenSymbol, initialSelectionHandled, onSelectToken]);

    useEffect(() => {
        loadTokens();
        const interval = setInterval(loadTokens, 10000); // 10 sec update
        return () => clearInterval(interval);
    }, [loadTokens]); // loadTokens now depends on debouncedSearch and selectedChain

    // Reset page logic handled in loadTokens
    // useEffect(() => { setCurrentPage(1); }, [search, selectedChain]);

    const handleManualRefresh = async () => {
        setRefreshing(true);
        await loadTokens();
        setRefreshing(false);
    };

    // Filter by selected chain (DEX platform mapping)
    const chainDEXMap: Record<string, string[]> = {
        ethereum: ["Uniswap", "SushiSwap", "1inch", "Balancer", "Curve"],
        bsc: ["PancakeSwap"],
        solana: ["Raydium", "Jupiter", "Orca"],
        arbitrum: ["Camelot", "GMX", "Uniswap"],
        base: ["Aerodrome", "Uniswap"],
        polygon: ["QuickSwap", "Uniswap", "Balancer"],
        avalanche: ["Trader Joe", "Pangolin", "GMX"],
        optimism: ["Velodrome", "Uniswap"],
    };

    const filtered = useMemo(() => {
        // Use a base list to avoid redundant copies
        let list = tokens;

        // Apply search filter (prioritize debounced search for stable results)
        const activeSearch = debouncedSearch.trim().toLowerCase();
        const instantSearch = search.trim().toLowerCase();

        if (activeSearch.length >= 2) {
            // If we just fetched results via API Search, don't filter again locally
            // to avoid issues with Japanese names or partial matches that API found
            if (!wasSearched) {
                list = list.filter(t =>
                    t.name.toLowerCase().includes(activeSearch) ||
                    t.symbol.toLowerCase().includes(activeSearch)
                );
            }
        } else if (instantSearch.length > 0) {
            // Instant local filtering for single characters or while waiting for debounce
            list = list.filter(t =>
                t.name.toLowerCase().includes(instantSearch) ||
                t.symbol.toLowerCase().includes(instantSearch)
            );
        }

        // Apply chain/favorites filter
        if (selectedChain === "favorites") {
            list = list.filter(t => favorites.has(t.id));
        }

        // Sorting
        const sortedList = [...list].sort((a, b) => {
            const val = sortDir === "desc" ? b[sortBy] - a[sortBy] : a[sortBy] - b[sortBy];
            return val;
        });

        // Favorites prioritization (only if not already in favorites view)
        if (selectedChain !== "favorites") {
            const favs: TradableToken[] = [];
            const others: TradableToken[] = [];

            for (const item of sortedList) {
                if (favorites.has(item.id)) favs.push(item);
                else others.push(item);
            }
            return [...favs, ...others];
        }

        return sortedList;
    }, [tokens, debouncedSearch, search, sortBy, sortDir, favorites, selectedChain]);

    // Pagination Logic
    const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE);
    const paginatedTokens = filtered.slice(
        (currentPage - 1) * ITEMS_PER_PAGE,
        currentPage * ITEMS_PER_PAGE
    );

    const handleSort = (col: typeof sortBy) => {
        if (sortBy === col) setSortDir(prev => prev === "desc" ? "asc" : "desc");
        else { setSortBy(col); setSortDir("desc"); }
    };

    const handleAnalysisClick = (token: TradableToken, e: React.MouseEvent) => {
        e.stopPropagation();
        // Always navigate to the dedicated AI Council page on "Analyze" click
        // regardless of whether onSelectToken is provided (which is for row selection)
        router.push(`/ai-council?token=${token.symbol}&id=${token.id}`);
    };

    // Mini sparkline renderer
    const renderSparkline = (data: number[]) => {
        if (!data || data.length === 0) return null;
        const sampled = data.filter((_, i) => i % Math.max(1, Math.floor(data.length / 30)) === 0);
        const min = Math.min(...sampled);
        const max = Math.max(...sampled);
        const range = max - min || 1;
        const w = 80;
        const h = 24;
        const isUp = sampled[sampled.length - 1] >= sampled[0];

        const points = sampled.map((v, i) => {
            const x = (i / (sampled.length - 1)) * w;
            const y = h - ((v - min) / range) * h;
            return `${x},${y}`;
        }).join(" ");

        return (
            <svg width={w} height={h} className="inline-block">
                <polyline
                    points={points}
                    fill="none"
                    stroke={isUp ? "#34d399" : "#f87171"}
                    strokeWidth="1.5"
                />
            </svg>
        );
    };

    return (
        <div className={cn(
            "w-full glass-panel-gold rounded-xl border border-gold-500/20 overflow-hidden transition-all duration-300 flex flex-col relative shadow-2xl",
            isFullscreen && "fixed inset-0 z-50 rounded-none h-screen"
        )}>
            {/* Ambient background glow */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-gold-500/5 blur-[100px] pointer-events-none" />

            {/* Header */}
            <div className="p-4 md:p-6 border-b border-gold-500/10 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between shrink-0 bg-black/20">
                <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="text-2xl">💎</span> DEX取引可能な仮想通貨
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gold-500/20 text-gold-400 border border-gold-500/30 font-mono">
                            LIVE
                        </span>
                        {selectedChain !== "all" && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                {CHAIN_OPTIONS.find(c => c.id === selectedChain)?.icon} {CHAIN_OPTIONS.find(c => c.id === selectedChain)?.name}
                            </span>
                        )}
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">
                        Uniswap・PancakeSwap・Raydiumなどで取引可能なトークン • {filtered.length}通貨
                    </p>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="通貨名・シンボルで検索..."
                            className="w-full bg-black/40 border border-gold-500/20 rounded-lg pl-9 pr-10 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-gold-500/50 transition-colors"
                        />
                        {searchLoading && (
                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                <RefreshCw className="w-3.5 h-3.5 text-gold-500 animate-spin" />
                            </div>
                        )}
                    </div>
                    {/* Compact Search Progress Line */}
                    {searchLoading && (
                        <div className="absolute top-0 left-0 w-full h-[2px] overflow-hidden">
                            <div className="h-full bg-gold-500 animate-[loading-line_1.5s_infinite]" />
                        </div>
                    )}
                    <button
                        onClick={handleManualRefresh}
                        disabled={refreshing}
                        className="p-2 bg-gold-500/10 text-gold-400 border border-gold-500/30 rounded-lg hover:bg-gold-500/20 transition-colors disabled:opacity-50"
                        title="手動更新"
                    >
                        <RefreshCw className={cn("w-4 h-4", refreshing && "animate-spin")} />
                    </button>
                    <button
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        className="p-2 bg-gold-500/10 text-gold-400 border border-gold-500/30 rounded-lg hover:bg-gold-500/20 transition-colors"
                        title={isFullscreen ? "通常表示" : "全画面表示"}
                    >
                        {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* Trending Section */}
            {trendingCoins.length > 0 && (
                <div className="px-4 py-2 bg-white/5 border-b border-gold-500/10 flex items-center gap-3 overflow-x-auto whitespace-nowrap scrollbar-hide shrink-0">
                    <div className="flex items-center gap-1 text-gold-400 text-xs font-bold">
                        <TrendingUp className="w-3.5 h-3.5" />
                        トレンド:
                    </div>
                    <div className="flex items-center gap-2">
                        {trendingCoins.slice(0, 5).map(coin => (
                            <button
                                key={coin.id}
                                onClick={() => setSearch(coin.symbol)}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-black/40 border border-white/10 hover:border-gold-500/50 hover:bg-gold-500/10 transition-colors text-xs group"
                            >
                                <img src={coin.thumb} alt={coin.symbol} className="w-4 h-4 rounded-full" />
                                <span className="text-gray-300 group-hover:text-white font-mono">{coin.symbol}</span>
                                <span className={cn(
                                    "text-[10px]",
                                    (coin.data.price_change_percentage_24h?.usd || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                                )}>
                                    {(coin.data.price_change_percentage_24h?.usd || 0) >= 0 ? "+" : ""}
                                    {(coin.data.price_change_percentage_24h?.usd || 0).toFixed(1)}%
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto flex-1 custom-scrollbar">
                <table className="w-full text-left">
                    <thead className="sticky top-0 bg-[#0d1117] z-10">
                        <tr className="border-b border-gold-500/10 text-xs text-gray-400 uppercase tracking-wider">
                            <th className="px-3 py-3 w-8"></th>
                            <th className="px-3 py-3 w-10">#</th>
                            <th className="px-3 py-3">通貨</th>
                            <th className="px-3 py-3 text-right">Price ({currency.toLowerCase() === 'jpy' ? 'JPY' : 'USD'})</th>
                            <th
                                className="px-3 py-3 text-right cursor-pointer hover:text-gold-400 transition-colors"
                                onClick={() => handleSort("priceChange24h")}
                            >
                                <span className="flex items-center gap-1 justify-end">
                                    24h 変動
                                    {sortBy === "priceChange24h" && <ChevronDown className={cn("w-3 h-3", sortDir === "asc" && "rotate-180")} />}
                                </span>
                            </th>
                            <th className="px-3 py-3 hidden lg:table-cell">7日チャート</th>
                            <th
                                className="px-3 py-3 text-right cursor-pointer hover:text-gold-400 transition-colors"
                                onClick={() => handleSort("volume24h")}
                            >
                                <span className="flex items-center gap-1 justify-end">
                                    24h 出来高
                                    {sortBy === "volume24h" && <ChevronDown className={cn("w-3 h-3", sortDir === "asc" && "rotate-180")} />}
                                </span>
                            </th>
                            <th
                                className="px-3 py-3 text-right hidden md:table-cell cursor-pointer hover:text-gold-400 transition-colors"
                                onClick={() => handleSort("marketCap")}
                            >
                                <span className="flex items-center gap-1 justify-end">
                                    時価総額
                                    {sortBy === "marketCap" && <ChevronDown className={cn("w-3 h-3", sortDir === "asc" && "rotate-180")} />}
                                </span>
                            </th>
                            <th className="px-3 py-3 hidden xl:table-cell">取引可能DEX</th>
                            <th className="px-3 py-3 w-20">AI分析</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 15 }).map((_, i) => (
                                <tr key={i} className="border-b border-white/5 animate-pulse">
                                    <td className="px-3 py-4" colSpan={10}>
                                        <div className="h-6 bg-gold-500/5 rounded w-full" />
                                    </td>
                                </tr>
                            ))
                        ) : (paginatedTokens.length === 0 && !loading && !searchLoading) ? (
                            <tr>
                                <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                                    {search ? `「${search}」に一致する通貨が見つかりません` :
                                        selectedChain !== "all" ? `${CHAIN_OPTIONS.find(c => c.id === selectedChain)?.name} チェーン対応の通貨が見つかりません` :
                                            "通貨データの読み込みに失敗しました"}
                                </td>
                            </tr>
                        ) : paginatedTokens.length > 0 ? (
                            paginatedTokens.map((token, idx) => (
                                <tr
                                    key={token.id}
                                    className={cn(
                                        "border-b border-gold-500/5 transition-all duration-300 cursor-pointer group glass-card-hover",
                                        favorites.has(token.id) ? "bg-gold-500/10" : ""
                                    )}
                                    onClick={() => onSelectToken?.(token)}
                                >
                                    <td className="px-3 py-3">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleFavorite(token.id); }}
                                            className={cn("text-gray-600 hover:text-gold-400 transition-colors", favorites.has(token.id) && "text-gold-400")}
                                        >
                                            <Star className={cn("w-3.5 h-3.5", favorites.has(token.id) && "fill-gold-400")} />
                                        </button>
                                    </td>
                                    <td className="px-3 py-3 text-gray-500 font-mono text-xs">
                                        {token.marketCapRank || (currentPage - 1) * ITEMS_PER_PAGE + idx + 1}
                                    </td>
                                    <td className="px-3 py-3">
                                        <div className="flex items-center gap-2.5">
                                            {token.image ? (
                                                <img src={token.image} alt={token.symbol} className="w-7 h-7 rounded-full" />
                                            ) : (
                                                <div className="w-7 h-7 rounded-full bg-gold-500/20 flex items-center justify-center text-xs font-bold text-gold-400">
                                                    {token.symbol.slice(0, 2)}
                                                </div>
                                            )}
                                            <div>
                                                <div className="text-white font-medium text-sm group-hover:text-gold-400 transition-colors">
                                                    {token.name}
                                                </div>
                                                <div className="text-[10px] text-gray-500 font-mono">{token.symbol}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-3 text-right text-white font-mono text-sm font-medium">
                                        {formatPrice(token.currentPrice)}
                                    </td>
                                    <td className="px-3 py-3 text-right">
                                        <span className={cn(
                                            "text-sm font-mono flex items-center gap-0.5 justify-end",
                                            token.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"
                                        )}>
                                            {token.priceChange24h >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                            {token.priceChange24h >= 0 ? "+" : ""}{token.priceChange24h.toFixed(2)}%
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 hidden lg:table-cell">
                                        {renderSparkline(token.sparkline)}
                                    </td>
                                    <td className="px-3 py-3 text-right text-gray-300 font-mono text-sm">
                                        {formatLarge(token.volume24h)}
                                    </td>
                                    <td className="px-3 py-3 text-right hidden md:table-cell text-gray-300 font-mono text-sm">
                                        {formatLarge(token.marketCap)}
                                    </td>
                                    <td className="px-3 py-3 hidden xl:table-cell">
                                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                                            {token.availableDEXs.slice(0, 3).map(dex => (
                                                <span key={dex} className={cn("text-[9px] px-1.5 py-0.5 rounded border", getDEXColor(dex))}>
                                                    {dex}
                                                </span>
                                            ))}
                                            {token.availableDEXs.length > 3 && (
                                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-gray-500 border border-white/10">
                                                    +{token.availableDEXs.length - 3}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-3">
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => handleAnalysisClick(token, e)}
                                                className="px-2 py-1 text-xs font-mono bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded hover:bg-purple-500/20 transition-colors flex items-center gap-1"
                                            >
                                                <BarChart3 className="w-3 h-3" />
                                                分析
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); handleIndividualRefresh(token.id, token.symbol); }}
                                                className={cn(
                                                    "p-1.5 rounded bg-gold-500/5 text-gold-500/40 border border-gold-500/10 hover:bg-gold-500/20 hover:text-gold-400 hover:border-gold-500/30 transition-all",
                                                    refreshingRows.has(token.id) && "animate-spin text-gold-500 opacity-100"
                                                )}
                                                title="データを更新"
                                            >
                                                <RefreshCw className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={10} className="px-4 py-12 text-center text-gray-700 italic">
                                    データを取得中...
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination & Footer */}
            <div className="px-4 py-3 border-t border-gold-500/10 flex justify-between items-center text-xs text-gray-500 shrink-0">
                <div className="flex items-center gap-4">
                    <span>{filtered.length} 通貨中 {Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filtered.length)} - {Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} 件表示</span>
                </div>

                {totalPages > 1 && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="p-1 rounded hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        <span className="font-mono text-gold-400">{currentPage} / {totalPages}</span>
                        <button
                            onClick={() => {
                                if (currentPage === totalPages && hasMore) {
                                    loadMoreTokens();
                                }
                                setCurrentPage(p => Math.min(totalPages + (hasMore ? 1 : 0), p + 1));
                            }}
                            className="p-1.5 rounded-lg hover:bg-gold-500/20 transition-all active:scale-95 disabled:opacity-30 disabled:hover:bg-transparent"
                            title="次へ"
                        >
                            <ChevronRight className="w-5 h-5 text-gold-400" />
                        </button>
                    </div>
                )}
                {hasMore && !search && (
                    <button
                        onClick={loadMoreTokens}
                        disabled={loadingMore}
                        className="px-4 py-1.5 bg-gold-500/10 border border-gold-500/30 rounded-full text-[10px] text-gold-400 hover:bg-gold-500/20 hover:text-gold-200 transition-all active:scale-95 uppercase tracking-widest font-bold flex items-center gap-2 shadow-lg shadow-gold-500/5"
                    >
                        {loadingMore ? <RefreshCw className="w-3 h-3 animate-spin" /> : <ChevronDown className="w-3 h-3" />}
                        さらにトークンを読み込む
                    </button>
                )}
            </div>
            <style jsx global>{`
                @keyframes loading-line {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
            `}</style>
        </div>
    );
}
