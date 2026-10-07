import { NextRequest, NextResponse } from "next/server";

const SUPPORTED_VOICES = new Set([
    "alloy", "ash", "ballad", "coral", "echo", "fable", "nova",
    "onyx", "sage", "shimmer", "verse", "marin", "cedar",
]);

const NATURAL_JA_INSTRUCTIONS = [
    "Speak in natural conversational Japanese, like a calm professional market commentator.",
    "Avoid a robotic cadence, monotone delivery, and exaggerated announcer style.",
    "Use subtle human-like intonation, short natural pauses at punctuation, and gentle emphasis on rank changes, numbers, and gate names.",
    "Keep the pace slightly relaxed but responsive. Pronounce alphanumeric asset and strategy names clearly.",
    "Do not add, remove, paraphrase, or translate any words from the provided input.",
].join(" ");

async function requestSpeech(apiKey: string, model: string, input: string, voice: string) {
    return fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model,
            input,
            voice,
            instructions: NATURAL_JA_INSTRUCTIONS,
            response_format: "mp3",
            speed: 0.97,
        }),
    });
}

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        const requestedVoice = typeof body?.voice === "string" ? body.voice.toLowerCase() : "marin";
        const voice = SUPPORTED_VOICES.has(requestedVoice) ? requestedVoice : "marin";

        if (!text || text.length > 900) {
            return NextResponse.json({ error: "Invalid text" }, { status: 400 });
        }

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
            console.error("OPENAI_API_KEY is not defined");
            return NextResponse.json({ error: "OpenAI API Key not configured" }, { status: 503 });
        }

        const preferredModel = process.env.DISDEX_TTS_MODEL || "gpt-realtime-2.1-mini";
        let response = await requestSpeech(apiKey, preferredModel, text, voice);
        let modelUsed = preferredModel;

        // Keep the natural-voice upgrade available even if the account/endpoint
        // has not yet enabled the recommended realtime replacement.
        if (!response.ok && preferredModel !== "gpt-4o-mini-tts") {
            console.warn("Primary TTS model unavailable; retrying speech model fallback", response.status);
            response = await requestSpeech(apiKey, "gpt-4o-mini-tts", text, voice);
            modelUsed = "gpt-4o-mini-tts";
        }

        if (!response.ok) {
            const errorText = await response.text();
            console.error("OpenAI TTS error", response.status, errorText.slice(0, 300));
            return NextResponse.json({ error: "TTS generation failed" }, { status: response.status });
        }

        const arrayBuffer = await response.arrayBuffer();
        return new NextResponse(arrayBuffer, {
            headers: {
                "Content-Type": "audio/mpeg",
                "Content-Length": arrayBuffer.byteLength.toString(),
                "Cache-Control": "private, no-store",
                "X-DisDex-TTS-Model": modelUsed,
                "X-DisDex-TTS-Voice": voice,
                "X-DisDex-Audio-Disclosure": "AI-generated",
            },
        });
    } catch (error) {
        console.error("TTS API error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
