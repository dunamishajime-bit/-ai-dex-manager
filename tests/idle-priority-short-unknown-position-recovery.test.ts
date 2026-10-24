import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  recoverIdlePriorityShortUnknownPositionState,
  UNKNOWN_ACTIVE_POSITION_REVIEW_PREFIX,
} from "../scripts/disdex-idle-priority-short-unknown-position-recovery";

const SHA = "a".repeat(40);
const REVIEW = `${UNKNOWN_ACTIVE_POSITION_REVIEW_PREFIX}SUSHIUSDT`;

function flatState(manualReview = REVIEW) {
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

function readonlyEvidence(overrides: Record<string, unknown> = {}) {
  return {
    status: "ASTER_READONLY_ACCOUNT_DIAGNOSTIC_PASS",
    positions: [{ symbol: "NEARUSDT", positionAmt: -3, positionSide: "BOTH" }],
    openOrders: [{ symbol: "NEARUSDT", status: "NEW", reduceOnly: true, type: "STOP_MARKET" }],
    ordersSent: 0,
    cancelsSent: 0,
    positionChangesSent: 0,
    ...overrides,
  };
}

test("clears an exact unknown-position review only after a clean signed read-only account proof", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-unknown-position-recovery-"));
  try {
    const statePath = join(root, "state.json");
    const evidencePath = join(root, "evidence.json");
    const original = flatState();
    await writeFile(statePath, `${JSON.stringify(original, null, 2)}\n`, { mode: 0o600 });
    await writeFile(evidencePath, `${JSON.stringify(readonlyEvidence(), null, 2)}\n`, { mode: 0o600 });
    const result = await recoverIdlePriorityShortUnknownPositionState({ statePath, evidencePath, expectedSha: SHA });
    assert.equal(result.status, "IDLE_UNKNOWN_POSITION_RECOVERY_PASS");
    assert.equal(result.recoveryReason, "IDLE_TRANSIENT_UNKNOWN_POSITION_RECONCILED_READONLY");
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(after.manualReview, null);
    assert.equal(after.lastDecision.reason, result.recoveryReason);
    assert.equal(after.unknownField, "preserve");
    assert.equal(JSON.stringify(JSON.parse(await readFile(result.backupPath, "utf8"))), JSON.stringify(original));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses to clear the review when an unknown position or unprotected order remains", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-unknown-position-recovery-refuse-"));
  try {
    const cases = [
      readonlyEvidence({ positions: [{ symbol: "SUSHIUSDT", positionAmt: -1 }] }),
      readonlyEvidence({ openOrders: [{ symbol: "SUSHIUSDT", status: "NEW", reduceOnly: true }] }),
      readonlyEvidence({ openOrders: [{ symbol: "NEARUSDT", status: "NEW", reduceOnly: false }] }),
      readonlyEvidence({ ordersSent: 1 }),
    ];
    for (let index = 0; index < cases.length; index += 1) {
      const statePath = join(root, `state-${index}.json`);
      const evidencePath = join(root, `evidence-${index}.json`);
      await writeFile(statePath, JSON.stringify(flatState()));
      await writeFile(evidencePath, JSON.stringify(cases[index]));
      await assert.rejects(
        () => recoverIdlePriorityShortUnknownPositionState({ statePath, evidencePath, expectedSha: SHA }),
        /IDLE_UNKNOWN_POSITION_RECOVERY_/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
