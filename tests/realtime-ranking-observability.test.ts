import { test } from "node:test";
import assert from "node:assert/strict";

import { V12_V4_HP_ROUTE_IDS, V12_V4_HP_TARGET, type V12V4HpSnapshot } from "@/lib/v12-v4-hp-contract";
import { mergeV12V4RealtimeRows, v12V4SnapshotToRankRows } from "@/lib/server/realtime-ranking-observability";
import { normalizeQuality102SymbolItems } from "@/lib/server/quality102-symbol-observability";
import { topRankedSymbols, type RankRow } from "@/lib/realtime-ranking";

const now = Date.UTC(2026, 9, 12, 4, 0, 0);
const routeA = V12_V4_HP_ROUTE_IDS[0];
const routeB = V12_V4_HP_ROUTE_IDS[1];

function snapshot(overrides: Partial<V12V4HpSnapshot> = {}): V12V4HpSnapshot {
  return {
    schema: "v12-v4-hp-status/v1",
    target: V12_V4_HP_TARGET,
    displayStatus: "STAGED_NOT_LIVE",
    actual: {
      currentReleaseSha: "a".repeat(40),
      activeRunnerId: "disdex-v12-v4-canary@" + "a".repeat(40) + ".service",
      activeRunnerState: "active/running",
      activeRunnerSha: "a".repeat(40),
      v4RunnerMode: "CANARY",
      v12PrimaryMode: "LEGACY",
      legacyV12RunnerActive: true,
      v4ReleaseSha: "a".repeat(40),
      heartbeatSha: "a".repeat(40),
      orderEnabled: false,
    },
    timestamps: { checkedAt: now, heartbeatUpdatedAt: now, decisionTs: now, capturedAtMs: now },
    freshness: { heartbeat: true, decision: true },
    candidates: [{
      symbol: "BTCUSDT", route: routeA, family: "CORE", side: "SHORT", eligibleEntryTs: now,
      sourceRank: 1, rankingEligible: false, rankingExclusion: "RESEARCH_PRIORITY_NOT_LIVE_RANK",
      score: null, scoreKind: "UNAVAILABLE", scoreLabel: "V4 decision source has no verified native score",
      features: { momentumPct: 2.5, atrRatio: 1.4 },
    }],
    filtered: [{ symbol: "ETHUSDT", route: routeB, side: "LONG", eligibleEntryTs: now, reason: "FILTERED_BY_CAUSAL_GATE" }],
    routeCoverage: {
      expected: 41, observed: 2, candidateCount: 1, filteredCount: 1,
      unobserved: [...V12_V4_HP_ROUTE_IDS.slice(2)], completeness: false,
      semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE",
    },
    errors: [],
    readOnly: true,
    tradingMutation: 0,
    ...overrides,
  };
}

function otherRow(): RankRow {
  return {
    id: "PENGU:PENGUUSDT:SHORT", symbol: "PENGUUSDT", logic: "PENGU", side: "SHORT",
    score: 75, scoreKind: "GATE_COMPLETION", scoreLabel: "Gate充足度（Signal Gateの充足割合）",
    gates: [], reason: "preserve", fresh: true, checkedAt: now, rankingScope: "PENGU",
    rankingEligible: false, rankingContractAvailable: false,
  };
}

test("V4 emitted candidates and filtered rows stay visible with route/features and no fabricated native score", () => {
  const rows = v12V4SnapshotToRankRows(snapshot(), now);
  assert.equal(rows.length, 2);
  const candidate = rows.find((row) => row.symbol === "BTCUSDT");
  assert.ok(candidate);
  assert.equal(candidate.logic, "V12_V4");
  assert.equal(candidate.sourceRoute, routeA);
  assert.deepEqual(candidate.sourceFeatures, { momentumPct: 2.5, atrRatio: 1.4 });
  assert.equal(candidate.sourceRank, 1);
  assert.equal(candidate.rankingEligible, false);
  assert.equal(candidate.score, null);
  assert.equal(candidate.scoreKind, "UNAVAILABLE");
  assert.equal(candidate.gates.some((gate) => gate.key.startsWith("feature:")), false);
  assert.match(candidate.reason, /RESEARCH_PRIORITY_NOT_LIVE_RANK/);

  const filtered = rows.find((row) => row.symbol === "ETHUSDT");
  assert.ok(filtered);
  assert.equal(filtered.sourceRoute, routeB);
  assert.equal(filtered.score, null);
  assert.match(filtered.reason, /FILTERED_BY_CAUSAL_GATE/);
  assert.equal(filtered.sourceStatus, "FRESH");
});

