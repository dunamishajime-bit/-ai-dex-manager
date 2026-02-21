import { useState, useEffect } from "react";
import { Bot, Sparkles } from "lucide-react";
import { useAgents } from "@/context/AgentContext";

export function AgentTicker() {
    const { latestMessage, getAgent, isCouncilActive } = useAgents();
    const [isVisible, setIsVisible] = useState(false);
    const [displayMessage, setDisplayMessage] = useState<typeof latestMessage>(null);

    useEffect(() => {
        if (latestMessage) {
            setIsVisible(false); // Fade out old
            setTimeout(() => {
                setDisplayMessage(latestMessage);
                setIsVisible(true); // Fade in new
            }, 300);
        }
    }, [latestMessage, isCouncilActive]);

    if (!displayMessage) return null;

    const agent = getAgent(displayMessage.agentId);

    return (
        <div className="w-full bg-cyber-dark/80 border-b border-gold-500/20 backdrop-blur-md overflow-hidden relative">
            {/* Background scanner effect */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-gold-500/5 to-transparent animate-scan-slow pointer-events-none" />

            <div className="container mx-auto px-4 py-2 flex items-center justify-between">
                <div className={`flex items-center gap-4 transition-opacity duration-500 ${isVisible ? "opacity-100" : "opacity-0"}`}>

                    {/* Left: Label */}
                    <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-gold-500/10 border border-gold-500/20">
                            <Sparkles className="w-3 h-3 text-gold-400 animate-pulse" />
                            <span className="text-[10px] font-mono text-gold-400">AI LIVE</span>
                        </div>
                    </div>

                    {/* Agent Info */}
                    <div className="flex items-center gap-2 shrink-0">
                        {agent ? (
                            <div className="relative">
                                <img
                                    src={agent.avatar}
                                    alt={agent.name}
                                    className="w-6 h-6 rounded-full border border-gold-500/30 object-cover"
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${agent.shortName}&background=333&color=fff`;
                                    }}
                                />
                                <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-emerald-500 rounded-full border border-black" />
                            </div>
                        ) : (
                            <div className="w-6 h-6 rounded-full bg-gold-500/10 flex items-center justify-center border border-gold-500/30">
                                <Bot className="w-3.5 h-3.5 text-gold-400" />
                            </div>
                        )}
                        <span className="text-xs font-bold text-gold-100 font-mono hidden sm:inline">
                            {agent ? agent.name : "System"}
                        </span>
                    </div>

                    {/* Message */}
                    <p className="text-xs md:text-sm text-gray-300 font-mono truncate max-w-[50vw] md:max-w-none flex items-center">
                        <span className="text-gold-500 mr-2">›</span>
                        {displayMessage.text}
                        <span className="ml-2 text-[10px] text-gray-500">
                            ({new Date(displayMessage.timestamp).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })})
                        </span>
                    </p>
                </div>
            </div>
        </div>
    );
}
