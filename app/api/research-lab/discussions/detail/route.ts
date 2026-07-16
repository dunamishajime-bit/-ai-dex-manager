import { NextRequest, NextResponse } from "next/server";

import type { ResearchDiscussionLog } from "@/lib/research-lab/discussion-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAW_BASE = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/research-autonomous-state/.research-state";
const SERVER_CACHE_MS = 60_000;
const DISCUSSION_PATH = /^discussions\/\d{4}\/\d{2}\/\d{2}\/cycle-[A-Za-z0-9_-]+\.json$/;
const cache = new Map<string, { payload: ResearchDiscussionLog; cachedAt: number }>();

function cacheResponse(payload: ResearchDiscussionLog, cacheState: "fresh" | "stale") {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      "X-Research-Cache": cacheState,
    },
  });
}

export async function GET(request: NextRequest) {
  const discussionPath = request.nextUrl.searchParams.get("path") ?? "";
  if (!DISCUSSION_PATH.test(discussionPath)) {
    return NextResponse.json({ error: "Invalid discussion path." }, { status: 400 });
  }

  const cached = cache.get(discussionPath);
  if (cached && Date.now() - cached.cachedAt < SERVER_CACHE_MS) return cacheResponse(cached.payload, "fresh");

  try {
    const response = await fetch(`${RAW_BASE}/${discussionPath}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`discussion fetch failed: ${response.status}`);
    const payload = await response.json() as ResearchDiscussionLog;
    if (!payload || payload.version !== 1 || !Array.isArray(payload.messages)) {
      throw new Error("discussion payload is invalid");
    }
    cache.set(discussionPath, { payload, cachedAt: Date.now() });
    if (cache.size > 30) {
      const oldest = [...cache.entries()].sort((left, right) => left[1].cachedAt - right[1].cachedAt)[0]?.[0];
      if (oldest) cache.delete(oldest);
    }
    return cacheResponse(payload, "fresh");
  } catch (error) {
    if (cached) return cacheResponse(cached.payload, "stale");
    return NextResponse.json(
      { error: "Discussion log could not be loaded.", detail: error instanceof Error ? error.message : String(error) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
