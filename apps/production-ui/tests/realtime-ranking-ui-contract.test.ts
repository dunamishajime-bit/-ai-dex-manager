import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { risingRankEvents, type RankRow } from "../lib/realtime-ranking";

const testDir = dirname(fileURLToPath(import.meta.url));
const boardSource = readFileSync(resolve(testDir, "../components/features/RealtimeRankingBoard.tsx"), "utf8");

function row(id: string, score: number): RankRow {
  return { id, symbol: id + "USDT", logic: "V12", side: "LONG", score, gates: [], reason: "", fresh: true, checkedAt: 1 };
}

test("numeric score rows remain observable by rising rank events", () => {
  const events = risingRankEvents([row("A", 80), row("B", 70), row("C", 60)], [row("C", 95), row("A", 80), row("B", 70)]);
  assert.deepEqual(events.map((event) => [event.row.id, event.from, event.to]), [["C", 3, 1]]);
});

test("390px commentary controls wrap without the min-content grid contract", () => {
  assert.doesNotMatch(boardSource, /grid-template-columns:1fr auto/);
  assert.match(boardSource, /\.ranking-commentary-tools\{[^}]*min-width:0/);
  assert.match(boardSource, /\.ranking-commentary-actions\{[^}]*flex-wrap:wrap/);
  assert.match(boardSource, /\.ranking-commentary-actions\{[^}]*min-width:0/);
  assert.match(boardSource, /\.ranking-commentary-actions label\{[^}]*min-width:0/);
  assert.match(boardSource, /\.ranking-commentary-actions select\{[^}]*min-width:0/);
});

test("page refresh and ranking animation hooks remain present", () => {
  assert.match(boardSource, /RANKING_PAGE_REFRESH_MS/);
  assert.match(boardSource, /setInterval\(/);
  assert.match(boardSource, /useRankingShow/);
  assert.match(boardSource, /rank-flash/);
  assert.match(boardSource, /ranking-commentary/);
});
