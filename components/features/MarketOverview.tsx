"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getTopMovers, getCryptoNews, TopMover, CryptoNews } from "@/lib/dex-service";
import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";
import { TrendingUp, TrendingDown, Newspaper, Wallet, ExternalLink, ArrowRight, Sparkles } from "lucide-react";
import { useAccount } from "wagmi";

export function MarketOverview() {
    const { portfolio, isDemoMode, demoBalance, isWalletConnected, marketRegime, liveInitialBalance } = useSimulation();
    const { isConnected } = useAccount();
    const { formatPrice, formatLarge, currency } = useCurrency();

    const [gainers, setGainers] = useState<TopMover[]>([]);
    const [losers, setLosers] = useState<TopMover[]>([]);
    const [news, setNews] = useState<CryptoNews[]>([]);
    const [loading, setLoading] = useState(true);
    const { setJpyRate } = useCurrency();

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch("/api/market/dashboard");
                const data = await res.json();
                if (data.ok) {
                    if (data.fxRate) setJpyRate(data.fxRate);
                    setGainers(data.trendTop3.up);
                    setLosers(data.trendTop3.down);
                    getCryptoNews().then(setNews);
                }
            } catch (e) {
                console.error("Failed to load market overview", e);
            } finally {
                setLoading(false);
            }
        };
        load();
        const interval = setInterval(load, 10000); // 10s polling
        return () => clearInterval(interval);
    }, [setJpyRate]);

    // Profit calculation (Mock logic based on portfolio)
    // In a real app, this would calculate daily PnL from transaction history
    const initialBalance = isDemoMode ? demoBalance : (liveInitialBalance || portfolio.totalValue); // Use actual demo set balance, or live initial
    const currentTotal = (isConnected || isDemoMode) ? portfolio.totalValue : 0;
    const profit = currentTotal - initialBalance;
    const profitColor = profit >= 0 ? "text-emerald-400" : "text-red-400";
    const profitSign = profit >= 0 ? "+" : "";

    if (loading) return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
            {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-[#0d1117] rounded-xl h-48 border border-gold-500/10" />
            ))}
        </div>
    );

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Top Gainers */}
            <div className="bg-[#0d1117] rounded-xl p-4 border border-emerald-500/20 flex flex-col">
                <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4" /> 上昇トレンド TOP3
                </h3>
                <div className="space-y-3 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                    {gainers.map((coin: any) => (
                        <div key={coin.providerId || coin.id} className="flex items-center justify-between p-2 bg-emerald-500/5 rounded border border-emerald-500/10 hover:bg-emerald-500/10 transition-colors">
                            <div className="flex items-center gap-2">
                                <img src={coin.image || coin.thumb || "/placeholder.png"} alt={coin.name} className="w-6 h-6 rounded-full" />
                                <div>
                                    <div className="text-xs font-bold text-white">{coin.symbol}</div>
                                    <div className="text-[10px] text-gray-400">
                                        {formatPrice(coin.currentPrice || coin.price)}
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs font-bold text-emerald-400">
                                +{(coin.priceChange24h || coin.change24h || 0).toFixed(2)}%
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Top Losers */}
            <div className="bg-[#0d1117] rounded-xl p-4 border border-red-500/20 flex flex-col">
                <h3 className="text-sm font-bold text-red-400 flex items-center gap-2 mb-3">
                    <TrendingDown className="w-4 h-4" /> 下降トレンド TOP3
                </h3>
                <div className="space-y-3 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                    {losers.map((coin: any) => (
                        <div key={coin.providerId || coin.id} className="flex items-center justify-between p-2 bg-red-500/5 rounded border border-red-500/10 hover:bg-red-500/10 transition-colors">
                            <div className="flex items-center gap-2">
                                <img src={coin.image || coin.thumb || "/placeholder.png"} alt={coin.name} className="w-6 h-6 rounded-full" />
                                <div>
                                    <div className="text-xs font-bold text-white">{coin.symbol}</div>
                                    <div className="text-[10px] text-gray-400">
                                        {formatPrice(coin.currentPrice || coin.price)}
                                    </div>
                                </div>
                            </div>
                            <div className="text-xs font-bold text-red-400">
                                {(coin.priceChange24h || coin.change24h || 0).toFixed(2)}%
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Realtime News */}
            <div className="bg-[#0d1117] rounded-xl p-4 border border-blue-500/20 flex flex-col">
                <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2 mb-3">
                    <Newspaper className="w-4 h-4" /> 仮想通貨ニュース
                </h3>
                <div className="space-y-2 flex-1 overflow-y-auto pr-1 custom-scrollbar max-h-[160px]">
                    {news.map(item => (
                        <a key={item.id} href={item.url} target="_blank" rel="noopener noreferrer" className="block p-2 bg-blue-500/5 rounded border border-blue-500/10 hover:bg-blue-500/10 transition-colors group">
                            <div className="text-xs text-gray-300 line-clamp-2 group-hover:text-blue-200 mb-1 leading-snug">
                                {item.title}
                            </div>
                            <div className="flex justify-between items-center text-[10px] text-gray-500">
                                <span>{item.source}</span>
                                <span>{item.published_at}</span>
                            </div>
                        </a>
                    ))}
                </div>
            </div>

            {/* Today's Profit */}
            <div className="bg-[#0d1117] rounded-xl p-4 border border-gold-500/20 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                    <Wallet className="w-24 h-24 text-gold-500" />
                </div>
                <h3 className="text-sm font-bold text-gold-400 flex items-center gap-2 mb-1 z-10">
                    <Wallet className="w-4 h-4" /> {isDemoMode ? `運用資産(${currency}/DEMO)` : `本日の利益額`}
                </h3>
                <p className="text-[10px] text-gray-500 mb-4 z-10">自動トレード損益 (24h)</p>

                <div className="flex-1 flex flex-col justify-center items-center z-10">
                    {(isConnected || isDemoMode) ? (
                        <>
                            <div className={`text-2xl font-bold font-mono ${profitColor} mb-1`}>
                                {profitSign}{formatPrice(profit)}
                            </div>
                            <div className="text-xs text-gray-400">
                                {isDemoMode ? "DEMO元本:" : "元本:"} <span className="font-mono">{formatPrice(initialBalance)}</span>
                            </div>

                            <div className="mt-3 px-3 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 bg-white/5 border-white/10 shadow-sm">
                                <span className="text-gray-500">REGIME:</span>
                                <span className={
                                    marketRegime === "TREND_UP" ? "text-emerald-400" :
                                        marketRegime === "TREND_DOWN" ? "text-red-400" :
                                            marketRegime === "VOLATILE" ? "text-orange-400" : "text-blue-400"
                                }>
                                    {marketRegime?.replace("_", " ") || "RANGE"}
                                </span>
                            </div>

                        </>
                    ) : (
                        <div className="text-center">
                            <div className="text-2xl font-bold text-gray-600 font-mono tracking-widest mb-2">
                                ※※※
                            </div>
                            <div className="text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded border border-red-500/20 font-mono">
                                ウォレット未接続
                            </div>
                        </div>
                    )}
                </div>
                {isConnected && profit > 0 && (
                    <>
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50" />
                        <div className="absolute inset-0 pointer-events-none overflow-hidden">
                            {[...Array(5)].map((_, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ y: 100, x: Math.random() * 200 - 100, opacity: 0 }}
                                    animate={{
                                        y: -200,
                                        x: Math.random() * 200 - 100,
                                        opacity: [0, 1, 0],
                                        scale: [0.5, 1.2, 0.8]
                                    }}
                                    transition={{
                                        duration: 2 + Math.random() * 2,
                                        repeat: Infinity,
                                        delay: Math.random() * 5
                                    }}
                                    className="absolute bottom-0 left-1/2 w-1 h-1 bg-gold-400 rounded-full blur-[1px]"
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
