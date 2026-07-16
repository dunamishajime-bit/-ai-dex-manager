import { NextResponse } from "next/server";

import type {
  ResearchDiscussionIndex,
  ResearchDiscussionIndexEntry,
  ResearchDiscussionListPayload,
} from "@/lib/research-lab/discussion-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RAW_INDEX = "https://raw.githubusercontent.com/dunamishajime-bit/-ai-dex-manager/research-autonomous-state/.research-state/discussions/index.json";
const SERVER_CACHE_MS = 60_000;

let cachedPayload: ResearchDiscussionListPayload | null = null;
let cachedAt = 0;

function finiteOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeEntry(value: unknown): ResearchDiscussionIndexEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || typeof item.path !== "string" || typeof item.completedAt !== "string") return null;
  return {
    id: item.id,
    path: item.path,
    cycle: typeof item.cycle === "number" && Number.isFinite(item.cycle) ? item.cycle : 0,
    completedAt: item.completedAt,
    profile: item.profile === "balanced" ? "balanced" : "attack",
    title: typeof item.title === "string" ? item.title : "研究会議",
    summary: typeof item.summary === "string" ? item.summary : "",
    decision: typeof item.decision === "string" ? item.decision : "",
    messageCount: typeof item.messageCount === "number" && Number.isFinite(item.messageCount) ? item.messageCount : 0,
    finalCandidates: typeof item.finalCandidates === "number" && Number.isFinite(item.finalCandidates) ? item.finalCandidates : 0,
    bestOosMonthlyPct: finiteOrNull(item.bestOosMonthlyPct),
    bestOosDrawdownPct: finiteOrNull(item.bestOosDrawdownPct),
    bestWorstStressMonthlyPct: finiteOrNull(item.bestWorstStressMonthlyPct),
    topStrategyIds: Array.isArray(item.topStrategyIds)
      ? item.topStrategyIds.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function response(payload: ResearchDiscussionListPayload, cacheState: "fresh" | "stale") {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      "X-Research-Cache": cacheState,
    },
  });
}

export async function GET() {
  if (cachedPayload && Date.now() - cachedAt < SERVER_CACHE_MS) return response(cachedPayload, "fresh");

  try {
    const request = await fetch(RAW_INDEX, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (request.status === 404) {
      const empty: ResearchDiscussionListPayload = { generatedAt: new Date().toISOString(), items: [], latest: null };
      cachedPayload = empty;
      cachedAt = Date.now();
      return response(empty, "fresh");
    }
    if (!request.ok) throw new Error(`discussion index fetch failed: ${request.status}`);
    const raw = await request.json() as Partial<ResearchDiscussionIndex>;
    const items = (Array.isArray(raw.items) ? raw.items : [])
      .map(normalizeEntry)
      .filter((item): item is ResearchDiscussionIndexEntry => item != null)
      .sort((left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt));
    const payload: ResearchDiscussionListPayload = {
      generatedAt: new Date().toISOString(),
      items,
      latest: items[0] ?? null,
    };
    cachedPayload = payload;
    cachedAt = Date.now();
    return response(payload, "fresh");
  } catch (error) {
    if (cachedPayload) return response(cachedPayload, "stale");
    return NextResponse.json(
      { error: "Discussion index could not be loaded.", detail: error instanceof Error ? error.message : String(error) },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
