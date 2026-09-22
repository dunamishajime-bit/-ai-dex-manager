import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateFlatRuntimeState } from "../scripts/disdex-flat-state-sha-migrate";

const A = "a".repeat(40);
const B = "b".repeat(40);

test("migrates flat FET state and preserves exact backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "fet-flat-migrate-"));
  try {
    const statePath = join(root, "state.json");
    const original = {
      schema: "fet-brk48-residual-state/v1",
      strategyId: "FET_BRK48_RESIDUAL",
      runtimeCommitSha: A,
      updatedAt: 123,
      failures: [],
      lastReferenceTs: 99,
    };
    await writeFile(statePath, JSON.stringify(original, null, 2) + "\n");
    const result = await migrateFlatRuntimeState({ strategy: "FET", statePath, fromSha: A, toSha: B });
    assert.equal(result.status, "FLAT_STATE_SHA_MIGRATE_PASS");
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).runtimeCommitSha, B);
    assert.deepEqual(JSON.parse(await readFile(result.backupPath, "utf8")), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migrates flat V12 state", async () => {
  const root = await mkdtemp(join(tmpdir(), "v12-flat-migrate-"));
  try {
    const statePath = join(root, "runner.json");
    const original = {
      schema: "v12-x1-all-runner-state/v2",
      strategyId: "V12_X1.00_ALL",
      mode: "LIVE",
      runtimeCommitSha: A,
      updatedAt: 123,
    };
    await writeFile(statePath, JSON.stringify(original, null, 2) + "\n");
    await migrateFlatRuntimeState({ strategy: "V12", statePath, fromSha: A, toSha: B });
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).runtimeCommitSha, B);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses any active/pending/review state", async () => {
  const root = await mkdtemp(join(tmpdir(), "flat-migrate-refuse-"));
  try {
    const cases = [
      { schema: "fet-brk48-residual-state/v1", strategyId: "FET_BRK48_RESIDUAL", runtimeCommitSha: A, updatedAt: 1, failures: [], position: { symbol: "FETUSDT" } },
      { schema: "fet-brk48-residual-state/v1", strategyId: "FET_BRK48_RESIDUAL", runtimeCommitSha: A, updatedAt: 1, failures: [], pending: { action: "ENTRY" } },
      { schema: "v12-x1-all-runner-state/v2", strategyId: "V12_X1.00_ALL", mode: "LIVE", runtimeCommitSha: A, updatedAt: 1, activePositions: [{ symbol: "DOGEUSDT" }] },
      { schema: "v12-x1-all-runner-state/v2", strategyId: "V12_X1.00_ALL", mode: "LIVE", runtimeCommitSha: A, updatedAt: 1, manualReview: "BLOCK" },
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const statePath = join(root, `state-${i}.json`);
      await writeFile(statePath, JSON.stringify(cases[i]) + "\n");
      await assert.rejects(() => migrateFlatRuntimeState({
        strategy: i < 2 ? "FET" : "V12",
        statePath,
        fromSha: A,
        toSha: B,
      }));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
