import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { FET_BRK48_RESIDUAL } from "../config/fetBrk48Runtime";
import { FET_BRK48_TRAILING_STOP_POLICY } from "../lib/fet-brk48-trailing-stop";

test("FET trailing policy and production wiring stay bound to the adopted research contract", async () => {
  assert.equal(FET_BRK48_RESIDUAL.trailingStopPolicyId, FET_BRK48_TRAILING_STOP_POLICY.id);
  assert.equal(FET_BRK48_RESIDUAL.trailingStopArmPct, FET_BRK48_TRAILING_STOP_POLICY.armGainPct);
  assert.equal(FET_BRK48_RESIDUAL.trailingStopGivebackPctPoints, FET_BRK48_TRAILING_STOP_POLICY.givebackPctPoints);

  const unit = await readFile("ops/systemd/disdex-fet-brk48@.service", "utf8");
  assert.match(unit, /Environment=FET_BRK48_TRAILING_STOP_ENABLED=true/);
  assert.match(unit, /Environment=FET_BRK48_TRAILING_STOP_POLICY=FET_TRAIL_8P_GIVEBACK_4P/);

  const runner = await readFile("scripts/disdex-fet-brk48-live-runner.ts", "utf8");
  assert.match(runner, /FET_TRAILING_STOP_POLICY_MISMATCH/);
  assert.match(runner, /trailingStopPolicy/);
});
