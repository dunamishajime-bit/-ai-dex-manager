import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveRunnerServiceUnit } from "../lib/server/runner-service-resolution";

const current = "d".repeat(40);
const next = "f".repeat(40);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("mixed-SHA HYPE and Idle are accepted only with exact explicit release overrides", () => {
  for (const [id, prefix] of [
    ["HYPE_TREND_LONG", "disdex-hype-long"],
    ["IDLE_PRIORITY_SHORT", "disdex-idle-priority-short"],
  ] as const) {
    const unit = `${prefix}@${next}.service`;
    const result = resolveRunnerServiceUnit(id, current, unit, next);
    assert.equal(result.failClosed, false);
    assert.equal(result.unit, unit);
    assert.equal(result.releaseSha, next);
    const wrong = resolveRunnerServiceUnit(id, current, `${prefix}@${current}.service`, next);
    assert.equal(wrong.failClosed, true);
    const missing = resolveRunnerServiceUnit(id, current, undefined, next);
    assert.equal(missing.failClosed, true);
    const noOverride = resolveRunnerServiceUnit(id, current, unit);
    assert.equal(noOverride.failClosed, true);
  }
});

test("email alert passes HYPE and Idle exact SHA env overrides into resolver", async () => {
  const src = await readFile(join(root, "scripts/ops/root/disdex-runner-health-alert.ts"), "utf8");
  assert.match(src, /runner\.id === "HYPE_TREND_LONG"[\s\S]*?process\.env\.DISDEX_ALERT_HYPE_EXPECTED_SHA/);
  assert.match(src, /runner\.id === "IDLE_PRIORITY_SHORT"[\s\S]*?process\.env\.DISDEX_ALERT_IDLE_EXPECTED_SHA/);
  assert.match(src, /resolveRunnerServiceUnit\(runner\.id, currentReleaseSha, process\.env\[runner\.unitEnv\], expectedShaOverride\)/);
});
