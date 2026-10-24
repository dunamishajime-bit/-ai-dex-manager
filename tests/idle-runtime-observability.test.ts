import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadIdleRuntimeObservability } from "../lib/server/idle-runtime-observability";

test("Idle runtime is LIVE only when state, SHA, freshness, and service are all verified", async () => {
  const root = await mkdtemp(join(tmpdir(), "idle-runtime-"));
  try {
    const decisionPath = join(root, "decision.json");
    const detailsPath = join(root, "details.json");
    const now = 1_800_000_000_000;
    await writeFile(decisionPath, JSON.stringify({ runtimeSha: "a".repeat(40), updatedAt: now }), "utf8");
    await writeFile(detailsPath, JSON.stringify({ runtimeSha: "a".repeat(40), updatedAt: now }), "utf8");
    const result = await loadIdleRuntimeObservability({
      now,
      expectedSha: "a".repeat(40),
      decisionPath,
      detailsPath,
      readSystemd: async () => "active",
    });
    assert.equal(result.status, "LIVE");
    assert.equal(result.runtimeSha, "a".repeat(40));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
