import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { migrateHypeZecLongRuntimeState } from "../scripts/disdex-hype-zec-long-state-migrate";

const FROM = "a".repeat(40);
const TO = "b".repeat(40);

test("migrates a flat HYPE state with an exact backup and preserves unknown fields", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-migrate-"));
  try {
    const statePath = join(root, "runner.json");
    const original = {
      schema: "disdex-hype-zec-long/v1",
      runtimeCommitSha: FROM,
      mode: "LIVE",
      updatedAt: 123,
      positions: null,
      pending: null,
      manualReview: null,
      failures: [],
      futureField: { keep: true },
    };
    const originalBytes = `${JSON.stringify(original, null, 2)}\n`;
    await writeFile(statePath, originalBytes, { mode: 0o600 });
    const result = await migrateHypeZecLongRuntimeState({ statePath, toSha: TO });
    assert.equal(result.status, "HYPE_ZEC_LONG_STATE_MIGRATE_PASS");
    assert.equal(JSON.parse(await readFile(statePath, "utf8")).runtimeCommitSha, TO);
    assert.deepEqual(JSON.parse(await readFile(result.backupPath, "utf8")), original);
    if (process.platform !== "win32") assert.equal((await stat(result.backupPath)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refuses HYPE state migration when exposure, pending, or manual review exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "hype-zec-migrate-refuse-"));
  try {
    const cases = [
      { positions: [{ symbol: "HYPEUSDT", quantity: 1 }] },
      { pending: { action: "ENTRY" } },
      { manualReview: "operator review" },
    ];
    for (let i = 0; i < cases.length; i += 1) {
      const statePath = join(root, `state-${i}.json`);
      await writeFile(statePath, JSON.stringify({ schema: "disdex-hype-zec-long/v1", runtimeCommitSha: FROM, mode: "LIVE", updatedAt: 1, failures: [], ...cases[i] }));
      await assert.rejects(() => migrateHypeZecLongRuntimeState({ statePath, toSha: TO }), /HYPE_ZEC_LONG_STATE_MIGRATE_(POSITIONS|PENDING|MANUAL_REVIEW)/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

