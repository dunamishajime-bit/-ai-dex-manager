import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getTradeHistory } from "../app/api/system/trade-history/route";
import { createDecisionStatusGet, type DecisionStatusRouteDependencies } from "../lib/server/decision-status-route-handler";
import { assessRuntimeLineage, resolveIndependentV4Sha, type CurrentProductionRuntime } from "../lib/server/current-production-runtime";
import { loadDecisionStatus } from "../lib/server/disdex-decision-status";
import { isHealthyCurrentRuntime, parseProductionRuntimeResponse, productionRuntimeStrategyLabel } from "../lib/ui/production-runtime";
import { livePortfolioFailureState } from "../lib/ui/live-portfolio-state";
import { LatestRequestGate } from "../lib/ui/latest-request";

const releaseSha = "a".repeat(40);
const now = 1_800_000_000_000;

function lineage(overrides: Partial<CurrentProductionRuntime["runtimeLineage"]["units"]["v12"]> = {}): CurrentProductionRuntime["runtimeLineage"] {
  const unit = { runtimeSha: releaseSha, expectedSha: releaseSha, updatedAt: now, matchesCurrent: true, ...overrides };
  return {
    synchronized: true,
    units: { v12: unit, pengu: unit, quality102: unit, v52: unit, fet: unit, hype: unit },
  };
}

test("decision status reads current VPS runtime and refreshes every 30 seconds", async () => {
  const [server, route] = await Promise.all([
    readFile("lib/server/disdex-decision-status.ts", "utf8"),
    readFile("lib/server/decision-status-route-handler.ts", "utf8"),
  ]);
  assert.match(server, /loadCurrentProductionRuntime/);
  assert.match(server, /CACHE_TTL_MS = 25_000/);
  assert.match(server, /runtimeSnapshot\(checkedAt, currentRuntime\)/);
  assert.match(route, /loadV12V4HpObservability/);
  assert.match(route, /v12V4/);
  assert.match(route, /private, no-store, max-age=0/);
});

test("trade history keeps official Aster provenance in the read-only API contract", async () => {
  const [route, history] = await Promise.all([
    readFile("app/api/system/trade-history/route.ts", "utf8"),
    readFile("lib/server/aster-trade-history.ts", "utf8"),
  ]);
  assert.match(route, /historySource/);
  assert.match(route, /officialHistory/);
  assert.match(route, /historyRange: "90d"/);
  assert.match(history, /source: "aster"/);
  assert.match(history, /Aster official fill/);
});

test("runtime lineage fails closed for SHA mismatch, stale, future, and missing heartbeats", () => {
  assert.equal(assessRuntimeLineage(lineage(), now).synchronized, true);
  assert.match(assessRuntimeLineage(lineage({ runtimeSha: "b".repeat(40), matchesCurrent: false }), now).errors.join(" / "), /RUNTIME_SHA_MISMATCH/);
  assert.match(assessRuntimeLineage(lineage({ updatedAt: now - 3 * 60 * 60 * 1000 - 1 }), now).errors.join(" / "), /STALE/);
  assert.match(assessRuntimeLineage(lineage({ updatedAt: now + 1 }), now).errors.join(" / "), /FUTURE/);
  assert.match(assessRuntimeLineage(lineage({ updatedAt: undefined }), now).errors.join(" / "), /MISSING/);
  assert.equal(assessRuntimeLineage(lineage({ error: "ENOENT" }), now).synchronized, false);
});

test("anonymous trade history fails closed before exposing runtime lineage", async () => {
  const response = await getTradeHistory(new NextRequest("http://localhost/api/system/trade-history"));
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.readOnly, true);
  assert.equal(body.tradingMutation, 0);
  assert.equal("runtime" in body, false);
  assert.match(response.headers.get("Cache-Control") || "", /private/);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});

