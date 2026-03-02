"use client";

import { useEffect, useState } from "react";
import { Newspaper, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";
import { getCryptoNews as fetchNews } from "@/lib/dex-service";
import { useSimulation } from "@/context/SimulationContext";

export function NewsTicker() {
  const [scrollingItems, setScrollingItems] = useState<{ title: string; url: string }[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [selectedNews, setSelectedNews] = useState<{ title: string; url: string } | null>(null);
  const { latestNews } = useSimulation();

  useEffect(() => {
    const load = async () => {
      const news = await fetchNews();

      const items = news.map((item) => ({
        title: `速報 ${item.title} (${item.source} / ${item.published_at})`,
        url: item.url || `https://www.google.com/search?q=${encodeURIComponent(item.title)}`,
      }));

      const marketUpdates = [
        { title: "Bitcoin: ¥9,800,000 (+2.4%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/btc_jpy" },
        { title: "Ethereum: ¥380,000 (+1.1%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/eth_jpy" },
        { title: "Solana: ¥22,000 (+5.8%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/sol_jpy" },
        { title: "XRP: ¥85 (-0.5%)", url: "https://coincheck.com/ja/exchange/charts/coincheck/xrp_jpy" },
      ];

      const allItems = [...items, ...marketUpdates];
      setScrollingItems([...allItems, ...allItems]);
    };

    load();
  }, []);

  useEffect(() => {
    if (latestNews) {
      const prefix = latestNews.category === "REAL" ? `速報 [${latestNews.source}]` : "速報 [緊急]";
      const newItem = {
        title: `${prefix} ${latestNews.title}`,
        url: latestNews.url || "#",
      };
      setScrollingItems((prev) => [newItem, ...prev.slice(0, Math.max(prev.length - 1, 0))]);
    }
  }, [latestNews]);

  const handleNewsClick = (newsItem: { title: string; url: string }) => {
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
      <div className="relative z-40 flex h-8 w-full items-center overflow-hidden border-b border-gold-500/20 bg-cyber-black/80">
        <div className="absolute left-0 top-0 bottom-0 z-10 w-8 bg-gradient-to-r from-cyber-black to-transparent" />
        <div className="absolute right-0 top-0 bottom-0 z-10 w-8 bg-gradient-to-l from-cyber-black to-transparent" />

        <div className="z-20 flex h-full shrink-0 items-center gap-2 border-r border-gold-500/10 bg-cyber-black px-3 text-gold-400">
          <Newspaper className="h-3.5 w-3.5" />
          <span className="hidden text-xs font-bold tracking-wider sm:inline">ニュース</span>
          <Link
            href="/news"
            className="ml-2 rounded border border-gold-500/20 bg-gold-500/10 px-1.5 py-0.5 text-[10px] text-gold-400 transition-colors hover:bg-gold-500/20"
          >
            詳細
          </Link>
        </div>

        <div className="ticker-wrap flex-1 overflow-hidden">
          <div className="ticker-content flex animate-ticker whitespace-nowrap">
            {scrollingItems.map((item, index) => (
              <button
                key={`${item.title}-${index}`}
                onClick={() => handleNewsClick(item)}
                className="mx-6 inline-flex cursor-pointer items-center text-xs text-gray-300 transition-colors hover:text-gold-400 focus:outline-none"
              >
                {item.title.includes("(+") ? (
                  <span className="mr-1 text-emerald-400">
                    <TrendingUp className="inline h-3 w-3" />
                  </span>
                ) : item.title.includes("(-") ? (
                  <span className="mr-1 text-red-400">
                    <TrendingDown className="inline h-3 w-3" />
                  </span>
                ) : (
                  <span className="mr-1 text-gold-500/50">•</span>
                )}
                {item.title}
              </button>
            ))}
          </div>
        </div>

        <style jsx global>{`
          @keyframes ticker {
            0% {
              transform: translateX(0);
            }
            100% {
              transform: translateX(-50%);
            }
          }
          .animate-ticker {
            animation: ticker 40s linear infinite;
          }
          .animate-ticker:hover {
            animation-play-state: paused;
          }
        `}</style>
      </div>

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-md rounded-lg border border-gold-500/30 bg-cyber-black p-6 text-left shadow-[0_0_20px_rgba(255,215,0,0.1)]">
            <h3 className="mb-4 text-lg font-bold text-gold-500">外部サイトへ移動します</h3>
            <p className="mb-4 text-sm text-gray-300">
              以下のニュース詳細を確認するため外部サイトへ移動します。
              <br />
              よろしいですか？
            </p>
            <div className="mb-6 break-words rounded border border-white/5 bg-black/30 p-3 font-mono text-xs text-gray-400">
              移動先: {selectedNews?.url}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded px-4 py-2 text-sm text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirm}
                className="rounded border border-gold-500/50 bg-gold-500/20 px-4 py-2 text-sm text-gold-400 transition-colors hover:bg-gold-500/30"
              >
                続行して移動
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
