"use client";

import { useEffect, useState } from "react";
import { getCryptoNews, CryptoNews } from "@/lib/dex-service";
import { Newspaper, ExternalLink, Calendar, Search } from "lucide-react";

export default function NewsPage() {
    const [news, setNews] = useState<CryptoNews[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedNews, setSelectedNews] = useState<CryptoNews | null>(null);

    useEffect(() => {
        const loadNews = async () => {
            try {
                const data = await getCryptoNews();
                setNews(data);
                if (data.length > 0) {
                    setSelectedNews(data[0]);
                }
            } catch (error) {
                console.error("Failed to load news:", error);
            } finally {
                setLoading(false);
            }
        };
        loadNews();
    }, []);

    const filteredNews = news.filter(item =>
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.source.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const cleanHtml = (html?: string) => {
        if (!html) return "";
        return html.replace(/<[^>]*>?/gm, "").replace(/&nbsp;/g, " ").trim();
    };

    return (
        <div className="space-y-6 h-[calc(100vh-140px)] flex flex-col">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
                <div>
                    <h1 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                        <Newspaper className="w-6 h-6 text-gold-400" />
                        仮想通貨ニュース
                    </h1>
                    <p className="text-gray-400 text-sm">市場の最新動向と重要ニュース</p>
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                        type="text"
                        placeholder="ニュースを検索..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9 pr-4 py-2 bg-black/30 border border-gold-500/20 rounded-lg text-sm text-white focus:outline-none focus:border-gold-500/50 w-full md:w-64"
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex-1 flex items-center justify-center">
                    <div className="w-8 h-8 border-2 border-gold-500/30 border-t-gold-500 rounded-full animate-spin" />
                </div>
            ) : (
                <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-0">
                    {/* List Area */}
                    <div className="lg:col-span-5 flex flex-col gap-4 overflow-y-auto pr-2 custom-scrollbar">
                        {filteredNews.length > 0 ? (
                            filteredNews.map((item) => (
                                <div
                                    key={item.id}
                                    onClick={() => setSelectedNews(item)}
                                    className={`glass-panel p-4 rounded-xl border transition-all cursor-pointer group ${selectedNews?.id === item.id
                                            ? "border-gold-500/50 bg-gold-500/5 shadow-[0_0_15px_rgba(255,215,0,0.1)]"
                                            : "border-gold-500/10 hover:border-gold-500/30 bg-white/5"
                                        }`}
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gold-500/10 text-gold-400 border border-gold-500/20">
                                            {item.source}
                                        </span>
                                        <span className="flex items-center gap-1 text-[10px] text-gray-500 font-mono">
                                            <Calendar className="w-3 h-3" />
                                            {item.published_at.split(' ')[0]}
                                        </span>
                                    </div>
                                    <h3 className={`text-sm font-semibold leading-relaxed ${selectedNews?.id === item.id ? "text-gold-400" : "text-white"
                                        }`}>
                                        {item.title}
                                    </h3>
                                </div>
                            ))
                        ) : (
                            <div className="text-center py-10 text-gray-500">
                                ニュースが見つかりませんでした
                            </div>
                        )}
                    </div>

                    {/* Content Detail Area */}
                    <div className="lg:col-span-7 hidden lg:flex flex-col glass-panel rounded-2xl border border-gold-500/20 bg-black/40 overflow-hidden relative group">
                        {selectedNews ? (
                            <div className="flex flex-col h-full">
                                <div className="p-8 border-b border-gold-500/10 bg-gradient-to-br from-gold-500/5 to-transparent">
                                    <div className="flex items-center gap-3 mb-4">
                                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-gold-500/20 text-gold-400 border border-gold-500/30">
                                            {selectedNews.source}
                                        </span>
                                        <span className="text-sm text-gray-500 font-mono">
                                            {selectedNews.published_at}
                                        </span>
                                    </div>
                                    <h2 className="text-2xl font-bold text-white leading-tight mb-6">
                                        {selectedNews.title}
                                    </h2>
                                    <div className="flex items-center gap-4">
                                        <a
                                            href={selectedNews.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-2 px-6 py-2.5 bg-gold-500 text-black font-bold rounded-lg hover:bg-gold-400 transition-all shadow-lg shadow-gold-500/20 active:scale-95 text-sm"
                                        >
                                            <ExternalLink className="w-4 h-4" />
                                            ソース元で全文を読む
                                        </a>
                                    </div>
                                </div>
                                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                                    <div className="prose prose-invert max-w-none">
                                        <p className="text-gray-300 leading-8 text-lg whitespace-pre-wrap">
                                            {cleanHtml(selectedNews.content || selectedNews.description || "このニュースの詳細内容はソース元からご確認ください。")}
                                        </p>
                                    </div>
                                </div>
                                <div className="absolute top-4 right-4 text-[10px] text-gold-500/20 font-mono tracking-widest uppercase pointer-events-none select-none">
                                    INTERNAL PREVIEW MODE
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-4 opacity-50">
                                <Newspaper className="w-16 h-16 stroke-1" />
                                <p>ニュースを選択して詳細を表示</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(212, 175, 55, 0.2);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(212, 175, 55, 0.4);
                }
            `}</style>
        </div>
    );
}
