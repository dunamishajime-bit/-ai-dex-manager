import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  buildRealtimeRankingPanels,
  rankingFeedbackRows,
  scoreKindLabel,
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

test("ALL view renders V12 V4 placeholder and only scopes backed by ranking contracts", () => {
  const rows = [
    row({ id: "q1", logic: "Q102", symbol: "BTCUSDT", score: 12, scoreKind: "NATIVE", rankingScope: "Q102", sourceRank: 1, rankingEligible: true, rankingContractAvailable: true }),
    row({ id: "p1", logic: "PENGU", symbol: "PENGUUSDT", score: 88, scoreKind: "GATE_COMPLETION", rankingScope: "PENGU", rankingEligible: false, rankingContractAvailable: false }),
  ];

  const panels = buildRealtimeRankingPanels(rows, "ALL");
  assert.deepEqual(panels.map((panel) => panel.scope), ["V12_V4", "Q102"]);
  assert.deepEqual(panels[0].slots.map((slot) => slot.status), ["NOT_EVALUATED", "NOT_EVALUATED", "NOT_EVALUATED"]);
  assert.equal(panels[0].slots.length, 3);
  assert.equal(panels.some((panel) => panel.scope === "PENGU"), false);
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
});

test("movement snapshots namespace ids and use only scoped Top-3 candidates", () => {
  const rowA = row({ id: "same-id", logic: "Q102", symbol: "BTCUSDT", score: 10, scoreKind: "NATIVE", rankingScope: "Q102", sourceRank: 1, rankingEligible: true, rankingContractAvailable: true });
  const rowB = { ...rowA, logic: "Other", rankingScope: "Other" };
  const panels = buildRealtimeRankingPanels([rowA, rowB], "ALL");
  const feedback = rankingFeedbackRows(panels);
  assert.equal(feedback.length, 2);
  assert.notEqual(feedback[0].id, feedback[1].id);
  assert.ok(feedback.every((item) => item.rank === 1));
});

test("ranking board exposes score meaning and placeholder slot semantics accessibly", async () => {
  const source = await readFile("components/features/RealtimeRankingBoard.tsx", "utf8");
  assert.match(source, /aria-label=\{.*上位3/);
  assert.match(source, /data-top-slot/);
  assert.match(source, /Gate充足度/);
  assert.match(source, /発火確率ではありません/);
  assert.match(source, /順位未評価/);
  assert.match(source, /発注不可/);
});
