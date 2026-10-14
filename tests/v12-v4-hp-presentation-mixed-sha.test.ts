import assert from "node:assert/strict";
import test from "node:test";
import { buildV12V4HpPresentation } from "../lib/v12-v4-hp-ui";
import type { V12V4HpSnapshot } from "../lib/v12-v4-hp-contract";

const PEER = "e8cc2e73f8d3981d708ee52f013241597c038b10";
const V4 = "6f97d2cf03877674ec1a845f6c08414f32899f36";

function snapshot(): V12V4HpSnapshot {
  return {
    schema: "v12-v4-hp-status/v1",
    target: { policyId: "V2_M150_D05_CORE_NATIVE", expectedRouteCount: 41 },
    displayStatus: "LIVE_VERIFIED",
    actual: {
      currentReleaseSha: PEER,
      activeRunnerId: `disdex-v12-v4@${V4}.service`,
      activeRunnerState: "active/running",
      activeRunnerSha: V4,
      v4RunnerMode: "CERTIFIED",
      v12PrimaryMode: "V4",
      legacyV12RunnerActive: false,
      v4ReleaseSha: V4,
      heartbeatSha: V4,
      orderEnabled: false,
    },
    timestamps: { checkedAt: 1000, heartbeatUpdatedAt: 1000, decisionTs: null, capturedAtMs: null },
    freshness: { heartbeat: true, decision: false },
    candidates: [],
    filtered: [],
    routeCoverage: {
      expected: 41, observed: 0, candidateCount: 0, filteredCount: 0,
      unobserved: [], completeness: false,
      semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE",
    },
    errors: [], readOnly: true, tradingMutation: 0,
  };
}

test("home accepts independently certified V4 SHA instead of demanding peer SHA equality", () => {
  const view = buildV12V4HpPresentation(snapshot());
  assert.equal(view.runtimeStatus, "LIVE_VERIFIED");
  assert.equal(view.runtimeLabel, "LIVE確認済み");
  assert.equal(view.isLiveVerified, true);
  assert.doesNotMatch(view.runtimeLabel, /発注不可/);
});

test("home still accepts legacy same-SHA production when every V4 identity agrees", () => {
  const s = snapshot();
  s.actual.currentReleaseSha = V4;
  const view = buildV12V4HpPresentation(s);
  assert.equal(view.runtimeStatus, "LIVE_VERIFIED");
  assert.equal(view.isLiveVerified, true);
});

test("V4 runner, heartbeat or service identity mismatch fails closed even if upstream reports LIVE", () => {
  for (const mutate of [
    (s:V12V4HpSnapshot)=>{s.actual.heartbeatSha=PEER;},
    (s:V12V4HpSnapshot)=>{s.actual.v4ReleaseSha=PEER;},
    (s:V12V4HpSnapshot)=>{s.actual.activeRunnerId=`disdex-v12-v4@${PEER}.service`;},
    (s:V12V4HpSnapshot)=>{s.actual.activeRunnerState="inactive";},
    (s:V12V4HpSnapshot)=>{s.actual.currentReleaseSha=null;},
    (s:V12V4HpSnapshot)=>{s.actual.v4RunnerMode="CANARY";},
    (s:V12V4HpSnapshot)=>{s.actual.v12PrimaryMode="LEGACY";},
    (s:V12V4HpSnapshot)=>{s.actual.legacyV12RunnerActive=true;},
    (s:V12V4HpSnapshot)=>{s.freshness.heartbeat=false;},
    (s:V12V4HpSnapshot)=>{s.readOnly=false as true;},
  ]) {
    const s=snapshot(); mutate(s);
    const view=buildV12V4HpPresentation(s);
    assert.equal(view.runtimeStatus, "SHA_MISMATCH");
    assert.equal(view.isLiveVerified, false);
    assert.doesNotMatch(view.runtimeLabel, /発注不可/);
  }
});

test("when observation fails, home says LIVE unverified rather than claiming trading is blocked", () => {
  const s=snapshot();
  for (const status of ["SHA_MISMATCH","STALE","SOURCE_ERROR","SHADOW"] as const) {
    s.displayStatus=status;
    const view=buildV12V4HpPresentation(s);
    assert.equal(view.runtimeStatus,status);
    assert.equal(view.isLiveVerified,false);
    assert.doesNotMatch(view.runtimeLabel,/発注不可/);
  }
});
