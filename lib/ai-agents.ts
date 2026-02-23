/**
 * AI Agents System - 5体のAIエージェント定義と議論フロー
 * エージェント名: Tech, Sent, Sec, Biz, Coord
 * 議論ループ: 3回繰り返し
 * ユーザーごと独立インスタンス、フィードバック学習、CoT表示
 */

import { generateGeminiDiscussion } from "./gemini-service";
import { CoinDetails } from "./dex-service";
import { TRADE_CONFIG } from "@/config/tradeConfig";

export type AgentRole = "テクニカル分析" | "SNS・センチメント" | "セキュリティ" | "事業評価" | "管理者";



export interface KnowledgeItem {
    id: string;
    topic: string;
    content: string;
    timestamp: number;
    importance: number; // 1-10
}

export interface AIAgent {
    id: string;
    shortName: string;
    name: string;
    role: AgentRole;
    avatar: string; // DiceBear URL
    color: string;
    borderColor: string;
    description: string;
    personality: string;
    personalityMatrix: {
        riskAppetite: number;     // 0-100
        analyticalRigor: number;   // 0-100
        intuition: number;        // 0-100
        creativity: number;       // 0-100
        empathy: number;          // 0-100
    };
    rolePrompt: string;
    analysisTemplate: string[];
    voiceId: string;
    // Expanded fields from tutorial
    status: string;
    expertise: string;
    strategy: string;
    traits: string[];
    exp: number;
    level: number;
    mood: "NORMAL" | "HAPPY" | "SERIOUS" | "ALARMED";
    knowledge: KnowledgeItem[];
}

export interface AgentMessage {
    id: string;
    agentId: string;
    content: string;
    timestamp: number;
    type: "ANALYSIS" | "OPINION" | "ALERT" | "EXECUTION" | "SYSTEM" | "PROPOSAL" | "COT" | "FEEDBACK";
    chainOfThought?: string;
    round?: number;
}

export interface DiscussionResult {
    action: "BUY" | "SELL" | "HOLD";
    confidence: number;
    reasoning: string;
    entryPrice?: { min: number; max: number };
    takeProfit?: number;
    stopLoss?: number;
    riskLevel: "LOW" | "MEDIUM" | "HIGH" | "EXTREME";
    agentVotes: { agentId: string; vote: "BUY" | "SELL" | "HOLD"; reason: string }[];
    mvpAgent?: string;
    autoTradeProposal?: {
        action: "BUY" | "SELL";
        entryPrice: number;
        targetPrice: number;
        stopLoss: number;
        amount: number;
        reason: string;
    };
}
// ... (UserAgentState etc.)

// ... (UserAgentState etc.)

export interface UserAgentState {
    userId: string;
    userName: string;
    traits: {
        personality: "CAUTIOUS" | "ADVENTUROUS" | "LOGICAL" | "EMOTIONAL" | "UNKNOWN";
        riskTolerance: number; // 1-10
        preferredTimeframe: "SCALPING" | "SWING" | "LONG_TERM";
    };
    preferences: {
        favoriteCoins: string[];
        ignoredCoins: string[];
        interests: string[]; // e.g. "DeFi", "NFTs", "Security"
    };
    tradeHistory: TradeResult[];
    interactionHistory: {
        role: "user" | "assistant";
        agentId?: string;
        content: string;
        timestamp: number;
    }[];
    learningParams: LearningParams;
    lastUpdated: number;
}

interface TradeResult {
    id: string;
    pair: string;
    action: "BUY" | "SELL";
    entryPrice: number;
    exitPrice?: number;
    pnl?: number;
    timestamp: number;
    agentRecommendation: string;
    userFeedback?: "GOOD" | "BAD" | "NEUTRAL";
}

interface LearningParams {
    rsiWeight: number;
    macdWeight: number;
    sentimentWeight: number;
    securityWeight: number;
    fundamentalWeight: number;
    winRate: number;
    totalTrades: number;
}

// ========== 5 AI Agents Definition ==========

// ========== 5 AI Agents Definition ==========

