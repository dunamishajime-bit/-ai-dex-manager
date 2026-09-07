import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createQuality102CausalV1State,
  FileQuality102CausalV1StateStore,
} from "../lib/disdex-quality102-causal-v1-state";
import { migrateQuality102CausalV1State } from "./disdex-quality102-causal-v1-state-migrate";

const FROM_SHA = "3f060852046f282926bd57f472288d4f1a8dc404";
const TO_SHA = "203eb28b2ff26920096cf21ba15fabec8986e1e1";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "disdex-q102-state-migrate-"));
  try {
    const statePath = join(root, "state.json");
    const backupPath = join(root, "state.json.backup");
    const initial = {
      ...createQuality102CausalV1State("LIVE", FROM_SHA),
      lastProcessedReferenceTs: 123,
      failures: [{ occurredAt: 100, message: "prior-safe-failure" }],
    };
    await writeFile(statePath, `${JSON.stringify(initial, null, 2)}\n`, { mode: 0o600 });

    const result = await migrateQuality102CausalV1State({
      statePath,
      fromRuntimeSha: FROM_SHA,
      toRuntimeSha: TO_SHA,
      backupPath,
    });
    assert.equal(result.status, "QUALITY102_STATE_MIGRATION_PASS");
    assert.equal(result.ordersSent, 0);
    assert.equal(result.positionChangesSent, 0);
    assert.equal((await stat(backupPath)).isFile(), true);

    const migrated = await new FileQuality102CausalV1StateStore(statePath, "LIVE", TO_SHA).load();
    assert.equal(migrated.runtimeCommitSha, TO_SHA);
    assert.equal(migrated.lastProcessedReferenceTs, initial.lastProcessedReferenceTs);
    assert.deepEqual(migrated.failures, initial.failures);
    assert.equal(JSON.parse(await readFile(backupPath, "utf8")).runtimeCommitSha, FROM_SHA);

    const pendingPath = join(root, "pending.json");
    const pending = {
      ...initial,
      pending: {
        idempotencyKey: "idempotency",
        clientOrderId: "client",
        phase: "submitted" as const,
        symbol: "SUIUSDT",
        side: "BUY" as const,
        quantity: 1,
        reduceOnly: false,
        referenceTs: 123,
        createdAt: 123,
        updatedAt: 123,
        targetGross: 0.5,
      },
    };
    await writeFile(pendingPath, `${JSON.stringify(pending, null, 2)}\n`, { mode: 0o600 });
    await assert.rejects(
      () => migrateQuality102CausalV1State({ statePath: pendingPath, fromRuntimeSha: FROM_SHA, toRuntimeSha: TO_SHA }),
      /QUALITY102_STATE_MIGRATION_PENDING_REQUIRES_RECONCILIATION/,
    );
    assert.equal(await stat(`${pendingPath}.before-${TO_SHA}`).then(() => true).catch(() => false), false);
    assert.equal(JSON.parse(await readFile(pendingPath, "utf8")).runtimeCommitSha, FROM_SHA);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log("QUALITY102_CAUSAL_V1_STATE_MIGRATION_SELFTEST_PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
