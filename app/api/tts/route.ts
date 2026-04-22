import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
    try {
        const { text, voice } = await req.json();

        if (!text || !voice) {
            return NextResponse.json({ error: "Missing text or voice" }, { status: 400 });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error("OPENAI_API_KEY is not defined");
            return NextResponse.json({ error: "OpenAI API Key not configured" }, { status: 500 });
        }

        const response = await fetch("https://api.openai.com/v1/audio/speech", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: "tts-1",
                input: text,
                voice: voice.toLowerCase(), // alloy, echo, fable, onyx, nova, shimmer, coral
            }),
        });

        if (!response.ok) {
            const error = await response.json();
            console.error("OpenAI TTS error:", error);
            return NextResponse.json({ error: "TTS generation failed" }, { status: response.status });
        }

        const arrayBuffer = await response.arrayBuffer();
        return new NextResponse(arrayBuffer, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Length": arrayBuffer.byteLength.toString(),
            },
        });
    } catch (error) {
        console.error("TTS API error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
