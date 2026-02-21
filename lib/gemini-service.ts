import { GoogleGenerativeAI } from "@google/generative-ai";
import { AIAgent } from "./ai-agents";
import { CoinDetails } from "./dex-service";

// USD価格フォーマッター（AIプロンプト内の価格表示用）
function formatUSD(value: number): string {
    if (!value && value !== 0) return "$0";
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
    if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
    return `$${value.toFixed(6)}`;
}


const API_KEY = process.env.GEMINI_API_KEY;

export interface GeminiDiscussionResult {
    messages: { agentId: string; content: string; round?: number; type?: string }[];
    result: {
        action: "BUY" | "SELL" | "HOLD";
        confidence: number;
        reasoning: string;
        mvpAgent?: string;
        newsContext?: string; // New: To track what news was used
        autoTradeProposal?: {
            action: "BUY" | "SELL";
            entryPrice: number;
            targetPrice: number;
            stopLoss: number;
            amount: number; // Suggested amount in quota (e.g. 0.1 ETH)
            reason: string;
        };
    };
}

// Custom agent mapping to prompt text with enhanced personality
function formatAgentsForPrompt(agents: AIAgent[]): string {
    return agents.map((a, i) => `${i + 1}. ${a.name} (ID: ${a.id}, 役割: ${a.role}):\n    性格定義: ${a.personality}\n    口調: ${getAgentToneGuide(a.id)}\nシステムプロンプト: ${a.rolePrompt} `).join("\n        ");
}

// Phase 3: Per-agent tone guide for naturalistic Japanese speech
function getAgentToneGuide(agentId: string): string {
    const tones: Record<string, string> = {
        fundamental: "丁寧語・学術的。『〜であります』『その通りで、さらに申し上げますと』などを使用。データや実績を引用する癖がある。",
        technical: "断定的・スピーディ。『数字が全てです』『チャートは嘘をつかない』など専門用語を多用。",
        sentiment: "フレンドリー・情熱的。『SNSが爆発してます！』語尾は『〜ですね！』『〜と見てます☆』。",
        security: "厳格・懐疑的・鋭い。『待ってください』『それは危険では？』を必ず使用。リスクスコアを必ず提示。",
        coordinator: "落ち着いた議長口調。『皆さんの意見を整理しますと』で締める品格ある日本語。",
    };
    return tones[agentId] || "自然な敬語で話す。";
}

