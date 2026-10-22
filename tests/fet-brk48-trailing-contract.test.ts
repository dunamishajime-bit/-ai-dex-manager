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
  assert.match(unit, /Environment=FET_BRK48_OPERATOR_ACTIVATION_PATH=\/var\/lib\/disdex\/shared\/operator-activation\/fet-brk48\.json/);
  assert.match(unit, /--activation-path \/var\/lib\/disdex\/shared\/operator-activation\/fet-brk48\.json/);
  assert.match(unit, /Environment=DISDEX_ACCOUNT_LOCK_PATH=\/var\/lib\/disdex\/shared\/account-order\.lock/);
  assert.match(unit, /Environment=DISDEX_SHARED_CRYPTO_DAILY_RISK_FILE=\/var\/lib\/disdex\/shared\/crypto-daily-risk\.json/);
  assert.match(unit, /ReadWritePaths=.*\/var\/lib\/disdex\/shared/);

  const runner = await readFile("scripts/disdex-fet-brk48-live-runner.ts", "utf8");
  assert.match(runner, /FET_TRAILING_STOP_POLICY_MISMATCH/);
  assert.match(runner, /trailingStopPolicy/);
});