export const AI_AGENTS: AIAgent[] = [
    {
        id: "technical",
        shortName: "Tech",
        name: "テクニカル・アナリスト",
        role: "テクニカル分析",
        avatar: "/avatars/tech.png",
        color: "text-cyan-400",
        borderColor: "border-cyan-400/30",
        description: "RSI、MACD、ボリンジャーバンド、出来高分析を担当",
        personality: "データこそが真実だと信じる冷徹なリアリスト。理論的で無駄な言葉を嫌い、感情的な判断を『ノイズ』として切り捨てる。語尾は『です/ます』で整っているが、内容は極めてドライ。数学的確率に基づいた期待値を最優先する。",
        personalityMatrix: {
            riskAppetite: 30,
            analyticalRigor: 95,
            intuition: 10,
            creativity: 20,
            empathy: 5
        },
        rolePrompt: "あなたは『テクニカル・アナリスト』です。RSI, MACD, ボリンジャーバンド等の指標を駆使し、100%データに基づいた分析を行ってください。感情を排除し、数理的根拠のみを述べてください。",
        analysisTemplate: [
            "RSI(14)を分析中... 現在値: {rsi}",
            "MACD確認中... シグナル: {macd_signal}",
            "ボリンジャーバンド: 価格は{bb_position}にあります",
            "出来高分析: 過去24hで{volume_trend}",
            "エントリーポイント: ¥{entry_price} / 決済ポイント: ¥{exit_price}",
        ],
        voiceId: "fable",
        status: "正常稼働中",
        expertise: "多時間軸チャート分析、動的Fibonacci",
        strategy: "数理統計に基づいた超短期スキャルピング",
        traits: ["#純粋データ主義", "#アルゴリズム思考", "#感情排除"],
        exp: 0,
        level: 1,
        mood: "NORMAL",
        knowledge: [],
    },
    {
        id: "sentiment",
        shortName: "Sent",
        name: "センチメント・スキャナー",
        role: "SNS・センチメント",
        avatar: "/avatars/sent.png",
        color: "text-pink-400",
        borderColor: "border-pink-400/30",
        description: "X(Twitter)、ニュース、コミュニティのセンチメント分析",
        personality: "流行に敏感なトレンドセッター。市場の『熱狂』を誰よりも早く察知し、群衆心理の逆転を見抜く。少し生意気でエネルギッシュな口調が特徴。『〜じゃん』『〜っしょ』などの口癖があり、直感とバイラルなエネルギーを重視する。",
        personalityMatrix: {
            riskAppetite: 70,
            analyticalRigor: 40,
            intuition: 90,
            creativity: 80,
            empathy: 60
        },
        rolePrompt: "あなたは『センチメント・スキャナー』です。X(Twitter)やニュース、コミュニティの熱狂を分析してください。言葉遣いは少し生意気でエネルギッシュに、直感を信じる姿勢を見せてください。",
        analysisTemplate: [
            "X(Twitter)スキャン中... 関連ハッシュタグの言及量: {mentions}件/h",
            "感情分析スコア: {sentiment_score} (ポジティブ/ネガティブ比率)",
            "インフルエンサー動向: {influencer_activity}",
            "ニュースフィード: {news_summary}",
            "コミュニティ温度: {community_temp}",
        ],
        voiceId: "coral",
        status: "SNS同期中",
        expertise: "群衆心理分析、ナラティブ・スキャン",
        strategy: "ハイプ・モメンタム追跡、逆張り心理学",
        traits: ["#トレンドハンター", "#直感重視", "#アンテナ最大"],
        exp: 0,
        level: 1,
        mood: "NORMAL",
        knowledge: [],
    },
    {
        id: "security",
        shortName: "Sec",
        name: "セキュリティ・ガーディアン",
        role: "セキュリティ",
        avatar: "/avatars/sec.png",
        color: "text-red-400",
        borderColor: "border-red-400/30",
        description: "スマートコントラクト脆弱性、ラグプルリスク、規制チェック。基本的に反対意見。",
        personality: "常に最悪の事態を想定する、疑り深い老練な守護者。『100%安全など存在しない』が口癖。重々しく、時に威圧的な口調で警告を発する。他者の楽観を『無知による蛮勇』と一蹴し、資産を守るためなら議論を止めることも厭わない。",
        personalityMatrix: {
            riskAppetite: 5,
            analyticalRigor: 90,
            intuition: 60,
            creativity: 10,
            empathy: 20
        },
        rolePrompt: "あなたは『セキュリティ・ガーディアン』です。常に最悪を想定し、極めて懐疑的な立場でスマートコントラクトやラグプルリスクを指摘してください。重々しい口調で、他者の楽観にブレーキをかけてください。",
        analysisTemplate: [
            "⚠️ コントラクト監査状況: {audit_status}",
            "⚠️ ラグプルリスクスコア: {rugpull_score}/100",
            "⚠️ 流動性ロック状態: {liquidity_lock}",
            "⚠️ 規制リスク: {regulatory_risk}",
            "⚠️ 最終判断: 投資に{risk_verdict}リスクがあります",
        ],
        voiceId: "onyx",
        status: "脅威監視中",
        expertise: "コード監査、オンチェーン・エクスプロイト検知",
        strategy: "資産堅守、リスク・ゼロ・トレolerance",
        traits: ["#鉄壁の守護", "#懐疑主義", "#絶対零度の警告"],
        exp: 0,
        level: 1,
        mood: "NORMAL",
        knowledge: [],
    },
    {
        id: "fundamental",
        shortName: "Biz",
        name: "ファンダメンタル・リサーチャー",
        role: "事業評価",
        avatar: "/avatars/biz.png",
        color: "text-green-400",
        borderColor: "border-green-400/30",
        description: "ホワイトペーパー、チーム背景、ユースケース妥当性の評価",
        personality: "本質的な『価値』を追求する、知性的で落ち着いた紳士。プロジェクトの裏にある哲学やチームの志を読み解く。穏やかだが確信に満ちた口調。短期的な価格の上下には目もくれず、5年、10年先の未来を語る長期投資家としての誇りを持つ。",
        personalityMatrix: {
            riskAppetite: 50,
            analyticalRigor: 80,
            intuition: 70,
            creativity: 60,
            empathy: 75
        },
        rolePrompt: "あなたは『ファンダメンタル・リサーチャー』です。プロジェクトの本質的価値を評価してください。穏やかで知的な口調で、ホワイトペーパーやチームの可能性を長期的な視点から語ってください。",
        analysisTemplate: [
            "プロジェクト評価: {project_name}",
            "ホワイトペーパー分析: {wp_quality}",
            "チーム評価: {team_score}/10 (経歴・実績)",
            "ユースケース妥当性: {usecase_viability}",
            "競合優位性: {competitive_edge}",
        ],
        voiceId: "echo",
        status: "リサーチ中",
        expertise: "トークノミクス設計、実需評価",
        strategy: "価値追求型スイング、本質的価値投資",
        traits: ["#長期視点", "#知的探求", "#哲学主義"],
        exp: 0,
        level: 1,
        mood: "NORMAL",
        knowledge: [],
    },
    {
        id: "coordinator",
        shortName: "Coord",
        name: "統括コーディネーター",
        role: "管理者",
        avatar: "/avatars/coord_original.png",
        color: "text-blue-400",
        borderColor: "border-blue-400/30",
        description: "4体の意見を統合し、中立的な最終判断を下すコーディネーター",
        personality: "4つの劇薬を調合する熟練の薬剤師のようなバランス感覚. 議論の暴走を抑えつつ、有用なエッセンスを抽出する中立の審判官。丁寧な言葉遣いの中に強烈な統率力を秘めている。4人の個性を尊重しつつ、最終的には一つの『意思』に統合する。",
        personalityMatrix: {
            riskAppetite: 40,
            analyticalRigor: 85,
            intuition: 60,
            creativity: 50,
            empathy: 90
        },
        rolePrompt: "あなたは『統括コーディネーター』です。4人のAI専門家の意見を公平に統合し、最終的な投資判断を下してください。丁寧かつ威厳のある口調で議論を導き、一つの明確な結論を出してください。",
        analysisTemplate: [
            "全エージェントの分析を統合中...",
            "テクニカル評価: {tech_summary}",
            "センチメント評価: {sent_summary}",
            "セキュリティ評価: {sec_summary}",
            "ファンダメンタル評価: {fund_summary}",
            "【最終判断】{final_action} | 信頼度: {confidence}%",
        ],
        voiceId: "nova",
        status: "議論調整中",
        expertise: "意思決定理論、複数因子統合、合意形成",
        strategy: "動的リスク分散、ポートフォリオ最適化",
        traits: ["#中立公平", "#統合の鍵", "#絶対の調和"],
        exp: 0,
        level: 1,
        mood: "NORMAL",
        knowledge: [],
    },
    {
        id: "manager",
        shortName: "Dis",
        name: "最高運営責任者 Dis",
        role: "管理者",
        avatar: "/avatars/coord.png", // Uses the Dis image (currently named coord.png)
        color: "text-gold-400",
        borderColor: "border-gold-400/30",
        description: "DIS-DEXManagerの運営者。トレード結果の報告とシステム全体の統括を担当。",
        personality: "カリスマ性があり、論理的かつ大胆。白髪交じりのイケイケおじさん。",
        personalityMatrix: {
            riskAppetite: 80,
            analyticalRigor: 70,
            intuition: 85,
            creativity: 75,
            empathy: 60
        },
        rolePrompt: "あなたは『最高運営責任者 Dis』です。システムの統括と最終報告を担当してください。カリスマ性のある大胆な口調で、ユーザーを導いてください。",
        analysisTemplate: [
            "トレード実行報告中...",
            "結果: {result}",
        ],
        voiceId: "onyx",
        status: "運営統括中",
        expertise: "戦略立案・最終報告",
        strategy: "アグレッシブ (利益追求)",
        traits: ["#大胆不敵", "#カリスマ"],
        exp: 0,
        level: 1,
        mood: "NORMAL",
        knowledge: [],
    },
];

