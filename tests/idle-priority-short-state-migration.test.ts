import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { emptyIdleState, writeIdleState } from "../lib/idle-priority-short-state";
import { migrateIdlePriorityShortState } from "../scripts/disdex-idle-priority-short-state-migrate";

const FROM = "2e49a3bd150e432858a2d8fa805d45c55f4949c6";
const TO = "148392fe4c8930a96a5bf3f8a80644455ae6048c";

test("flat Idle state migrates with exact backup and read-back", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-idle-migrate-"));
  const statePath = join(root, "state.json");
  try {
    await writeIdleState(statePath, emptyIdleState(FROM, 1000));
    const before = await readFile(statePath);
    const result = await migrateIdlePriorityShortState({ statePath, toSha: TO });
    assert.equal(result.status, "IDLE_STATE_SHA_MIGRATE_PASS");
    assert.equal((await readFile(result.backupPath)).equals(before), true);
    const after = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(after.runtimeSha, TO);
    assert.deepEqual(after.positions, []);
    assert.equal(after.pending, null);
    assert.equal(after.manualReview, null);
    const again = await migrateIdlePriorityShortState({ statePath, toSha: TO });
    assert.equal(again.status, "IDLE_STATE_SHA_MIGRATE_ALREADY_CURRENT");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Idle state migration fails closed for exposure or review state", async () => {
  const root = await mkdtemp(join(tmpdir(), "disdex-idle-migrate-"));
  const statePath = join(root, "state.json");
  try {
    const state = emptyIdleState(FROM, 1000);
    state.manualReview = "MANUAL_REVIEW_REQUIRED";
    await writeIdleState(statePath, state);
    await assert.rejects(
      () => migrateIdlePriorityShortState({ statePath, toSha: TO }),
      /IDLE_STATE_SHA_MIGRATE_REVIEW_OR_EXPOSURE_PRESENT/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
