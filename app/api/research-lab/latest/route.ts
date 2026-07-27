import { NextResponse } from "next/server";

import type {
  ChampionDeepDashboardSummary,
  ChampionDashboardItem,
  ChampionExperimentDashboardItem,
  ResearchCycleHistoryPoint,
  ResearchDashboardPayload,
  ResearchEliteSummary,
} from "@/lib/research-lab/dashboard-types";
import type { ResearchDiscussionIndex, ResearchDiscussionIndexEntry } from "@/lib/research-lab/discussion-types";

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

interface RawChampionDeepState {
  cycle?: unknown;
  updatedAt?: unknown;
  champions?: unknown;
  latestExperiments?: unknown;
  nextPlan?: unknown;
  researchFocus?: unknown;
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

function championSlot(value: unknown): "oos" | "stress" | "stability" {
  if (value === "stress" || value === "stability") return value;
  return "oos";
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

function normalizeDiscussionEntry(value: unknown): ResearchDiscussionIndexEntry | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const id = stringValue(item.id);
  const discussionPath = stringValue(item.path);
  const completedAt = stringValue(item.completedAt);
  if (!id || !discussionPath || !completedAt) return null;
  return {
    id,
    path: discussionPath,
    cycle: finiteNumber(item.cycle),
    completedAt,
    profile: profile(item.profile),
    title: stringValue(item.title, `Cycle ${finiteNumber(item.cycle)} 研究会議`),
    summary: stringValue(item.summary),
    decision: stringValue(item.decision),
    messageCount: finiteNumber(item.messageCount),
    finalCandidates: finiteNumber(item.finalCandidates),
    bestOosMonthlyPct: nullableFiniteNumber(item.bestOosMonthlyPct),
    bestOosDrawdownPct: nullableFiniteNumber(item.bestOosDrawdownPct),
    bestWorstStressMonthlyPct: nullableFiniteNumber(item.bestWorstStressMonthlyPct),
    topStrategyIds: stringArray(item.topStrategyIds),
  };
}

function normalizeChampion(value: unknown): ChampionDashboardItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const genome = item.genome && typeof item.genome === "object" ? item.genome as Record<string, unknown> : {};
  const metrics = item.metrics && typeof item.metrics === "object" ? item.metrics as Record<string, unknown> : {};
  const id = stringValue(genome.id);
  if (!id) return null;
  return {
    slot: championSlot(item.slot),
    id,
    family: stringValue(genome.family, "unknown"),
    rootCauses: stringArray(item.rootCauses),
    noImprovementCycles: finiteNumber(item.noImprovementCycles),
    metrics: {
      trainMonthlyPct: finiteNumber(metrics.trainMonthlyPct, -100),
      oosMonthlyPct: finiteNumber(metrics.oosMonthlyPct, -100),
      oosMaxDrawdownPct: finiteNumber(metrics.oosMaxDrawdownPct, 100),
      worstStressMonthlyPct: finiteNumber(metrics.worstStressMonthlyPct, -100),
      walkForwardPassRatePct: finiteNumber(metrics.walkForwardPassRatePct),
      oosTrades: finiteNumber(metrics.oosTrades),
      profitFactor: finiteNumber(metrics.profitFactor),
      liquidationCount: finiteNumber(metrics.liquidationCount),
    },
  };
}

function normalizeExperiment(value: unknown): ChampionExperimentDashboardItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const plan = item.plan && typeof item.plan === "object" ? item.plan as Record<string, unknown> : {};
  const comparison = item.comparison && typeof item.comparison === "object" ? item.comparison as Record<string, unknown> : {};
  const id = stringValue(plan.id);
  if (!id) return null;
  return {
    id,
    championSlot: championSlot(plan.championSlot),
    parentStrategyId: stringValue(plan.parentStrategyId),
    childStrategyId: stringValue(plan.childStrategyId),
    hypothesis: stringValue(plan.hypothesis),
    changedParameter: stringValue(plan.changedParameter),
    beforeValue: String(plan.beforeValue ?? ""),
    afterValue: String(plan.afterValue ?? ""),
    accepted: item.accepted === true,
    deltaOosMonthlyPct: finiteNumber(comparison.deltaOosMonthlyPct),
    deltaWorstStressMonthlyPct: finiteNumber(comparison.deltaWorstStressMonthlyPct),
    deltaDrawdownImprovementPct: finiteNumber(comparison.deltaDrawdownImprovementPct),
    compositeImprovement: finiteNumber(comparison.compositeImprovement),
    reasons: stringArray(item.reasons),
  };
}

