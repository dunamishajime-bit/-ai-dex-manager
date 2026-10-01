import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES,
  recoverIdlePriorityShortBenignState,
} from "../scripts/disdex-idle-priority-short-benign-state-recovery";

const BENIGN_RATE_BUDGET = "IDLE_RUNNER_FAIL_CLOSED:ASTER_GLOBAL_RATE_BUDGET_SATURATED:5007";

const SHA = "a".repeat(40);

function flatState(manualReview: string | null = null) {
  return {
    schema: "disdex-idle-priority-state/v2",
    runtimeSha: SHA,
    updatedAt: 1,
    positions: [],
    manualReview,
    pending: null,
    lastAcceptedBySymbol: {},
    failures: [],
    unknownField: "preserve",
  };
}

test("clears only the known flat operator-artifact EACCES review and keeps an exact backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-benign-recovery-"));
  try {
    const statePath = join(root, "state.json");
    const original = flatState(BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES);
    await writeFile(statePath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o600 });
    const result = await recoverIdlePriorityShortBenignState({ statePath, expectedSha: SHA });
    assert.equal(result.status, "IDLE_BENIGN_STATE_RECOVERY_PASS");
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(after.manualReview, null);
    assert.equal(after.runtimeSha, SHA);
    assert.equal(after.unknownField, "preserve");
    assert.equal(JSON.stringify(JSON.parse(await readFile(result.backupPath, "utf8"))), JSON.stringify(original));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clears the exact flat Aster rate-budget saturation review and keeps an exact backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-benign-rate-budget-recovery-"));
  try {
    const statePath = join(root, "state.json");
    const original = flatState(BENIGN_RATE_BUDGET);
    await writeFile(statePath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o600 });
    const result = await recoverIdlePriorityShortBenignState({ statePath, expectedSha: SHA });
    assert.equal(result.status, "IDLE_BENIGN_STATE_RECOVERY_PASS");
    assert.equal(result.recoveryReason, "IDLE_BENIGN_RATE_BUDGET_RECOVERY");
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(after.manualReview, null);
    assert.equal(after.lastDecision.reason, "IDLE_BENIGN_RATE_BUDGET_RECOVERY");
    assert.equal(after.runtimeSha, SHA);
    assert.equal(after.unknownField, "preserve");
    assert.equal(JSON.stringify(JSON.parse(await readFile(result.backupPath, "utf8"))), JSON.stringify(original));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses unknown review and any active or pending exposure", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-benign-recovery-refuse-"));
  try {
    const cases = [
      flatState("operator review"),
      { ...flatState(BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES), positions: [{ symbol: "DOTUSDT" }] },
      { ...flatState(BENIGN_IDLE_OPERATOR_ACTIVATION_EACCES), pending: { action: "ENTRY" } },
      { ...flatState(BENIGN_RATE_BUDGET), positions: [{ symbol: "DOTUSDT" }] },
      { ...flatState(BENIGN_RATE_BUDGET), pending: { action: "ENTRY" } },
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const statePath = join(root, `state-${index}.json`);
      await writeFile(statePath, JSON.stringify(cases[index]));
      await assert.rejects(
        () => recoverIdlePriorityShortBenignState({ statePath, expectedSha: SHA }),
        /(?:IDLE_BENIGN_STATE_RECOVERY_|IDLE_STATE_(?:POSITION|PENDING)_INVALID)/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
