import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { loadDecisionStatus } from "@/lib/server/disdex-decision-status";
import { loadV12DecisionObservability } from "@/lib/server/v12-decision-observability";

const referenceTs = 1_789_416_000_000;
const blockedDecision = {
  schema: "v12-decision-observation/v1",
  strategyId: "V12_X1.00_ALL",
  observedAt: "2026-09-14T21:44:39.087Z",
  selectedAt: "2026-09-14T21:44:39.087Z",
  referenceTs,
  entryTs: referenceTs,
  regime: "LONG",
  btcRegime: "LONG",
  reason: "NO_COMPLETED_BAR_SIGNAL",
  candidates: [
    { symbol: "BTC", side: "LONG", rank: 1, score: 0.5786, momentum: 0.02585, volatility: 0.00358, atr: 369.54, volumeRatio: 2.0448, signalEligible: false, signalReason: "BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED" },
    { symbol: "XRP", side: "LONG", rank: 2, score: 0.4537, momentum: 0.0879, volatility: 0.00909, atr: 0.0138, volumeRatio: 4.2914, signalEligible: false, signalReason: "BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED" },
  ],
};
async function withFixture(run: () => Promise<void>, decision: Record<string, unknown> = blockedDecision) {
  const dir = await mkdtemp(join(tmpdir(), "v12-ui-gate-"));
  const decisionPath = join(dir, "decision.json");
  const runnerPath = join(dir, "runner.json");
  const riskPath = join(dir, "risk.json");
  const v52Path = join(dir, "v52.json");
  await writeFile(decisionPath, JSON.stringify(decision));
  await writeFile(runnerPath, JSON.stringify({ strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: referenceTs + 1_000, lastReferenceTs: referenceTs, activePositions: [] }));
  await writeFile(riskPath, JSON.stringify({ tripped: false, lossPct: 0, maximumLossPct: 20, updatedAt: referenceTs + 1_000 }));
  await writeFile(v52Path, JSON.stringify({ updatedAt: referenceTs + 1_000 }));
  const previous = { ...process.env };
  Object.assign(process.env, { V12_DECISION_SNAPSHOT_PATH: decisionPath, V12_X1_ALL_STATE_PATH: runnerPath, DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH: riskPath, V52_ASTER_ONLY_STATE_PATH: v52Path });
  try { await run(); } finally { process.env = previous; await rm(dir, { recursive: true, force: true }); }
}

test("V12 detail trusts runner signalEligible=false instead of reconstructing a pass", async () => withFixture(async () => {
  const details = await loadV12DecisionObservability();
  const btc = details.decision?.candidates.find((candidate) => candidate.symbol === "BTC");
  assert.equal(btc?.signalGate?.status, "blocked");
  assert.equal(btc?.signalGate?.code, "BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED");
  assert.equal(details.executionTrace.steps.find((step) => step.key === "regime")?.state, "blocked");
  assert.equal(details.executionTrace.steps.find((step) => step.key === "risk")?.state, "pending");
  assert.equal(details.executionTrace.steps.find((step) => step.key === "position")?.state, "pending");
}));
test("V12 supplementary ranking never upgrades a runner-blocked Top2 candidate", async () => withFixture(async () => {
  const snapshot = await loadDecisionStatus({ force: true });
  const btc = snapshot.v12.items.find((item) => item.symbol === "BTC");
  const xrp = snapshot.v12.items.find((item) => item.symbol === "XRP");
  assert.equal(btc?.status, "条件不足");
  assert.equal(xrp?.status, "条件不足");
  assert.match(btc?.reason || "", /BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED/);
  assert.match(xrp?.reason || "", /BTC_REGIME_OR_ENTRY_QUALITY_BLOCKED/);
}));

test("V12 selected signal uses the matching runner candidate gate, not Rank1 gate", async () => {
  const decision = {
    ...blockedDecision,
    reason: "SIGNAL_AVAILABLE",
    symbol: "XRP",
    side: "LONG",
    rank: 2,
    score: 1.12,
    momentum: 0.0879,
    volumeRatio: 4.2914,
    candidates: [
      { ...blockedDecision.candidates[0] },
      { ...blockedDecision.candidates[1], score: 1.12, signalEligible: true, signalReason: "SIGNAL_ELIGIBLE" },
    ],
  };
  await withFixture(async () => {
    const details = await loadV12DecisionObservability();
    assert.equal(details.decision?.symbol, "XRP");
    assert.equal(details.decision?.signalGate?.status, "pass");
    assert.equal(details.decision?.signalGate?.code, "SIGNAL_ELIGIBLE");
  }, decision);
});

test("V12 missing runner gate stays unknown instead of being inferred from Rank or metrics", async () => {
  const decision = {
    ...blockedDecision,
    candidates: blockedDecision.candidates.map(({ signalEligible: _eligible, signalReason: _reason, ...candidate }) => candidate),
  };
  await withFixture(async () => {
    const details = await loadV12DecisionObservability();
    assert.equal(details.decision?.candidates[0]?.signalGate?.status, "unknown");
    assert.equal(details.decision?.candidates[0]?.signalGate?.code, "RUNNER_SIGNAL_GATE_UNAVAILABLE");
    assert.equal(details.executionTrace.steps.find((step) => step.key === "regime")?.state, "unknown");
    const snapshot = await loadDecisionStatus({ force: true });
    assert.equal(snapshot.v12.items.find((item) => item.symbol === "BTC")?.status, "取得不能");
  }, decision);
});

test("V12 UI does not present a fake fixed score maximum or recompute runner gates", async () => {
  const panel = await readFile(join(process.cwd(), "components/features/DecisionStatusPanel.tsx"), "utf8");
  const observability = await readFile(join(process.cwd(), "lib/server/v12-decision-observability.ts"), "utf8");
  const page = await readFile(join(process.cwd(), "app/decision-status/page.tsx"), "utf8");
  assert.doesNotMatch(panel, /item\.score\}\/\{item\.scoreMax/);
  assert.doesNotMatch(observability, /diagnoseSignalGate|V12_SIGNAL_POLICY/);
  assert.match(observability, /signalEligible/);
  assert.match(observability, /signalReason/);
  assert.match(page, /Runner.*signalEligible.*signalReason/);
});
