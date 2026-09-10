import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { v12ObservationStatus } from "../lib/v12-observation-status";
import { loadDecisionStatus } from "../lib/server/disdex-decision-status";

test("候補の説明に古いsnapshot注意文を繰り返し表示しない", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "disdex-hp-copy-"));
  const statePath = path.join(dir, "v12.json");
  const previous = process.env.V12_DECISION_SNAPSHOT_PATH;
  const previousRunner = process.env.V12_X1_ALL_STATE_PATH;
  process.env.V12_DECISION_SNAPSHOT_PATH = statePath;
  process.env.V12_X1_ALL_STATE_PATH = statePath;
  await writeFile(statePath, JSON.stringify({ candidates: [] }), "utf8");
  try {
    const snapshot = await loadDecisionStatus({ force: true });
    const reasons = snapshot.v12.items.map((item) => item.reason).join("\n");
    assert.doesNotMatch(reasons, /古いdecision snapshot候補は現在候補として表示しません/);
    assert.doesNotMatch(reasons, /VPSのsanitized snapshotがない場合、過去データから推測表示しません/);
  } finally {
    if (previous === undefined) delete process.env.V12_DECISION_SNAPSHOT_PATH;
    else process.env.V12_DECISION_SNAPSHOT_PATH = previous;
    if (previousRunner === undefined) delete process.env.V12_X1_ALL_STATE_PATH;
    else process.env.V12_X1_ALL_STATE_PATH = previousRunner;
    await rm(dir, { recursive: true, force: true });
  }
});

test("補助情報の警告だけではV12を要確認にしない", () => {
  assert.equal(v12ObservationStatus({ decisionDetailsAvailable: true, errors: [], warnings: ["履歴未取得"] }), "確認済み");
  assert.equal(v12ObservationStatus({ decisionDetailsAvailable: true, errors: ["runner未取得"], warnings: [] }), "要確認");
  assert.equal(v12ObservationStatus({ decisionDetailsAvailable: false, errors: [], warnings: [] }), "未取得");
  assert.equal(v12ObservationStatus({ decisionDetailsAvailable: false, runnerStateFresh: true, errors: [], warnings: [] }), "確認済み");
});

test("最新runnerが候補なしを返した場合は銘柄ごとに未取得と表示しない", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "disdex-hp-no-signal-"));
  const statePath = path.join(dir, "v12.json");
  const previous = process.env.V12_DECISION_SNAPSHOT_PATH;
  const previousRunner = process.env.V12_X1_ALL_STATE_PATH;
  process.env.V12_DECISION_SNAPSHOT_PATH = statePath;
  process.env.V12_X1_ALL_STATE_PATH = statePath;
  const now = Date.now();
  await writeFile(statePath, JSON.stringify({ mode: "LIVE", updatedAt: now, lastReferenceTs: now - 60_000, candidates: [] }), "utf8");
  try {
    const snapshot = await loadDecisionStatus({ force: true });
    assert.ok(snapshot.v12.items.length > 0);
    assert.ok(snapshot.v12.items.every((item) => item.status === "条件不足"));
    assert.ok(snapshot.v12.items.every((item) => item.reason === "現在の候補はありません。"));
  } finally {
    if (previous === undefined) delete process.env.V12_DECISION_SNAPSHOT_PATH;
    else process.env.V12_DECISION_SNAPSHOT_PATH = previous;
    if (previousRunner === undefined) delete process.env.V12_X1_ALL_STATE_PATH;
    else process.env.V12_X1_ALL_STATE_PATH = previousRunner;
    await rm(dir, { recursive: true, force: true });
  }
});

test("古いsnapshotを破棄した場合もfresh runnerなら候補なしとして表示する", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "disdex-hp-stale-no-signal-"));
  const decisionPath = path.join(dir, "decision.json");
  const runnerPath = path.join(dir, "runner.json");
  const previous = process.env.V12_DECISION_SNAPSHOT_PATH;
  const previousRunner = process.env.V12_X1_ALL_STATE_PATH;
  process.env.V12_DECISION_SNAPSHOT_PATH = decisionPath;
  process.env.V12_X1_ALL_STATE_PATH = runnerPath;
  const now = Date.now();
  await writeFile(decisionPath, JSON.stringify({ referenceTs: now - 24 * 60 * 60 * 1000, candidates: [{ symbol: "OLD", rank: 1, score: 9 }] }), "utf8");
  await writeFile(runnerPath, JSON.stringify({ mode: "LIVE", updatedAt: now, lastReferenceTs: now - 60_000, candidates: [] }), "utf8");
  try {
    const snapshot = await loadDecisionStatus({ force: true });
    assert.ok(snapshot.v12.items.length > 0);
    assert.ok(snapshot.v12.items.every((item) => item.status === "条件不足"));
    assert.ok(snapshot.v12.items.every((item) => item.reason === "現在の候補はありません。"));
  } finally {
    if (previous === undefined) delete process.env.V12_DECISION_SNAPSHOT_PATH;
    else process.env.V12_DECISION_SNAPSHOT_PATH = previous;
    if (previousRunner === undefined) delete process.env.V12_X1_ALL_STATE_PATH;
    else process.env.V12_X1_ALL_STATE_PATH = previousRunner;
    await rm(dir, { recursive: true, force: true });
  }
});

test("判定状況の説明は短く、10分更新を維持する", async () => {
  const panel = await readFile(path.join(process.cwd(), "components/features/DecisionStatusPanel.tsx"), "utf8");
  assert.match(panel, /10 \* 60 \* 1000/);
  assert.match(panel, /自動再確認：10分ごと/);
  assert.doesNotMatch(panel, /古いdecision snapshot候補は現在候補として表示しません/);
  assert.doesNotMatch(panel, /VPSのsanitized snapshotがない場合、過去データから推測表示しません/);
});