test("authenticated decision status keeps every runtime unit unavailable when current lineage fails", async () => {
  const sha = "a".repeat(40);
  const now = 1_800_000_000_000;
  const failedSnapshot = {
    ok: false,
    readOnly: true,
    refreshIntervalMinutes: 0.5,
    checkedAt: new Date(now).toISOString(),
    source: "VPS runner state / sanitized decision snapshot",
    runtime: {
      checkedAt: new Date(now).toISOString(),
      units: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1", "FET_BRK48_RESIDUAL", "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96"].map((id) => ({
        id,
        label: id,
        status: "UNAVAILABLE" as const,
        releaseSha: "UNAVAILABLE",
        venue: "Production runtime unavailable",
        timeframe: "Production runtime unavailable; needs manual review.",
        entryPolicy: "Production runtime unavailable; needs manual review.",
        protection: "Production runtime unavailable; needs manual review.",
        note: "Manual review required.",
        reason: "CURRENT_RUNTIME_LINEAGE_UNAVAILABLE",
      })),
    },
    v12: { items: [] },
    v52: { marketOpen: true, marketLabel: "US session", items: [] },
    error: "CURRENT_RUNTIME_LINEAGE_UNAVAILABLE",
  } as unknown as Awaited<ReturnType<typeof loadDecisionStatus>>;
  const freshV12 = {
    ok: true,
    readOnly: true,
    tradingMutation: 0,
    capturedAt: new Date(now).toISOString(),
    decisionDetailsAvailable: true,
    decision: {},
    runnerState: { releaseSha: sha, updatedAt: now, mode: "LIVE", killSwitch: { active: false } },
    sharedRisk: null,
    executionTrace: { currentStage: "candidate", currentStageLabel: "candidate", summary: "fresh", nextAction: "none", steps: [] },
    v12Positions: [],
    recentFills: [],
    wiring: { runnerStateConfigured: true, decisionSnapshotConfigured: true },
    errors: [],
    warnings: [],
  };
  const freshV52 = { ok: true, readOnly: true, tradingMutation: 0, configured: true, status: "LIVE", capturedAt: new Date(now).toISOString(), updatedAt: now, killSwitchActive: false, activeV50Slots: 0, v50DailyEntries: 0, positions: [], windows: [], errors: [], reason: "fresh" };
  const freshPengu = { status: "LIVE", configured: true, capturedAt: new Date(now).toISOString(), updatedAt: now, expectedReleaseSha: sha, reason: "fresh", executionTrace: {}, failures: [], resolvedFailures: [] };
  const freshQuality = { ok: true, readOnly: true, tradingMutation: 0, configured: true, status: "LIVE", capturedAt: new Date(now).toISOString(), selectorMode: "CAUSAL_V4", historicalSelectorParity: false, brkLiveEnabled: false, caps: { strategyGrossCap: 0.5, cryptoGrossCap: 2, totalGrossCap: 2.5 }, symbols: [], reason: "fresh", errors: [] };
  const freshV4 = { displayStatus: "LIVE_VERIFIED", actual: {}, timestamps: { checkedAt: now, heartbeatUpdatedAt: now, decisionTs: now, capturedAtMs: now }, freshness: { heartbeat: true, decision: true }, errors: [] };
  const deps = {
    loadDecisionStatus: async () => failedSnapshot,
    loadV12DecisionObservability: async () => freshV12,
    loadV52Top2Observability: async () => freshV52,
    loadPenguRuntimeObservability: async () => freshPengu,
    loadQuality102RuntimeObservability: async () => freshQuality,
    loadV12V4HpObservability: async () => freshV4,
  } as unknown as DecisionStatusRouteDependencies;
  const get = createDecisionStatusGet(deps);
  const response = await get(new NextRequest("http://localhost/api/system/decision-status", { headers: { cookie: "disdex_auth=1" } }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.runtime.units.every((unit: { status: string; reason?: string }) => unit.status === "UNAVAILABLE" && /manual review|unavailable|要確認/i.test(unit.reason || "")), true);
  assert.equal(body.penguRuntime.status, "UNAVAILABLE");
  assert.equal(body.quality102Runtime.status, "UNAVAILABLE");
  assert.equal(body.v52Top2Observability.status, "UNAVAILABLE");
  assert.equal(body.v12Observability.ok, false);
  assert.equal(body.v12Observability.runtimeStatus, "UNAVAILABLE");
  assert.equal(body.v12V4.displayStatus, "UNAVAILABLE");
  assert.match(response.headers.get("Cache-Control") || "", /private/);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
});

