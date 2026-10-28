import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildRealtimeRankingPanels,
  rankingFeedbackRows,
  scoreKindLabel,
  v4NoCandidatePanelState,
} from "../lib/realtime-ranking-ui";
import type { RankRow } from "../lib/realtime-ranking";

const now = Date.UTC(2026, 9, 12, 4);

function row(overrides: Partial<RankRow> & Pick<RankRow, "id" | "logic" | "symbol">): RankRow {
  return {
    side: "LONG",
    score: null,
    scoreKind: "UNAVAILABLE",
    scoreLabel: "native unavailable",
    gates: [],
    reason: "observed",
    fresh: true,
    checkedAt: now,
    ...overrides,
  };
}

test("ALL view exposes one shared-market Top-3 and does not mix native strategy scores", () => {
  const rows=[
    row({ id:"market-btc",logic:"MARKET",symbol:"BTCUSDT",score:82.75,scoreKind:"MARKET",scoreLabel:"Aster共通市場Score",rankingScope:"MARKET",sourceRank:1,rankingEligible:true,rankingContractAvailable:true }),
    row({ id:"market-eth",logic:"MARKET",symbol:"ETHUSDT",score:74.25,scoreKind:"MARKET",scoreLabel:"Aster共通市場Score",rankingScope:"MARKET",sourceRank:2,rankingEligible:true,rankingContractAvailable:true }),
    row({ id:"q1",logic:"Q102",symbol:"BTCUSDT",score:99,scoreKind:"NATIVE",rankingScope:"Q102",sourceRank:1,rankingEligible:true,rankingContractAvailable:true }),
  ];
  const panels=buildRealtimeRankingPanels(rows,"ALL");
  assert.deepEqual(panels.map(panel=>panel.scope),["MARKET"]);
  assert.deepEqual(panels[0].slots.map(slot=>slot.symbol),["BTCUSDT","ETHUSDT",undefined]);
  assert.equal(panels[0].slots.length,3);
  assert.match(scoreKindLabel(rows[0]),/Aster共通市場Score/);
});

test("selected logic gets three scoped slots, deduplicated by symbol, retaining blocked candidate and placeholder", () => {
  const blocked = row({ id: "q-btc-a", logic: "Q102", symbol: "BTCUSDT", score: 12, scoreKind: "NATIVE", scoreLabel: "Q102 model units", rankingScope: "Q102", sourceRank: 1, rankingEligible: true, rankingContractAvailable: true, gates: [{ key: "held", label: "保有", state: "NO", kind: "execution", detail: "保有中" }] });
  const duplicate = row({ id: "q-btc-b", logic: "Q102", symbol: "BTCUSDT", score: 10, scoreKind: "NATIVE", rankingScope: "Q102", sourceRank: 2, rankingEligible: true, rankingContractAvailable: true });
  const eth = row({ id: "q-eth", logic: "Q102", symbol: "ETHUSDT", score: 9, scoreKind: "NATIVE", rankingScope: "Q102", sourceRank: 3, rankingEligible: true, rankingContractAvailable: true });
  const panels = buildRealtimeRankingPanels([blocked, duplicate, eth], "Q102");

  assert.equal(panels.length, 1);
  assert.equal(panels[0].slots.length, 3);
  assert.equal(panels[0].slots[0].sourceRow?.id, "q-btc-a");
  assert.equal(panels[0].slots[0].sourceRow?.score, 12);
  assert.equal(panels[0].slots[0].sourceRow?.gates[0].state, "NO");
  assert.equal(panels[0].slots[2].status, "NO_CANDIDATE");
});

test("score labels distinguish native, gate completion, unavailable and numeric zero", () => {
  assert.equal(scoreKindLabel(row({ id: "native", logic: "Q102", symbol: "BTCUSDT", score: 0, scoreKind: "NATIVE", scoreLabel: "Proximity model units" })), "Proximity model units");
  assert.match(scoreKindLabel(row({ id: "gate", logic: "PENGU", symbol: "PENGUUSDT", score: 72, scoreKind: "GATE_COMPLETION", scoreLabel: "Gate充足度（発火確率ではありません）" })), /Gate充足度/);
  assert.match(scoreKindLabel(row({ id: "na", logic: "V12_V4", symbol: "BTCUSDT", score: null, scoreKind: "UNAVAILABLE", sourceRank: 1 })), /未評価/);
  assert.match(scoreKindLabel(row({ id: "empty-v4", logic: "V12_V4", symbol: "—", score: null, scoreKind: "UNAVAILABLE", sourceStatus: "NOT_EVALUATED", reason: "NO_NATIVE_ENTRY_CANDIDATES", rankingScope: "V12_V4" })), /候補なし/);
});

