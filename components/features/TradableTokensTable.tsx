"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, BarChart3, RefreshCw, Search, Star } from "lucide-react";
import { STRATEGY_CONFIG } from "@/config/strategyConfig";
import { STRATEGY_UNIVERSE_SEEDS } from "@/config/strategyUniverse";
import { ChainId } from "@/lib/dex-service";
import { useSimulation } from "@/context/SimulationContext";
import { useCurrency } from "@/context/CurrencyContext";
import { cn } from "@/lib/utils";

export interface TradableToken {
    id: string;
    symbol: string;
    name: string;
    image: string;
    currentPrice: number;
    priceChange24h: number;
    priceChange7d: number;
    volume24h: number;
    marketCap: number;
    marketCapRank: number;
    sparkline: number[];
    availableDEXs: string[];
    high24h: number;
    low24h: number;
}

interface Props {
    onSelectToken?: (token: TradableToken) => void;
    selectedChain?: ChainId;
    initialTokenSymbol?: string | null;
}

const DEFAULT_DEXS = ["ParaSwap", "OpenOcean", "PancakeSwap"];
const ELIGIBLE_UNIVERSE_SEEDS = STRATEGY_UNIVERSE_SEEDS.filter((seed) => !seed.excludeFromUniverse);
const DISPLAY_UNIVERSE_SYMBOLS = ELIGIBLE_UNIVERSE_SEEDS.map((seed) => seed.symbol);
const TOKEN_META = Object.fromEntries(
    ELIGIBLE_UNIVERSE_SEEDS.map((seed) => [
        seed.symbol,
        {
            name: seed.name || seed.symbol,
            dexs: DEFAULT_DEXS,
            volume24hUsd: seed.volume24hUsd,
            marketCapUsd: seed.marketCapUsd,
        },
    ]),
);

