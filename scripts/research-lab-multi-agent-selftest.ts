import assert from "node:assert/strict";

import type { MainStrategySnapshotReplayArtifact } from "../lib/research-lab/perp/main-strategy-snapshot-replay";
import { WIN80_ULTRA90_MAIN_STRATEGY } from "../lib/win80-ultra90-main-strategy";
import { buildMultiAgentResearchCycle } from "../lib/research-lab/perp/multi-agent-research-pipeline";

const events = Array.from({ length: 40 }, (_value, index) => {
  const isUltra = index % 4 === 0;
  const isWin = !isUltra && index % 2 === 0;
  const positive = index % 5 !== 0;
  const returnPct = positive ? (isUltra ? 2.4 : 1.2) : -1.4;
  return {
    snapshotTs: Date.UTC(2025, 0, 1) + index * 6 * 60 * 60 * 1_000,
    snapshotIso: new Date(Date.UTC(2025, 0, 1) + index * 6 * 60 * 60 * 1_000).toISOString(),
    symbol: isUltra ? "ETH" : isWin ? "BNB" : "SOL",
    tier: isUltra ? "ULTRA90" : "WIN80",
    score: isUltra ? 94 : isWin ? 84 : 80,
    confidencePct: isUltra ? 95 : isWin ? 86 : 80,
    triggerState: "Triggered",
    triggerProgressPct: isUltra ? 92 : isWin ? 86 : 76,
    rr: isUltra ? 1.7 : isWin ? 1.35 : 1.18,
    volumeRatio: isUltra ? 1.1 : isWin ? 0.9 : 0.72,
    entryTs: Date.UTC(2025, 0, 1) + index * 6 * 60 * 60 * 1_000,
    entryPrice: 100,
    forward24hPct: returnPct / 2,
    forward72hPct: returnPct,
    forward168hPct: returnPct * 1.2,
    stress72hPct: positive ? returnPct - 0.4 : returnPct - 0.8,
    funding72hPct: 0.02,
    mfe72hPct: Math.max(returnPct, 0) + 1,
    mae72hPct: Math.min(returnPct, 0) - 1,
    snapshotFingerprint: `event-${String(index).padStart(4, "0")}`,
  };
});

const artifact = {
  version: 1,
  datasetId: "MULTI_AGENT_SELFTEST_V1",
  strategyId: WIN80_ULTRA90_MAIN_STRATEGY.id,
  generatedAt: "2026-07-17T00:00:00.000Z",
  source: "synthetic",
  period: {
    startTs: events[0].snapshotTs,
    endTs: events.at(-1)?.snapshotTs ?? events[0].snapshotTs,
    startIso: events[0].snapshotIso,
    endIso: events.at(-1)?.snapshotIso ?? events[0].snapshotIso,
  },
  symbols: ["BNB", "ETH", "SOL"],
  intervalHours: 6,
  warmupHours: 48,
  snapshotCount: 40,
  selectedSignalCount: 40,
  noSignalSnapshotCount: 0,
  incompleteOutcomeCount: 0,
  costs: { feeBpsPerSide: 6, slippageBpsPerSide: 4, stressSlippageBpsPerSide: 12 },
  metrics: {} as never,
  signalCountsBySymbol: { BNB: 16, ETH: 10, SOL: 14 },
  limitations: [],
  fingerprint: "a".repeat(64),
  events,
} as MainStrategySnapshotReplayArtifact;

const result = buildMultiAgentResearchCycle({
  artifact,
  cycle: 1,
  startedAt: "2026-07-17T01:00:00.000Z",
  startSequence: 1,
});

assert.equal(result.report.parentStrategyId, WIN80_ULTRA90_MAIN_STRATEGY.id);
assert.equal(result.report.protocol.futureOutcomeUsedAsFilter, false);
assert.equal(result.report.automaticPromotionToMain, false);
assert.equal(result.report.proposals.length, 4);
assert.equal(result.messages.length, 7);
assert.ok(result.messages.some((item) => item.role === "win80_specialist"));
assert.ok(result.messages.some((item) => item.role === "ultra90_specialist"));
assert.ok(result.messages.some((item) => item.role === "synthesis"));
assert.ok(result.messages.some((item) => item.role === "independent_critic"));
assert.ok(result.messages.some((item) => item.role === "cio"));
assert.ok(result.report.proposals.every((item) => item.evidenceFingerprint.length === 64));
console.log("MULTI_AGENT_RESEARCH_PIPELINE_SELFTEST_OK");

