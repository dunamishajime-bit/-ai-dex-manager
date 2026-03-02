import { useEffect, useRef, useState } from "react";
import { Bot, Sparkles } from "lucide-react";
import { useAgents } from "@/context/AgentContext";

export function AgentTicker() {
    const { latestMessage, getAgent } = useAgents();
    const [displayMessage, setDisplayMessage] = useState<typeof latestMessage>(null);
    const lastMessageKeyRef = useRef<string | null>(null);

    useEffect(() => {
        if (!latestMessage) return;

        const nextKey = `${latestMessage.agentId}:${latestMessage.timestamp}:${latestMessage.text}`;
        if (nextKey === lastMessageKeyRef.current) return;

        lastMessageKeyRef.current = nextKey;
        setDisplayMessage(latestMessage);
    }, [latestMessage]);

    if (!displayMessage) return null;

    const agent = getAgent(displayMessage.agentId);
    const text = `${displayMessage.text || ""}`;
    const isImportant = /risk|warning|alert|error|約定|利確|損切り|危険|戦略|signal|execute|trade/i.test(text);

    return (
        <div className="relative w-full overflow-hidden border-b border-gold-500/20 bg-cyber-dark/80 backdrop-blur-md">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-gold-500/5 to-transparent animate-scan-slow" />

            <div className="container mx-auto flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-4">
                    <div className="flex shrink-0 items-center gap-2">
                        <div
                            className={
                                isImportant
                                    ? "flex items-center gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5"
                                    : "flex items-center gap-1.5 rounded border border-gold-500/20 bg-gold-500/10 px-2 py-0.5"
                            }
                        >
                            <Sparkles className={isImportant ? "h-3 w-3 animate-pulse text-red-300" : "h-3 w-3 animate-pulse text-gold-400"} />
                            <span className={isImportant ? "text-[10px] font-mono text-red-300" : "text-[10px] font-mono text-gold-400"}>AI LIVE</span>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                        {agent ? (
                            <div className="relative">
                                <img
                                    src={agent.avatar}
                                    alt={agent.name}
                                    className="h-6 w-6 rounded-full border border-gold-500/30 object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${agent.shortName}&background=333&color=fff`;
                                    }}
                                />
                                <div className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-black bg-emerald-500" />
                            </div>
                        ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10">
                                <Bot className="h-3.5 w-3.5 text-gold-400" />
                            </div>
                        )}
                        <span className="hidden font-mono text-xs font-bold text-gold-100 sm:inline">
                            {agent ? agent.name : "System"}
                        </span>
                    </div>

                    <p
                        className={
                            isImportant
                                ? "flex max-w-[50vw] items-center truncate font-mono text-xs text-red-100 md:max-w-none md:text-sm"
                                : "flex max-w-[50vw] items-center truncate font-mono text-xs text-gray-300 md:max-w-none md:text-sm"
                        }
                    >
                        <span className={isImportant ? "mr-2 text-red-300" : "mr-2 text-gold-500"}>•</span>
                        {displayMessage.text}
                        <span className="ml-2 text-[10px] text-gray-500">
                            ({new Date(displayMessage.timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })})
                        </span>
                    </p>
                </div>
            </div>
        </div>
    );
}