function normalizeResearchFocus(value: unknown): ChampionDeepDashboardSummary["researchFocus"] {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (item.mode !== "win80_ultra90_lineage") return null;
  return {
    mode: "win80_ultra90_lineage",
    title: stringValue(item.title, "Win80 / Ultra90 Main-Lineage Research"),
    mainStrategyId: stringValue(item.mainStrategyId, "DISDEX_V35_STRONG_RESERVED_PENGU_V96"),
    mainStrategyLocked: item.mainStrategyLocked === true,
    autoPromotionToMain: item.autoPromotionToMain === true,
    productionLogicMutable: item.productionLogicMutable === true,
    researchTracks: stringArray(item.researchTracks),
    guardrails: stringArray(item.guardrails),
  };
}

function normalizeDeepResearch(value: RawChampionDeepState | null): ChampionDeepDashboardSummary | null {
  if (!value) return null;
  const champions = (Array.isArray(value.champions) ? value.champions : [])
    .map(normalizeChampion)
    .filter((item): item is ChampionDashboardItem => item != null);
  const experiments = (Array.isArray(value.latestExperiments) ? value.latestExperiments : [])
    .map(normalizeExperiment)
    .filter((item): item is ChampionExperimentDashboardItem => item != null);
  if (!champions.length && !experiments.length) return null;
  const researchFocus = normalizeResearchFocus(value.researchFocus);
  return {
    mode: researchFocus?.mode ?? "champion_deep",
    cycle: finiteNumber(value.cycle),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null,
    championCount: champions.length,
    experimentCount: experiments.length,
    acceptedExperiments: experiments.filter((item) => item.accepted).length,
    champions,
    experiments,
    nextPlan: stringArray(value.nextPlan),
    researchFocus,
  };
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
  if (ageMs <= 5 * 60 * 60 * 1000) return "fresh";
  if (ageMs <= 8 * 60 * 60 * 1000) return "delayed";
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
    const [state, deduplication, discussionIndex, deepState] = await Promise.all([
      fetchJson<RawAutonomousState>("autonomous-state.json"),
      fetchJson<RawDeduplicationStats>("deduplication-stats.json")
        .catch((): RawDeduplicationStats => ({})),
      fetchJson<ResearchDiscussionIndex>("discussions/index.json")
        .catch((): ResearchDiscussionIndex => ({ version: 1, updatedAt: new Date(0).toISOString(), items: [] })),
      fetchJson<RawChampionDeepState>("champion-deep-state.json").catch((): RawChampionDeepState | null => null),
    ]);
    const history = normalizeHistory(state.history);
    const lastRunAt = typeof state.lastRunAt === "string" ? state.lastRunAt : history.at(-1)?.completedAt ?? null;
    const latestDiscussion = normalizeDiscussionEntry(discussionIndex.items?.find((item) => {
      const ids = Array.isArray(item?.topStrategyIds) ? item.topStrategyIds.map(String) : [];
      return ids.includes("DISDEX_V35_STRONG_RESERVED_PENGU_V96") || ids.includes("DISDEX_V35_CORE_PLUS_PENGU_DUAL_V46");
    }));
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
      latestDiscussion,
      deepResearch: normalizeDeepResearch(deepState),
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
        latestDiscussion: `${GITHUB_BASE}/blob/${STATE_BRANCH}/.research-state/latest-discussion.md`,
        discussions: "/research-lab/discussions",
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