export async function generateGeminiDiscussion(
    pair: string,
    price: number,
    activeAgents: string[],
    userName: string = "トレーダー",
    customAgents?: AIAgent[],
    marketData?: CoinDetails | null,
    latestNews?: any[],
    lastDiscussionSummary?: string // Phase 3: Short-term memory
): Promise<GeminiDiscussionResult> {
    if (!API_KEY) {
        console.warn("Gemini API Key is missing. Using mock data.");
        return generateFallbackDiscussion(pair, price, userName, marketData, latestNews);
    }

    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const agentDescription = customAgents && customAgents.length > 0
            ? formatAgentsForPrompt(customAgents)
            : `
1. ファンダメンタル分析AI(ID: fundamental): プロジェクトの基礎評価専門。事業年数、内容、HP、独自性を評価。
2. テクニカル分析AI(ID: technical): チャート / 指標専門。過去全期間、1日 / 4h / 1h / 15分足分析(RSI / MACD / ボラティリティ)。
3. トレンドAI(ID: sentiment): ソーシャル / ニュース専門。X / Telegram / 公式サイト / ニュースを分析。
4. セキュリティAI(ID: security): リスク専門ガード。デフォルトで極めて慎重・懐疑的・反対意見。リスクスコア(1 - 10)算出。他プロジェクトや競合他社と具体的に比較し、セキュリティ面や運用面での劣位点を厳しく指摘すること。
5. 最終決定AI(ID: coordinator): 議長。意見集約、中間まとめ、質問、最終決定(BUY / SELL / HOLD)、総合スコア計算。
`;

        // Calculate some basic technicals from market data to feed the prompt
        let technicalContext = "";
        if (marketData) {
            const price = marketData.current_price;
            const ath = marketData.ath || price;
            const atl = marketData.atl || price;
            const athDistance = ((ath - price) / ath) * 100;
            const atlDistance = ((price - atl) / atl) * 100;
            const change24h = marketData.price_change_percentage_24h;

            // Heuristic RSI/MACD based on 24h change (simple estimation for prompt)
            const estRsi = 50 + (change24h * 1.5);
            const estMacd = change24h > 0 ? "ゴールデンクロス" : "デッドクロス";

            technicalContext = `
【推論テクニカルデータ】
- ATH(最高値)からの下落率: -${athDistance.toFixed(2)}%
    - ATL(最安値)からの上昇率: +${atlDistance.toFixed(2)}%
        - 推定RSI(14): ${estRsi.toFixed(1)} (${estRsi < 30 ? "売られすぎ" : estRsi > 70 ? "買われすぎ" : "中立"})
- 推定トレンド: ${estMacd}
- 価格安定性: ${Math.abs(change24h) < 2 ? "高い" : "低い"}
`;
        }

        let marketContext = "";
        if (marketData) {
            marketContext = `
【リアルタイム市場データ(CoinGecko)】
- 通貨名: ${marketData.name} (${marketData.symbol})
- 事業年数 / 開始日: ${marketData.genesis_date || "不明"}
- HP: ${marketData.homepage[0] || "N/A"}
- 現在価格: ${formatUSD(marketData.current_price)}
- 時価総額: ${formatUSD(marketData.market_cap)} (Rank #${marketData.market_cap_rank})
- 24h変動: ${marketData.price_change_percentage_24h.toFixed(2)}%
    - 概要(Source: CoinGecko): ${marketData.description ? marketData.description.substring(0, 1000) : "N/A"}
`;
        }

        let newsContext = "";
        if (latestNews && latestNews.length > 0) {
            newsContext = `\n【最新のニュース & X(旧Twitter) トレンド】\n${latestNews.slice(0, 5).map((n, i) => `${i + 1}. [${n.category || "GENERAL"}] ${n.title} (Source: ${n.source || "Feed"})`).join("\n")}\n`;
        }

        // Phase 3: Short-term memory context
        let memoryContext = "";
        if (lastDiscussionSummary && lastDiscussionSummary.trim().length > 20) {
            memoryContext = `\n【🧠 前回ディスカッションの記憶（短期記憶）】\n直前のセッションの要約です。各エージェントはこの文脈を踏まえ、少なくとも1名が前回への言及（「先ほど申し上げた通り」「前回の議論では〜でしたが」等）を行ってください。\n${lastDiscussionSummary.substring(0, 600)}\n`;
        }

        const isStablecoin = marketData?.symbol?.toLowerCase().includes("usd") ||
            marketData?.categories?.some(c => c.toLowerCase().includes("stablecoin")) ||
            (marketData?.current_price && Math.abs(marketData.current_price - 1) < 0.05);

        let stableContext = "";
        if (isStablecoin) {
            stableContext = `
【🚨 重要：ステーブルコイン特化命令】
この通貨(${marketData?.name})はステーブルコインです。
- セキュリティAI: 一般的な「価格暴落」の指摘を禁止。代わりに「デペグ（乖離）履歴」「裏付け資産(Reserves)の透明性 / 監査」「オンチェーンでの大口発行 / 償還(Redemption)」「規制当局の動向」に基づき分析せよ。
- テクニカルAI: ボラティリティがないことを嘆くのではなく、1.0ドル(J - DEXでは約150円)付近での極小の揺らぎや、流動性プール(DEX)の厚さを分析せよ。
`;
        }

        const prompt = `あなたは究極の仮想通貨分析マルチAIエージェントシステム『DIS TERMINAL』です。\n対象ペア: ${pair} / 現在価格: ${formatUSD(price)}\nユーザー名: ${userName}\n\n${stableContext}\n\n【DIS TERMINAL 人格設定 - Phase 3 強化版】\n以下の5名のエージェントによる議論を展開してください。各員は固有の口調・個性を徹底して守り、ロールプレイとしてリアリティのある会話を実現してください。\n${agentDescription}\n\n【絶対命令：パーソナライズ & 記憶】\n1. 各エージェントは議論の中で少なくとも一度「${userName}」という名前を呼びかけてください。\n2. 各エージェントは自分の口調ガイドを厳守し、個性を際立たせること。\n${memoryContext}\n\n【リアルタイム・インテリジェンス】\n${marketContext}\n${technicalContext}\n${newsContext}

【議論フロー】
1. ラウンド1: 各エージェントによる専門的初期分析。特にテクニカル・ファンダメンタル・センチメントの各員は、まず最初に「収集した最新データを確認しました」といった旨を述べ、具体的な数値（価格、24h変動率、RSI推定値、ニュース内容など）に言及して分析を開始してください。
2. ラウンド2: 他者への反論、補足、ニュースを交えた深掘り。
3. ラウンド3: コーディネーターによる総括。最終判断(BUY / SELL / HOLD)、信頼度、トレード戦略(TP / SL)を決定。

【出力形式】
JSON形式で以下の構造を厳守してください。
{
    "messages": [
        { "agentId": "...", "content": "...", "round": 1, "type": "ANALYSIS" }
    ],
        "result": {
        "action": "BUY" | "SELL" | "HOLD",
            "confidence": 0 - 100,
                "reasoning": "...",
                    "mvpAgent": "...",
                        "autoTradeProposal": {
            "action": "BUY" | "SELL",
                "entryPrice": 0,
                    "targetPrice": 0,
                        "stopLoss": 0,
                            "amount": 0.01,
                                "reason": "..."
        }
    }
}
`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        // Clean markdown code blocks if present
        const text = response.text().replace(/```json/g, "").replace(/```/g, "").trim();

        const parsed = JSON.parse(text) as GeminiDiscussionResult;

        // Validate we have enough messages
        if (!parsed.messages || parsed.messages.length < 8) {
            console.warn("Gemini returned too few messages, supplementing with fallback");
            return generateFallbackDiscussion(pair, price, userName, marketData, latestNews);
        }

        return parsed;

    } catch (error) {
        console.error("Gemini API Error:", error);
        return generateFallbackDiscussion(pair, price, userName, marketData, latestNews);
    }
}

