"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { fetchMarketPrices } from "@/lib/market-service";
import { useCurrency } from "@/context/CurrencyContext";

type TickerItem = {
    label: string;
    fetchSymbol: string;
    cmcSlug?: string;
};

const TICKER_ITEMS: readonly TickerItem[] = [
    { label: "BTC", fetchSymbol: "BTC" },
    { label: "ETH", fetchSymbol: "ETH" },
    { label: "BNB", fetchSymbol: "BNB" },
    { label: "XRP", fetchSymbol: "XRP" },
    { label: "WLFI", fetchSymbol: "WLFI", cmcSlug: "world-liberty-financial" },
    { label: "TAO", fetchSymbol: "TAO" },
    { label: "LINK", fetchSymbol: "LINK" },
    { label: "ASTER", fetchSymbol: "ASTER", cmcSlug: "astar" },
] as const;

type TickerRow = {
    label: string;
    fetchSymbol: string;
    price: number;
    change24h: number;
};

function cmcUrl(item: TickerItem) {
    const slug = item.cmcSlug || item.fetchSymbol.toLowerCase();
    return `https://coinmarketcap.com/currencies/${slug}/`;
}

export function CoinMarketCapMarquee() {
    const { formatPrice } = useCurrency();
    const [rows, setRows] = useState<TickerRow[]>([]);
    const [updatedAt, setUpdatedAt] = useState<number | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const loadTicker = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const prices = await fetchMarketPrices(TICKER_ITEMS.map((item) => item.fetchSymbol));
            setRows(
                TICKER_ITEMS.map((item) => ({
                    label: item.label,
                    fetchSymbol: item.fetchSymbol,
                    price: Number(prices[item.fetchSymbol]?.price || 0),
                    change24h: Number(prices[item.fetchSymbol]?.change24h || 0),
                })),
            );
            setUpdatedAt(Date.now());
        } catch (error) {
            console.warn("[Ticker] Failed to load market prices:", error);
        } finally {
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        void loadTicker();
    }, [loadTicker]);

    const visibleRows = useMemo(() => {
        if (rows.length > 0) return rows;
        return TICKER_ITEMS.map((item) => ({
            label: item.label,
            fetchSymbol: item.fetchSymbol,
            price: 0,
            change24h: 0,
        }));
    }, [rows]);

    return (
        <section className="rounded-[24px] border border-gold-500/20 bg-[linear-gradient(180deg,#151107,#0c0a05)] p-4 shadow-[0_14px_44px_rgba(0,0,0,0.28)]">
            <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                    <div className="text-xs font-black uppercase tracking-[0.22em] text-gold-400">Market Ticker</div>
                    <div className="mt-1 text-sm text-slate-300">主要監視銘柄の現在値と24時間変化率</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold text-slate-300">
                        <RefreshCw className={`h-3.5 w-3.5 text-cyan-300 ${isRefreshing ? "animate-spin" : ""}`} />
                        {updatedAt ? "更新ボタンで取得" : "初回データ取得中"}
                    </div>
                    <button
                        onClick={() => void loadTicker()}
                        disabled={isRefreshing}
                        className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold text-cyan-200 transition hover:bg-cyan-400/16 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
                        更新
                    </button>
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                {visibleRows.map((row) => {
                    const item = TICKER_ITEMS.find((candidate) => candidate.label === row.label) || TICKER_ITEMS[0];
                    const positive = row.change24h >= 0;
                    return (
                        <Link
                            key={row.label}
                            href={cmcUrl(item)}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 transition hover:border-gold-400/50 hover:bg-white/[0.07]"
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-1 text-base font-black text-white">
                                        {row.label}
                                        <ExternalLink className="h-3.5 w-3.5 text-slate-500" />
                                    </div>
                                    <div className="mt-1 text-sm font-semibold text-slate-300">
                                        {row.price > 0 ? formatPrice(row.price) : "価格未取得"}
                                    </div>
                                </div>
                                <div
                                    className={`rounded-full px-2 py-1 text-xs font-black ${
                                        positive
                                            ? "bg-emerald-500/15 text-emerald-300"
                                            : "bg-rose-500/15 text-rose-300"
                                    }`}
                                >
                                    {positive ? "+" : ""}
                                    {row.change24h.toFixed(2)}%
                                </div>
                            </div>
                        </Link>
                    );
                })}
            </div>
        </section>
    );
}
