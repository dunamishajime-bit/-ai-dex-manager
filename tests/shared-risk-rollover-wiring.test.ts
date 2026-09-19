import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("V12 waits for UTC rollover outside the account lock for flat entry evaluation", async () => {
  const source = await readFile("lib/v12-live-execution-engine.ts", "utf8");
  const waitAt = source.indexOf("readSharedCryptoDailyRiskWithRolloverRetry");
  const lockAt = source.indexOf("this.d.lock.acquire");
  assert.ok(waitAt >= 0, "V12 must invoke rollover retry");
  assert.ok(lockAt >= 0, "V12 account lock acquisition missing");
  assert.ok(waitAt < lockAt, "V12 rollover wait must happen before account lock acquisition");
  assert.match(source, /!beforeLockState\.pending[\s\S]{0,160}activePositionsOf\(beforeLockState\)\.length === 0/);
  assert.match(source, /readSharedCryptoDailyRisk\([^\n]+\)/, "V12 must retain normal in-lock risk validation");
});

test("PENGU waits through UTC rollover before the account lock even while a position is held", async () => {
  const source = await readFile("lib/pengu-dual-ls-v2-portfolio-runner.ts", "utf8");
  const waitAt = source.indexOf("readSharedCryptoDailyRiskWithRolloverRetry");
  const lockAt = source.indexOf("this.dependencies.lock.acquire");
  assert.ok(waitAt >= 0, "PENGU must invoke rollover retry");
  assert.ok(lockAt >= 0, "PENGU account lock acquisition missing");
  assert.ok(waitAt < lockAt, "PENGU rollover wait must happen before account lock acquisition");

  const preLock = source.slice(Math.max(0, waitAt - 600), lockAt);
  assert.match(preLock, /if \(!beforeLockState\.pending && sharedPath\)/);
  assert.doesNotMatch(preLock, /!beforeLockState\.position/, "held PENGU positions must not bypass rollover retry");
  assert.match(preLock, /rolloverGraceMs:\s*60_000/);
  assert.match(preLock, /pollMs:\s*2_000/);
  assert.match(preLock, /maxAttempts:\s*31/);
  assert.match(source, /readSharedCryptoDailyRisk\([^\n]+\)/, "PENGU must retain normal in-lock risk validation");
});
