import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET as getTradeHistory } from "../app/api/system/trade-history/route";
import { createDecisionStatusGet, type DecisionStatusRouteDependencies } from "../app/api/system/decision-status/route";
import { assessRuntimeLineage, type CurrentProductionRuntime } from "../lib/server/current-production-runtime";
import { loadDecisionStatus } from "../lib/server/disdex-decision-status";

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
    readFile("app/api/system/decision-status/route.ts", "utf8"),
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
