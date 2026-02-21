"use client";

import React, { useEffect, useRef } from "react";
import { useSimulation, Message } from "@/context/SimulationContext";
import { AI_AGENTS } from "@/lib/ai-agents";
import { cn } from "@/lib/utils";

export function LiveAgentChat() {
    const { messages } = useSimulation();
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    // Filter messages to show mostly relevant conversations (OPINION, ANALYSIS, ALERT, PROPOSAL)
    // and exclude purely technical execution logs if they feel too noisy
    const displayMessages = messages.slice(-50); // Show last 50 messages

    return (
        <div className="flex flex-col h-full bg-black/20 rounded-lg border border-gold-500/5 overflow-hidden">
            <div className="px-3 py-2 border-b border-gold-500/10 bg-gold-500/5 flex items-center justify-between">
                <span className="text-[10px] font-black text-gold-400 uppercase tracking-widest">Live AI Intelligence</span>
                <div className="flex gap-1">
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse delay-75" />
                    <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse delay-150" />
                </div>
            </div>

            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar"
            >
                {displayMessages.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-gray-600 text-[10px] font-mono italic">
                        Initializing agent synchronization...
                    </div>
                ) : (
                    displayMessages.map((msg) => {
                        const agent = AI_AGENTS.find(a => a.id === msg.agentId);
                        if (!agent) return null;

                        return (
                            <div key={msg.id} className="flex gap-2 group animate-in fade-in slide-in-from-left-2 duration-300">
                                <div className="shrink-0 flex flex-col items-center gap-1">
                                    <div className={cn(
                                        "w-6 h-6 rounded-full border flex items-center justify-center bg-black/40 overflow-hidden",
                                        agent.borderColor
                                    )}>
                                        <img src={agent.avatar} alt={agent.shortName} className="w-full h-full object-cover opacity-80" />
                                    </div>
                                    <span className={cn("text-[8px] font-black uppercase tracking-tighter opacity-50", agent.color)}>
                                        {agent.shortName}
                                    </span>
                                </div>
                                <div className="flex-1 space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className={cn("text-[9px] font-bold uppercase tracking-widest", agent.color)}>
                                            {agent.role}
                                        </span>
                                        <span className="text-[8px] text-gray-600 font-mono">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </span>
                                        {msg.type && (
                                            <span className={cn(
                                                "text-[7px] px-1 rounded border",
                                                msg.type === "ALERT" ? "text-red-400 border-red-500/30 bg-red-500/5" :
                                                    msg.type === "PROPOSAL" ? "text-amber-400 border-amber-500/30 bg-amber-500/5" :
                                                        msg.type === "EXECUTION" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5" :
                                                            "text-gold-400/50 border-gold-500/10 bg-gold-500/5"
                                            )}>
                                                {msg.type}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-gray-300 leading-relaxed font-medium selection:bg-gold-500/30">
                                        {msg.content}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 3px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(212, 175, 55, 0.1);
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(212, 175, 55, 0.2);
                }
            `}</style>
        </div>
    );
}
