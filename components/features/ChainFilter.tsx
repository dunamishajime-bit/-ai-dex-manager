"use client";

import { CHAIN_OPTIONS, ChainId } from "@/lib/dex-service";
import { cn } from "@/lib/utils";

interface Props {
    selectedChain: ChainId;
    onSelectChain: (chain: ChainId) => void;
}

export function ChainFilter({ selectedChain, onSelectChain }: Props) {
    return (
        <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
            {CHAIN_OPTIONS.map(chain => (
                <button
                    key={chain.id}
                    onClick={() => onSelectChain(chain.id)}
                    className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border",
                        selectedChain === chain.id
                            ? "bg-gold-500/15 text-gold-400 border-gold-500/30"
                            : "bg-white/5 text-gray-400 border-white/10 hover:bg-gold-500/5 hover:text-gold-400 hover:border-gold-500/20"
                    )}
                >
                    <span>{chain.icon}</span>
                    <span>{chain.name}</span>
                </button>
            ))}
        </div>
    );
}
