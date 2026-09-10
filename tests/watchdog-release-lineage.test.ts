import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { resolve } from "node:path";

const source = readFileSync(resolve("scripts/ops/root/disdex-runner-watchdog-current.mjs"), "utf8");

test("watchdog enforces singleton release lineage for every live runner family", () => {
  for (const pattern of ["disdex-v12-x1-all@*.service", "disdex-pengu-dual-ls-v2@*.service", "disdex-v52-aster-only@*.service", "disdex-quality102-causal-v1@*.service"]) {
    assert.match(source, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(source, /assertReleasePinnedRunnerSingleton/);
  assert.match(source, /RUNNER_LINEAGE/);
});

test("watchdog also enforces singleton lineage for margin guard", () => {
  assert.match(source, /disdex-v12-v52-margin-guard@\*\.service/);
});

test("watchdog fails closed if the legacy V96/V52 live supervisor is active", () => {
  assert.match(source, /disdex-v96-v52-live\.service/);
  assert.match(source, /LEGACY_LIVE_CONFLICT/);
});
