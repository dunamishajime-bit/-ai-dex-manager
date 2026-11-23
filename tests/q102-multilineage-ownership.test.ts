import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = [
  "lib/v12-live-execution-engine.ts",
  "lib/v12-strict-live-adapter.ts",
  "lib/pengu-dual-ls-v2-portfolio-runner.ts",
];

test("base sleeves use the Q102-specific runtime SHA for ownership and reductions", async () => {
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /expectedRuntimeSha:\s*process\.env\.DISDEX_RUNTIME_COMMIT_SHA(?!\s*\|\|)/);
    assert.match(source, /DISDEX_Q102_RUNTIME_SHA/);
  }
});

test("runtime wiring exposes Q102 state and runtime SHA to other crypto sleeves", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(source, /QUALITY102_CAUSAL_V1_STATE_PATH=\/var\/lib\/disdex\/quality102-causal-v1\/state\.json/);
  assert.match(source, /DISDEX_Q102_RUNTIME_SHA=\$\{DEPLOYED_SHA\}/);
});