export function TradableTokensTable({ onSelectToken, initialTokenSymbol }: Props) {
    const router = useRouter();
    const { formatPrice, formatLarge, setJpyRate } = useCurrency();
    const { favorites, toggleFavorite, allMarketData } = useSimulation();
    const [tokens, setTokens] = useState<TradableToken[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [search, setSearch] = useState("");

    const loadTokens = useCallback(async () => {
        setLoading((prev) => prev && tokens.length === 0);
        try {
            const [dashboardRes, metricsRes] = await Promise.all([
                fetch("/api/market/dashboard", { cache: "no-store" }),
                fetch(`/api/market/universe-metrics?symbols=${encodeURIComponent(DISPLAY_UNIVERSE_SYMBOLS.join(","))}`, { cache: "no-store" }),
            ]);

            const dashboard = await dashboardRes.json();
            const metrics = await metricsRes.json();

            if (dashboard?.ok && dashboard.fxRate) {
                setJpyRate(Number(dashboard.fxRate));
            }

            const nextTokens = DISPLAY_UNIVERSE_SYMBOLS.map((symbol) => {
                const quote = (metrics?.[symbol] || {}) as {
                    price?: number;
                    change24h?: number;
                    volume?: number;
                    marketCap?: number;
                };
                const fallback = (allMarketData[symbol] || {}) as {
                    price?: number;
                    change24h?: number;
                    volume?: number;
                };
                const meta = TOKEN_META[symbol] || { name: symbol, dexs: DEFAULT_DEXS, volume24hUsd: 0, marketCapUsd: 0 };
                const currentPrice = Number(quote.price ?? fallback.price ?? 0);
                const priceChange24h = Number(quote.change24h ?? fallback.change24h ?? 0);
                const volume24h = Number(quote.volume ?? fallback.volume ?? meta.volume24hUsd ?? 0);
                const marketCap = Number(quote.marketCap ?? meta.marketCapUsd ?? 0);

                return {
                    id: symbol.toLowerCase(),
                    symbol,
                    name: meta.name,
                    image: "",
                    currentPrice,
                    priceChange24h,
                    priceChange7d: 0,
                    volume24h,
                    marketCap,
                    marketCapRank: 0,
                    sparkline: [],
                    availableDEXs: meta.dexs,
                    high24h: 0,
                    low24h: 0,
                } satisfies TradableToken;
            });

            nextTokens.sort((left, right) => {
                if (right.marketCap !== left.marketCap) return right.marketCap - left.marketCap;
                if (right.volume24h !== left.volume24h) return right.volume24h - left.volume24h;
                return right.priceChange24h - left.priceChange24h;
            });

            setTokens(nextTokens.map((token, index) => ({ ...token, marketCapRank: index + 1 })));
        } catch (error) {
            console.error("Failed to load DEX tracker universe:", error);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [allMarketData, setJpyRate, tokens.length]);

    useEffect(() => {
        loadTokens();
        const interval = setInterval(loadTokens, 15_000);
        return () => clearInterval(interval);
    }, [loadTokens]);

    useEffect(() => {
        if (!initialTokenSymbol) return;
        const token = tokens.find((entry) => entry.symbol === initialTokenSymbol);
        if (token && onSelectToken) {
            onSelectToken(token);
        }
    }, [initialTokenSymbol, onSelectToken, tokens]);

    const filtered = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        const base = keyword.length === 0
            ? tokens
            : tokens.filter((token) =>
                token.symbol.toLowerCase().includes(keyword) || token.name.toLowerCase().includes(keyword),
            );

        return [...base].sort((left, right) => {
            const leftFav = favorites.has(left.id) ? 1 : 0;
            const rightFav = favorites.has(right.id) ? 1 : 0;
            if (leftFav !== rightFav) return rightFav - leftFav;
            return left.marketCapRank - right.marketCapRank;
        });
    }, [favorites, search, tokens]);

    return (
        <div className="flex w-full flex-col overflow-hidden rounded-xl border border-gold-500/20 bg-[#0d1117]">
            <div className="flex flex-col gap-4 border-b border-gold-500/10 bg-black/20 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold text-white">
                        銘柄検索とグローバルランキング
                        <span className="rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] font-mono text-blue-300">
                            BNB Chain
                        </span>
                        <span className="rounded-full border border-gold-500/30 bg-gold-500/10 px-2 py-0.5 text-[11px] font-mono text-gold-300">
                            {DISPLAY_UNIVERSE_SYMBOLS.length} 銘柄
                        </span>
                        <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[11px] font-mono text-cyan-300">
                            監視上限 {STRATEGY_CONFIG.UNIVERSE_MAX_SIZE}
                        </span>
                    </h2>
                    <p className="mt-1 text-xs text-gray-400">
                        24H 騰落率は live universe metrics を優先し、欠損時のみ内部価格データで補完しています。
                    </p>
                </div>

                <div className="flex w-full items-center gap-2 md:w-auto">
                    <div className="relative w-full md:w-72">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                        <input
                            type="text"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="銘柄名またはシンボルで検索"
                            className="w-full rounded-lg border border-gold-500/20 bg-black/40 py-2 pl-9 pr-3 text-sm text-white outline-none transition-colors focus:border-gold-500/50"
                        />
                    </div>
                    <button
                        onClick={() => {
                            setRefreshing(true);
                            loadTokens();
                        }}
                        className="rounded-lg border border-gold-500/30 bg-gold-500/10 p-2 text-gold-400 transition-colors hover:bg-gold-500/20"
                        title="最新データに更新"
                    >
                        <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead className="sticky top-0 z-10 bg-[#0d1117]">
                        <tr className="border-b border-gold-500/10 text-xs uppercase tracking-[0.16em] text-gray-400">
                            <th className="w-10 px-4 py-3"></th>
                            <th className="w-14 px-4 py-3">順位</th>
                            <th className="px-4 py-3">銘柄</th>
                            <th className="px-4 py-3 text-right">現在価格</th>
                            <th className="px-4 py-3 text-right">24H</th>
                            <th className="px-4 py-3 text-right">24H 出来高</th>
                            <th className="px-4 py-3 text-right">時価総額</th>
                            <th className="px-4 py-3">DEX</th>
                            <th className="w-24 px-4 py-3">分析</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            Array.from({ length: 8 }).map((_, index) => (
                                <tr key={index} className="border-b border-white/5">
                                    <td colSpan={9} className="px-4 py-4">
                                        <div className="h-8 animate-pulse rounded bg-gold-500/5" />
                                    </td>
                                </tr>
                            ))
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={9} className="px-4 py-12 text-center text-sm text-gray-500">
                                    条件に一致する銘柄はありません。
                                </td>
                            </tr>
                        ) : (
                            filtered.map((token) => (
                                <tr
                                    key={token.id}
                                    className={cn(
                                        "cursor-pointer border-b border-white/5 transition-colors hover:bg-white/5",
                                        favorites.has(token.id) && "bg-gold-500/5",
                                    )}
                                    onClick={() => onSelectToken?.(token)}
                                >
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                toggleFavorite(token.id);
                                            }}
                                            className={cn("text-gray-600 transition-colors hover:text-gold-400", favorites.has(token.id) && "text-gold-400")}
                                        >
                                            <Star className={cn("h-4 w-4", favorites.has(token.id) && "fill-gold-400")} />
                                        </button>
                                    </td>
                                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                                        {favorites.has(token.id) ? "★" : token.marketCapRank}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/15 bg-gold-500/10 text-xs font-black text-gold-300">
                                                {token.symbol.slice(0, 2)}
                                            </div>
                                            <div>
                                                <div className="font-bold text-white">{token.name}</div>
                                                <div className="text-[11px] font-mono text-gray-500">{token.symbol}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-sm text-white">
                                        {formatPrice(token.currentPrice)}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <span
                                            className={cn(
                                                "inline-flex items-center justify-end gap-1 font-mono text-sm",
                                                token.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400",
                                            )}
                                        >
                                            {token.priceChange24h >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                            {token.priceChange24h >= 0 ? "+" : ""}
                                            {token.priceChange24h.toFixed(2)}%
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                                        {formatLarge(token.volume24h)}
                                    </td>
                                    <td className="px-4 py-3 text-right font-mono text-sm text-gray-300">
                                        {formatLarge(token.marketCap)}
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex flex-wrap gap-1">
                                            {token.availableDEXs.map((dex) => (
                                                <span
                                                    key={dex}
                                                    className="rounded border border-gold-500/20 bg-gold-500/10 px-2 py-1 text-[10px] font-mono text-gold-300"
                                                >
                                                    {dex}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <button
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                router.push(`/strategy/ranking?rank=All&state=All&scope=universe`);
                                            }}
                                            className="inline-flex items-center gap-1 rounded border border-purple-500/30 bg-purple-500/10 px-2 py-1 text-xs font-mono text-purple-300 transition-colors hover:bg-purple-500/20"
                                        >
                                            <BarChart3 className="h-3 w-3" />
                                            分析
                                        </button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
