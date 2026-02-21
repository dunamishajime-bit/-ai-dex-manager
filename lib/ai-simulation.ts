import { AI_AGENTS, AIAgent } from "./ai-agents";

/**
 * AI Simulation - Exports adapted for compatibility with new AI Agent system
 */

export type Agent = AIAgent;

export interface Message {
    id: string;
    agentId: string;
    content: string;
    timestamp: number;
    type: "ANALYSIS" | "OPINION" | "ALERT" | "EXECUTION" | "SYSTEM" | "PROPOSAL" | "COT";
}

// Re-export for compatibility
export const AGENTS = AI_AGENTS;
export const AI_AGENTS_SIM = AI_AGENTS;

export interface StrategyProposal {
    id: string;
    action: "BUY" | "SELL" | "HOLD";
    token: string;
    price: number;
    confidence: number;
    reason: string;
    agentVotes: { agentId: string; vote: string; reason: string }[];
    status: "pending" | "approved" | "rejected" | "executed";
    timestamp: number;
}

export function generateSimulatedMessage(agents: Agent[], context: string): Message {
    const agent = agents[Math.floor(Math.random() * agents.length)];
    const templates = [
        `${context}の分析を行いました。現在の市場状況を踏まえると...`,
        `📊 RSIとMACDの指標から、短期的な${Math.random() > 0.5 ? "上昇" : "下降"}トレンドが見られます。`,
        `📱 SNS上での言及量が${Math.random() > 0.5 ? "増加" : "減少"}しています。センチメントは${Math.random() > 0.5 ? "ポジティブ" : "ネガティブ"}。`,
        `🛡️ ⚠️ セキュリティの観点から注意が必要です。コントラクト監査状況を確認中。`,
        `📋 プロジェクトのファンダメンタルを評価中。ホワイトペーパーの内容は${Math.random() > 0.5 ? "有望" : "要検討"}。`,
        `👑 各エージェントの分析を統合します。現在の投票状況...`,
    ];

    // Determine type based on agent role (using new IDs)
    let type: Message["type"] = "ANALYSIS";
    if (agent.id === "coordinator") type = "PROPOSAL";
    else if (agent.id === "security") type = "ALERT";

    return {
        id: `sim_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        agentId: agent.id,
        content: templates[Math.floor(Math.random() * templates.length)],
        timestamp: Date.now(),
        type: type,
    };
}