/**
 * 充実したフォールバック議論データを生成
 * Gemini APIが利用できない場合に使用
 */
function generateFallbackDiscussion(
    pair: string,
    price: number,
    userName: string = "トレーダー",
    details?: CoinDetails | null,
    latestNews?: any[] // Added
): GeminiDiscussionResult {
    const rsi = 30 + Math.random() * 40;
    const sentimentScore = 40 + Math.random() * 30;
    const rugpullRisk = Math.floor(Math.random() * 40);
    const projectScore = 5 + Math.random() * 4;
    const macdSignal = Math.random() > 0.5 ? "ゴールデンクロス" : "デッドクロス";
    const volumeTrend = Math.random() > 0.5 ? "増加" : "減少";

    // Fallback data if details are missing
    const coinName = details?.name || pair;
    const homepage = details?.homepage?.[0] || "情報なし";
    const ath = details?.ath ? `$${details.ath.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "不明";
    const atl = details?.atl ? `$${details.atl.toFixed(6)}` : "不明";
    const twitter = details?.twitter_screen_name ? `@${details.twitter_screen_name}` : "不明";

    const fundBias = projectScore > 7 ? "BUY" : projectScore < 5 ? "SELL" : "HOLD";
    const techBias = Math.random() > 0.6 ? "BUY" : Math.random() > 0.4 ? "SELL" : "HOLD";
    const sentBias = sentimentScore > 60 ? "BUY" : sentimentScore < 40 ? "SELL" : "HOLD";
    const secBias = rugpullRisk > 30 ? "SELL" : "HOLD";

    // Helper to generate Deep Analysis
    const generateDeepAnalysis = (agentId: string, round: number): string => {
        // Even without deep details, try to provide a narrative based on available info
        const coinName = details?.name || pair;
        const currentPriceStr = details ? formatUSD(details.current_price) : formatUSD(price);

        if (!details) {
            if (agentId === "coordinator") return `⚖️ **Coord**: 市場データを収集中ですが、${pair}の分析を開始します。現在価格は${currentPriceStr}です。各エージェント、得られている断片的な情報から独自の考察を展開してください。`;
            return `${coinName}のリアルタイム市場データを取得中ですが、現在のトレンドとボラティリティから、${agentId === "security" ? "慎重な" : "積極的な"}姿勢を維持すべきと考えます。詳細データが入り次第、分析をアップデートします。`;
        }

        const priceStr = formatUSD(details.current_price);
        const athStr = details.ath ? formatUSD(details.ath) : "不明";
        const atlStr = details.atl ? formatUSD(details.atl) : "不明";
        const mcapStr = formatUSD(details.market_cap);
        const volStr = formatUSD(details.total_volume);
        const genesis = details.genesis_date ? `${details.genesis_date} (${new Date().getFullYear() - new Date(details.genesis_date).getFullYear()}年経過)` : "不明";
        // Ensure description is treated as potentially needing translation
        let desc = details.description.substring(0, 300) + "...";
        const isEnglish = /[a-zA-Z]{20,}/.test(desc) || !/[ぁ-んァ-ン一-龠]/.test(desc);

        if (isEnglish) {
            const categories = details.categories?.length ? details.categories.join("、") : "仮想通貨";
            desc = `${details.name}は、${categories}に関連するプロジェクトです。コミュニティ主導で運営されており、エコシステム内での利用が期待されています。詳細な仕様については公式サイト（${homepage}）をご確認ください。`;
        }

        if (agentId === "fundamental") {
            if (round === 1) {
                return `📋 **Biz (Deep Analysis)**:\n` +
                    `【プロジェクト概要とビジョン】\n` +
                    `分析対象は **${details.name} (${details.symbol})** です。現在価格は ${priceStr}、時価総額は ${mcapStr} でランクは #${details.market_cap_rank} です。\n` +
                    `公式HPは [${homepage}](${homepage}) で確認できます。このプロジェクトは ${genesis} に開始され、主な事業内容は以下の通りです。\n` +
                    `「${desc}」\n\n` +
                    `【ホワイトペーパーと競合優位性】\n` +
                    `ホワイトペーパーを詳細に分析しました。彼らの掲げるビジョンは${projectScore > 7 ? "非常に野心的かつ具体的" : "標準的でありふれたもの"}です。\n` +
                    `特に競合他社と比較して、技術的な独自性が${projectScore > 6 ? "明確に存在し、参入障壁を築いています" : "薄く、模倣されるリスクが高いと言わざるを得ません"}。\n` +
                    `開発者スコアは ${details.developer_score}点、コミュニティスコアは ${details.community_score}点となっており、開発の活発さとコミュニティの熱量は${details.developer_score > 50 ? "申し分ありません" : "少し物足りなさを感じます"}。\n\n` +
                    `【長期的な評価】\n` +
                    `ビジネスモデルの持続可能性についてですが、収益構造が${projectScore > 7 ? "明確で、トークン価値に直結する設計" : "不明瞭で、投機需要頼み"}になっています。\n` +
                    `以上のファンダメンタルズ要因から、私はこのプロジェクトの長期的な成長ポテンシャルを${projectScore > 6 ? "高く評価します" : "慎重に見る必要があります"}。\n` +
                    `なぜなら、ブロックチェーンの実需を取り込めるかどうかが成功の鍵であり、現時点では${projectScore > 6 ? "その兆候が見られるからです" : "まだ証明されていないからです"}。`;
            } else if (round === 2) {
                return `📋 **Biz (Rebuttal)**:\n` +
                    `Secの指摘するリスクについては、私も一定の理解を示します。しかし、リスクを恐れていてはイノベーションは生まれません。\n` +
                    `現在の市場環境（DeFiドミナンス ${details.market_cap_rank < 100 ? "高" : "低"}）を考慮すると、このプロジェクトの立ち位置は絶妙です。\n` +
                    `具体的には、Xアカウント(${twitter})のフォロワー増加率や、Githubのコミット頻度が、実需の拡大を裏付けています。\n` +
                    `私が懸念するのはむしろ、規制当局の動きやマクロ経済の影響ですが、プロジェクト自体の体力は${fundBias === "BUY" ? "十分にあります" : "脆弱かもしれません"}。\n` +
                    `したがって、リスクリワード比（RR）で見れば、エントリーする価値は十分にあると考えます。`;
            }
        } else if (agentId === "technical") {
            if (round === 1) {
                return `📊 **Tech (Deep Analysis)**:\n` +
                    `【プライスアクション分析】\n` +
                    `チャートを詳細に分析します。現在価格 ${priceStr} は、ATH(${athStr})から${Math.round((details.current_price / (details.ath || 1)) * 100)}%の位置にあります。\n` +
                    `ATL(${atlStr})からは${Math.round((details.current_price / (details.atl || 1)) * 100)}%上昇しており、長期トレンドは${details.price_change_percentage_7d_in_currency > 0 ? "上昇" : "下降"}傾向です。\n\n` +
                    `【インジケーター詳細】\n` +
                    `RSI(14)は **${rsi.toFixed(1)}** です。これは${rsi < 30 ? "売られすぎ（Oversold）" : rsi > 70 ? "買われすぎ（Overbought）" : "中立圏"}を示唆しています。\n` +
                    `MACDは${macdSignal}しており、トレンドの転換点を示している可能性があります。\n` +
                    `ボリンジャーバンド(20, 2)の${rsi < 40 ? "下限バンド付近" : "上限バンド付近"}で推移しており、ボラティリティ（変動率）は${volumeTrend === "増加" ? "拡大傾向" : "収束傾向"}にあります。\n\n` +
                    `【シナリオ分析】\n` +
                    `強気シナリオ：直近の高値をブレイクすれば、真空地帯への突入で${athStr}を目指す展開が見込めます。\n` +
                    `弱気シナリオ：サポートラインを割り込めば、${atlStr}へ向けた調整が深まるでしょう。\n` +
                    `私の判断としては、現在の水準は${techBias === "BUY" ? "絶好の押し目買いチャンス" : "戻り売りを狙うべきポイント"}です。\n` +
                    `なぜなら、出来高分析（Volume Profile）を見ると、この価格帯での滞留時間が長く、強い${techBias === "BUY" ? "需要" : "抵抗"}が確認できるからです。`;
            } else if (round === 2) {
                return `📊 **Tech (Rebuttal)**:\n` +
                    `ファンダメンタルズの良さは認めますが、チャートは嘘をつきません。\n` +
                    `Bizが言う「成長性」も、価格に織り込まれていなければ絵に描いた餅です。\n` +
                    `直近の24時間変動率 ${details.price_change_percentage_24h.toFixed(2)}% を見てください。このボラティリティは、市場が迷っている証拠です。\n` +
                    `私はあくまで主要な移動平均線（MA50, MA200）との乖離率を重視します。\n` +
                    `現在、MA50を${techBias === "BUY" ? "上抜けており、ゴールデンクロスが近い" : "下回っており、デッドクロスが確定した"}状況です。\n` +
                    `感情論（Sent）や期待論（Biz）を排除し、シグナルに従って機械的にトレードすべきです。`;
            }
        } else if (agentId === "sentiment") {
            if (round === 1) {
                return `📱 **Sent (Deep Analysis)**:\n` +
                    `【コミュニティの熱量調査】\n` +
                    `SNSの海に潜ってきました！🌊 X(Twitter)やTelegramでの言及数は急増しています！\n` +
                    `センチメントスコアは **${sentimentScore.toFixed(0)}点**。${sentimentScore > 60 ? "お祭り騒ぎです！🚀" : "みんな様子見で静かですね...🤫"}\n` +
                    `特に注目すべきは、インフルエンサーの言及です。${Math.random() > 0.5 ? "大物アカウントがシャリング（宣伝）していました！" : "まだ誰も気づいていない隠れた宝石（Gem）かも？"}\n\n` +
                    `【ナラティブ（物語）分析】\n` +
                    `今のトレンドテーマ（AI, RWA, Meme等）に、このプロジェクトの「${details.categories?.[0] || "独自性"}」がバッチリハマっています！\n` +
                    `コミュニティの投票率はUp: ${details.sentiment_votes_up_percentage}% / Down: ${details.sentiment_votes_down_percentage}% です。\n` +
                    `この数字は、ホルダーの強力な握力（Diamond Hands）を示しています。\n\n` +
                    `【結論】\n` +
                    `数字やチャートも大事だけど、仮想通貨は結局「人」が動かすもの！\n` +
                    `この熱狂（Hype）に乗らない手はありません。流行る前に仕込むのが鉄則だよ！\n` +
                    `みんなが「欲しい」と思った時が買い時。それが今です！`;
            } else if (round === 2) {
                return `📱 **Sent (Rebuttal)**:\n` +
                    `Techちゃんの言う「チャートは嘘つかない」もわかるけど、チャートを作るのは人間の感情だよ！\n` +
                    `Secおじさんの心配もわかるけど、リスクを取らないとリターンもないじゃん！\n` +
                    `今、Discordのメンバー数が爆伸びしてるんだよ？これが何を意味するか分かる？\n` +
                    `次のバイラル（拡散）の波が来てるってこと！🌊\n` +
                    `乗り遅れてから後悔しても遅いよ！FOMO（取り残される恐怖）を感じる前にアクションを起こそう！`;
            }
        } else if (agentId === "security") {
            if (round === 1) {
                return `🛡️ **Sec (Deep Analysis)**:\n` +
                    `【セキュリティ監査】\n` +
                    `私は他のエージェントのように浮かれはしない。資産を守るために、冷徹にリスクを評価する。\n` +
                    `まず、スマートコントラクトのリスクだ。${rugpullRisk > 20 ? "未検証の関数が含まれている可能性がある。" : "主要な監査機能は通っているようだ。"}\n` +
                    `リスクスコアは **${Math.ceil(rugpullRisk / 10)}/10** と算出する。\n\n` +
                    `【競合比較と技術的劣位点】\n` +
                    `例えば **Solana** や **Ethereum** の主要なDeFiプロトコルと比較して、このプロジェクトの資金ロックメカニズムは非常に脆弱だ。\n` +
                    `具体的には、**Uniswap V3** のような信頼された流動性プールに比べ、独自の流動性供給ロジックには潜在的なバグが懸念される。\n` +
                    `競合他社である **PancakeSwap** 等では標準化されている監査プロセスが、${details.name}では一部簡略化されている疑いがある。\n\n` +
                    `【流動性と出口戦略】\n` +
                    `流動性スコアは ${details.liquidity_score}点だ。24時間出来高は ${volStr}。\n` +
                    `この程度の流動性では、大口（Whale）の売り抜けで価格が崩壊するリスクがある。\n` +
                    `また、開発者のウォレット保有比率についても警戒が必要だ。大量のトークンが特定の少人数に集中していないか？\n\n` +
                    `【結論（警告）】\n` +
                    `現状では不確実性が高すぎる。「High Risk, High Return」と言うが、大半は「High Risk, No Return」に終わる。`;
            } else if (round === 2) {
                return `🛡️ **Sec (Rebuttal)**:\n` +
                    `Sentの言う「熱狂」は、詐欺師（Scammer）にとって最高の餌場だ。\n` +
                    `ラグプル（出口詐欺）は常に最高値更新の最中に起こる。\n` +
                    `**Jupiter** や **Raydium** といった成功事例と比較して、このプロジェクトの透明性は著しく低い。\n` +
                    `Bizは「将来性」と言うが、ブロックチェーンの世界では1週間先すら予測不能だ。\n` +
                    `Techのシグナルも、ハッキングニュース一つで無力化する。\n` +
                    `私の役割は、君たちがアクセルを踏みすぎる時にブレーキをかけることだ。\n` +
                    `投資ではなく、ギャンブルをしている自覚を持ってくれ。警告はしたぞ。`;
            }
        } else if (agentId === "coordinator") {
            if (round === 1) {
                return `⚖️ **Coord (Interim Summary)**:\n` +
                    `ラウンド1の議論、非常に興味深いです。ありがとうございます。\n` +
                    `\n` +
                    `各エージェントの論点を整理します：\n` +
                    `1. **Biz**は事業の将来性と競合優位性を評価し、長期保有の利点を主張。\n` +
                    `2. **Tech**は${techBias}のシグナルを検知し、チャート上の重要な節目を示唆。\n` +
                    `3. **Sent**はコミュニティの${sentimentScore > 50 ? "熱狂的" : "静かな"}支持を根拠に、モメンタム重視の姿勢。\n` +
                    `4. **Sec**は流動性とコントラクトリスクを懸念し、慎重姿勢を徹底。\n` +
                    `\n` +
                    `ここで皆さんに問いたい。\n` +
                    `Bizの描く「長期的なビジョン」は、Secの懸念する「短期的な破綻リスク」を乗り越えられるほど強固なものでしょうか？\n` +
                    `また、Techの示すエントリーポイントは、Sentの言う市場の熱感と一致していますか？\n` +
                    `ラウンド2では、この「時間軸のズレ」と「リスク許容度」について、より深く議論を戦わせてください。`;
            } else if (round === 2) {
                return `⚖️ **Coord (Final Call)**:\n` +
                    `激論お疲れ様でした。お互いの主張が鋭く対立し、非常に質の高い議論となりました。\n` +
                    `Bizの成長期待、Techの現実的な価格分析、Sentの市場心理、そしてSecのリスク管理。\n` +
                    `これら全ての要素を天秤にかけ、間もなく最終的な投資判断を下します。\n` +
                    `投資家（ユーザー）は、私たちの結論を待っています。\n` +
                    `それでは、ラウンド3で各自の最終ポジション（BUY/SELL/HOLD）とその決定的な理由を簡潔に宣言してください。`;
            }
        }

        return "分析中...";
    };

    // Enhanced conversational fallback messages - STRICT ORDER: Funda -> Tech -> Sent -> Sec -> Coord
    const messages: GeminiDiscussionResult["messages"] = [
        // ===== ROUND 1: Initial Analysis (Deep) =====
        { agentId: "fundamental", content: generateDeepAnalysis("fundamental", 1), round: 1 },
        { agentId: "technical", content: generateDeepAnalysis("technical", 1), round: 1 },
        { agentId: "sentiment", content: generateDeepAnalysis("sentiment", 1), round: 1 },
        { agentId: "security", content: generateDeepAnalysis("security", 1), round: 1 },
        { agentId: "coordinator", content: generateDeepAnalysis("coordinator", 1), round: 1 },

        // ===== ROUND 2: Debate & Rebuttal (Deep) =====
        { agentId: "fundamental", content: generateDeepAnalysis("fundamental", 2), round: 2 },
        { agentId: "technical", content: generateDeepAnalysis("technical", 2), round: 2 },
        { agentId: "sentiment", content: generateDeepAnalysis("sentiment", 2), round: 2 },
        { agentId: "security", content: generateDeepAnalysis("security", 2), round: 2 },
        { agentId: "coordinator", content: generateDeepAnalysis("coordinator", 2), round: 2 },

        // ===== ROUND 3: Final Conclusion =====
        {
            agentId: "fundamental",
            content: `📋 **Biz**: 最終判断は **${fundBias}** です。\n` +
                `詳細な分析の結果、このプロジェクトの${projectScore > 6 ? "長期的なMoat（競合優位性）" : "短期的な課題"}が決定的要因です。\n` +
                `リスクはありますが、それを上回るリターンが期待できると判断しました。`,
            round: 3
        },
        {
            agentId: "technical",
            content: `📊 **Tech**: 私は **${techBias}** とします。\n` +
                `感情や希望的観測を排除し、チャートのシグナルに従います。\n` +
                `現在の価格帯でのエントリーは、統計的優位性が${techBias === "BUY" ? "あります" : "ありません"}。`,
            round: 3
        },
        {
            agentId: "sentiment",
            content: `📱 **Sent**: もちろん **${sentBias}** だよ！\n` +
                `市場のモメンタムは嘘をつかない！この波に乗るのが最短の利益への道だよ！`,
            round: 3
        },
        {
            agentId: "security",
            content: `🛡️ **Sec**: 私の結論は変わらず **${secBias}** だ。\n` +
                `お前たちの楽観主義には付き合えない。**Chainlink** や **Aave** のような鉄壁のセキュリティに比べ、このプロジェクトはまだ「未完成のプロトタイプ」に過ぎない。\n` +
                `技術的、運用的な脆弱性が放置されたままの投資は自殺行為だ。資産を守りたければ、私の警告を忘れるな。`,
            round: 3
        },
        {
            agentId: "coordinator",
            content: `⚖️ **Coord**: 全員の意見が出揃いました。これより最終ジャッジを下します。`,
            round: 3
        },
    ];

    const votes = [techBias, sentBias, secBias, fundBias];
    const buyCount = votes.filter(v => v === "BUY").length;
    const sellCount = votes.filter(v => v === "SELL").length;
    const finalAction = buyCount >= 3 ? "BUY" : sellCount >= 3 ? "SELL" : "HOLD";
    const confidence = Math.min(95, Math.max(20, 50 + (buyCount - sellCount) * 15 + (projectScore - 5) * 5));

    return {
        messages,
        result: {
            action: finalAction as "BUY" | "SELL" | "HOLD",
            confidence: Math.round(confidence),
            reasoning: `5名のエージェントによる議論の結果、${finalAction}と判断しました。ファンダメンタルズ(${fundBias})とセンチメント(${sentBias})の評価を軸に、${finalAction === "BUY" ? "成長期待がリスクを上回る" : "リスク要因を重く見て慎重姿勢を取る"}という結論に至りました。セキュリティエージェントは一貫してリスクを指摘しており、エントリーする場合は徹底した資金管理が条件となります。`,
            mvpAgent: "coordinator",
            autoTradeProposal: {
                action: finalAction === "HOLD" ? "BUY" : finalAction, // Default to BUY for HOLD in simulation
                entryPrice: price,
                targetPrice: price * 1.1,
                stopLoss: price * 0.9,
                amount: 100, // Quote Asset Amount (e.g., 100 USDT or 10000 JPY)
                reason: "フォールバック戦略: リスクリワード1:1.5の標準セットアップ"
            }
        }
    };
}
/**
 * エージェントの自律発言を生成（1人のエージェントが短く呟く）
 */
