"use client";

import { useEffect, useState } from "react";
import { Asset, fetchAssetList } from "@/lib/assets";
import AssetCard from "@/components/AssetCard";
import AIAnalysisPanel from "@/components/AIAnalysisPanel";
import { Search, Grid, RefreshCcw } from "lucide-react";

export default function DisIndexPage() {
    const [assetList, setAssetList] = useState<Asset[]>([]);
    const [filteredList, setFilteredList] = useState<Asset[]>([]);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadAssets = async () => {
            const list = await fetchAssetList(50);
            setAssetList(list);
            setFilteredList(list);
            setLoading(false);
        };
        loadAssets();
    }, []);

    useEffect(() => {
        const results = assetList.filter(a =>
            a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            a.symbol.toLowerCase().includes(searchTerm.toLowerCase()) ||
            a.id.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setFilteredList(results);
    }, [searchTerm, assetList]);

    return (
        <main className="flex h-screen bg-cyber-black overflow-hidden font-sans">
            {/* Grid background effect */}
            <div className="absolute inset-0 bg-grid-pattern bg-[size:40px_40px] opacity-[0.03] pointer-events-none" />

            {/* Left Sidebar / List Area */}
            <div className="flex-1 flex flex-col relative z-10 overflow-hidden">
                {/* Header */}
                <header className="h-16 border-b border-white/10 bg-white/5 backdrop-blur-md flex items-center justify-between px-8">
                    <div className="flex items-center gap-4">
                        <h1 className="text-xl font-black tracking-tighter text-white uppercase italic">
                            Dis <span className="text-gold-500">Index</span>
                        </h1>
                        <div className="h-4 w-[1px] bg-white/20 mx-2" />
                        <div className="flex items-center gap-2 text-xs font-mono text-white/40">
                            <Grid className="w-3 h-3" />
                            <span>GRID_MODE</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                            <input
                                type="text"
                                placeholder="Search Assets..."
                                className="bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-gold-500/50 w-64 transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <button className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/60">
                            <RefreshCcw className="w-4 h-4" />
                        </button>
                    </div>
                </header>

                {/* Asset Grid */}
                <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                    {loading ? (
                        <div className="flex items-center justify-center h-full">
                            <div className="relative w-16 h-16">
                                <div className="absolute inset-0 border-4 border-gold-500/20 rounded-full" />
                                <div className="absolute inset-0 border-4 border-gold-500 rounded-full border-t-transparent animate-spin" />
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            {filteredList.map((asset) => (
                                <AssetCard
                                    key={asset.id}
                                    asset={asset}
                                    onClick={() => setSelectedAsset(asset)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Right Sidebar - AI Analysis */}
            <AIAnalysisPanel selectedAsset={selectedAsset} />

            <style jsx global>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(255, 255, 255, 0.2);
                }
            `}</style>
        </main>
    );
}
