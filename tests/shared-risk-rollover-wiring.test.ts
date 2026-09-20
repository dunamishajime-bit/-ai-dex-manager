import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("V12 waits for UTC rollover outside the account lock even while a position is held", async () => {
  const source = await readFile("lib/v12-live-execution-engine.ts", "utf8");
  const waitAt = source.indexOf("await readSharedCryptoDailyRiskWithRolloverRetry");
  const lockAt = source.indexOf("this.d.lock.acquire", waitAt);
  assert.ok(waitAt >= 0, "V12 must invoke rollover retry");
  assert.ok(lockAt >= 0, "V12 account lock acquisition missing");
  assert.ok(waitAt < lockAt, "V12 rollover wait must happen before account lock acquisition");
  const preLock = source.slice(Math.max(0, waitAt - 600), lockAt);
  assert.match(preLock, /if \(!beforeLockState\.pending\)/);
  assert.doesNotMatch(preLock, /activePositionsOf\(beforeLockState\)\.length === 0/, "held V12 positions must not bypass rollover retry");
  assert.match(preLock, /rolloverGraceMs:\s*60_000/);
  assert.match(preLock, /pollMs:\s*2_000/);
  assert.match(preLock, /maxAttempts:\s*31/);
  assert.match(source, /readSharedCryptoDailyRisk\([^\n]+\)/, "V12 must retain normal in-lock risk validation");
});

test("PENGU waits through UTC rollover before the account lock even while a position is held", async () => {
  const source = await readFile("lib/pengu-dual-ls-v2-portfolio-runner.ts", "utf8");
  const waitAt = source.indexOf("await readSharedCryptoDailyRiskWithRolloverRetry");
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


test("Q102 flat entry waits through UTC rollover before the account lock without consuming the signal", async () => {
  const source = await readFile("lib/disdex-quality102-causal-v1-runner.ts", "utf8");
  const waitAt = source.indexOf("await readSharedCryptoDailyRiskWithRolloverRetry");
  const lockAt = source.indexOf("this.dependencies.lock.acquire", waitAt);
  assert.ok(waitAt >= 0, "Q102 must invoke rollover retry");
  assert.ok(lockAt >= 0, "Q102 account lock acquisition missing");
  assert.ok(waitAt < lockAt, "Q102 rollover wait must happen before account lock acquisition");
  const preLock = source.slice(Math.max(0, waitAt - 900), lockAt);
  assert.match(preLock, /this\.dependencies\.config\.mode === "LIVE"/);
  assert.match(preLock, /!beforeLockState\.pending/);
  assert.match(preLock, /!beforeLockState\.position/);
  assert.match(preLock, /rolloverGraceMs:\s*60_000/);
  assert.match(preLock, /pollMs:\s*2_000/);
  assert.match(preLock, /maxAttempts:\s*31/);
  const riskBlockAt = source.indexOf("refreshQ102StateAfterRiskBlock(state, this.now())");
  const nextSignalAt = source.indexOf("const baseSignal = this.buildSignal", riskBlockAt);
  const riskBlock = source.slice(riskBlockAt, nextSignalAt);
  assert.doesNotMatch(riskBlock, /lastProcessedReferenceTs\s*=/, "Q102 risk hold must not consume the entry reference");
});

test("PENGU signal-reference bookkeeping is observational and does not gate same-signal retry", async () => {
  const source = await readFile("lib/pengu-dual-ls-v2-portfolio-runner.ts", "utf8");
  assert.doesNotMatch(source, /if\s*\([^)]*lastSignalReferenceTs/);
  assert.doesNotMatch(source, /lastSignalReferenceTs\s*(?:===|!==|<=|>=|<|>)/);
  const assignments = source.match(/state\.lastSignalReferenceTs\s*=\s*signal\.referenceTs/g) || [];
  assert.ok(assignments.length >= 2, "PENGU should retain signal-reference observability writes");
});
