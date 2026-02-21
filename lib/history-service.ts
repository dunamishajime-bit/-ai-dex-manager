import { AgentMessage, DiscussionResult } from "@/lib/ai-agents";

export interface AIHistoryItem {
    id: string;
    timestamp: number;
    coinName: string;
    coinSymbol: string;
    action: "BUY" | "SELL" | "HOLD";
    confidence: number;
    mvpAgent: string;
    discussion: {
        messages: AgentMessage[];
        result: DiscussionResult;
    };
}

const STORAGE_KEY = "jdex_ai_history";

export const saveHistoryItem = (discussion: { messages: AgentMessage[], result: DiscussionResult }, coinName: string, coinSymbol: string) => {
    if (typeof window === "undefined") return;

    const newItem: AIHistoryItem = {
        id: crypto.randomUUID(),
        timestamp: Date.now(),
        coinName,
        coinSymbol,
        action: discussion.result.action,
        confidence: discussion.result.confidence,
        mvpAgent: discussion.result.mvpAgent || "coordinator",
        discussion
    };

    try {
        const existing = getHistoryItems();
        // Limit to 50 items
        const updated = [newItem, ...existing].slice(0, 50);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
        console.error("Failed to save history", e);
    }
};

export const getHistoryItems = (): AIHistoryItem[] => {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return parsed;
    } catch (e) {
        console.error("Failed to read history", e);
        return [];
    }
};

export const clearHistory = () => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(STORAGE_KEY);
};
export const deleteHistoryItems = (ids: string[]) => {
    if (typeof window === "undefined") return;
    try {
        const existing = getHistoryItems();
        const updated = existing.filter(item => !ids.includes(item.id));
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
        console.error("Failed to delete history items", e);
    }
};
