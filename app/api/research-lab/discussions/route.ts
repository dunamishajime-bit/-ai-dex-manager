import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const stateDir = path.resolve(process.env.RESEARCH_AUTONOMOUS_STATE_DIR ?? ".research-state");

export async function GET() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(stateDir, "discussions", "index.json"), "utf8")) as { items?: unknown[] };
    const items = Array.isArray(raw.items) ? raw.items : [];
    return NextResponse.json({ generatedAt: new Date().toISOString(), items, latest: items[0] || null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") return NextResponse.json({ generatedAt: new Date().toISOString(), items: [], latest: null }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    return NextResponse.json({ error: "研究議論ログを読み込めませんでした。" }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
