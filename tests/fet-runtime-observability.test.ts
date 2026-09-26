import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";

import { loadFetRuntimeObservability } from "../lib/server/fet-runtime-observability";

test("fresh FET heartbeat state is exposed as LIVE when the release SHA matches", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-fet-observability-"));
  const statePath = join(directory, "state.json");
  const now = Date.parse("2026-09-26T00:00:00.000Z");
  await writeFile(statePath, JSON.stringify({
    schema: "fet-brk48-residual-state/v1",
    strategyId: "FET_BRK48_RESIDUAL",
    runtimeCommitSha: "a".repeat(40),
    updatedAt: now - 30_000,
    failures: [],
  }), "utf8");
  const previousPath = process.env.FET_BRK48_RESIDUAL_STATE_PATH;
  process.env.FET_BRK48_RESIDUAL_STATE_PATH = statePath;
  try {
    const result = await loadFetRuntimeObservability({ now, expectedReleaseSha: "a".repeat(40) });
    assert.equal(result.status, "LIVE");
    assert.equal(result.stateFresh, true);
    assert.equal(result.strategyOk, true);
    assert.equal(result.releaseShaVerified, true);
  } finally {
    if (previousPath === undefined) delete process.env.FET_BRK48_RESIDUAL_STATE_PATH;
    else process.env.FET_BRK48_RESIDUAL_STATE_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});

test("stale FET heartbeat state is never shown as LIVE", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-fet-observability-"));
  const statePath = join(directory, "state.json");
  const now = Date.parse("2026-09-26T00:00:00.000Z");
  await writeFile(statePath, JSON.stringify({
    schema: "fet-brk48-residual-state/v1",
    strategyId: "FET_BRK48_RESIDUAL",
    runtimeCommitSha: "b".repeat(40),
    updatedAt: now - (4 * 60 * 60 * 1000),
    failures: [],
  }), "utf8");
  const previousPath = process.env.FET_BRK48_RESIDUAL_STATE_PATH;
  process.env.FET_BRK48_RESIDUAL_STATE_PATH = statePath;
  try {
    const result = await loadFetRuntimeObservability({ now, expectedReleaseSha: "b".repeat(40) });
    assert.equal(result.status, "STALE");
    assert.equal(result.stateFresh, false);
  } finally {
    if (previousPath === undefined) delete process.env.FET_BRK48_RESIDUAL_STATE_PATH;
    else process.env.FET_BRK48_RESIDUAL_STATE_PATH = previousPath;
    await rm(directory, { recursive: true, force: true });
  }
});