test("V4 mapping replaces legacy V12 rows and leaves non-V12 rows untouched", () => {
  const legacy: RankRow = { ...otherRow(), id: "V12:BTC:LONG", symbol: "BTCUSDT", logic: "V12" };
  const pengu = otherRow();
  const merged = mergeV12V4RealtimeRows([legacy, pengu], snapshot(), now);
  assert.equal(merged.some((row) => row.logic === "V12"), false);
  assert.equal(merged.some((row) => row.logic === "V12_V4" && row.symbol === "BTCUSDT"), true);
  assert.equal(merged.find((row) => row.logic === "PENGU"), pengu);
});

test("stale and failed V4 decision sources are represented explicitly, never as NO_SIGNAL or zero", () => {
  const staleSnapshot = snapshot({ freshness: { heartbeat: true, decision: false } });
  const staleRows = v12V4SnapshotToRankRows(staleSnapshot, now);
  assert.ok(staleRows.length > 0);
  assert.ok(staleRows.every((row) => row.sourceStatus === "STALE" && !row.fresh && row.score === null));
  assert.ok(staleRows.every((row) => row.gates.every((gate) => gate.key !== "signal" || gate.state === "UNKNOWN")));
  assert.deepEqual(topRankedSymbols(staleRows, "V12_V4").map((slot) => slot.status), ["STALE", "STALE", "STALE"]);

  const errorSnapshot = snapshot({ candidates: [], filtered: [], freshness: { heartbeat: false, decision: false }, errors: ["V4_DECISION_SOURCE:ENOENT"] });
  const errorRows = v12V4SnapshotToRankRows(errorSnapshot, now);
  assert.equal(errorRows.length, 1);
  assert.equal(errorRows[0].sourceStatus, "SOURCE_ERROR");
  assert.equal(errorRows[0].score, null);
  assert.equal(errorRows[0].symbol, "—");
  assert.equal(errorRows[0].gates.some((gate) => gate.state === "NO" && gate.key === "signal"), false);
  assert.deepEqual(topRankedSymbols(errorRows, "V12_V4").map((slot) => slot.status), ["SOURCE_ERROR", "SOURCE_ERROR", "SOURCE_ERROR"]);
});

test("empty but fresh V4 batch is an explicit no-candidate wait state, not a manufactured no-signal row", () => {
  const empty = snapshot({ candidates: [], filtered: [], routeCoverage: { ...snapshot().routeCoverage, candidateCount: 0, filteredCount: 0, observed: 0 } });
  const [row] = v12V4SnapshotToRankRows(empty, now);
  assert.equal(row.sourceStatus, "NOT_EVALUATED");
  assert.equal(row.fresh, true);
  assert.equal(row.score, null);
  assert.match(row.reason, /NO_NATIVE_ENTRY_CANDIDATES/);
  assert.deepEqual(topRankedSymbols([row], "V12_V4").map((slot) => slot.status), ["NO_CANDIDATE", "NO_CANDIDATE", "NO_CANDIDATE"]);
});

test("Q102 score normalization preserves numeric zero but does not turn null or absent values into zero", () => {
  const rows = normalizeQuality102SymbolItems([
    { symbol: "BTCUSDT", side: "WAIT", rankingScore: 0, rankingRank: 1 },
    { symbol: "ETHUSDT", side: "WAIT", rankingScore: null, rankingRank: null },
    { symbol: "SOLUSDT", side: "WAIT" },
    { symbol: "XRPUSDT", side: "WAIT", rankingScore: true, rankingRank: false },
  ]);
  assert.equal(rows[0].rankingScore, 0);
  assert.equal(rows[0].rankingRank, 1);
  assert.equal("rankingScore" in rows[1], false);
  assert.equal("rankingRank" in rows[1], false);
  assert.equal("rankingScore" in rows[2], false);
  assert.equal("rankingScore" in rows[3], false);
  assert.equal("rankingRank" in rows[3], false);
});