function healthyRuntime(): CurrentProductionRuntime {
  const release = "a".repeat(40);
  const unit = { runtimeSha: release, expectedSha: release, updatedAt: now, matchesCurrent: true };
  return {
    ok: true,
    status: "LIVE",
    needsReview: false,
    readOnly: true,
    tradingMutation: 0,
    checkedAt: new Date(now).toISOString(),
    source: "VPS_CURRENT_RUNTIME",
    releaseSha: release,
    productionReleaseShas: { v12: release, pengu: release, quality102: release, v52: release, fet: release, hype: release },
    runtimeLineage: { synchronized: true, units: { v12: unit, pengu: unit, quality102: unit, v52: unit, fet: unit, hype: unit } },
    caps: {
      v12BaseGross: 1,
      v12DynamicGross: 1,
      v12PerPositionGross: 0.5,
      penguGross: 1,
      quality102Gross: 0.5,
      cryptoGross: 2,
      stockGross: 1,
      totalGross: 2.5,
      v52V11Gross: 0.5,
      v52V50Gross: 0.5,
      sharedCryptoDailyLossPct: 3,
      stockDailyLossPct: 2,
    },
    v12: {
      strategyId: "V12_RUNTIME",
      maximumPositions: 2,
      neutralScoreThreshold: 0,
      strongRegimeThresholdPct: 0,
      strongRegimeQualityScoreMinimum: 0,
      strongRegimeQualityScoreMaximum: 1,
      strongRegimeQualityMinimumAtrRatio: 0,
      relaxedRegimeMinimumMomentumPct: 0,
      relaxedRegimeMinimumAtrRatio: 0,
    },
    pengu: {
      strategyId: "PENGU_RUNTIME",
      hardStopCooldownHours: 1,
      recoveryRule: "runtime",
      recoveryPriority: "runtime",
      recoveryInitialGross: 0.5,
      recoveryRsiDelta6Min: 0,
      recoveryEma168DistanceMinPct: 0,
      recoveryBtcReturn6hMinPct: 0,
      recoveryHardStopPct: 0,
      recoveryTrailActivationPct: 0,
      recoveryTrailRetracePct: 0,
      recoveryMaxHoldHours: 1,
      recoveryPartialAfterHours: 1,
      recoveryPartialGross: 0.25,
      longMultiplier: 1,
      lowGross: 0.25,
    },
    quality102: { selectorMode: "CAUSAL_V4", familyGross: { HIGH_VOL: 0.5, MR: 0, BRK: 0, REV: 0, PB: 0 } },
    v52: {
      policyId: "V52_RUNTIME",
      strategy: "V52_RUNTIME",
      maximumHoldingHours: 1,
      minimumEntryBasisBps: 0,
      convergenceBps: 0,
      basisStopMultiple: 1,
      minimumNetEdgeBps: 0,
      maximumRoundTripCostBps: 0,
      maximumSpreadBps: 0,
      slotGross: 0.5,
      stockAggregateGross: 1,
      windowsNy: ["runtime"],
    },
  };
}

test("runtime response rejects needsReview and invalid SHA instead of exposing a live contract", () => {
  const runtime = healthyRuntime();
  assert.equal(isHealthyCurrentRuntime(runtime, now), true);
  assert.equal(productionRuntimeStrategyLabel(runtime, now), "V12_RUNTIME / PENGU_RUNTIME / V52_RUNTIME");
  assert.throws(() => parseProductionRuntimeResponse(true, { ...runtime, needsReview: true }), /manual review/i);
  assert.throws(() => parseProductionRuntimeResponse(true, { ...runtime, releaseSha: "invalid" }), /manual review/i);
  assert.match(productionRuntimeStrategyLabel(null), /未取得|手動確認/);
});

