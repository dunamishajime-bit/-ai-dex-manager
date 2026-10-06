import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("FET readiness audit keeps exact blocker detail when V52 is stopped", async () => {
  const text = await readFile(new URL("../scripts/ops/root/disdex-fet-preemption-readiness-guard.py", import.meta.url), "utf8");
  assert.match(text, /config_env = \{\}/);
  assert.match(text, /v52_running = pid\.isdigit\(\) and int\(pid\) > 0/);
  assert.match(text, /else:\s*\n\s*env = config_env/);
  assert.match(text, /FET_PREEMPTION_V52_NOT_RUNNING/);
  assert.doesNotMatch(text, /raise ValueError\('V52_NOT_RUNNING'\)/);
});
