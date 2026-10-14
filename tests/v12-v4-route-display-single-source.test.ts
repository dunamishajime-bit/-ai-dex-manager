import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const runtime = readFileSync(resolve("components/features/V12V4RuntimePanel.tsx"), "utf8");
const inventory = readFileSync(resolve("components/features/V12RouteInventoryPanel.tsx"), "utf8");

test("home V4 runtime does not show cycle-emitted routes as implemented 0/41", () => {
  assert.doesNotMatch(runtime, /snapshot\.routeCoverage\.observed/);
  assert.doesNotMatch(runtime, /出力されたroute数/);
  assert.doesNotMatch(runtime, /V4 route coverage/);
  assert.doesNotMatch(runtime, /41 routes/);
  assert.match(runtime, /V4実観測候補/);
  assert.match(runtime, /LIVE確認済み|view\.runtimeLabel/);
});

test("route catalog retains the sole catalog total and clearly labels cycle observations", () => {
  assert.match(inventory, /定義ルート \/ Catalog/);
  assert.match(inventory, /snapshot\.routeCoverage\.expected/);
  assert.match(inventory, /V12_V4_HP_ROUTE_IDS\.length/);
  assert.match(inventory, /直近cycleで出力されたroute/);
  assert.match(inventory, /出力0件でも未実装・停止という意味ではありません/);
  assert.doesNotMatch(inventory, /{family\.observed} \/ {family\.total}/);
  assert.doesNotMatch(inventory, /Decision候補 \/ filtered/);
});
