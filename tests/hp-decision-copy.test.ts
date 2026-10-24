import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import { loadDecisionStatus, runtimeSnapshot } from "../lib/server/disdex-decision-status";
import { v12ObservationStatus } from "../lib/v12-observation-status";

test("判定候補の説明に古いsnapshot注意文を繰り返し表示しない", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-hp-copy-"));
  const statePath = join(directory, "v12-state.json");
  const previous = {
    runner: process.env.V12_X1_ALL_STATE_PATH,
    decision: process.env.V12_DECISION_SNAPSHOT_PATH,
  };
  await writeFile(statePath, JSON.stringify({ candidates: [] }), "utf8");
  process.env.V12_X1_ALL_STATE_PATH = statePath;
  process.env.V12_DECISION_SNAPSHOT_PATH = statePath;
  try {
    const snapshot = await loadDecisionStatus({ force: true });
    for (const item of snapshot.v12.items) {
      assert.doesNotMatch(item.reason, /過去データから推測表示しません/);
      assert.doesNotMatch(item.reason, /sanitized snapshotがない場合/);
    }
  } finally {
    if (previous.runner === undefined) delete process.env.V12_X1_ALL_STATE_PATH;
    else process.env.V12_X1_ALL_STATE_PATH = previous.runner;
    if (previous.decision === undefined) delete process.env.V12_DECISION_SNAPSHOT_PATH;
    else process.env.V12_DECISION_SNAPSHOT_PATH = previous.decision;
    await rm(directory, { recursive: true, force: true });
  }
});

test("補助情報の警告だけではV12発火経路を要確認にしない", () => {
  assert.equal(v12ObservationStatus({ decisionDetailsAvailable: true, errors: [], warnings: ["trade-history: 未取得"] }), "確認済み");
  assert.equal(v12ObservationStatus({ decisionDetailsAvailable: true, errors: ["runner-state: 未取得"], warnings: [] }), "要確認");
  assert.equal(v12ObservationStatus({ decisionDetailsAvailable: false, errors: [], warnings: [] }), "未取得");
});

test("runtime unavailable has no static FET or V52 policy fallback", () => {
  const units = runtimeSnapshot("2026-10-24T00:00:00.000Z", null).units;
  const fet = units.find((unit) => unit.id === "FET_BRK48_RESIDUAL");
  const v52 = units.find((unit) => unit.id === "DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96");
  assert.equal(fet?.status, "UNAVAILABLE");
  assert.equal(v52?.status, "UNAVAILABLE");
  assert.match(fet?.reason || "", /手動確認|needs review|unavailable/i);
  assert.match(v52?.reason || "", /手動確認|needs review|unavailable/i);
  assert.doesNotMatch(fet?.entryPolicy || "", /BRK48|Core entry|残余枠/);
  assert.doesNotMatch(v52?.entryPolicy || "", /Top2|Basis|Net Edge|V50|V11/);
});

test("decision status refreshes every 30 seconds and separates V4 process from entry readiness", async () => {
  const panel = await readFile("components/features/DecisionStatusPanel.tsx", "utf8");

  assert.match(panel, /setInterval\(\(\) => void load\(true\), 30_000\)/);
  assert.match(panel, /V4 process\/runtime/);
  assert.match(panel, /orderEnabled/);
  assert.match(panel, /new-entry|新規.*entry|新規.*エントリー/i);
});

test("decision status hides static detail panels unless V4 is live verified", async () => {
  const panel = await readFile("components/features/DecisionStatusPanel.tsx", "utf8");

  assert.match(panel, /runtimeAvailable = snapshot\.ok && snapshot\.v12V4\?\.displayStatus === "LIVE_VERIFIED"/);
});
