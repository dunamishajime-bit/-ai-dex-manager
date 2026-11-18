import test from "node:test";
import assert from "node:assert/strict";
import { classifyRunnerObservation as classify, createRunnerObservationTracker } from "../lib/runner-observation";
import { LOGIC_ROLES, buildLiveLogicSnapshot } from "../lib/server/current-live-logic-catalog";

const healthy = { serviceState: "RUNNING", heartbeatFresh: true, heartbeatSha: "a", pinSha: "a", safetyState: "PASS" };
const inactive = { holdActive: false };

test("running and blocked are independent", () => assert.deepEqual(classify({ ...healthy, safetyState: "BLOCKED" }, inactive, true), { process: "RUNNING", local: "ATTENTION", protection: "BLOCK_REPORTED" }));
test("one stopped runner does not change another observation", () => {
  assert.equal(classify({ ...healthy, serviceState: "STOPPED" }, inactive, true).local, "FAULT");
  assert.equal(classify(healthy, inactive, true).local, "OBSERVED");
});
test("fresh heartbeat cannot establish trading authority", () => assert.equal(classify(healthy, inactive, true).protection, "AUTHORITY_UNVERIFIED"));
test("shared hold stays visible regardless of process state", () => assert.equal(classify(healthy, { holdActive: true, scope: "GLOBAL" }, true).protection, "SHARED_HOLD_REPORTED"));
test("unknown hold or missing heartbeat never implies authorization", () => {
  assert.equal(classify(healthy, { holdActive: null }, true).protection, "AUTHORITY_UNVERIFIED");
  assert.equal(classify({ ...healthy, heartbeatFresh: false }, inactive, true).local, "UNVERIFIED");
});
test("mismatched evidence is flagged", () => {
  assert.equal(classify({ ...healthy, mismatchReason: "SHA mismatch" }, inactive, true).local, "ATTENTION");
  assert.equal(classify({ ...healthy, heartbeatSha: "b" }, inactive, true).local, "UNVERIFIED");
});
test("infrastructure without heartbeat does not imply observed runner health", () => assert.equal(classify(healthy, inactive, false).local, "UNVERIFIED"));
test("recovery requires three fresh healthy observations and ignores repeats", () => {
  const tracker = createRunnerObservationTracker();
  let state = tracker.observe("IDLE", { sequence: 1, healthy: false });
  assert.equal(state.label, "ATTENTION");
  state = tracker.observe("IDLE", { sequence: 2, healthy: true });
  assert.equal(state.label, "VERIFYING");
  state = tracker.observe("IDLE", { sequence: 2, healthy: true });
  assert.equal(state.label, "UNKNOWN");
  state = tracker.observe("IDLE", { sequence: 3, healthy: true });
  assert.equal(state.label, "VERIFYING");
  state = tracker.observe("IDLE", { sequence: 4, healthy: true });
  assert.equal(state.label, "VERIFYING");
  state = tracker.observe("IDLE", { sequence: 5, healthy: true });
  assert.equal(state.label, "HEALTHY_OBSERVED");
});

test("invalid individual pin leaves all other diagnostic rows available", async () => {
  const sha = "a".repeat(40);
  const ids = Object.keys(LOGIC_ROLES);
  const root = "/home/deploy/disdex-trading/releases/" + sha;
  const pins = Object.fromEntries(ids.map(id => [id, { sha, serviceUnit: "disdex-test-" + id.toLowerCase().replaceAll("_", "-") + "@" + sha + ".service", releaseRoot: root }]));
  delete pins.IDLE_PRIORITY_SHORT;
  const probes: string[] = [];
  const result = await buildLiveLogicSnapshot({
    now: () => 1000000,
    readText: async path => {
      if (path.endsWith("runner-pins.json")) return JSON.stringify({ schema: "disdex-runner-pin-manifest/v1", target: "professional-dismanager.net", runners: pins });
      if (path.endsWith("kill-switch.json")) return JSON.stringify({ active: true, scope: "GLOBAL", action: "HOLD_PROTECTED" });
      return JSON.stringify({ runtimeSha: sha, heartbeatAt: 990000, safetyState: "PASS" });
    },
    showService: async unit => { probes.push(unit); return { stdout: "ActiveState=active\nMainPID=123\nWorkingDirectory=" + root + "\n", stderr: "" }; },
    readProcessCwd: async () => root,
  });
  assert.equal(result.rows.length, ids.length);
  assert.equal(result.rows.find(row => row.id === "IDLE_PRIORITY_SHORT")?.serviceState, "UNVERIFIED");
  assert.equal(result.rows.find(row => row.id === "V12_V4")?.serviceState, "RUNNING");
  assert.equal(probes.length, ids.length - 1);
  assert.equal(result.safety.holdActive, true);
  assert.equal(result.tradingMutation, 0);
});

test("IDLE and Q102 faults remain isolated while healthy runners stay observable", async () => {
  const sha = "b".repeat(40);
  const ids = Object.keys(LOGIC_ROLES);
  const root = "/home/deploy/disdex-trading/releases/" + sha;
  const pins = Object.fromEntries(ids.map(id => [id, {
    sha,
    serviceUnit: "disdex-test-" + id.toLowerCase().replaceAll("_", "-") + "@" + sha + ".service",
    releaseRoot: root,
  }]));
  const result = await buildLiveLogicSnapshot({
    now: () => 1000000,
    observationTracker: createRunnerObservationTracker(),
    readText: async path => {
      if (path.endsWith("runner-pins.json")) return JSON.stringify({ schema: "disdex-runner-pin-manifest/v1", target: "professional-dismanager.net", runners: pins });
      if (path.endsWith("kill-switch.json")) return JSON.stringify({ active: true, scope: "GLOBAL", action: "HOLD_PROTECTED", reason: "fixture" });
      if (path.includes("quality102-causal-v1")) return JSON.stringify({ runtimeSha: "c".repeat(40), heartbeatAt: 995000, safetyState: "PASS" });
      if (path.includes("idle-priority-short")) throw new Error("heartbeat missing");
      return JSON.stringify({ runtimeSha: sha, heartbeatAt: 995000, safetyState: "PASS" });
    },
    showService: async unit => {
      const stopped = unit.includes("quality102-causal-v1") || unit.includes("idle-priority-short");
      return { stdout: (stopped ? "ActiveState=inactive" : "ActiveState=active") + "\nMainPID=123\nWorkingDirectory=" + root + "\n", stderr: "" };
    },
    readProcessCwd: async () => root,
  });
  assert.equal(result.rows.length, ids.length);
  assert.equal(result.rows.find(row => row.id === "V12_V4")?.serviceState, "RUNNING");
  assert.equal(result.rows.find(row => row.id === "QUALITY102_CAUSAL_V1")?.serviceState, "STOPPED");
  assert.equal(result.rows.find(row => row.id === "IDLE_PRIORITY_SHORT")?.heartbeatFresh, false);
  assert.equal(result.rows.find(row => row.id === "FET_BRK48_RESIDUAL")?.serviceState, "RUNNING");
  assert.equal(result.safety.holdActive, true);
  assert.equal(result.tradingMutation, 0);
});

