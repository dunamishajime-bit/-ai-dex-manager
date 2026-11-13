import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { assessPinnedHypeTick } =
  require("../lib/server/hype-pinned-tick-observability.ts") as typeof import("../lib/server/hype-pinned-tick-observability");

const SHA = "d6bcc94512a6416189cd92d7203b9ac3b2c98e70";
const OLD = "7688ed7c93a1918d8b44837339b7da5584a868f5";
const NOW = 1794057777000;
const ROOT = "/home/deploy/disdex-trading/releases/" + SHA;
const UNIT = "disdex-hype-long@" + SHA + ".service";
const SERVICE = {
  activeState: "active", subState: "running", mainPid: 159977,
  workingDirectory: ROOT, processCwd: ROOT,
};
function data() {
  return {
    tick: {
      schema: "disdex-runner-tick/v1",
      runnerId: "HYPE_TREND_LONG", runtimeSha: SHA, expectedSha: SHA,
      serviceUnit: UNIT, workingDirectory: ROOT, mainPid: 159977,
      tickStartedAt: NOW - 840_000 - 3000,
      tickCompletedAt: NOW - 840_000,
      newOrdersAllowed: false,
    },
    state: {
      schema: "disdex-hype-zec-long/v1", runtimeCommitSha: SHA,
      mode: "LIVE", updatedAt: NOW - 840_000 - 3,
      failures: [{ message: "historic recovery", occurredAt: NOW - 2 * 86400000 }],
    },
    heartbeat: {
      schema: "disdex-runner-heartbeat/v1", runtimeSha: OLD,
      expectedSha: OLD, safetyState: "BLOCKED", mainPid: 0,
    },
  };
}
function assess(t = data(), service = SERVICE, now = NOW) {
  return assessPinnedHypeTick(SHA, t.tick, t.state, service, SHA, t.heartbeat, now);
}
test("real pinned HYPE tick + process + state is observed without enabling orders", () => {
  const result = assess();
  assert.equal(result.matchesCurrent, true);
  assert.equal(result.runtimeSha, SHA);
  assert.equal(result.mainPid, 159977);
  assert.equal(result.liveEnabled, false);
  assert.equal(result.safetyState, "UNVERIFIED");
  assert.match(result.healthReason || "", /旧heartbeatは別SHA/);
  assert.match(result.healthReason || "", /新規発注許可はfalse/);
});
test("legacy heartbeat is not reused to certify current runner", () => {
  const d = data();
  d.heartbeat.runtimeSha = SHA;
  d.heartbeat.safetyState = "BLOCKED";
  const result = assess(d);
  assert.equal(result.safetyState, "BLOCKED");
  assert.equal(result.liveEnabled, false);
});
test("mismatched tick SHA must not be accepted", () => {
  const d = data(); d.tick.runtimeSha = OLD;
  const result = assess(d);
  assert.equal(result.matchesCurrent, false);
  assert.equal(result.error, "HYPE_PIN_TICK_IDENTITY_MISMATCH");
});
test("mismatched process PID or CWD must not be accepted", () => {
  const result = assess(data(), { ...SERVICE, mainPid: 159978 });
  assert.equal(result.matchesCurrent, false);
  assert.equal(result.error, "HYPE_PIN_PROCESS_IDENTITY_MISMATCH");
});
test("mismatched state SHA must not be accepted", () => {
  const d = data(); d.state.runtimeCommitSha = OLD;
  const result = assess(d);
  assert.equal(result.matchesCurrent, false);
  assert.equal(result.error, "HYPE_PIN_STATE_IDENTITY_MISMATCH");
});
test("stale and future tick evidence is never treated as current", () => {
  const stale = assess(data(), SERVICE, NOW + 36 * 60000);
  assert.equal(stale.matchesCurrent, false);
  assert.equal(stale.safetyState, "STALE");
  const future = assess(data(), SERVICE, NOW - 30 * 60000);
  assert.equal(future.matchesCurrent, false);
  assert.equal(future.error, "HYPE_PIN_TICK_TIMESTAMP_INVALID");
});
test("active pending work is not certified by the display-only observer", () => {
  const d = data(); Object.assign(d.state, { pending: { action: "ENTRY" } });
  const result = assess(d);
  assert.equal(result.matchesCurrent, true);
  assert.equal(result.safetyState, "REVIEW_REQUIRED");
  assert.equal(result.liveEnabled, false);
});

test("inactive pinned HYPE surfaces stopped manual-review reason, not an unknown status", () => {
  const d = data();
  Object.assign(d.state, { manualReview: "HYPE_ZEC_RUNNER_FAIL_CLOSED:UNKNOWN_JOURNAL_EVENT" });
  const result = assess(d, {
    ...SERVICE, activeState: "inactive", subState: "dead", mainPid: 0, processCwd: "",
  });
  assert.equal(result.safetyState, "STOPPED");
  assert.equal(result.error, "HYPE_PIN_SERVICE_STOPPED_MANUAL_REVIEW");
  assert.equal(result.liveEnabled, false);
  assert.equal(result.matchesCurrent, false);
  assert.equal(result.mainPid, 0);
  assert.match(result.healthReason || "", /UNKNOWN_JOURNAL_EVENT/);
});
test("stopped HYPE with mismatched pin remains an identity error", () => {
  const d = data(); d.tick.expectedSha = OLD;
  const result = assess(d, {
    ...SERVICE, activeState: "inactive", subState: "dead", mainPid: 0, processCwd: "",
  });
  assert.equal(result.error, "HYPE_PIN_TICK_IDENTITY_MISMATCH");
  assert.notEqual(result.safetyState, "STOPPED");
});
