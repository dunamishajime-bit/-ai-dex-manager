import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Q102 live unit repairs market history ownership before daemon start", async () => {
  const source = await readFile("ops/systemd/disdex-quality102-causal-v1@.service", "utf8");
  assert.match(source, /ExecStartPre=.*chown deploy:deploy \/var\/lib\/disdex\/quality102-causal-v1\/market-history\.json/);
  assert.match(source, /chmod 600 \/var\/lib\/disdex\/quality102-causal-v1\/market-history\.json/);
  assert.match(source, /ReadWritePaths=\/var\/lib\/disdex\/quality102-causal-v1 \/var\/lib\/disdex\/shared/);
});

test("current runtime wiring keeps the Q102 state path canonical", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");
  assert.match(source, /QUALITY102_CAUSAL_V1_STATE_PATH=\/var\/lib\/disdex\/quality102-causal-v1\/state\.json/);
  assert.match(source, /DISDEX_ASTER_GLOBAL_RATE_BUDGET_PATH=\$\{SHARED_ROOT\}\/aster-rate-budget\.json/);
});
