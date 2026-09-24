import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const unit = readFileSync("ops/systemd/disdex-quality102-causal-v1@.service", "utf8");

test("Q102 service auto-recovers only a proven no-exposure planned pending before live preflight", () => {
  const recovery = unit.indexOf("scripts/disdex-quality102-pending-order-recovery.ts");
  const preflight = unit.indexOf("scripts/disdex-quality102-causal-v1-live-runner.ts --preflight");
  assert.ok(recovery >= 0, "planned pending recovery must be wired into the service start gate");
  assert.ok(recovery < preflight, "planned pending recovery must run before Q102 live preflight");
  assert.match(unit, /scripts\/disdex-quality102-pending-order-recovery\.ts --allow-no-pending --apply --sha %i/);
  assert.match(unit, /--allow-no-pending/);
  assert.match(unit, /--ack I_ACK_Q102_NO_EXPOSURE_PENDING_RECOVERY_AFTER_THREE_READONLY_ROUNDS/);
  assert.match(unit, /--apply --sha %i[\s\S]*--ack I_ACK_Q102_NO_EXPOSURE_PENDING_RECOVERY_AFTER_THREE_READONLY_ROUNDS/);
});
