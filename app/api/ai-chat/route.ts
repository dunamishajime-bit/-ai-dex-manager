import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_AGENTS } from "@/lib/ai-agents";

export async function POST(req: Request) {
    const API_KEY = process.env.GEMINI_API_KEY;

    console.log("AI Chat API Call received. API_KEY present:", !!API_KEY);

    if (!API_KEY) {
        console.error("CRITICAL: GEMINI_API_KEY is not defined in environment variables.");
        return NextResponse.json({ error: "Gemini API key is not configured" }, { status: 500 });
    }

    try {
        const { method, payload } = await req.json();
        const genAI = new GoogleGenerativeAI(API_KEY);

        if (method === "reply") {
            const { userMessage, pair, price, userState, marketData, agents } = payload;

            console.log("AI Chat Request:", { method, agentCount: (agents || []).length, userMessage });

            // 1. Route to specialist with fallback
            let agentId;
            const routingPrompt = `
                以下のユーザーメッセージに最も適した担当専門家を1人選んでください:
                - technical (チャート分析、テクニカル指標、価格予想)
                - sentiment (SNSの評判、トレンド、ニュース)
                - security (リスク、詐欺、安全性)
                - fundamental (事業内容、ホワイトペーパー、将来性)
                - coordinator (その他、抽象的な質問、挨拶)

                ユーザーメッセージ: "${userMessage}"
                回答はID（例: technical）のみを返してください。
            `;
            try {
                const routingModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                const routingResult = await routingModel.generateContent(routingPrompt);
                const agentIdResponse = routingResult.response.text().trim().toLowerCase();
                agentId = agentIdResponse.includes("tech") ? "technical" :
                    agentIdResponse.includes("sent") ? "sentiment" :
                        agentIdResponse.includes("sec") ? "security" :
                            agentIdResponse.includes("fund") ? "fundamental" : "coordinator";
            } catch (err) {
                console.warn("Routing model failed, falling back to coordinator", err);
                agentId = "coordinator";
            }

            const selectedAgent = (agents || AI_AGENTS).find((a: any) => a.id === agentId) || AI_AGENTS.find(a => a.id === "coordinator")!;

            console.log("Selected Agent:", selectedAgent.id);

            // 2. Generate Reply with Fallback
            const replyPrompt = `
                あなたはAI評議会の専門家「${selectedAgent.name} (ID: ${selectedAgent.id})」です。
                役割: ${selectedAgent.role}
                性格: ${selectedAgent.personality}
                
                【状況】
                - 対象ペア: ${pair}
                - 現在価格: ¥${price.toLocaleString()}
                - ユーザー名: ${userState.userName}
                - ユーザーの性格: ${userState.traits.personality}
                
                【ユーザーからのメッセージ】
                "${userMessage}"
                
                【指示】
                1. あなたの専門性を活かして日本語で回答してください。
                2. 150文字程度で簡潔かつ有益に答えてください。
                3. 必要に応じて「最新情報をスキャンした結果...」のように、動的にデータを調査したフリをして具体性を高めてください。
            `;

            let replyResult;
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                replyResult = await model.generateContent(replyPrompt);
            } catch (err) {
                console.warn("Primary model failed, retrying...", err);
                const fallbackModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
                replyResult = await fallbackModel.generateContent(replyPrompt);
            }

            return NextResponse.json({
                agentId: selectedAgent.id,
                content: replyResult.response.text().trim()
            });

        } else if (method === "insights") {
            const { userMessage, aiResponse, currentState } = payload;
            const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

            const prompt = `
                ユーザー: "${userMessage}"
                AI: "${aiResponse}"
                現在の特性: ${JSON.stringify(currentState.traits)}
                現在の好み: ${JSON.stringify(currentState.preferences)}

                対話からユーザーの新しい性格、リスク許容度、関心事をJSON形式で抽出してください。
                { "traits": { "personality": "...", "riskTolerance": 1-10, "preferredTimeframe": "..." }, "preferences": { "favoriteCoins": [], "interests": [] } }
            `;

            const result = await model.generateContent(prompt);
            const text = result.response.text().replace(/```json/g, "").replace(/```/g, "").trim();
            return NextResponse.json(JSON.parse(text));
        }

        return NextResponse.json({ error: "Invalid method" }, { status: 400 });

    } catch (error: any) {
        console.error("AI Chat API Error:", error);
        return NextResponse.json({ error: "Internal Server Error", details: error.message }, { status: 500 });
    }
}
