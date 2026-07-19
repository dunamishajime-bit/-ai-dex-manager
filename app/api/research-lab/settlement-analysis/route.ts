import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PATH = "/home/deploy/ai-dex-manager-v46-live/.runtime-state/disdex-v46-live/settlement-analysis.json";

export async function GET() {
  const filePath = process.env.DISDEX_V46_SETTLEMENT_ANALYSIS_PATH || DEFAULT_PATH;
  try {
    const raw = JSON.parse(await fs.readFile(path.resolve(filePath), "utf8")) as { updatedAt?: string; items?: unknown[] };
    const items = Array.isArray(raw.items) ? raw.items : [];
    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      trigger: "post-settlement-event",
      updatedAt: raw.updatedAt || null,
      latest: items.at(-1) || null,
      items: items.slice(-50).reverse(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code === "ENOENT") {
      return NextResponse.json({ generatedAt: new Date().toISOString(), trigger: "post-settlement-event", updatedAt: null, latest: null, items: [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
    }
    return NextResponse.json({ error: "決済後分析を読み込めませんでした。" }, { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