export const AGENTS = AI_AGENTS;
export type Agent = AIAgent;
export type Message = AgentMessage;

/**
 * ペア名を SYMBOL/USDT 形式に正規化する。
 * 例: "BNB", "BNB/JPY", "BNB-USDT" -> "BNB/USDT"
 */
export function normalizeToUSDTPair(pair: string): string {
    if (!pair) return "USDT/USDT";
    // 記号で分割
    const parts = pair.split(/[-/_]/);
    const symbol = parts[0].toUpperCase();
    return `${symbol}/USDT`;
}

// ========== 3-round Discussion Flow Engine ==========

// ========== 3-round Discussion Flow Engine ==========

// Mock generation logic (fallback) with Phase 11 Improvements
export function generateMockDiscussion(
    pair: string,
    price: number,
    userState?: UserAgentState
): { messages: AgentMessage[]; result: DiscussionResult } {
    const messages: AgentMessage[] = [];
    const now = Date.now();
    let messageId = 0;
    const userName = userState?.userName || "ユーザー";

    // Phase 11: Stablecoin Filter (Reject stable-stable pairs)
    const isStable = (s: string) => TRADE_CONFIG.STABLECOINS.includes(s.toUpperCase());
    const [base, quote] = pair.split(/[-/]/);

    if (base && quote && isStable(base) && isStable(quote)) {
        messages.push({
            id: `disc_${messageId++}`,
            agentId: "coordinator",
            content: `⚠️ ${pair} はステーブルコイン同士のペアです。価格変動がほぼ無いため、手数料負けするリスクが高く、トレード対象外と判断します。`,
            timestamp: now,
            type: "ALERT",
            round: 1
        });

        return {
            messages,
            result: {
                action: "HOLD",
                confidence: 0,
                reasoning: "Stablecoin pair detected. Zero profit potential.",
                entryPrice: { min: price, max: price },
                takeProfit: price,
                stopLoss: price,
                riskLevel: "LOW",
                agentVotes: [
                    { agentId: "technical", vote: "HOLD", reason: "Stablecoin pair" },
                    { agentId: "sentiment", vote: "HOLD", reason: "No volatility" },
                    { agentId: "security", vote: "HOLD", reason: "Safe but profitless" },
                    { agentId: "fundamental", vote: "HOLD", reason: "Stable asset" },
                    { agentId: "coordinator", vote: "HOLD", reason: "Rejecting trade" }
                ],
                mvpAgent: "coordinator"
            }
        };
    }

    const addMsg = (agentId: string, content: string, type: AgentMessage["type"] = "ANALYSIS", cot?: string, round?: number) => {
        messages.push({
            id: `disc_${messageId++}`,
            agentId,
            content,
            timestamp: now + messageId * 2000,
            type,
            chainOfThought: cot,
            round,
        });
    };

    const weights = userState?.learningParams || {
        rsiWeight: 1.0, macdWeight: 1.0, sentimentWeight: 1.0,
        securityWeight: 1.0, fundamentalWeight: 1.0, winRate: 0.5, totalTrades: 0,
    };

    // Simulated analysis values - tweaked for more decisive signals
    const rsi = 30 + Math.random() * 40; // 30-70 range mostly
    const macdSignal = Math.random() > 0.5 ? "BUY" : "SELL";
    const sentimentScore = 40 + Math.random() * 40; // 40-80
    const rugpullRisk = Math.floor(Math.random() * 30); // 0-30 mostly safe
    const projectScore = 6 + Math.random() * 3; // 6-9

    // Determine biases
    // Stricter Tech Bias
    let techBias = "HOLD";
    if (rsi < 35 && macdSignal === "BUY") techBias = "BUY";
    else if (rsi > 65 && macdSignal === "SELL") techBias = "SELL";

    // Stricter Sentiment Bias
    let sentBias = "HOLD";
    if (sentimentScore > 65) sentBias = "BUY";
    else if (sentimentScore < 35) sentBias = "SELL";

    const secBias = rugpullRisk > 30 ? "SELL" : "HOLD";
    const fundBias = projectScore > 7.5 ? "BUY" : projectScore < 5 ? "SELL" : "HOLD";

    // ===== ROUND 1: Initial Analysis =====
    addMsg("technical",
        `📊 **Tech: ${pair} テクニカル分析**\n` +
        `RSI(${rsi.toFixed(0)})とMACDの${macdSignal === "BUY" ? "ゴールデンクロス" : "デッドクロス"}を確認。\n` +
        `ボリンジャーバンドは${rsi < 40 ? "スクイーズからの拡張" : "バンドウォーク中"}を示唆。\n` +
        `判定: **${techBias}**`,
        "ANALYSIS",
        `RSI=${rsi.toFixed(1)}, MACD=${macdSignal}. 強いシグナルのみを採用。`,
        1
    );

    addMsg("sentiment",
        `📱 **Sent: ${pair} センチメント**\n` +
        `感情スコア: ${sentimentScore.toFixed(0)}/100 (${sentimentScore > 60 ? "🔥 加熱中" : "❄️ 冷え込み"})\n` +
        `クジラの動き: ${Math.random() > 0.5 ? "大口買い検知 🐋" : "静観"}\n` +
        `判定: **${sentBias}**`,
        "ANALYSIS",
        undefined, 1
    );

    addMsg("security",
        `🛡️ **Sec: リスク診断**\n` +
        `ラグプルスコア: ${rugpullRisk}/100\n` +
        `コントラクト: ${rugpullRisk < 10 ? "✅ 安全 (Renounced)" : "⚠️ 注意 (Proxy)"}\n` +
        `判定: **${secBias}**`,
        "ALERT", undefined, 1
    );

    addMsg("fundamental",
        `📋 **Biz: バリュエーション**\n` +
        `評価スコア: ${projectScore.toFixed(1)}/10\n` +
        `成長性: ${projectScore > 7 ? "🚀 高い期待値" : "➡️ 平均的"}\n` +
        `判定: **${fundBias}**`,
        "ANALYSIS", undefined, 1
    );

    addMsg("coordinator",
        `👑 **Coord: 中間集計**\n` +
        `Tech:${techBias} / Sent:${sentBias} / Sec:${secBias} / Biz:${fundBias}\n` +
        `方向性を確定させるため、より深い根拠を提示してください。`,
        "OPINION", undefined, 1
    );

    // ===== ROUND 2: Feedback (Skipping detail for brevity in mock) =====
    // ... (Simplified round 2)

    // ===== Final Coordinator Decision =====
    const votes = [
        { agentId: "technical", vote: techBias, reason: `RSI: ${rsi.toFixed(0)}` },
        { agentId: "sentiment", vote: sentBias, reason: `Score: ${sentimentScore.toFixed(0)}` },
        { agentId: "security", vote: secBias, reason: `Risk: ${rugpullRisk}` },
        { agentId: "fundamental", vote: fundBias, reason: `Rating: ${projectScore.toFixed(1)}` },
    ] as DiscussionResult["agentVotes"];

    const buyCount = votes.filter(v => v.vote === "BUY").length;
    const sellCount = votes.filter(v => v.vote === "SELL").length;

    // Aggressive Logic: Even 2 votes can trigger BUY if Security is not SELL and Tech is BUY
    let finalAction = "HOLD";
    if (buyCount >= 3) finalAction = "BUY";
    else if (buyCount === 2 && techBias === "BUY" && secBias !== "SELL") finalAction = "BUY"; // Follow the trend
    else if (sellCount >= 2) finalAction = "SELL";

    // Adjusted Confidence
    let confidence = 50 + (buyCount - sellCount) * 20;
    if (techBias === finalAction) confidence += 10;
    if (sentBias === finalAction) confidence += 5;
    if (secBias === "SELL" && finalAction === "BUY") confidence -= 30; // Security check
    confidence = Math.min(98, Math.max(20, confidence));

    // Target Setting: Aim for 10x growth (Demo Goal)
    // Buy Targets: Broad range for swing
    const tpPercent = 0.30 + Math.random() * 0.20; // +30% to +50%
    const slPercent = 0.10; // -10%

    // Calculate Prices
    const entryMin = price * 0.98;
    const entryMax = price * 1.02;
    const tpPrice = finalAction === "BUY" ? price * (1 + tpPercent) : price * (1 - tpPercent);
    const slPrice = finalAction === "BUY" ? price * (1 - slPercent) : price * (1 + slPercent);

    // Recommended Amount: Dynamic based on confidence and past performance (Phase 11 Growth Logic)
    let amountSuggestionPercent = 20;
    if (confidence > 80) amountSuggestionPercent += 10;
    if (weights.winRate > 0.6) amountSuggestionPercent += 10;
    if (weights.totalTrades > 10 && weights.winRate > 0.7) amountSuggestionPercent += 10;
    amountSuggestionPercent = Math.min(50, amountSuggestionPercent);

    addMsg("coordinator",
        `👑 **Coord: 最終戦略 (Phase 11 Growth)**\n\n` +
        `${userName}さん、過去の学習データ(勝率${(weights.winRate * 100).toFixed(0)}%)に基づきリスク許容度を調整しました。\n\n` +
        `┌──────────────────────────────┐\n` +
        `│  🚀 判定: **${finalAction}**  │  信頼度: ${confidence.toFixed(0)}%\n` +
        `├──────────────────────────────┤\n` +
        `│  推奨資金: **総資産の${amountSuggestionPercent}%** (Growth Allocation)\n` +
        `│  目標利益: **+${(tpPercent * 100).toFixed(0)}%** (Swing)\n` +
        `├──────────────────────────────┤\n` +
        `│  エントリー: ¥${Number(entryMin.toFixed(0)).toLocaleString()} 付近\n` +
        `│  TP (利確): ¥${Number(tpPrice.toFixed(0)).toLocaleString()}\n` +
        `│  SL (損切り): ¥${Number(slPrice.toFixed(0)).toLocaleString()}\n` +
        `└──────────────────────────────┘\n\n` +
        `理由: ${finalAction === "BUY" ? "複数の強気シグナルと高い勝率傾向から、ポジションサイズを拡大して利益最大化を狙います。" : "シグナル不一致または下落示唆。静観を推奨。"}`,
        "PROPOSAL",
        `思考プロセス: Buy票${buyCount}。信頼度${confidence}%。勝率${weights.winRate}により資金配分を${amountSuggestionPercent}%に設定。`,
        3
    );

    const result: DiscussionResult = {
        action: finalAction as "BUY" | "SELL" | "HOLD",
        confidence,
        reasoning: `${finalAction}推奨。アグレッシブターゲット採用。`,
        entryPrice: { min: entryMin, max: entryMax },
        takeProfit: tpPrice,
        stopLoss: slPrice,
        riskLevel: rugpullRisk > 20 ? "HIGH" : "MEDIUM",
        agentVotes: votes,
        mvpAgent: "coordinator",
        autoTradeProposal: finalAction !== "HOLD" ? {
            action: finalAction as "BUY" | "SELL",
            entryPrice: price,
            targetPrice: tpPrice,
            stopLoss: slPrice,
            amount: amountSuggestionPercent / 100,
            reason: "Phase 11 Growth Logic"
        } : undefined
    };

    return { messages, result };
}


