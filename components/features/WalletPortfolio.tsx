"use client";

import React, { useEffect, useState } from "react";
import { useAccount, useBalance, useSwitchChain } from "wagmi";
import { polygon, bsc } from "wagmi/chains";
import { Card } from "@/components/ui/Card";
import { Wallet, ExternalLink, RefreshCw, AlertCircle, ArrowRightLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConnectButton } from "@rainbow-me/rainbowkit";

// Use a subset of chains for display
const SUPPORTED_CHAINS = [
    { chain: bsc, icon: "https://cryptologos.cc/logos/bnb-bnb-logo.png?v=026", color: "bg-yellow-500/10 text-yellow-400" },
    { chain: polygon, icon: "https://cryptologos.cc/logos/polygon-matic-logo.png?v=026", color: "bg-purple-500/10 text-purple-400" },
];

function ChainBalanceCard({ chainItem, address }: { chainItem: typeof SUPPORTED_CHAINS[0]; address: `0x${string}` }) {
    const { chain, icon, color } = chainItem;
    const { data: balance, isLoading, isError, refetch } = useBalance({
        address,
        chainId: chain.id,
    });
    const { switchChain } = useSwitchChain();
    const { chain: activeChain } = useAccount();

    const isCurrent = activeChain?.id === chain.id;

    // Mock price (In real app, fetch from Market Data or use Oracle)
    const mockPrice = chain.id === 56 ? 500 : // BNB
        chain.id === 137 ? 0.8 : // MATIC
            0;

    // Convert price for demo (if necessary)
    // Ideally we want to use the unified price feed.

    return (
        <div className={cn("relative overflow-hidden rounded-xl border p-4 transition-all hover:border-gold-500/30 group",
            isCurrent ? "bg-white/5 border-gold-500/30" : "bg-black/20 border-white/5"
        )}>
            {/* Background Icon */}
            <div className="absolute -right-4 -bottom-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <img src={icon} alt={chain.name} className="w-24 h-24 grayscale" />
            </div>

            <div className="flex justify-between items-start mb-2 relative z-10">
                <div className="flex items-center gap-2">
                    <img src={icon} alt={chain.name} className="w-6 h-6 rounded-full" />
                    <span className="font-bold text-sm text-gray-200">{chain.name}</span>
                </div>
                {isCurrent && (
                    <div className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                        Active
                    </div>
                )}
            </div>

            <div className="space-y-1 relative z-10">
                <div className="text-2xl font-black font-mono text-white tracking-tight">
                    {isLoading ? (
                        <span className="animate-pulse bg-gray-700/50 rounded h-8 w-24 block" />
                    ) : isError ? (
                        <span className="text-red-400 text-sm flex items-center gap-1"><AlertCircle className="w-4 h-4" /> Error</span>
                    ) : (
                        <span>{parseFloat(balance?.formatted || "0").toFixed(4)} <span className="text-sm text-gray-400">{balance?.symbol}</span></span>
                    )}
                </div>
                {/* <div className="text-xs text-gray-500 font-mono">
                    ≈ ¥...
                </div> */}
            </div>

            <div className="mt-4 flex gap-2 relative z-10">
                {!isCurrent && (
                    <button
                        onClick={() => switchChain({ chainId: chain.id })}
                        className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-gray-300 transition-colors flex items-center justify-center gap-1"
                    >
                        <ArrowRightLeft className="w-3 h-3" /> Switch
                    </button>
                )}
                <a
                    href={`${chain.blockExplorers?.default.url}/address/${address}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] text-gray-300 transition-colors flex items-center justify-center gap-1"
                >
                    <ExternalLink className="w-3 h-3" /> Explorer
                </a>
            </div>
        </div>
    );
}

export function WalletPortfolio() {
    const { address, isConnected } = useAccount();

    if (!isConnected || !address) {
        return (
            <div className="flex flex-col items-center justify-center py-20 bg-black/20 rounded-2xl border border-dashed border-white/10">
                <div className="p-4 bg-gold-500/10 rounded-full mb-4">
                    <Wallet className="w-12 h-12 text-gold-500" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">ウォレット未接続</h3>
                <p className="text-gray-500 text-sm mb-6 max-w-md text-center">
                    マルチチェーンの資産を確認するには、ウォレットを接続してください。<br />
                    (BSC, Polygon 対応)
                </p>
                <div className="scale-110">
                    <ConnectButton label="ウォレットを接続して資産確認" />
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                        <Wallet className="w-6 h-6 text-gold-400" />
                        Multi-Chain Portfolio
                    </h2>
                    <p className="text-xs text-gray-500 font-mono">
                        CONNECTED: <span className="text-gold-500">{address.slice(0, 6)}...{address.slice(-4)}</span>
                    </p>
                </div>
                <div className="bg-black/40 rounded-lg p-1 border border-white/10 flex gap-1">
                    {/* Placeholder for total balance aggregator */}
                    <div className="px-3 py-1">
                        <div className="text-[10px] text-gray-500 uppercase">Total Value (Est.)</div>
                        <div className="text-sm font-bold text-white font-mono">--</div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {SUPPORTED_CHAINS.map(chain => (
                    <ChainBalanceCard key={chain.chain.id} chainItem={chain} address={address} />
                ))}
            </div>

            <div className="p-4 bg-blue-500/5 border border-blue-500/10 rounded-xl flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
                <div>
                    <h4 className="text-sm font-bold text-blue-400">Read-Only Access</h4>
                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                        この画面ではブロックチェーン上のネイティブトークン残高を直接参照しています。
                        秘密鍵や資産への操作権限は要求されません。安全に資産状況を確認できます。
                    </p>
                </div>
            </div>
        </div>
    );
}
