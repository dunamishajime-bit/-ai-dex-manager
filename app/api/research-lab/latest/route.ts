import { NextResponse } from "next/server";

import type {
  ResearchCycleHistoryPoint,
  ResearchDashboardPayload,
  ResearchEliteSummary,
} from "@/lib/research-lab/dashboard-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPOSITORY = "dunamishajime-bit/-ai-dex-manager";
const STATE_BRANCH = "research-autonomous-state";
const RAW_BASE = `https://raw.githubusercontent.com/${REPOSITORY}/${STATE_BRANCH}/.research-state`;
const GITHUB_BASE = `https://github.com/${REPOSITORY}`;
const SERVER_CACHE_MS = 60_000;

let cachedPayload: ResearchDashboardPayload | null = null;
let cachedAt = 0;

interface RawAutonomousState {
  cycle?: unknown;
  nextProfile?: unknown;
  consecutiveNoCandidate?: unknown;
  bestTrainMonthlyPct?: unknown;
  bestOosMonthlyPct?: unknown;
  bestScore?: unknown;
  eliteGenomes?: unknown;
  nextPlan?: unknown;
  lastRunAt?: unknown;
  history?: unknown;
}

interface RawDeduplicationStats {
  duplicateStrategiesSkipped?: unknown;
  replacementCandidatesGenerated?: unknown;
  exhaustedPopulationSlots?: unknown;
  historicalFingerprintsLoaded?: unknown;
  newUniqueLogicTested?: unknown;
  totalUniqueLogic?: unknown;
}

function finiteNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nullableFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function profile(value: unknown): "attack" | "balanced" {
  return value === "balanced" ? "balanced" : "attack";
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeHistory(value: unknown): ResearchCycleHistoryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const cycle = finiteNumber(item.cycle, -1);
    const completedAt = stringValue(item.completedAt);
    if (cycle < 0 || !completedAt) return [];
    return [{
      cycle,
      completedAt,
      profile: profile(item.profile),
      evaluations: finiteNumber(item.evaluations),
      validated: finiteNumber(item.validated),
      finalCandidates: finiteNumber(item.finalCandidates),
      bestTrainMonthlyPct: finiteNumber(item.bestTrainMonthlyPct),
      bestOosMonthlyPct: nullableFiniteNumber(item.bestOosMonthlyPct),
      bestOosDrawdownPct: nullableFiniteNumber(item.bestOosDrawdownPct),
      bestWorstStressMonthlyPct: nullableFiniteNumber(item.bestWorstStressMonthlyPct),
    }];
  }).sort((left, right) => left.cycle - right.cycle).slice(-30);
}

function normalizeElites(value: unknown): ResearchEliteSummary[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const item = entry as Record<string, unknown>;
    const parameters = item.parameters && typeof item.parameters === "object"
      ? item.parameters as Record<string, unknown>
      : {};
    const id = stringValue(item.id);
    if (!id) return [];
    return [{
      id,
      family: stringValue(item.family, "unknown"),
      thesis: stringValue(item.thesis),
      symbols: stringArray(item.symbols),
      timeframeHours: finiteNumber(parameters.timeframeHours),
      leverage: finiteNumber(parameters.leverage),
      riskPerTradePct: finiteNumber(parameters.riskPerTradePct),
      maxMarginUsagePct: finiteNumber(parameters.maxMarginUsagePct),
      minimumEdgeToCostRatio: finiteNumber(parameters.minimumEdgeToCostRatio),
      allowLong: parameters.allowLong === true,
      allowShort: parameters.allowShort === true,
      allowNeutralRegime: parameters.allowNeutralRegime === true,
    }];
  }).slice(0, 8);
}

async function fetchJson<T>(name: string): Promise<T> {
  const response = await fetch(`${RAW_BASE}/${name}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${name} fetch failed: ${response.status}`);
  return response.json() as Promise<T>;
}

function freshness(lastRunAt: string | null): ResearchDashboardPayload["freshness"] {
  if (!lastRunAt) return "unknown";
  const ageMs = Date.now() - Date.parse(lastRunAt);
  if (!Number.isFinite(ageMs)) return "unknown";
  if (ageMs <= 2 * 60 * 60 * 1000) return "fresh";
  if (ageMs <= 4 * 60 * 60 * 1000) return "delayed";
  return "stale";
}

function response(payload: ResearchDashboardPayload, cacheState: "fresh" | "stale") {
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      "X-Research-Cache": cacheState,
    },
  });
}

export async function GET() {
  if (cachedPayload && Date.now() - cachedAt < SERVER_CACHE_MS) {
    return response(cachedPayload, "fresh");
  }

  try {
    const [state, deduplication] = await Promise.all([
      fetchJson<RawAutonomousState>("autonomous-state.json"),
      fetchJson<RawDeduplicationStats>("deduplication-stats.json")
        .catch((): RawDeduplicationStats => ({})),
    ]);
    const history = normalizeHistory(state.history);
    const lastRunAt = typeof state.lastRunAt === "string" ? state.lastRunAt : history.at(-1)?.completedAt ?? null;
    const payload: ResearchDashboardPayload = {
      generatedAt: new Date().toISOString(),
      lastRunAt,
      freshness: freshness(lastRunAt),
      cycle: finiteNumber(state.cycle),
      nextProfile: profile(state.nextProfile),
      consecutiveNoCandidate: finiteNumber(state.consecutiveNoCandidate),
      bestEver: {
        trainMonthlyPct: nullableFiniteNumber(state.bestTrainMonthlyPct),
        oosMonthlyPct: nullableFiniteNumber(state.bestOosMonthlyPct),
        score: nullableFiniteNumber(state.bestScore),
      },
      latest: history.at(-1) ?? null,
      history,
      elites: normalizeElites(state.eliteGenomes),
      nextPlan: stringArray(state.nextPlan),
      deduplication: {
        historicalFingerprintsLoaded: finiteNumber(deduplication.historicalFingerprintsLoaded),
        newUniqueLogicTested: finiteNumber(deduplication.newUniqueLogicTested),
        duplicateStrategiesSkipped: finiteNumber(deduplication.duplicateStrategiesSkipped),
        replacementCandidatesGenerated: finiteNumber(deduplication.replacementCandidatesGenerated),
        exhaustedPopulationSlots: finiteNumber(deduplication.exhaustedPopulationSlots),
        totalUniqueLogic: finiteNumber(deduplication.totalUniqueLogic),
      },
      targets: {
        oosMonthlyPct: 30,
        stressMonthlyPct: 20,
      },
      links: {
        actions: `${GITHUB_BASE}/actions/workflows/research-lab-autonomous.yml`,
        latestReport: `${GITHUB_BASE}/blob/${STATE_BRANCH}/.research-state/latest-report.md`,
        state: `${GITHUB_BASE}/tree/${STATE_BRANCH}/.research-state`,
        issues: `${GITHUB_BASE}/issues`,
      },
    };

    cachedPayload = payload;
    cachedAt = Date.now();
    return response(payload, "fresh");
  } catch (error) {
    if (cachedPayload) {
      return response({ ...cachedPayload, freshness: "stale" }, "stale");
    }
    return NextResponse.json(
      {
        error: "Research state could not be loaded.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