test("V4 no-candidate summary follows the current panel freshness state", () => {
  const fresh = buildRealtimeRankingPanels([
    row({ id: "v4-empty", logic: "V12_V4", symbol: "—", sourceStatus: "NOT_EVALUATED", reason: "NO_NATIVE_ENTRY_CANDIDATES", rankingScope: "V12_V4", fresh: true }),
  ], "V12_V4")[0];
  const stale = buildRealtimeRankingPanels([
    row({ id: "v4-stale", logic: "V12_V4", symbol: "—", sourceStatus: "STALE", reason: "観測鮮度期限切れ / NO_NATIVE_ENTRY_CANDIDATES", rankingScope: "V12_V4", fresh: false }),
  ], "V12_V4")[0];
  assert.equal(v4NoCandidatePanelState(fresh), "FRESH_NO_CANDIDATE");
  assert.equal(v4NoCandidatePanelState(stale), "STALE");
});

test("movement snapshots include every ranked shared-market currency in ALL view", () => {
  const market=[
    row({ id:"market-btc",logic:"MARKET",symbol:"BTCUSDT",score:88,scoreKind:"MARKET",rankingScope:"MARKET",sourceRank:1,rank:1,rankingEligible:true,rankingContractAvailable:true }),
    row({ id:"market-eth",logic:"MARKET",symbol:"ETHUSDT",score:82,scoreKind:"MARKET",rankingScope:"MARKET",sourceRank:2,rank:2,rankingEligible:true,rankingContractAvailable:true }),
    row({ id:"market-sol",logic:"MARKET",symbol:"SOLUSDT",score:79,scoreKind:"MARKET",rankingScope:"MARKET",sourceRank:3,rank:3,rankingEligible:true,rankingContractAvailable:true }),
    row({ id:"market-xrp",logic:"MARKET",symbol:"XRPUSDT",score:71,scoreKind:"MARKET",rankingScope:"MARKET",sourceRank:4,rank:4,rankingEligible:true,rankingContractAvailable:true }),
  ];
  const q102=row({ id:"q102",logic:"Q102",symbol:"BTCUSDT",score:95,scoreKind:"NATIVE",rankingScope:"Q102",sourceRank:1,rank:1,rankingEligible:true,rankingContractAvailable:true });
  const rows=[...market,q102];
  const feedback=rankingFeedbackRows(buildRealtimeRankingPanels(rows,"ALL"),rows);
  assert.deepEqual(feedback.map(item=>item.symbol),["BTCUSDT","ETHUSDT","SOLUSDT","XRPUSDT"]);
  assert.ok(feedback.every(item=>item.id.startsWith("MARKET::")));
});

test("ranking board exposes score meaning and placeholder slot semantics accessibly", async () => {
  const source = await readFile("components/features/RealtimeRankingBoard.tsx", "utf8");
  assert.match(source, /aria-label=\{.*上位3/);
  assert.match(source, /data-top-slot/);
  assert.match(source, /Gate充足度/);
  assert.match(source, /発火確率.*ありません/);
  assert.match(source, /順位未評価/);
  assert.match(source, /発注不可/);
  assert.match(source, /NO_NATIVE_ENTRY_CANDIDATES/);
  assert.match(source, /候補なし（V4 fresh）/);
  assert.match(source, /V4 stale/);
});

test("ranking motion remains currency-scoped and is not a board-wide refresh pulse", async () => {
  const board = await readFile("components/features/RealtimeRankingBoard.tsx", "utf8");
  const feedback = await readFile("hooks/useRealtimeRankingFeedback.ts", "utf8");
  assert.doesNotMatch(board, /realtime-refresh-pulse/);
  assert.doesNotMatch(board, /realtime-frame-travel/);
  assert.doesNotMatch(board, /setRefreshPulse\(/);
  assert.match(feedback, /ranking-flyer/);
  assert.match(feedback, /rankingMoving/);
  assert.match(feedback, /rankingCompleted/);
});

test("currency motion uses a colored foreground frame and serial groups", async () => {
  const feedback = await readFile("hooks/useRealtimeRankingFeedback.ts", "utf8");
  const motionGroups = await readFile("lib/ranking-motion-groups.ts", "utf8");
  assert.match(feedback, /borderColor/);
  assert.match(feedback, /outline.*color|outline.*\+\s*color/);
  assert.match(feedback, /playRankingSequence\(\s*coloredGroups/);
  assert.match(feedback, /scale\(\$\{scale\}\)/);
  assert.match(feedback, /foregroundY/);
  assert.match(motionGroups, /for\s*\(const item of items\)/);
});