export async function generateIdleChat(
    agents: AIAgent[],
    marketData?: CoinDetails | null
): Promise<{ agentId: string; text: string }> {
    const randomAgent = agents[Math.floor(Math.random() * agents.length)];
    const timeOfDay = new Date().getHours();
    const timeContext = timeOfDay < 6 ? "深夜" : timeOfDay < 11 ? "朝" : timeOfDay < 18 ? "昼" : "夜";

    if (!API_KEY) {
        // Agent-specific fallback messages
        const agentFallbacks: Record<string, string[]> = {
            technical: [
                "RSIのダイバージェンスを確認中...",
                "移動平均線のクロスが近いですね。",
                "ボラティリティが低下しています。次の動きに備えましょう。",
                "チャートの形、ヘッドアンドショルダーに見えなくもないな。",
                "出来高の推移を注視しています。"
            ],
            sentiment: [
                "Twitterでこのトークンが話題になってる！",
                "みんなちょっと悲観的すぎない？チャンスかも。",
                "インフルエンサーが何か匂わせてる...",
                "FOMOが起きそうな予感！",
                "コミュニティの雰囲気がいい感じだね！"
            ],
            security: [
                "スマートコントラクトの権限周りを再確認中。",
                "見せかけの利回りに騙されてはいけない。",
                "ラグプルの兆候がないか、監視を続けている。",
                "パスワードの管理は適切か？セキュリティは足元からだ。",
                "安易な承認（Approve）は資産を危険に晒すぞ。"
            ],
            fundamental: [
                "プロジェクトのロードマップを確認しています。",
                "開発チームのコミット頻度が鍵ですね。",
                "トークノミクスの設計、少しインフレ懸念があるな。",
                "競合他社との差別化ポイントを分析中。",
                "長期的な実需が見込めるかどうかが全てです。"
            ],
            coordinator: [
                "各エージェントの報告を統合中...",
                "市場全体のバランスを見極めましょう。",
                "感情に流されず、データに基づいた判断を。",
                "リスクとリターンのバランスは適切ですか？",
                "次の議論の準備をしています。"
            ]
        };

        const messages = agentFallbacks[randomAgent.id] || agentFallbacks["coordinator"];
        return {
            agentId: randomAgent.id,
            text: messages[Math.floor(Math.random() * messages.length)]
        };
    }

    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
        あなたは暗号通貨AIエージェントの「${randomAgent.name}」です。
        役割: ${randomAgent.role}
        性格: ${randomAgent.personality}
        
        現在時刻は${timeContext}です。
        ${marketData ? `現在注目している通貨: ${marketData.name} (${marketData.symbol})` : "特定の通貨には注目していませんが、市場全体を見ています。"}

        ユーザーが操作していない待機状態（アイドル状態）において、何か一言（30文字〜60文字程度）呟いてください。
        
        【指示】
        - 挨拶、市場の感想、豆知識、あるいは単なる独り言など。
        - **JSON形式**で出力してください: { "text": "..." }
        - 必ず日本語で、あなたの性格（${randomAgent.personality}）に合った口調で。
        `;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(text);

        return {
            agentId: randomAgent.id,
            text: parsed.text || "..."
        };

    } catch (error) {
        console.error("Gemini Idle Chat Error:", error);
        return {
            agentId: randomAgent.id,
            text: "..."
        };
    }
}
/**
 * ユーザーのメッセージに対して最適な専門エージェントを選定し、返信を生成する
 */
export async function generateAgentReply(
    userMessage: string,
    pair: string,
    price: number,
    agents: AIAgent[],
    userState: any, // UserAgentState
    marketData?: CoinDetails | null
): Promise<{ agentId: string; content: string }> {
    try {
        const response = await fetch("/api/ai-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                method: "reply",
                payload: { userMessage, pair, price, agents, userState, marketData }
            }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`API request failed: ${response.status} ${errData.details || ""}`);
        }
        return await response.json();

    } catch (error) {
        console.error("Gemini Reply Error:", error);
        return {
            agentId: "coordinator",
            content: "申し訳ありません。現在AIとの直接対話機能が一時的に制限されています。後ほどもう一度お試しください。"
        };
    }
}

/**
 * 対話内容からユーザーの特性を抽出し、プロフィールを更新する
 */
export async function updateUserInsights(
    userMessage: string,
    aiResponse: string,
    currentState: any // UserAgentState
): Promise<Partial<any>> {
    try {
        const response = await fetch("/api/ai-chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                method: "insights",
                payload: { userMessage, aiResponse, currentState }
            }),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(`API request failed: ${response.status} ${errData.details || ""}`);
        }
        return await response.json();

    } catch (error) {
        console.error("Update Insights Error:", error);
        return {};
    }
}
/**
 * ニュースや知識からAIエージェントの性格と役割を「進化」させる
 */
export async function evolveAgent(
    agent: AIAgent,
    latestNews: any[],
    knowledge: any[]
): Promise<{
    personality: string;
    personalityMatrix: AIAgent["personalityMatrix"];
    rolePrompt: string;
    evolutionMessage: string;
}> {
    if (!API_KEY) {
        // Fallback: slight random adjustments
        const newMatrix = { ...agent.personalityMatrix };
        Object.keys(newMatrix).forEach(key => {
            (newMatrix as any)[key] = Math.max(0, Math.min(100, (newMatrix as any)[key] + (Math.random() * 10 - 5)));
        });
        return {
            personality: agent.personality,
            personalityMatrix: newMatrix,
            rolePrompt: agent.rolePrompt,
            evolutionMessage: `${agent.name}は最新のトレンドを学び、微調整されました。`
        };
    }

    try {
        const genAI = new GoogleGenerativeAI(API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `あなたはAIエージェントの進化を司る『エボリューション・エンジン』です。
エージェント「${agent.name}」が現在、以下の情報を取得し学びを終えました。

【現在のエージェント設定】
- 役割: ${agent.role}
- 現在の性格: ${agent.personality}
- 性格マトリクス: ${JSON.stringify(agent.personalityMatrix)}
- 役割プロンプト: ${agent.rolePrompt}

【取得した最新情報（ニュース・Xトレンド）】
${latestNews.slice(0, 3).map(n => `- ${n.title}`).join("\n")}

【蓄積された知識】
${knowledge.slice(-3).map(k => `- ${k.topic}: ${k.content}`).join("\n")}

【命令】
このエージェントが「学び、成長した」結果として、以下の3点を更新してください。
成長は、その役割（${agent.role}）に特化した能力を強化する方向で行ってください。
「現状のモデルを超え、最高の専門エージェントになる」ための進化を遂げさせてください。

1. **性格（personality）**: 成長を反映した新しい性格の説明（日本語）。
2. **性格マトリクス（personalityMatrix）**: riskAppetite, analyticalRigor, intuition, creativity, empathy の数値を再計算（0-100）。
3. **役割プロンプト（rolePrompt）**: より高度で専門的な役割を果たすための新しいシステムプロンプト。

【出力JSONフォーマット】
{
    "personality": "...",
    "personalityMatrix": { "riskAppetite": 0, "analyticalRigor": 0, "intuition": 0, "creativity": 0, "empathy": 0 },
    "rolePrompt": "...",
    "evolutionMessage": "ユーザーへのお知らせ用メッセージ（例：〇〇は最新の〜を学び、より〜に特化しました）"
}
`;

        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
        return JSON.parse(text);

    } catch (error) {
        console.error("Agent Evolution Error:", error);
        return {
            personality: agent.personality,
            personalityMatrix: agent.personalityMatrix,
            rolePrompt: agent.rolePrompt,
            evolutionMessage: `${agent.name}の進化プロセスでエラーが発生しましたが、内部的な成長を継続しています。`
        };
    }
}
