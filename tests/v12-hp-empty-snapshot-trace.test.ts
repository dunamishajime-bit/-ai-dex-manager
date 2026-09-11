import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadV12DecisionObservability } from "../lib/server/v12-decision-observability";

test("valid empty decision snapshot is shown as no candidate, not unavailable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "v12-hp-empty-"));
  const runner = join(dir, "runner.json");
  const decision = join(dir, "decision.json");
  const risk = join(dir, "risk.json");
  await writeFile(runner, JSON.stringify({ strategyId: "V12_X1.00_ALL", mode: "LIVE", updatedAt: Date.now(), activePositions: [] }));
  await writeFile(decision, JSON.stringify({ schema: "v12-decision-snapshot/v1", strategyId: "V12_X1.00_ALL", generatedAt: Date.now(), referenceTs: Date.now(), selectionConfirmed: false, selectedSymbols: [], candidates: [] }));
  await writeFile(risk, JSON.stringify({ lossPct: 0, maximumLossPct: 5, tripped: false, updatedAt: Date.now() }));
  process.env.V12_X1_ALL_STATE_PATH = runner;
  process.env.V12_DECISION_SNAPSHOT_PATH = decision;
  process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH = risk;
  const result = await loadV12DecisionObservability();
  assert.equal(result.executionTrace.currentStage, "candidate-none");
  assert.match(result.executionTrace.currentStageLabel, /候補なし/);
  assert.doesNotMatch(result.executionTrace.currentStageLabel, /未取得/);
});