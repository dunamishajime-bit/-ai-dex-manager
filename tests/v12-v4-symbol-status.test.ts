import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { v12V4SymbolDisplayRows } from "../lib/v12-v4-symbol-status";
import { V12_V4_HP_TARGET, type V12V4HpSnapshot } from "../lib/v12-v4-hp-contract";

const SHA = "e8cc2e73f8d3981d708ee52f013241597c038b10";
const NOW = 1_791_960_000_000;
function sampleSnapshot(decisionFresh = false): V12V4HpSnapshot {
  return {
    schema: "v12-v4-hp-status/v1", target: V12_V4_HP_TARGET,
    displayStatus: "LIVE_VERIFIED",
    actual: {
      currentReleaseSha: SHA, activeRunnerId: "disdex-v12-v4@" + SHA + ".service",
      activeRunnerState: "active/running", activeRunnerSha: SHA,
      v4RunnerMode: "CERTIFIED", v12PrimaryMode: "V4",
      legacyV12RunnerActive: false, v4ReleaseSha: SHA,
      heartbeatSha: SHA, orderEnabled: false,
    },
    timestamps: { checkedAt: NOW, heartbeatUpdatedAt: NOW, decisionTs: decisionFresh ? NOW : null, capturedAtMs: null },
    freshness: { heartbeat: true, decision: decisionFresh },
    candidates: [], filtered: [],
    routeCoverage: {
      expected: 41, observed: 0, candidateCount: null, filteredCount: null, unobserved: [],
      completeness: false, semantics: "EMITTED_ROUTE_PRESENCE_ONLY_NOT_EVALUATION_COVERAGE",
    },
    errors: [], readOnly: true, tradingMutation: 0,
  };
}

test("all 14 V12 V4 symbols stay visible without native decision output", () => {
  const rows = v12V4SymbolDisplayRows(sampleSnapshot(), null, NOW);
  assert.equal(rows.length, 14);
  assert.equal(rows.find((row) => row.symbol === "ETHUSDT")?.state, "SOURCE_UNAVAILABLE");
  assert.equal(rows.find((row) => row.symbol === "ETHUSDT")?.side, null);
  assert.equal(rows.find((row) => row.symbol === "ETHUSDT")?.marketScore, null);
  assert.ok(rows.every((row) => row.routes.length === 0 && row.state !== "FILTERED"));
});

test("market-only scores do not fabricate native V4 Gate results", () => {
  const rows = v12V4SymbolDisplayRows(sampleSnapshot(), {
    readOnly: true, tradingMutation: 0, runtimeSha: SHA,
    rows: [{
      logic: "MARKET", symbol: "ETHUSDT", checkedAt: NOW, fresh: true,
      scoreKind: "MARKET", score: 87.25,
      sourceFeatures: { volumeRatio: 1.17, return6hPct: 2.8, atrPct: 1.6 },
    }],
  }, NOW);
  const eth = rows.find((row) => row.symbol === "ETHUSDT");
  assert.equal(eth?.state, "SOURCE_UNAVAILABLE");
  assert.equal(eth?.side, null);
  assert.equal(eth?.marketScore, 87.25);
  assert.equal(eth?.marketFeatures.volumeRatio, 1.17);
});

test("only fresh V4-native emitted candidates or filters acquire verdict and direction", () => {
  const snapshot = sampleSnapshot(true);
  snapshot.candidates.push({
    symbol: "ETHUSDT", route: "REC_G1_MID_REL_LOWVOL",
    family: "REC_G1", side: "LONG", eligibleEntryTs: NOW, sourceRank: 1,
    rankingEligible: false, rankingExclusion: "RESEARCH_PRIORITY_NOT_LIVE_RANK",
    score: null, scoreKind: "UNAVAILABLE",
    scoreLabel: "V4 decision source has no verified native score", features: {},
  });
  snapshot.filtered.push({
    symbol: "SOLUSDT", route: "REC_G2_EARLY_BTC_OPPOSE_VOL",
    side: "SHORT", eligibleEntryTs: NOW, reason: "FEATURE_VOL_REJECTED",
  });
  const rows = v12V4SymbolDisplayRows(snapshot, null, NOW);
  assert.equal(rows.find((row) => row.symbol === "ETHUSDT")?.state, "CANDIDATE");
  assert.equal(rows.find((row) => row.symbol === "ETHUSDT")?.side, "LONG");
  assert.equal(rows.find((row) => row.symbol === "SOLUSDT")?.state, "FILTERED");
  assert.equal(rows.find((row) => row.symbol === "SOLUSDT")?.filteredReasons[0], "FEATURE_VOL_REJECTED");
  assert.equal(rows.find((row) => row.symbol === "BTCUSDT")?.state, "NO_EMISSION");
});

test("stale decision evidence and unrelated trading runtime market data cannot appear as current", () => {
  const snapshot = sampleSnapshot(false);
  snapshot.candidates.push({
    symbol: "ETHUSDT", route: "REC_G1_MID_REL_LOWVOL", family: "REC_G1", side: "LONG",
    eligibleEntryTs: NOW, sourceRank: 1, rankingEligible: false,
    rankingExclusion: "RESEARCH_PRIORITY_NOT_LIVE_RANK", score: null,
    scoreKind: "UNAVAILABLE", scoreLabel: "V4 decision source has no verified native score",
    features: {},
  });
  const rows = v12V4SymbolDisplayRows(snapshot, {
    readOnly: true, tradingMutation: 0,
    runtimeSha: "f53d98d955a31a98145da1a3c02d373ec4f97e7c",
    rows: [{ logic: "MARKET", symbol: "ETHUSDT", checkedAt: NOW, fresh: true, scoreKind: "MARKET", score: 99 }],
  }, NOW);
  assert.equal(rows.find((row) => row.symbol === "ETHUSDT")?.state, "SOURCE_UNAVAILABLE");
  assert.equal(rows.find((row) => row.symbol === "ETHUSDT")?.marketScore, null);
});

test("V4 page includes all-symbol observer; obsolete legacy warning needs active V4 attestation to disappear", () => {
  const page = readFileSync("app/decision-status/v12/page.tsx", "utf8");
  const panel = readFileSync("components/features/DecisionStatusPanel.tsx", "utf8");
  assert.match(page, /V12V4SymbolStatusPanel/);
  assert.match(panel, /legacyV12RunnerActive === false/);
  assert.match(panel, /v4\?\.displayStatus === "LIVE_VERIFIED"/);
  assert.match(panel, /filter\(\(unit\) => unit\.id !== "V12_X1\.00_ALL"\)/);
});
