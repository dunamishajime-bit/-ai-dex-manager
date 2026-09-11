import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("V12 HP renders Top2 activePositions and distinguishes valid no-candidate", () => {
  const panel = readFileSync("components/features/DecisionStatusPanel.tsx", "utf8");
  assert.match(panel, /activePositions/);
  assert.match(panel, /この確定2時間足では候補なし/);
  assert.match(panel, /snapshot.*未取得|未取得.*snapshot/i);
});