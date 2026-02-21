import { useState, useEffect, useCallback } from "react";
import { Agent, AGENTS, Message } from "@/lib/ai-simulation";

export function useAISimulation() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isSimulating, setIsSimulating] = useState(false);

    const addMessage = useCallback((agentId: string, content: string, type: Message["type"] = "OPINION") => {
        const newMessage: Message = {
            id: Math.random().toString(36).substring(7),
            agentId,
            content,
            timestamp: Date.now(),
            type,
        };
        setMessages((prev) => [...prev, newMessage]);
        return newMessage;
    }, []);

    // Simulation Loop
    useEffect(() => {
        if (!isSimulating) return;

        let timeoutId: NodeJS.Timeout;

        const loop = () => {
            // Pick a random agent
            const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];

            // Generate mock content based on role
            const mockPhrases = [
                "Analyzing volume spikes on ETH/USDC pair...",
                "Market volatility is increasing. Recommending tighter stop-losses.",
                "Liquidity depth looks good for entry.",
                "Wait, I see a potential arbitrage opportunity on Uniswap.",
                "Consensus required for trade execution.",
                "Checking gas fees... optimized for execution.",
            ];

            const content = mockPhrases[Math.floor(Math.random() * mockPhrases.length)];

            addMessage(agent.id, content);

            // Random delay between 2s and 6s
            const delay = Math.random() * 4000 + 2000;
            timeoutId = setTimeout(loop, delay);
        };

        loop();

        return () => clearTimeout(timeoutId);
    }, [isSimulating, addMessage]);

    return {
        messages,
        isSimulating,
        toggleSimulation: () => setIsSimulating(!isSimulating),
        agents: AGENTS,
    };
}
