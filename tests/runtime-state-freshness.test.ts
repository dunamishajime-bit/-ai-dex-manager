import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadPenguRuntimeObservability } from "@/lib/server/pengu-runtime-observability";
import { v12DecisionSnapshotIsCurrent } from "@/lib/server/v12-snapshot-freshness";

test("V12 hides a decision snapshot older than the runner reference", () => {
  assert.equal(v12DecisionSnapshotIsCurrent(100, 200), false);
  assert.equal(v12DecisionSnapshotIsCurrent(200, 200), true);
  assert.equal(v12DecisionSnapshotIsCurrent(300, 200), true);
  assert.equal(v12DecisionSnapshotIsCurrent(undefined, 200), true);
});

test("PENGU observability selects the freshest readable state path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "disdex-pengu-ui-"));
  const legacy = join(dir, "legacy.json");
  const current = join(dir, "current.json");
  const now = Date.now();
  const previous = { ...process.env };
  try {
    await writeFile(legacy, JSON.stringify({ strategyId: "PENGU_DUAL_LS_V2_FINAL", mode: "LIVE", updatedAt: now - 60_000 }));
    await writeFile(current, JSON.stringify({ strategyId: "PENGU_DUAL_LS_V2_FINAL", mode: "LIVE", updatedAt: now }));
    process.env.PENGU_DUAL_LS_V2_DECISION_SNAPSHOT_PATH = legacy;
    process.env.PENGU_DUAL_LS_V2_RUNNER_STATE_PATH = current;
    delete process.env.PENGU_DUAL_LS_V2_STATE_PATH;
    delete process.env.PENGU_RUNTIME_STATE_PATH;
    delete process.env.DISDEX_SHARED_CRYPTO_DAILY_RISK_PATH;
    const result = await loadPenguRuntimeObservability();
    assert.equal(result.status, "LIVE");
    assert.equal(result.updatedAt, now);
  } finally {
    process.env = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test("both V12 UI surfaces check snapshot freshness against runner state", async () => {
  const [detail, ranking] = await Promise.all([
    import("node:fs/promises").then(({ readFile }) => readFile("lib/server/v12-decision-observability.ts", "utf8")),
    import("node:fs/promises").then(({ readFile }) => readFile("lib/server/disdex-decision-status.ts", "utf8")),
  ]);
  assert.match(detail, /v12DecisionSnapshotIsCurrent/);
  assert.match(ranking, /v12DecisionSnapshotIsCurrent/);
});
