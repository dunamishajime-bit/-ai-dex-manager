"use client";

import { useState, useEffect, useMemo } from "react";
import { DEXInfo, ChainId, fetchDEXRanking, CHAIN_OPTIONS } from "@/lib/dex-service";
import { ArrowUpRight, ArrowDownRight, Search, ChevronDown, Maximize2, Minimize2, Star, RefreshCw, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/context/CurrencyContext";

interface Props {
    onSelectDEX?: (dex: DEXInfo) => void;
    selectedChain?: ChainId;
}

export function DEXRankingTable({ onSelectDEX, selectedChain = "all" }: Props) {
    const { formatLarge } = useCurrency();
    const [dexes, setDexes] = useState<DEXInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    const [sortBy, setSortBy] = useState<"volume24h" | "marketShare" | "numPairs">("volume24h");
    const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
    const [favorites, setFavorites] = useState<Set<string>>(new Set());
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
    const [refreshing, setRefreshing] = useState(false);

    // Load favorites from localStorage
    useEffect(() => {
        try {
            const saved = localStorage.getItem("disdex_dex_favorites");
            if (saved) setFavorites(new Set(JSON.parse(saved)));
        } catch { /* ignore */ }
    }, []);

    // Save favorites
    useEffect(() => {
        localStorage.setItem("disdex_dex_favorites", JSON.stringify(Array.from(favorites)));
    }, [favorites]);

    // Fetch data on chain change - separate data reload
    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            try {
                const data = await fetchDEXRanking(selectedChain);
                if (!cancelled) {
                    setDexes(data);
                    setLastUpdated(new Date());
                }
            } catch (e) {
                console.error("DEX Ranking fetch failed:", e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        const interval = setInterval(load, 30000); // 30s instead of 60s for faster updates
        return () => { cancelled = true; clearInterval(interval); };
    }, [selectedChain]);

    const handleManualRefresh = async () => {
        setRefreshing(true);
        try {
            const data = await fetchDEXRanking(selectedChain);
            setDexes(data);
            setLastUpdated(new Date());
        } catch (e) {
            console.error("Manual refresh failed:", e);
        } finally {
            setRefreshing(false);
        }
    };

    const toggleFavorite = (id: string) => {
        setFavorites(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const filtered = useMemo(() => {
        let list = [...dexes];

        // Chain filter - filter by actual chain data
        if (selectedChain !== "all") {
            list = list.filter(d => d.chain === selectedChain);
        }

        if (search) {
            list = list.filter(d => d.name.toLowerCase().includes(search.toLowerCase()));
        }
        list.sort((a, b) => {
            const val = sortDir === "desc" ? b[sortBy] - a[sortBy] : a[sortBy] - b[sortBy];
            return val;
        });
        const favList = list.filter(d => favorites.has(d.id));
        const nonFavList = list.filter(d => !favorites.has(d.id));
        return [...favList, ...nonFavList];
    }, [dexes, search, sortBy, sortDir, favorites, selectedChain]);

    const handleSort = (col: typeof sortBy) => {
        if (sortBy === col) setSortDir(prev => prev === "desc" ? "asc" : "desc");
        else { setSortBy(col); setSortDir("desc"); }
    };

    const getChainBadge = (chain: ChainId) => {
        const opt = CHAIN_OPTIONS.find(c => c.id === chain);
        return opt ? (
            <span className={cn("text-xs px-1.5 py-0.5 rounded bg-white/5 border border-white/10", opt.color)}>
                {opt.icon} {opt.name}
            </span>
        ) : null;
    };

    return (
        <div className={cn(
            "w-full bg-[#0d1117] rounded-xl border border-gold-500/20 overflow-hidden transition-all duration-300",
            isFullscreen && "fixed inset-0 z-50 rounded-none"
        )}>
            {/* Header */}
            <div className="p-4 border-b border-gold-500/10 flex flex-col md:flex-row gap-3 items-start md:items-center justify-between">
                <div>
                    <h2 className="text-lg font-bold text-white flex items-center gap-2">
                        <span className="text-2xl">📊</span> DEX ランキング
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gold-500/20 text-gold-400 border border-gold-500/30 font-mono">
                            LIVE
                        </span>
                        {selectedChain !== "all" && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                                {CHAIN_OPTIONS.find(c => c.id === selectedChain)?.icon} {CHAIN_OPTIONS.find(c => c.id === selectedChain)?.name}
                            </span>
                        )}
                    </h2>
                    <p className="text-xs text-gray-500 mt-1">24h取引ボリュームでランキング • {filtered.length} DEXs</p>
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto">
                    <div className="relative flex-1 md:w-64">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                            type="text"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="DEXを検索..."
                            className="w-full bg-black/40 border border-gold-500/20 rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-gold-500/50 transition-colors"
                        />
                    </div>
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

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-gold-500/10 text-xs text-gray-400 uppercase tracking-wider">
                            <th className="px-4 py-3 w-8"></th>
                            <th className="px-4 py-3 w-12">#</th>
                            <th className="px-4 py-3">取引所</th>
                            <th className="px-4 py-3">チェーン</th>
                            <th
                                className="px-4 py-3 cursor-pointer hover:text-gold-400 transition-colors"
                                onClick={() => handleSort("volume24h")}
                            >
                                <span className="flex items-center gap-1">
                                    24h ボリューム
                                    {sortBy === "volume24h" && <ChevronDown className={cn("w-3 h-3", sortDir === "asc" && "rotate-180")} />}
                                </span>
                            </th>
                            <th
                                className="px-4 py-3 cursor-pointer hover:text-gold-400 transition-colors"
                                onClick={() => handleSort("marketShare")}
                            >
                                <span className="flex items-center gap-1">
                                    市場シェア
                                    {sortBy === "marketShare" && <ChevronDown className={cn("w-3 h-3", sortDir === "asc" && "rotate-180")} />}
                                </span>
                            </th>
                            <th className="px-4 py-3 hidden lg:table-cell">24h 変動</th>
                            <th
                                className="px-4 py-3 hidden md:table-cell cursor-pointer hover:text-gold-400 transition-colors"
                                onClick={() => handleSort("numPairs")}
                            >
                                <span className="flex items-center gap-1">
                                    ペア数
                                    {sortBy === "numPairs" && <ChevronDown className={cn("w-3 h-3", sortDir === "asc" && "rotate-180")} />}
                                </span>
                            </th>
                            <th className="px-4 py-3 hidden xl:table-cell">最も取引されたペア</th>
                            <th className="px-4 py-3 w-20">AI分析</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 8 }).map((_, i) => (
                                <tr key={i} className="border-b border-white/5 animate-pulse">
                                    <td className="px-4 py-4" colSpan={10}>
                                        <div className="h-6 bg-gold-500/5 rounded w-full" />
                                    </td>
                                </tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={10} className="px-4 py-12 text-center text-gray-500">
                                    {selectedChain !== "all"
                                        ? `${CHAIN_OPTIONS.find(c => c.id === selectedChain)?.name || selectedChain} チェーンに該当するDEXが見つかりません`
                                        : "該当するDEXが見つかりません"
                                    }
                                </td>
                            </tr>
                        ) : (
                            filtered.map((dex, idx) => (
                                <tr
                                    key={dex.id}
                                    className={cn(
                                        "border-b border-white/5 hover:bg-gold-500/5 transition-colors group cursor-pointer",
                                        favorites.has(dex.id) && "bg-gold-500/3"
                                    )}
                                    onClick={() => onSelectDEX?.(dex)}
                                >
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); toggleFavorite(dex.id); }}
                                            className={cn("text-gray-600 hover:text-gold-400 transition-colors", favorites.has(dex.id) && "text-gold-400")}
                                        >
                                            <Star className={cn("w-4 h-4", favorites.has(dex.id) && "fill-gold-400")} />
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 text-gray-400 font-mono text-sm">{idx + 1}</td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {dex.logo.startsWith("http") ? (
                                                <img src={dex.logo} alt={dex.name} className="w-7 h-7 rounded-full" />
                                            ) : (
                                                <span className="text-2xl">{dex.logo}</span>
                                            )}
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-white font-medium group-hover:text-gold-400 transition-colors">{dex.name}</span>
                                                    {dex.url && dex.url !== "#" && (
                                                        <a href={dex.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="text-gray-500 hover:text-gold-400">
                                                            <ExternalLink className="w-3 h-3" />
                                                        </a>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <div className="flex gap-0.5">
                                                        {Array.from({ length: 5 }).map((_, i) => (
                                                            <div key={i} className={cn("w-1.5 h-1.5 rounded-full", i < Math.ceil(dex.trustScore / 2) ? "bg-gold-400" : "bg-gray-700")} />
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">{getChainBadge(dex.chain)}</td>
                                    <td className="px-4 py-3 text-white font-mono font-medium">
                                        {formatLarge(dex.volume24h)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                                                <div className="h-full bg-gold-500 rounded-full" style={{ width: `${Math.min(100, dex.marketShare)}%` }} />
                                            </div>
                                            <span className="text-sm text-gray-300 font-mono">{dex.marketShare.toFixed(1)}%</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 hidden lg:table-cell">
                                        <span className={cn("text-sm font-mono flex items-center gap-1", dex.volumeChange24h >= 0 ? "text-emerald-400" : "text-red-400")}>
                                            {dex.volumeChange24h >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                                            {dex.volumeChange24h >= 0 ? "+" : ""}{dex.volumeChange24h.toFixed(1)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 hidden md:table-cell text-gray-300 font-mono text-sm">{dex.numPairs.toLocaleString()}</td>
                                    <td className="px-4 py-3 hidden xl:table-cell">
                                        <span className="text-sm text-gold-400 bg-gold-500/10 px-2 py-0.5 rounded border border-gold-500/20">
                                            {dex.topPair}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onSelectDEX?.(dex); }}
                                            className="px-2 py-1 text-xs font-mono bg-gold-500/10 text-gold-400 border border-gold-500/30 rounded hover:bg-gold-500/20 transition-colors"
                                        >
                                            分析
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Footer */}
            <div className="px-4 py-3 border-t border-gold-500/10 flex justify-between items-center text-xs text-gray-500">
                <span>{filtered.length} / {dexes.length} DEXs {selectedChain !== "all" ? `(${CHAIN_OPTIONS.find(c => c.id === selectedChain)?.name})` : ""}</span>
                <span className="flex items-center gap-2">
                    <span className="text-gray-600">最終更新: {lastUpdated.toLocaleTimeString()}</span>
                    <span className="w-2 h-2 rounded-full bg-gold-500 animate-pulse" />
                    リアルタイム更新中 (30s)
                </span>
            </div>
        </div>
    );
}
