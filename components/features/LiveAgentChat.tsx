// AUTO_CONTINUE: enabled
"use client";

import React, { useEffect, useMemo, useRef } from "react";
import { useSimulation } from "@/context/SimulationContext";
import { AI_AGENTS } from "@/lib/ai-agents";
import { cn } from "@/lib/utils";

const IMPORTANT_PATTERN = /warning|alert|error|critical|blocked|危険|損切り|ロスカット|緊急売却|資金不足|失敗|約定異常/i;
const MESSAGE_DEDUPE_WINDOW_MS = 15 * 1000;

export function LiveAgentChat() {
    const { messages } = useSimulation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const shouldStickToBottomRef = useRef(true);

    useEffect(() => {
        if (scrollRef.current && shouldStickToBottomRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const displayMessages = useMemo(() => {
        const source = messages.slice(-160);
        const deduped = source.filter((msg, index) => {
            const prev = source[index - 1];
            if (!prev) return true;

            return !(
                prev.agentId === msg.agentId &&
                prev.type === msg.type &&
                prev.content === msg.content &&
                Math.abs(msg.timestamp - prev.timestamp) < MESSAGE_DEDUPE_WINDOW_MS
            );
        });

        return deduped.slice(-48);
    }, [messages]);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldStickToBottomRef.current = distanceFromBottom < 48;
    };

    return (
        <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gold-500/5 bg-black/20">
            <div className="flex items-center justify-between border-b border-gold-500/10 bg-gold-500/5 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-widest text-gold-400">Live AI Intelligence</span>
                <div className="flex gap-1">
                    <div className="h-1 w-1 animate-pulse rounded-full bg-emerald-500" />
                    <div className="h-1 w-1 animate-pulse rounded-full bg-emerald-500 delay-75" />
                    <div className="h-1 w-1 animate-pulse rounded-full bg-emerald-500 delay-150" />
                </div>
            </div>

            <div ref={scrollRef} onScroll={handleScroll} className="custom-scrollbar flex-1 space-y-3 overflow-y-auto p-3">
                {displayMessages.length === 0 ? (
                    <div className="flex h-full items-center justify-center font-mono text-[10px] italic text-gray-600">
                        AI エージェントを待機しています...
                    </div>
                ) : (
                    displayMessages.map((msg) => {
                        const agent = AI_AGENTS.find((a) => a.id === msg.agentId);
                        if (!agent) return null;

                        const isImportant = msg.type === "ALERT" || IMPORTANT_PATTERN.test(`${msg.content || ""}`);

                        return (
                            <div key={msg.id} className="group flex gap-2">
                                <div className="flex shrink-0 flex-col items-center gap-1">
                                    <div className={cn("flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border bg-black/40", agent.borderColor)}>
                                        <img src={agent.avatar} alt={agent.shortName} className="h-full w-full object-cover opacity-80" />
                                    </div>
                                    <span className={cn("text-[8px] font-black uppercase tracking-tighter opacity-50", agent.color)}>
                                        {agent.shortName}
                                    </span>
                                </div>

                                <div className="flex-1 space-y-1 border-b border-white/5 pb-2">
                                    <div className="flex items-center gap-2">
                                        <span className={cn("text-[9px] font-bold uppercase tracking-widest", agent.color)}>
                                            {agent.role}
                                        </span>
                                        <span className="font-mono text-[8px] text-gray-600">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                                        </span>
                                        {msg.type && (
                                            <span
                                                className={cn(
                                                    "rounded border px-1 text-[7px]",
                                                    msg.type === "ALERT"
                                                        ? "border-red-500/30 text-red-400"
                                                        : msg.type === "EXECUTION"
                                                            ? "border-emerald-500/30 text-emerald-400"
                                                            : "border-gold-500/20 text-gold-400/60"
                                                )}
                                            >
                                                {msg.type}
                                            </span>
                                        )}
                                    </div>
                                    <p className={cn("selection:bg-gold-500/30 text-[11px] font-medium leading-relaxed", isImportant ? "text-red-400" : "text-gray-300")}>
                                        {msg.content}
                                    </p>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            <style jsx>{`
                .custom-scrollbar::-webkit-scrollbar { width: 3px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(212, 175, 55, 0.1); border-radius: 10px; }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(212, 175, 55, 0.2); }
            `}</style>
        </div>
    );
}
