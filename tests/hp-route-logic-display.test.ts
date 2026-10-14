import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dashboard exposes implemented V12 V4 route inventory separately from current-cycle output", () => {
  const source = readFileSync("components/features/V12RouteInventoryPanel.tsx", "utf8");
  assert.match(source, /V12 V4 ルート構成/);
  assert.match(source, /実装ルート総数/);
  assert.match(source, /今回cycle出力route/);
  assert.match(source, /実装41ルートをすべて表示/);
  assert.match(source, /今cycle未出力/);
  assert.match(source, /V12_V4_HP_ROUTE_IDS\.map/);
});

test("realtime page exposes live strategy direction and route explicitly", () => {
  const board = readFileSync("components/features/LiveLogicDirectionBoard.tsx", "utf8");
  const page = readFileSync("app/realtime/page.tsx", "utf8");
  assert.match(board, /LIVEロジック方向/);
  assert.match(board, /LONG/);
  assert.match(board, /SHORT/);
  assert.match(board, /route:/);
  assert.match(board, /Signal Gate/);
  assert.match(board, /row\.logic !== "MARKET"/);
  assert.match(page, /LiveLogicDirectionBoard/);
});

test("home dashboard includes route inventory panel", () => {
  const source = readFileSync("app/page.tsx", "utf8");
  assert.match(source, /V12RouteInventoryPanel/);
  assert.match(source, /<V12RouteInventoryPanel \/>/);
});
