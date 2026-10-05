"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, Newspaper } from "lucide-react";
import Link from "next/link";
import { getCryptoNews as fetchNews } from "@/lib/dex-service";
import { useSimulation } from "@/context/SimulationContext";

export function NewsTicker() {
    const [scrollingItems, setScrollingItems] = useState<{ title: string, url: string }[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [selectedNews, setSelectedNews] = useState<{ title: string, url: string } | null>(null);
    const { latestNews } = useSimulation();

    useEffect(() => {
        const load = async () => {
            const news = await fetchNews();

            // Create ticker items from news
            const items = news.map(n => ({
                title: `📰 ${n.title} (Source: ${n.source} / ${n.published_at})`,
                url: n.url || `https://www.google.com/search?q=${encodeURIComponent(n.title)}`
            }));

            // Add market updates (mock)
            const marketUpdates = [
                { title: "Bitcoin: ¥9,800,000 (+2.4%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/btc_jpy" },
                { title: "Ethereum: ¥380,000 (+1.1%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/eth_jpy" },
                { title: "Solana: ¥22,000 (+5.8%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/sol_jpy" },
                { title: "XRP: ¥85 (-0.5%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/xrp_jpy" }
            ];

            const allItems = [...items, ...marketUpdates];
            // Duplicate for seamless loop
            setScrollingItems([...allItems, ...allItems]);
        };
        load();
    }, []);

    // Effect to handle real-time news injection
    useEffect(() => {
        if (latestNews) {
            const isReal = latestNews.category === "REAL";
            const prefix = isReal ? `🆕 [${latestNews.source}]` : "🆕 [URGENT]";
            const newItem = {
                title: `${prefix} ${latestNews.title}`,
                url: latestNews.url || "#"
            };
            setScrollingItems(prev => [newItem, ...prev.slice(0, prev.length - 1)]);
        }
    }, [latestNews]);

    const handleNewsClick = (newsItem: { title: string, url: string }) => {
        setSelectedNews(newsItem);
        setShowModal(true);
    };

    const handleConfirm = () => {
        if (selectedNews) {
            window.open(selectedNews.url, "_blank");
        }
        setShowModal(false);
    };

    if (scrollingItems.length === 0) return null;

    return (
        <>
            <div className="w-full bg-cyber-black/80 border-b border-gold-500/20 overflow-hidden h-8 flex items-center relative z-40">
                <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-cyber-black to-transparent z-10" />
                <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-cyber-black to-transparent z-10" />

                <div className="flex items-center gap-2 px-3 text-gold-400 bg-cyber-black h-full z-20 shrink-0 border-r border-gold-500/10">
                    <Newspaper className="w-3.5 h-3.5" />
                    <span className="text-xs font-bold tracking-wider hidden sm:inline">NEWS</span>
                    <Link href="/news" className="ml-2 px-1.5 py-0.5 text-[10px] bg-gold-500/10 hover:bg-gold-500/20 rounded border border-gold-500/20 text-gold-400 transition-colors">
                        履歴
                    </Link>
                </div>

                <div className="ticker-wrap flex-1 overflow-hidden">
                    <div className="ticker-content flex whitespace-nowrap animate-ticker">
                        {scrollingItems.map((item, i) => (
                            <button
                                key={i}
                                onClick={() => handleNewsClick(item)}
                                className="inline-flex items-center mx-6 text-xs text-gray-300 hover:text-gold-400 transition-colors cursor-pointer focus:outline-none"
                            >
                                {item.title.includes("(+") ? (
                                    <span className="text-emerald-400 mr-1"><TrendingUp className="w-3 h-3 inline" /></span>
                                ) : item.title.includes("(-") ? (
                                    <span className="text-red-400 mr-1"><TrendingDown className="w-3 h-3 inline" /></span>
                                ) : (
                                    <span className="text-gold-500/50 mr-1">•</span>
                                )}
                                {item.title}
                            </button>
                        ))}
                    </div>
                </div>

                <style jsx global>{`
                    @keyframes ticker {
                        0% { transform: translateX(0); }
                        100% { transform: translateX(-50%); }
                    }
                    .animate-ticker {
                        animation: ticker 40s linear infinite;
                    }
                    .animate-ticker:hover {
                        animation-play-state: paused;
                    }
                `}</style>
            </div>

            {/* Confirmation Modal */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-cyber-black border border-gold-500/30 rounded-lg p-6 max-w-md w-full shadow-[0_0_20px_rgba(255,215,0,0.1)] relative text-left">
                        <h3 className="text-lg font-bold text-gold-500 mb-4">外部サイトへ移動します</h3>
                        <p className="text-gray-300 text-sm mb-4">
                            以下のニュース記事の詳細を確認するために外部サイトへ移動します。<br />
                            よろしいですか？
                        </p>
                        <div className="bg-black/30 p-3 rounded border border-white/5 mb-6 text-xs text-gray-400 break-words font-mono">
                            Target: {selectedNews?.url}
                        </div>

                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowModal(false)}
                                className="px-4 py-2 rounded text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
                            >
                                キャンセル
                            </button>
                            <button
                                onClick={handleConfirm}
                                className="px-4 py-2 rounded text-sm bg-gold-500/20 text-gold-400 border border-gold-500/50 hover:bg-gold-500/30 transition-colors"
                            >
                                同意して移動
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
