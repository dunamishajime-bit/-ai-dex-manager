import assert from "node:assert/strict";
import test from "node:test";

import { selectV12Top3Candidates, v12EntryGrossCapForRank, type V12Candidate } from "../lib/v12-x1-all";

function c(symbol: string, score: number): V12Candidate {
  return { symbol, side: "LONG", momentum: 0.08, volatility: 0.01, atr: 2, volumeRatio: 1.2, score };
}

test("Top3 preserves top2 and only admits rank3 at score >= 0.70", () => {
  const blocked = selectV12Top3Candidates([c("ETH", 2), c("SOL", 1.5), c("AVAX", 0.6999)], 3);
  assert.deepEqual(blocked.map((x) => [x.candidate.symbol, x.rank]), [["ETH",1],["SOL",2]]);
  const exact = selectV12Top3Candidates([c("ETH", 2), c("SOL", 1.5), c("AVAX", 0.70)], 3);
  assert.deepEqual(exact.map((x) => [x.candidate.symbol, x.rank]), [["ETH",1],["SOL",2],["AVAX",3]]);
  assert.equal(v12EntryGrossCapForRank(1), 1);
  assert.equal(v12EntryGrossCapForRank(2), 1);
  assert.equal(v12EntryGrossCapForRank(3), 0.10);
});

test("requesting Top2 cannot expose rank3", () => {
  const rows = selectV12Top3Candidates([c("ETH",2),c("SOL",1.5),c("AVAX",1.4649)],2);
  assert.equal(rows.length,2);
});
