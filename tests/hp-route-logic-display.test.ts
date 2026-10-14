import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("dashboard exposes all 41 V12 V4 routes and family-level observed coverage", () => {
  const source = readFileSync("components/features/V12RouteInventoryPanel.tsx", "utf8");
  assert.match(source, /V12 V4 ルート構成/);
  assert.match(source, /Catalog \{V12_V4_HP_ROUTE_IDS\.length\}\/41/);
  assert.match(source, /41\/41 一致/);
  assert.match(source, /ROUTE_FAMILIES/);
  assert.match(source, /CORE \/ ROBUST/);
  assert.match(source, /REC_G/);
  assert.match(source, /REC_X/);
  assert.match(source, /REC_Y/);
  assert.match(source, /REC_Z/);
  assert.match(source, /data-testid="v12-route-family-breakdown"/);
  assert.match(source, /V12_V4_HP_ROUTE_IDS\.map/);
});

test("realtime ranking rows expose every matching strategy and LONG SHORT WAIT direction", () => {
  const board = readFileSync("components/features/RealtimeRankingBoard.tsx", "utf8");
  const page = readFileSync("app/realtime/page.tsx", "utf8");
  assert.match(board, /strategyRowsForSymbol/);
  assert.match(board, /ロジック \/ 判定方向/);
  assert.match(board, /data-strategy-logic/);
  assert.match(board, /data-strategy-side/);
  assert.match(board, /rank-strategy-long/);
  assert.match(board, /rank-strategy-short/);
  assert.match(board, /rank-strategy-wait/);
  assert.match(board, /ロジック未確認/);
  assert.match(board, /設定候補/);
  assert.match(board, /data-strategy-source/);
  assert.match(board, /renderStrategyBadges\(row, true\)/);
  assert.match(page, /RealtimeRankingBoard/);
  assert.doesNotMatch(page, /LiveLogicDirectionBoard/);
});

test("home dashboard includes route inventory panel", () => {
  const source = readFileSync("app/page.tsx", "utf8");
  assert.match(source, /V12RouteInventoryPanel/);
  assert.match(source, /<V12RouteInventoryPanel \/>/);
});

test("production runtime uses V4 heartbeat when V4 is the primary V12 runner", () => {
  const source = readFileSync("lib/server/current-production-runtime.ts", "utf8");
  assert.match(source, /V12_V4_HEARTBEAT_PATH = "\/var\/lib\/disdex\/v12-v4\/heartbeat\.json"/);
  assert.match(source, /DISDEX_PRIMARY_V12_RUNNER/);
  assert.match(source, /\$\{releaseSha\}\.v12-primary\.env/);
  assert.match(source, /CURRENT_V12_PRIMARY_SHA_MISMATCH/);
  assert.match(source, /v12PrimaryMode === "V4" \? V12_V4_HEARTBEAT_PATH/);
  assert.match(source, /loadRuntimeLineage\(releaseSha, env\)/);
});
