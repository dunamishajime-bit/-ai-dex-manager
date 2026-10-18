import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  createQuality102CausalV1State,
} from "../lib/disdex-quality102-causal-v1-state";
import { migrateQuality102CausalV1State } from "../scripts/disdex-quality102-causal-v1-state-migrate";

const FROM = "a".repeat(40);
const TO = "b".repeat(40);

function state(overrides: Record<string, unknown> = {}) {
  return {
    ...createQuality102CausalV1State("LIVE", FROM),
    updatedAt: 100,
    failures: [],
    ...overrides,
  };
}

test("flat Q102 state migrates with an exact backup and SHA-bound readback", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-q102-flat-migrate-"));
  const statePath = join(root, "state.json");
  const before = Buffer.from(`${JSON.stringify(state())}\n`);
  await writeFile(statePath, before, { mode: 0o600 });

  const backupPath = join(root, "state.backup.json");
  const result = await migrateQuality102CausalV1State({
    statePath,
    fromRuntimeSha: FROM,
    toRuntimeSha: TO,
    backupPath,
  });
  assert.equal(result.status, "QUALITY102_STATE_MIGRATION_PASS");
  assert.equal((await readFile(result.backupPath)).equals(before), true);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).runtimeCommitSha, TO);
  assert.equal(result.ordersSent, 0);
  assert.equal(result.positionChangesSent, 0);
});

test("non-flat, wrong identity, and source SHA mismatch fail closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-q102-flat-migrate-invalid-"));
  const statePath = join(root, "state.json");
  await writeFile(statePath, JSON.stringify(state({
    pending: {
      idempotencyKey: "idempotency",
      clientOrderId: "x",
      phase: "planned",
      symbol: "FETUSDT",
      side: "SELL",
      quantity: 1,
      reduceOnly: false,
      referenceTs: 100,
      createdAt: 100,
      updatedAt: 100,
    },
  })));
  await assert.rejects(() => migrateQuality102CausalV1State({ statePath, fromRuntimeSha: FROM, toRuntimeSha: TO }), /QUALITY102_STATE_MIGRATION_PENDING_REQUIRES_RECONCILIATION/);

  await writeFile(statePath, JSON.stringify(state({ strategyId: "OTHER" })));
  await assert.rejects(() => migrateQuality102CausalV1State({ statePath, fromRuntimeSha: FROM, toRuntimeSha: TO }), /QUALITY102_STATE_(MIGRATION|MALFORMED)/);

  await writeFile(statePath, JSON.stringify(state({ runtimeCommitSha: "c".repeat(40) })));
  await assert.rejects(() => migrateQuality102CausalV1State({ statePath, fromRuntimeSha: FROM, toRuntimeSha: TO }), /QUALITY102_STATE_(MIGRATION|MALFORMED)/);
});
