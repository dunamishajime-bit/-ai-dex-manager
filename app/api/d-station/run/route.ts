import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const API_VERSION = "openai-run-2026-02-26-1";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function jsonError(e: any, where: string) {
  const payload = {
    ok: false as const,
    apiVersion: API_VERSION,
    where,
    name: e?.name ?? null,
    message: e?.message ?? String(e),
    stack: e?.stack ?? null,
    node: process.version,
    hasKey: !!process.env.OPENAI_API_KEY,
  };

  console.error("[/api/d-station/run] ERROR", payload);
  return NextResponse.json(payload, { status: 500 });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    apiVersion: API_VERSION,
    node: process.version,
    hasKey: !!process.env.OPENAI_API_KEY,
  });
}

export async function POST(req: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY missing");
    }

    const raw = await req.text();
    let body: any = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {}
    }

    const model = body?.model || "gpt-4.1-mini";
    const input = body?.input || "ping";

    const r = await client.responses.create({
      model,
      input,
    });

    return NextResponse.json({
      ok: true,
      apiVersion: API_VERSION,
      responseId: r.id,
      outputText: (r as any).output_text ?? null,
    });

  } catch (e: any) {
    return jsonError(e, "POST");
  }
}