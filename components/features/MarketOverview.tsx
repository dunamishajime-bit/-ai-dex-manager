"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Wallet, TrendingDown, TrendingUp, Newspaper } from "lucide-react";
import { useAccount } from "wagmi";
import { getCryptoNews, CryptoNews, TopMover } from "@/lib/dex-service";
import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";

function safeNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safePercent(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function getUsdPrice(coin: TopMover | Record<string, unknown>): number | undefined {
    return (
        safeNumber((coin as any)?.usdPrice)
        ?? safeNumber((coin as any)?.currentPrice)
        ?? safeNumber((coin as any)?.current_price)
        ?? safeNumber((coin as any)?.price)
    );
}

function TokenAvatar({ symbol, name, image }: { symbol?: string; name?: string; image?: string }) {
    if (image) {
        return <img src={image} alt={name || symbol || "token"} className="h-6 w-6 rounded-full" />;
    }

    const label = (symbol || name || "?").slice(0, 2).toUpperCase();
    return (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-500/10 text-[9px] font-bold text-gold-400">
            {label}
        </div>
    );
}

export function MarketOverview() {
    const { portfolio, isDemoMode, demoBalance, marketRegime, liveInitialBalance } = useSimulation();
    const { formatPrice, currency, setJpyRate } = useCurrency();
    const { isConnected } = useAccount();

    const [gainers, setGainers] = useState<TopMover[]>([]);
    const [losers, setLosers] = useState<TopMover[]>([]);
    const [news, setNews] = useState<CryptoNews[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const load = async () => {
            try {
                const dashboardRes = await fetch("/api/market/dashboard", { cache: "no-store" });
                const dashboard = await dashboardRes.json();

                if (dashboard.ok) {
                    if (dashboard.fxRate) {
                        setJpyRate(Number(dashboard.fxRate));
                    }
                    setGainers(Array.isArray(dashboard.trendTop3?.up) ? dashboard.trendTop3.up : []);
                    setLosers(Array.isArray(dashboard.trendTop3?.down) ? dashboard.trendTop3.down : []);
                }

                const latestNews = await getCryptoNews();
                setNews(Array.isArray(latestNews) ? latestNews : []);
            } catch (error) {
                console.error("Failed to load market overview:", error);
            } finally {
                setLoading(false);
            }
        };

        load();
        const interval = setInterval(load, 10_000);
        return () => clearInterval(interval);
    }, [setJpyRate]);

    const currentTotal = useMemo(() => {
        if (!isConnected && !isDemoMode) return 0;
        return Number.isFinite(portfolio.totalValue) ? portfolio.totalValue : 0;
    }, [isConnected, isDemoMode, portfolio.totalValue]);

    const principal = useMemo(() => {
        if (isDemoMode) return Number.isFinite(demoBalance) ? demoBalance : currentTotal;
        if (Number.isFinite(liveInitialBalance) && liveInitialBalance > 0) return liveInitialBalance;
        return currentTotal;
    }, [currentTotal, demoBalance, isDemoMode, liveInitialBalance]);

    const dailyPnl = currentTotal - principal;
    const pnlColor = dailyPnl >= 0 ? "text-emerald-400" : "text-red-400";
    const pnlPrefix = dailyPnl >= 0 ? "+" : "";

    if (loading) {
        return (
            <div className="grid animate-pulse grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                    <div key={index} className="h-48 rounded-xl border border-gold-500/10 bg-[#0d1117]" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="relative flex min-h-[228px] flex-col overflow-hidden rounded-xl border border-gold-500/20 bg-[#0d1117] p-4">
                <div className="pointer-events-none absolute right-0 top-0 p-2 opacity-10">
                    <Wallet className="h-24 w-24 text-gold-500" />
                </div>

                <h3 className="z-10 mb-1 flex items-center gap-2 text-sm font-bold text-gold-400">
                    <Wallet className="h-4 w-4" />
                    {isDemoMode ? `本日の損益額 (${currency}/DEMO)` : "本日の損益額"}
                </h3>
                <p className="z-10 mb-4 text-[10px] text-gray-500">
                    {isDemoMode ? "デモ口座の損益表示" : "接続ウォレット基準の損益表示"}
                </p>

                <div className="z-10 flex flex-1 flex-col items-center justify-center text-center">
                    {isConnected || isDemoMode ? (
                        <>
                            <div className={`mb-1 text-2xl font-mono font-bold ${pnlColor}`}>
                                {pnlPrefix}
                                {formatPrice(dailyPnl)}
                            </div>
                            <div className="text-xs text-gray-400">
                                元本: <span className="font-mono">{formatPrice(principal)}</span>
                            </div>
                            <div className="mt-1 text-xs text-gray-500">
                                運用資産: <span className="font-mono text-gray-300">{formatPrice(currentTotal)}</span>
                            </div>
                            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-bold">
                                <span className="text-gray-500">REGIME:</span>
                                <span
                                    className={
                                        marketRegime === "TREND_UP"
                                            ? "text-emerald-400"
                                            : marketRegime === "TREND_DOWN"
                                                ? "text-red-400"
                                                : marketRegime === "VOLATILE"
                                                    ? "text-orange-400"
                                                    : "text-blue-400"
                                    }
                                >
                                    {marketRegime?.replace("_", " ") || "RANGE"}
                                </span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="mb-2 font-mono text-2xl font-bold tracking-widest text-gray-600">---</div>
                            <div className="rounded border border-red-500/20 bg-red-500/10 px-2 py-1 text-xs font-mono text-red-400">
                                ウォレット未接続
                            </div>
                        </>
                    )}
                </div>

                {isConnected && dailyPnl > 0 ? (
                    <>
                        <div className="absolute bottom-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-500 to-transparent opacity-50" />
                        <div className="pointer-events-none absolute inset-0 overflow-hidden">
                            {Array.from({ length: 5 }).map((_, index) => (
                                <motion.div
                                    key={index}
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
                                    className="absolute bottom-0 left-1/2 h-1 w-1 rounded-full bg-gold-400 blur-[1px]"
                                />
                            ))}
                        </div>
                    </>
                ) : null}
            </div>

            <div className="flex min-h-[228px] flex-col rounded-xl border border-emerald-500/20 bg-[#0d1117] p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-emerald-400">
                    <TrendingUp className="h-4 w-4" />
                    上昇トレンドTOP3
                </h3>
                <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-1">
                    {gainers.map((coin: any) => (
                        <div
                            key={coin.providerId || coin.id}
                            className="flex items-center justify-between rounded border border-emerald-500/10 bg-emerald-500/5 p-2 transition-colors hover:bg-emerald-500/10"
                        >
                            <div className="flex items-center gap-2">
                                <TokenAvatar symbol={coin.symbol} name={coin.name} image={coin.image || coin.thumb} />
                                <div>
                                    <div className="text-xs font-bold text-white">{coin.symbol}</div>
                                    <div className="text-[10px] text-gray-400">{formatPrice(getUsdPrice(coin))}</div>
                                </div>
                            </div>
                            <div className="text-xs font-bold text-emerald-400">
                                +{safePercent(coin.priceChange24h ?? coin.change24h).toFixed(2)}%
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex min-h-[228px] flex-col rounded-xl border border-red-500/20 bg-[#0d1117] p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-red-400">
                    <TrendingDown className="h-4 w-4" />
                    下降トレンドTOP3
                </h3>
                <div className="custom-scrollbar flex-1 space-y-3 overflow-y-auto pr-1">
                    {losers.map((coin: any) => (
                        <div
                            key={coin.providerId || coin.id}
                            className="flex items-center justify-between rounded border border-red-500/10 bg-red-500/5 p-2 transition-colors hover:bg-red-500/10"
                        >
                            <div className="flex items-center gap-2">
                                <TokenAvatar symbol={coin.symbol} name={coin.name} image={coin.image || coin.thumb} />
                                <div>
                                    <div className="text-xs font-bold text-white">{coin.symbol}</div>
                                    <div className="text-[10px] text-gray-400">{formatPrice(getUsdPrice(coin))}</div>
                                </div>
                            </div>
                            <div className="text-xs font-bold text-red-400">
                                {safePercent(coin.priceChange24h ?? coin.change24h).toFixed(2)}%
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex min-h-[228px] flex-col rounded-xl border border-blue-500/20 bg-[#0d1117] p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-blue-400">
                    <Newspaper className="h-4 w-4" />
                    仮想通貨ニュース
                </h3>
                <div className="custom-scrollbar max-h-[160px] flex-1 space-y-2 overflow-y-auto pr-1">
                    {news.map((item) => (
                        <a
                            key={item.id}
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="block rounded border border-blue-500/10 bg-blue-500/5 p-3 transition-colors hover:bg-blue-500/10"
                        >
                            <div className="mb-1 line-clamp-2 text-xs font-bold text-white">{item.title}</div>
                            <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
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