test("malformed runtime payloads fail closed before consumer formatting", () => {
  const runtime = healthyRuntime();
  for (const field of ["caps", "v12", "pengu", "quality102", "v52"] as const) {
    assert.equal(isHealthyCurrentRuntime({ ...runtime, [field]: undefined }, now), false);
  }
  assert.equal(isHealthyCurrentRuntime({ ...runtime, runtimeLineage: { ...runtime.runtimeLineage, units: { ...runtime.runtimeLineage.units, v12: { ...runtime.runtimeLineage.units.v12, updatedAt: 0 } } } }, now), false);
  assert.equal(isHealthyCurrentRuntime({ ...runtime, runtimeLineage: { ...runtime.runtimeLineage, units: { ...runtime.runtimeLineage.units, v12: { ...runtime.runtimeLineage.units.v12, updatedAt: now - (3 * 60 * 60 * 1000 + 1) } } } }, now), false);
  assert.equal(isHealthyCurrentRuntime({ ...runtime, runtimeLineage: { ...runtime.runtimeLineage, units: { ...runtime.runtimeLineage.units, v12: { ...runtime.runtimeLineage.units.v12, updatedAt: now + 1 } } } }, now), false);
  assert.equal(isHealthyCurrentRuntime({ ...runtime, error: "stale" }, now), false);
  assert.equal(isHealthyCurrentRuntime({ ...runtime, runtimeLineage: { ...runtime.runtimeLineage, units: { ...runtime.runtimeLineage.units, v12: { ...runtime.runtimeLineage.units.v12, error: "stale" } } } }, now), false);
  assert.throws(() => parseProductionRuntimeResponse(true, { ...runtime, caps: undefined }), /manual review/i);
  assert.match(productionRuntimeStrategyLabel({ ...runtime, caps: undefined } as unknown as CurrentProductionRuntime), /未取得|手動確認/);
});

test("latest-request-wins prevents stale decision and portfolio completions", () => {
  const decisionGate = new LatestRequestGate();
  const decisionFirst = decisionGate.begin();
  const decisionLatest = decisionGate.begin();
  let decisionSnapshot: string | null = "previous-success";
  if (decisionFirst.isLatest()) decisionSnapshot = "stale-success";
  if (decisionLatest.isLatest()) decisionSnapshot = null;
  assert.equal(decisionSnapshot, null);

  const portfolioGate = new LatestRequestGate();
  const portfolioFirst = portfolioGate.begin();
  const portfolioLatest = portfolioGate.begin();
  let portfolioSnapshot: string | null = "previous-aster";
  if (portfolioFirst.isLatest()) portfolioSnapshot = "stale-success";
  if (portfolioLatest.isLatest()) portfolioSnapshot = null;
  assert.equal(portfolioSnapshot, null);
  assert.equal(decisionFirst.isLatest(), false);
  assert.equal(portfolioFirst.isLatest(), false);
});

test("live portfolio failure clears the prior Aster snapshot", () => {
  const previous = { snapshot: { account: { balanceUsd: 100 } }, error: null };
  const next = livePortfolioFailureState(previous, "503 unavailable");
  assert.equal(next.snapshot, null);
  assert.equal(next.error, "503 unavailable");
});


test("independent V4 is never treated as common-SHA V12 but permits healthy shared release assessment", () => {
  const independentSha = "f".repeat(40);
  const v4 = {
    runtimeSha: independentSha, expectedSha: independentSha, releaseSha: independentSha,
    serviceUnit: `disdex-v12-v4@${independentSha}.service`,
  };
  assert.equal(resolveIndependentV4Sha(v4, releaseSha), independentSha);
  assert.equal(resolveIndependentV4Sha({ ...v4, expectedSha: releaseSha }, releaseSha), null);
  assert.equal(resolveIndependentV4Sha({ ...v4, serviceUnit: "disdex-v12-v4@bad.service" }, releaseSha), null);
  const units = lineage().units;
  const withSeparateV4 = {
    synchronized: false,
    independentV4: true,
    units: {
      ...units,
      v12: { runtimeSha: independentSha, expectedSha: independentSha, matchesCurrent: false, updatedAt: now - 30 * 60 * 60 * 1000 },
    },
  };
  const full = assessRuntimeLineage(withSeparateV4, now);
  assert.equal(full.synchronized, false);
  assert.ok(full.errors.includes("v12:RUNTIME_SHA_MISMATCH"));
  const scoped = assessRuntimeLineage(withSeparateV4, now, ["v12"]);
  assert.equal(scoped.synchronized, true);
  assert.equal(withSeparateV4.units.v12.matchesCurrent, false);
  const stalePeer = { ...withSeparateV4, units: { ...withSeparateV4.units, pengu: { ...units.pengu, updatedAt: now - 30 * 60 * 60 * 1000 } } };
  assert.equal(assessRuntimeLineage(stalePeer, now, ["v12"]).synchronized, false);
});
