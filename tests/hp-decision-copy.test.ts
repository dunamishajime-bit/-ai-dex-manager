import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import { loadDecisionStatus } from "../lib/server/disdex-decision-status";
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

test("HPの候補表示は長い注意文を使わず10分ごとに更新する", async () => {
  const panel = await readFile(join(process.cwd(), "components/features/DecisionStatusPanel.tsx"), "utf8");
  assert.match(panel, /10 \* 60 \* 1000/);
  assert.match(panel, /10分ごとに更新/);
  assert.doesNotMatch(panel, /過去データから推測表示しません|sanitized snapshotがない場合/);
});
