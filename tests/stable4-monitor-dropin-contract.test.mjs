import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const helper = await readFile(new URL("../scripts/ops/deploy/disdex_stable4_safety_repair_cutover.py", import.meta.url), "utf8");

test("STABLE4 monitor cutover resets inherited order-capable commands", () => {
  assert.match(helper, /DISDEX_MONITOR_NEW_ORDERS_ALLOWED=false/);
  assert.match(helper, /QUALITY102_CAUSAL_V1_MONITOR_ONLY=true/);
  assert.match(helper, /QUALITY102_CAUSAL_V1_LIVE_EXECUTION_ENABLED=false/);
  assert.match(helper, /--monitor-only-daemon/);
  assert.match(helper, /scripts\/disdex-quality102-causal-v1-monitor\.ts --daemon/);
  assert.match(helper, /ExecStartPre=\\n/);
  assert.match(helper, /ExecStart=\\n/);
  assert.doesNotMatch(helper, /--clear-global-hold/);
  assert.doesNotMatch(helper, /order\.create|cancelOrder|createOrder/);
});

test("STABLE4 monitor cutover restores drop-ins on rollback", () => {
  assert.match(helper, /snapshot_monitor_dropins/);
  assert.match(helper, /install_monitor_dropins/);
  assert.match(helper, /restore_monitor_dropins/);
  assert.match(helper, /MONITOR_DROPIN_UNEXPECTED_EXISTING/);
});
