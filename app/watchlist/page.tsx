"use client";

import { Card } from "@/components/ui/Card";
import { Star, TrendingUp, TrendingDown, Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";

const POPULAR_TOKENS = [
    { symbol: "BTC", name: "Bitcoin", price: 97500, change: 2.3 },
    { symbol: "ETH", name: "Ethereum", price: 3250, change: -0.8 },
    { symbol: "SOL", name: "Solana", price: 195, change: 5.1 },
    { symbol: "BNB", name: "BNB", price: 610, change: 1.2 },
    { symbol: "DOGE", name: "Dogecoin", price: 0.32, change: -2.1 },
    { symbol: "POL", name: "Polygon", price: 0.85, change: 3.4 },
    { symbol: "AVAX", name: "Avalanche", price: 38.5, change: 4.2 },
    { symbol: "LINK", name: "Chainlink", price: 18.2, change: 1.8 },
    { symbol: "UNI", name: "Uniswap", price: 12.5, change: -1.5 },
    { symbol: "AAVE", name: "Aave", price: 285, change: 2.1 },
];

export default function WatchlistPage() {
    const { allMarketData } = useSimulation();
    const { formatPrice } = useCurrency();
    const [watchlist, setWatchlist] = useState<string[]>(() => {
        if (typeof window !== "undefined") {
            const stored = localStorage.getItem("jdex_watchlist");
            return stored ? JSON.parse(stored) : ["BTC", "ETH", "SOL"];
        }
        return ["BTC", "ETH", "SOL"];
    });
    const [searchQuery, setSearchQuery] = useState("");
    const [showSearch, setShowSearch] = useState(false);

    const saveWatchlist = (list: string[]) => {
        setWatchlist(list);
        localStorage.setItem("jdex_watchlist", JSON.stringify(list));
    };

    const addToWatchlist = (symbol: string) => {
        if (!watchlist.includes(symbol)) {
            saveWatchlist([...watchlist, symbol]);
        }
        setShowSearch(false);
        setSearchQuery("");
    };

    const removeFromWatchlist = (symbol: string) => {
        saveWatchlist(watchlist.filter(s => s !== symbol));
    };

    const filteredTokens = POPULAR_TOKENS.filter(
        t => !watchlist.includes(t.symbol) &&
            (t.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
                t.name.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white via-gold-200 to-gold-500 bg-clip-text text-transparent flex items-center gap-3">
                    <Star className="w-8 h-8 text-gold-500" />
                    ウォッチリスト
                </h1>
                <button
                    onClick={() => setShowSearch(!showSearch)}
                    className="flex items-center gap-2 bg-gold-500/10 hover:bg-gold-500/20 text-gold-500 border border-gold-500/50 px-4 py-2 rounded-lg transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    トークン追加
                </button>
            </div>

            {/* Search Panel */}
            {showSearch && (
                <Card title="トークン検索" glow="secondary">
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="シンボルまたはトークン名で検索..."
                                className="w-full bg-black/50 border border-white/10 rounded-lg pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-gold-500/50"
                                autoFocus
                            />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {filteredTokens.map(token => (
                                <button
                                    key={token.symbol}
                                    onClick={() => addToWatchlist(token.symbol)}
                                    className="flex items-center justify-between p-3 bg-white/5 hover:bg-white/10 rounded-lg border border-white/5 hover:border-gold-500/30 transition-all"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 rounded-full bg-gold-500/20 flex items-center justify-center text-gold-400 text-xs font-bold">
                                            {token.symbol.slice(0, 2)}
                                        </div>
                                        <div className="text-left">
                                            <div className="text-sm font-bold text-white">{token.symbol}</div>
                                            <div className="text-xs text-gray-500">{token.name}</div>
                                        </div>
                                    </div>
                                    <Plus className="w-4 h-4 text-gold-400" />
                                </button>
                            ))}
                        </div>
                    </div>
                </Card>
            )}

            {/* Watchlist Grid */}
            {watchlist.length === 0 ? (
                <div className="text-center py-16">
                    <Star className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                    <p className="text-gray-500 text-lg">ウォッチリストが空です</p>
                    <p className="text-gray-600 text-sm mt-1">「トークン追加」ボタンからお気に入りトークンを追加してください</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {watchlist.map(symbol => {
                        const token = POPULAR_TOKENS.find(t => t.symbol === symbol);
                        const marketPrice = allMarketData[symbol]?.price;
                        const price = marketPrice || token?.price || 0;
                        const change = token?.change || 0;
                        const isPositive = change >= 0;

                        return (
                            <Card key={symbol} title={symbol} glow={isPositive ? "success" : "danger"}>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2">
                                            <div className="w-10 h-10 rounded-full bg-gold-500/20 flex items-center justify-center text-gold-400 font-bold">
                                                {symbol.slice(0, 2)}
                                            </div>
                                            <div>
                                                <div className="font-bold text-white">{symbol}</div>
                                                <div className="text-xs text-gray-500">{token?.name || symbol}</div>
                                            </div>
                                        </div>
                                        <div className="text-2xl font-bold font-mono text-white">
                                            {formatPrice(price)}
                                        </div>
                                        <div className={`flex items-center gap-1 mt-1 ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
                                            {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                                            <span className="font-mono text-sm font-bold">{isPositive ? "+" : ""}{change}%</span>
                                            <span className="text-xs text-gray-500">24h</span>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => removeFromWatchlist(symbol)}
                                        className="text-gray-600 hover:text-red-400 transition-colors p-1"
                                        title="ウォッチリストから削除"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </Card>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
