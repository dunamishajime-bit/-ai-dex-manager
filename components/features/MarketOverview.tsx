// AUTO_CONTINUE: enabled
"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { getCryptoNews, CryptoNews, TopMover } from "@/lib/dex-service";
import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";
import { TrendingUp, TrendingDown, Newspaper, Wallet } from "lucide-react";
import { useAccount } from "wagmi";

const FALLBACK_COIN_ICON =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
            <rect width="64" height="64" rx="32" fill="#111827"/>
            <text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#9CA3AF" font-size="18" font-family="Arial">COIN</text>
        </svg>`
    );

function toNumberSafe(value: unknown): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function getJstDateKey() {
    const now = new Date();
    const jst = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
    const y = jst.getFullYear();
    const m = String(jst.getMonth() + 1).padStart(2, "0");
    const d = String(jst.getDate()).padStart(2, "0");
    return `jdex_daily_principal_${y}-${m}-${d}`;
}

export function MarketOverview() {
    const { portfolio, isDemoMode, demoBalance, marketRegime, liveInitialBalance } = useSimulation();
    const { isConnected } = useAccount();
    const { formatPrice, setJpyRate, jpyRate } = useCurrency();
    const formatJpyValue = (usdValue: number) => {
        const amount = Number.isFinite(Number(usdValue)) ? Number(usdValue) : 0;
        return `¥${Math.round(amount * jpyRate).toLocaleString("ja-JP")}`;
    };

    const [gainers, setGainers] = useState<TopMover[]>([]);
    const [losers, setLosers] = useState<TopMover[]>([]);
    const [news, setNews] = useState<CryptoNews[]>([]);
    const [loading, setLoading] = useState(true);
    const [dailyPrincipal, setDailyPrincipal] = useState(0);
    const [principalStorageKey, setPrincipalStorageKey] = useState(getJstDateKey());
    const prevConnectedRef = useRef(false);

    useEffect(() => {
        const interval = setInterval(() => {
            const next = getJstDateKey();
            setPrincipalStorageKey((prev) => (prev === next ? prev : next));
        }, 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const load = async () => {
            try {
                const res = await fetch("/api/market/dashboard");
                const data = await res.json();
                if (!data?.ok) return;

                if (data.fxRate) setJpyRate(Number(data.fxRate));
                setGainers(Array.isArray(data.trendTop3?.up) ? data.trendTop3.up : []);
                setLosers(Array.isArray(data.trendTop3?.down) ? data.trendTop3.down : []);
                getCryptoNews().then(setNews).catch(() => setNews([]));
            } catch (err) {
                console.error("Failed to load market overview", err);
            } finally {
                setLoading(false);
            }
        };

        load();
        const interval = setInterval(load, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [setJpyRate]);

    useEffect(() => {
        if (isDemoMode) {
            setDailyPrincipal(demoBalance || portfolio.totalValue || 0);
            return;
        }

        if (!isConnected || portfolio.totalValue <= 0) return;

        const current = portfolio.totalValue;
        const raw = localStorage.getItem(principalStorageKey);
        const parsed = raw ? Number(raw) : 0;
        const invalid = !Number.isFinite(parsed) || parsed <= 0;
        const looksStale = !invalid && (parsed < current * 0.25 || parsed > current * 4);

        if (invalid || looksStale) {
            localStorage.setItem(principalStorageKey, String(current));
            setDailyPrincipal(current);
            return;
        }

        setDailyPrincipal(parsed);
    }, [isConnected, isDemoMode, demoBalance, portfolio.totalValue, principalStorageKey]);

    useEffect(() => {
        if (isDemoMode) {
            prevConnectedRef.current = false;
            return;
        }
        const justConnected = isConnected && !prevConnectedRef.current;
        prevConnectedRef.current = isConnected;

        if (justConnected && portfolio.totalValue > 0) {
            localStorage.setItem(principalStorageKey, String(portfolio.totalValue));
            setDailyPrincipal(portfolio.totalValue);
        }
    }, [isConnected, isDemoMode, portfolio.totalValue, principalStorageKey]);

    const currentTotal = (isConnected || isDemoMode)
        ? portfolio.totalValue
        : 0;

    const initialBalance = isDemoMode
        ? (demoBalance || portfolio.totalValue || 0)
        : (liveInitialBalance || dailyPrincipal || portfolio.totalValue || currentTotal);

    const profit = currentTotal - initialBalance;
    const profitColor = profit >= 0 ? "text-emerald-400" : "text-red-400";
    const profitSign = profit >= 0 ? "+" : "-";

    const extractUsdPrice = (coin: any): number => {
        const usd = toNumberSafe(
            coin?.usdPrice ??
            coin?.currentPrice ??
            coin?.price ??
            coin?.usd ??
            coin?.current_price
        );
        if (usd > 0) return usd;

        const jpy = toNumberSafe(coin?.jpyPrice);
        if (jpy > 0 && jpyRate > 0) return jpy / jpyRate;

        return 0;
    };

    const extractChange24h = (coin: any): number =>
        toNumberSafe(
            coin?.priceChange24h ??
            coin?.change24h ??
            coin?.price_change_percentage_24h
        );

    const renderMover = (coin: any, direction: "up" | "down") => {
        const usdPrice = extractUsdPrice(coin);
        const change24h = extractChange24h(coin);
        const positive = direction === "up";

        return (
            <div
                key={coin.providerId || coin.id || coin.symbol}
                className={`flex items-center justify-between p-2 rounded border transition-colors ${
                    positive
                        ? "bg-emerald-500/5 border-emerald-500/10 hover:bg-emerald-500/10"
                        : "bg-red-500/5 border-red-500/10 hover:bg-red-500/10"
                }`}
            >
                <div className="flex items-center gap-2">
                    <img
                        src={coin.image || coin.thumb || FALLBACK_COIN_ICON}
                        alt={coin.name || coin.symbol || "coin"}
                        className="w-6 h-6 rounded-full"
                        onError={(e) => {
                            e.currentTarget.src = FALLBACK_COIN_ICON;
                        }}
                    />
                    <div>
                        <div className="text-xs font-bold text-white">{coin.symbol || "-"}</div>
                        <div className="text-[10px] text-gray-400">
                            {usdPrice > 0 ? formatPrice(usdPrice) : "N/A"}
                        </div>
                    </div>
                </div>
                <div className={`text-xs font-bold ${positive ? "text-emerald-400" : "text-red-400"}`}>
                    {change24h >= 0 ? "+" : ""}{change24h.toFixed(2)}%
                </div>
            </div>
        );
    };

    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
                {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-[#0d1117] rounded-xl h-48 border border-gold-500/10" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#0d1117] rounded-xl p-4 border border-gold-500/20 flex flex-col relative overflow-hidden">
                <div className="absolute top-0 right-0 p-2 opacity-10">
                    <Wallet className="w-24 h-24 text-gold-500" />
                </div>
                <h3 className="text-sm font-bold text-gold-400 flex items-center gap-2 mb-1 z-10">
                    <Wallet className="w-4 h-4" /> 本日の損益額
                </h3>
                <p className="mb-3 z-10 text-[11px] md:text-xs font-medium tracking-[0.1em] text-cyan-200/60">
                    元本
                    <span className="ml-2 text-base md:text-lg font-mono font-medium text-cyan-50/75">
                        {formatJpyValue(initialBalance)}
                    </span>
                </p>

                <div className="flex-1 flex flex-col justify-center items-center z-10">
                    {(isConnected || isDemoMode) ? (
                        <>
                            <div className={`text-2xl font-bold font-mono ${profitColor} mb-1`}>
                                {profitSign}{formatPrice(Math.abs(profit))}
                            </div>

                            <div className="mt-3 px-3 py-1 rounded-full text-[10px] font-bold border flex items-center gap-1.5 bg-white/5 border-white/10 shadow-sm">
                                <span className="text-gray-500">REGIME:</span>
                                <span
                                    className={
                                        marketRegime === "TREND_UP" ? "text-emerald-400" :
                                            marketRegime === "TREND_DOWN" ? "text-red-400" :
                                                marketRegime === "VOLATILE" ? "text-orange-400" : "text-blue-400"
                                    }
                                >
                                    {marketRegime?.replace("_", " ") || "RANGE"}
                                </span>
                            </div>
                        </>
                    ) : (
                        <div className="text-center">
                            <div className="text-2xl font-bold text-gray-600 font-mono tracking-widest mb-2">---</div>
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
                                        scale: [0.5, 1.2, 0.8],
                                    }}
                                    transition={{
                                        duration: 2 + Math.random() * 2,
                                        repeat: Infinity,
                                        delay: Math.random() * 5,
                                    }}
                                    className="absolute bottom-0 left-1/2 w-1 h-1 bg-gold-400 rounded-full blur-[1px]"
                                />
                            ))}
                        </div>
                    </>
                )}
            </div>

            <div className="bg-[#0d1117] rounded-xl p-4 border border-emerald-500/20 flex flex-col">
                <h3 className="text-sm font-bold text-emerald-400 flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4" /> 上昇トレンド TOP3
                </h3>
                <div className="space-y-3 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                    {gainers.map((coin) => renderMover(coin, "up"))}
                </div>
            </div>

            <div className="bg-[#0d1117] rounded-xl p-4 border border-red-500/20 flex flex-col">
                <h3 className="text-sm font-bold text-red-400 flex items-center gap-2 mb-3">
                    <TrendingDown className="w-4 h-4" /> 下降トレンド TOP3
                </h3>
                <div className="space-y-3 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                    {losers.map((coin) => renderMover(coin, "down"))}
                </div>
            </div>

            <div className="bg-[#0d1117] rounded-xl p-4 border border-blue-500/20 flex flex-col">
                <h3 className="text-sm font-bold text-blue-400 flex items-center gap-2 mb-3">
                    <Newspaper className="w-4 h-4" /> 仮想通貨ニュース
                </h3>
                <div className="space-y-2 flex-1 overflow-y-auto pr-1 custom-scrollbar max-h-[160px]">
                    {news.map((item) => (
                        <a
                            key={item.id}
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block p-2 bg-blue-500/5 rounded border border-blue-500/10 hover:bg-blue-500/10 transition-colors group"
                        >
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
        </div>
    );
}
