import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  adaptV12V4DecisionToState,
  loadV12V4LiveSource,
} from "../lib/server/v12-v4-live-source";
import { evaluateV12V4RuntimeBadge } from "../lib/server/v12-runtime-status";

const sha = "a".repeat(40);

test("V12 V4 source is read from its dedicated VPS heartbeat and realtime decision", async () => {
  const root = await mkdtemp(join(process.env.TEMP || process.cwd(), "disdex-v4-source-"));
  const heartbeatPath = join(root, "heartbeat.json");
  const decisionPath = join(root, "realtime-decision.json");
  const now = Date.now();
  try {
    await writeFile(heartbeatPath, JSON.stringify({
      schema: "disdex-v12-v4-runner-heartbeat/v1",
      runnerId: "V12_V4",
      expectedSha: sha,
      runtimeSha: sha,
      mode: "LIVE",
      liveEnabled: true,
      orderPermission: "ALLOWED",
      newOrdersAllowed: true,
      safetyState: "HEALTHY",
      heartbeatAt: now,
      mainPid: 123,
      nRestarts: 0,
      v12v4: { operationMode: "CERTIFIED" },
    }));
    await writeFile(decisionPath, JSON.stringify({
      schema: "v12-v4-live-decision/v1",
      policyId: "V2_M150_D05_CORE_NATIVE",
      decisionTs: now - 60_000,
      updatedAt: now,
      capturedAtMs: now,
      runtimeSha: sha,
      candidateCount: 1,
      filteredCount: 0,
      sourceCount: 1,
      btcRegime: "NEUTRAL",
      observedCandidates: [{ symbol: "ETH", side: "LONG", rank: 1, score: 1.2, signalEligible: true, signalReason: "SIGNAL_ELIGIBLE" }],
      tradingMutation: 0,
    }));

    const source = await loadV12V4LiveSource({ heartbeatPath, decisionPath, now });
    assert.equal(source.available, true);
    assert.equal(source.fresh, true);
    assert.equal(source.runtimeSha, sha);
    assert.equal(source.policyId, "V2_M150_D05_CORE_NATIVE");
    const state = adaptV12V4DecisionToState(source);
    assert.equal(state?.strategyId, "V12_V4");
    assert.equal((state?.candidates as Array<Record<string, unknown>>)[0]?.symbol, "ETH");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("V12 V4 badge requires healthy fresh runtime and matching SHA", () => {
  const now = Date.now();
  const heartbeat = {
    schema: "disdex-v12-v4-runner-heartbeat/v1",
    runnerId: "V12_V4",
    expectedSha: sha,
    runtimeSha: sha,
    mode: "LIVE",
    liveEnabled: true,
    safetyState: "HEALTHY",
    heartbeatAt: now,
    mainPid: 123,
  };
  const decision = { schema: "v12-v4-live-decision/v1", runtimeSha: sha, updatedAt: now, tradingMutation: 0 };
  const good = evaluateV12V4RuntimeBadge({ now, expectedReleaseSha: sha, heartbeat, decision, sharedKill: { active: false } });
  assert.equal(good.status, "LIVE");
  const bad = evaluateV12V4RuntimeBadge({ now, expectedReleaseSha: "b".repeat(40), heartbeat, decision, sharedKill: { active: false } });
  assert.equal(bad.status, "UNCONFIRMED");
});
