"use client";

import React, { useEffect, useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown, Minus, RefreshCw } from "lucide-react";

// Major crypto pairs to correlate
const ASSETS = ["BTC", "ETH", "SOL", "BNB", "AVAX", "ADA", "DOT", "LINK"];

// Cache for 30-day price data
let priceCache: Record<string, number[]> = {};
let cacheExpiry = 0;

async function fetchPrices(symbol: string): Promise<number[]> {
    try {
        const res = await fetch(`/api/market/chart?id=${symbol}&days=30`);
        const data = await res.json();
        if (!data.ok || !data.prices) return [];
        return data.prices.map((p: [number, number]) => p[1]);
    } catch {
        return [];
    }
}

function pearsonCorrelation(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n < 3) return 0;
    const ax = a.slice(0, n);
    const bx = b.slice(0, n);
    const meanA = ax.reduce((s, v) => s + v, 0) / n;
    const meanB = bx.reduce((s, v) => s + v, 0) / n;
    let num = 0, da = 0, db = 0;
    for (let i = 0; i < n; i++) {
        const dA = ax[i] - meanA;
        const dB = bx[i] - meanB;
        num += dA * dB;
        da += dA * dA;
        db += dB * dB;
    }
    const denom = Math.sqrt(da * db);
    return denom === 0 ? 0 : num / denom;
}

function corrColor(r: number): string {
    if (r >= 0.8) return "rgba(255, 215, 0, 0.85)";    // Gold: very high
    if (r >= 0.6) return "rgba(255, 165, 0, 0.70)";    // Orange: high
    if (r >= 0.3) return "rgba(100, 200, 100, 0.50)";  // Green: moderate
    if (r >= -0.3) return "rgba(60, 100, 150, 0.40)";  // Blue: low
    if (r >= -0.6) return "rgba(180, 80, 80, 0.50)";   // Red: negative
    return "rgba(220, 40, 40, 0.80)";                   // Dark red: strong negative
}

function corrLabel(r: number): string {
    if (r >= 0.8) return "強";
    if (r >= 0.6) return "高";
    if (r >= 0.3) return "中";
    if (r >= -0.3) return "低";
    return "逆";
}

export function CorrelationHeatmap() {
    const [matrix, setMatrix] = useState<number[][]>([]);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{ i: number; j: number } | null>(null);

    const loadCorrelations = useCallback(async () => {
        setLoading(true);

        // Use cache if fresh (30 min TTL)
        if (Date.now() < cacheExpiry && Object.keys(priceCache).length >= ASSETS.length) {
            computeMatrix();
            setLoading(false);
            return;
        }

        // Fetch all with stagger to avoid rate limiting
        const results: Record<string, number[]> = {};
        for (const asset of ASSETS) {
            const prices = await fetchPrices(asset);
            results[asset] = prices;
            await new Promise(r => setTimeout(r, 300)); // stagger
        }
        priceCache = results;
        cacheExpiry = Date.now() + 30 * 60 * 1000;
        computeMatrix();
        setLoading(false);
        setLastUpdated(new Date());
    }, []); // eslint-disable-line

    function computeMatrix() {
        const n = ASSETS.length;
        const m: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
        for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
                if (i === j) { m[i][j] = 1; continue; }
                const a = priceCache[ASSETS[i]] || [];
                const b = priceCache[ASSETS[j]] || [];
                m[i][j] = parseFloat(pearsonCorrelation(a, b).toFixed(2));
            }
        }
        setMatrix(m);
    }

    useEffect(() => { loadCorrelations(); }, [loadCorrelations]);

    const hoveredValue = hoveredCell !== null && matrix.length > 0
        ? matrix[hoveredCell.i][hoveredCell.j]
        : null;

    return (
        <div className="w-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-gold-400">30日相関マップ</span>
                    {lastUpdated && (
                        <span className="text-[10px] text-gray-500">
                            更新: {lastUpdated.toLocaleTimeString()}
                        </span>
                    )}
                </div>
                <button
                    onClick={loadCorrelations}
                    className="text-gray-500 hover:text-gold-400 transition-colors btn-micro"
                    disabled={loading}
                >
                    <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                </button>
            </div>

            {loading ? (
                <div className="space-y-2">
                    {ASSETS.map((_, i) => (
                        <div key={i} className="skeleton h-8 rounded" />
                    ))}
                    <p className="text-xs text-gray-500 text-center mt-2">価格データ取得中...</p>
                </div>
            ) : (
                <>
                    {/* Tooltip */}
                    {hoveredCell && hoveredValue !== null && (
                        <div className="mb-2 px-3 py-1.5 bg-black/80 border border-gold-500/20 rounded-lg text-xs font-mono text-gold-300">
                            {ASSETS[hoveredCell.i]} / {ASSETS[hoveredCell.j]}: r = {hoveredValue.toFixed(2)}
                            <span className={cn("ml-2", hoveredValue > 0.6 ? "text-yellow-400" : hoveredValue < -0.3 ? "text-red-400" : "text-gray-400")}>
                                {hoveredValue >= 0.8 ? "非常に強い正相関"
                                    : hoveredValue >= 0.6 ? "強い正相関"
                                        : hoveredValue >= 0.3 ? "中程度の正相関"
                                            : hoveredValue >= -0.3 ? "相関なし"
                                                : "負の相関"}
                            </span>
                        </div>
                    )}

                    {/* Matrix */}
                    <div className="overflow-x-auto">
                        <table className="w-full text-[10px] border-collapse">
                            <thead>
                                <tr>
                                    <th className="w-8" />
                                    {ASSETS.map(a => (
                                        <th key={a} className="w-10 text-center text-gray-500 font-mono pb-1">{a}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {ASSETS.map((rowAsset, i) => (
                                    <tr key={rowAsset}>
                                        <td className="text-right pr-1 text-gray-500 font-mono text-[9px]">{rowAsset}</td>
                                        {ASSETS.map((_, j) => {
                                            const r = matrix[i]?.[j] ?? 0;
                                            const isHovered = hoveredCell?.i === i && hoveredCell?.j === j;
                                            return (
                                                <td
                                                    key={j}
                                                    className={cn(
                                                        "text-center cursor-pointer transition-all duration-150",
                                                        "w-10 h-8 leading-8 font-mono",
                                                        isHovered && "ring-1 ring-gold-400"
                                                    )}
                                                    style={{
                                                        backgroundColor: corrColor(r),
                                                        color: r >= 0.6 || r <= -0.6 ? "#fff" : "rgba(255,255,255,0.8)",
                                                        fontSize: "9px",
                                                    }}
                                                    onMouseEnter={() => setHoveredCell({ i, j })}
                                                    onMouseLeave={() => setHoveredCell(null)}
                                                >
                                                    {i === j ? "●" : corrLabel(r)}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {[
                            { color: "bg-yellow-500", label: "強相関 ≥0.8" },
                            { color: "bg-orange-500", label: "高相関 ≥0.6" },
                            { color: "bg-green-700", label: "中相関 ≥0.3" },
                            { color: "bg-blue-800", label: "低相関" },
                            { color: "bg-red-600", label: "負相関" },
                        ].map(l => (
                            <div key={l.label} className="flex items-center gap-1">
                                <div className={cn("w-2.5 h-2.5 rounded-sm", l.color)} />
                                <span className="text-[9px] text-gray-500">{l.label}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
