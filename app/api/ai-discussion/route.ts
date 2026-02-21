import { NextResponse } from "next/server";
import { generateGeminiDiscussion } from "@/lib/gemini-service";

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
    try {
        const { pair, price, agents } = await req.json();

        if (!pair || !price) {
            return NextResponse.json({ error: "Missing pair or price" }, { status: 400 });
        }

        // Timeout handler to prevent Vercel 10s limit (Serverless function timeout)
        const timeoutPromise = new Promise((resolve) => {
            setTimeout(() => {
                console.warn("Gemini API timed out, falling back to mock.");
                resolve(null);
            }, 8000); // 8 seconds timeout
        });

        // Race between API call and timeout
        const discussion = await Promise.race([
            generateGeminiDiscussion(pair, price, [], agents),
            timeoutPromise
        ]);

        if (!discussion) {
            // Timeout occurred, manually fetch mock
            // Since generateGeminiDiscussion handles missing key by returning mock,
            // we can simulate the mock return here or call a helper.
            // For now, let's just return a generic mock response structure compatible with client.
            return NextResponse.json({
                messages: [
                    { agentId: "coordinator", content: "API応答が遅延しています。デモモードで分析を表示します。" },
                    { agentId: "technical", content: "現在価格周辺でのもみ合いが続いています。RSIは中立付近を示唆。" },
                    { agentId: "sentiment", content: "SNS上での言及数は安定しており、大きなパニック売りは見られません。" },
                    { agentId: "security", content: "コントラクトや流動性に異常な動きは検知されていません。" }
                ],
                result: {
                    action: "HOLD",
                    confidence: 50,
                    reasoning: "APIタイムアウトのため、安全側に倒してHOLDを推奨します。"
                }
            });
        }

        return NextResponse.json(discussion);

    } catch (error) {
        console.error("API Route Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
