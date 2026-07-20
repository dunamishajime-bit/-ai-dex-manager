import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    lastRunAt: null,
    freshness: "unknown",
    cycle: 0,
    nextProfile: "balanced",
    consecutiveNoCandidate: 0,
    bestEver: { trainMonthlyPct: null, oosMonthlyPct: null, score: null },
    latest: null,
    history: [],
    elites: [],
    nextPlan: ["次回のV35＋PENGU V46決済完了イベントを待機中"],
    latestDiscussion: null,
    deepResearch: null,
    deduplication: { historicalFingerprintsLoaded: 0, newUniqueLogicTested: 0, duplicateStrategiesSkipped: 0, replacementCandidatesGenerated: 0 },
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
