import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { createV12V4HpStatusGet } from "../lib/server/v12-v4-hp-status-handler";
import type { V12V4HpSnapshot } from "../lib/v12-v4-hp-contract";
import { isV12RuntimeFresh } from "../app/api/system/decision-status/route";

const snapshot = {
  schema: "v12-v4-hp-status/v1",
  target: { policyId: "V2_M150_D05_CORE_NATIVE", expectedRouteCount: 41 },
  displayStatus: "UNAVAILABLE",
  actual: { currentReleaseSha: null, activeRunnerId: null, activeRunnerState: "unavailable", activeRunnerSha: null, v4RunnerMode: "UNKNOWN", v12PrimaryMode: "UNKNOWN", legacyV12RunnerActive: null, v4ReleaseSha: null, heartbeatSha: null, orderEnabled: null },
  timestamps: { checkedAt: 1, heartbeatUpdatedAt: null, decisionTs: null, capturedAtMs: null },
  freshness: { heartbeat: false, decision: false },
  candidates: [],
  filtered: [],
  routeCoverage: { expected: 41, observed: 0, candidateCount: null, filteredCount: null, unobserved: [], completeness: false, semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE" },
  errors: ["V4_DECISION_PATH_UNCONFIGURED"],
  readOnly: true,
  tradingMutation: 0,
} as const satisfies V12V4HpSnapshot;

test("V4 HP status route requires auth and never calls the loader anonymously", async () => {
  let calls = 0;
  const get = createV12V4HpStatusGet(async () => { calls += 1; return snapshot; });
  const response = await get(new NextRequest("http://localhost/api/system/v12-v4-hp-status"));
  assert.equal(response.status, 401);
  assert.match(response.headers.get("Cache-Control") || "", /private/);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  assert.equal(calls, 0);
});

test("authenticated V4 response is private, read-only, and exposes unavailable source truth", async () => {
  const get = createV12V4HpStatusGet(async () => snapshot);
  const request = new NextRequest("http://localhost/api/system/v12-v4-hp-status", { headers: { cookie: "disdex_auth=1" } });
  const response = await get(request);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control") || "", /private/);
  assert.match(response.headers.get("Cache-Control") || "", /no-store/);
  assert.equal(body.readOnly, true);
  assert.equal(body.tradingMutation, 0);
  assert.equal(body.displayStatus, "UNAVAILABLE");
});

test("loader exception returns 503 and remains fail closed", async () => {
  const get = createV12V4HpStatusGet(async () => { throw new Error("source unavailable"); });
  const request = new NextRequest("http://localhost/api/system/v12-v4-hp-status", { headers: { cookie: "disdex_auth=1" } });
  const response = await get(request);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.readOnly, true);
  assert.equal(body.tradingMutation, 0);
  assert.equal(body.error, "V4_HP_STATUS_UNAVAILABLE");
});

test("legacy V12 cannot become LIVE without a current matching runtime SHA", () => {
  const sha = "a".repeat(40);
  const now = 1_800_000_000_000;
  const runtime = {
    ok: true,
    status: "LIVE" as const,
    releaseSha: sha,
    runtimeLineage: {
      synchronized: true,
      units: { v12: { runtimeSha: sha, matchesCurrent: true, updatedAt: now } },
    },
  };
  const base = { runtime, runnerState: { releaseSha: sha, updatedAt: now, mode: "LIVE", killSwitch: { active: false } }, now };
  assert.equal(isV12RuntimeFresh(base), true);
  assert.equal(isV12RuntimeFresh({ ...base, runnerState: { ...base.runnerState, releaseSha: undefined } }), false);
  assert.equal(isV12RuntimeFresh({ ...base, runnerState: { ...base.runnerState, releaseSha: "b".repeat(40) } }), false);
  assert.equal(isV12RuntimeFresh({ ...base, runtime: { ...runtime, runtimeLineage: { ...runtime.runtimeLineage, synchronized: false } } }), false);
  assert.equal(isV12RuntimeFresh({ ...base, runnerState: { ...base.runnerState, updatedAt: now + 1 } }), false);
});