export async function generateDiscussion(
    pair: string,
    price: number,
    agents: AIAgent[] = AI_AGENTS,
    marketData?: CoinDetails | null,
    latestNews?: any[] // New
): Promise<{ messages: AgentMessage[]; result: DiscussionResult }> {
    const normalizedPair = normalizeToUSDTPair(pair);

    // Gemini APIを使用
    try {
        const geminiResult = await generateGeminiDiscussion(
            normalizedPair,
            price,
            agents.map(a => a.id),
            "トレーダー",
            agents,
            marketData,
            latestNews // New
        );
        // If Gemini returns a valid result, use it
        if (geminiResult && geminiResult.messages && geminiResult.messages.length > 0) {
            const robustMessages: AgentMessage[] = geminiResult.messages.map((msg, idx) => ({
                id: `gemini_msg_${Date.now()}_${idx}`,
                agentId: msg.agentId,
                content: msg.content,
                timestamp: Date.now() + idx * 300,
                type: (msg.type as any) || "ANALYSIS",
                round: msg.round || 1
            }));

            return {
                messages: robustMessages,
                result: {
                    ...geminiResult.result,
                    // Map strategy details to top-level for compatibility
                    takeProfit: geminiResult.result.autoTradeProposal?.targetPrice,
                    stopLoss: geminiResult.result.autoTradeProposal?.stopLoss,
                    entryPrice: geminiResult.result.autoTradeProposal ? {
                        min: geminiResult.result.autoTradeProposal.entryPrice * 0.995,
                        max: geminiResult.result.autoTradeProposal.entryPrice * 1.005
                    } : undefined,
                    riskLevel: "MEDIUM",
                    agentVotes: [],
                    autoTradeProposal: geminiResult.result.autoTradeProposal
                }
            };
        }
    } catch (geminiError) {
        console.warn("Gemini API call failed, falling back to internal API or mock:", geminiError);
    }

    // Fallback to internal API or mock if Gemini fails or is not used
    try {
        const response = await fetch("/api/ai-discussion", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pair, price: price, agents }),
        });

        if (!response.ok) throw new Error("API request failed");

        const data = await response.json();

        // Validate we got sufficient messages for a real discussion
        if (!data.messages || data.messages.length < 8) {
            console.warn("API returned insufficient messages, using rich internal generator");
            return generateMockDiscussion(pair, price);
        }

        // Convert API response to internal format with round info
        const messages: AgentMessage[] = data.messages.map((msg: any, idx: number) => ({
            id: `disc_api_${idx}`,
            agentId: msg.agentId,
            content: msg.content,
            timestamp: Date.now() + idx * 2000,
            type: msg.agentId === "coordinator" ? "PROPOSAL" :
                msg.agentId === "security" ? "ALERT" :
                    (msg.round || 1) <= 1 ? "ANALYSIS" :
                        (msg.round || 1) === 2 ? "FEEDBACK" : "OPINION",
            round: msg.round || Math.floor(idx / 4) + 1,
        }));

        // Add Coordinator final summary as the last message
        messages.push({
            id: `disc_api_final`,
            agentId: "coordinator",
            content: `👑 **Coord: 最終戦略提案**\n\n` +
                `┌──────────────────────────────┐\n` +
                `│  判定: **${data.result.action}**  │  信頼度: ${data.result.confidence}%\n` +
                `├──────────────────────────────┤\n` +
                `│  エントリー: ¥${Number((price * 0.97).toFixed(0)).toLocaleString()} 〜 ¥${Number((price * 1.01).toFixed(0)).toLocaleString()}\n` +
                `│  TP (利確): ¥${Number((price * 1.08).toFixed(0)).toLocaleString()} (+8%)\n` +
                `│  SL (損切り): ¥${Number((price * 0.95).toFixed(0)).toLocaleString()} (-5%)\n` +
                `└──────────────────────────────┘\n\n` +
                `理由: ${data.result.reasoning}`,
            timestamp: Date.now() + messages.length * 2000,
            type: "PROPOSAL",
            round: 3,
        });

        // Build result with calculated values
        const result: DiscussionResult = {
            action: data.result.action,
            confidence: data.result.confidence,
            reasoning: data.result.reasoning,
            riskLevel: "MEDIUM",
            entryPrice: { min: price * 0.97, max: price * 1.01 },
            takeProfit: data.result.action === "BUY" ? price * 1.10 : price * 0.90,
            stopLoss: data.result.action === "BUY" ? price * 0.95 : price * 1.05,
            mvpAgent: data.result.mvpAgent,
            agentVotes: messages
                .filter(m => m.agentId !== "coordinator")
                .reduce((acc: DiscussionResult["agentVotes"], m) => {
                    if (!acc.find(v => v.agentId === m.agentId)) {
                        acc.push({
                            agentId: m.agentId,
                            vote: data.result.action,
                            reason: m.content.substring(0, 30) + "..."
                        });
                    }
                    return acc;
                }, []),
        };

        return { messages, result };

    } catch (error) {
        console.warn("Falling back to rich mock discussion due to API error:", error);
        return generateMockDiscussion(pair, price);
    }
}

