import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-5.2",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Say hello in one sentence." },
        ],
        temperature: 0.2,
      }),
    });

    const data = await res.json();

    return NextResponse.json({
      ok: true,
      output: data.choices?.[0]?.message?.content ?? "No output",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "error" },
      { status: 500 }
    );
  }
}