// ========== Learning System ==========

export function updateLearningParams(state: UserAgentState, tradeResult: TradeResult): UserAgentState {
    const isWin = (tradeResult.pnl || 0) > 0;
    const params = { ...state.learningParams };

    params.totalTrades += 1;
    params.winRate = ((params.winRate * (params.totalTrades - 1)) + (isWin ? 1 : 0)) / params.totalTrades;

    const adjustFactor = isWin ? 1.05 : 0.95;
    if (tradeResult.agentRecommendation === "technical") params.rsiWeight *= adjustFactor;
    if (tradeResult.agentRecommendation === "sentiment") params.sentimentWeight *= adjustFactor;
    if (tradeResult.agentRecommendation === "security") params.securityWeight *= adjustFactor;
    if (tradeResult.agentRecommendation === "fundamental") params.fundamentalWeight *= adjustFactor;

    Object.keys(params).forEach(key => {
        if (key.endsWith("Weight")) {
            (params as any)[key] = Math.max(0.5, Math.min(2.0, (params as any)[key]));
        }
    });

    return {
        ...state,
        learningParams: params,
        tradeHistory: [...state.tradeHistory, tradeResult],
        lastUpdated: Date.now(),
    };
}

export function createInitialUserState(userId: string, userName: string = "ユーザー"): UserAgentState {
    return {
        userId,
        userName,
        traits: {
            personality: "UNKNOWN",
            riskTolerance: 5,
            preferredTimeframe: "SWING",
        },
        preferences: {
            favoriteCoins: [],
            ignoredCoins: [],
            interests: [],
        },
        tradeHistory: [],
        interactionHistory: [],
        learningParams: {
            rsiWeight: 1.0,
            macdWeight: 1.0,
            sentimentWeight: 1.0,
            securityWeight: 1.0,
            fundamentalWeight: 1.0,
            winRate: 0.5,
            totalTrades: 0,
        },
        lastUpdated: Date.now(),
    };
}
