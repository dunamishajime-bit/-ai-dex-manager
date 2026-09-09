import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

for (const [label, file, lockNeedle] of [
  ["V12", "lib/v12-live-execution-engine.ts", "this.d.lock.acquire"],
  ["PENGU", "lib/pengu-dual-ls-v2-portfolio-runner.ts", "this.dependencies.lock.acquire"],
] as const) {
  test(`${label} waits for UTC rollover outside the account lock only for flat entry evaluation`, async () => {
    const source = await readFile(file, "utf8");
    const waitAt = source.indexOf("readSharedCryptoDailyRiskWithRolloverRetry");
    const lockAt = source.indexOf(lockNeedle);
    assert.ok(waitAt >= 0, `${label} must invoke rollover retry`);
    assert.ok(lockAt >= 0, `${label} account lock acquisition missing`);
    assert.ok(waitAt < lockAt, `${label} rollover wait must happen before account lock acquisition`);
    assert.match(source, /!beforeLockState\.pending[\s\S]{0,160}!beforeLockState\.(?:active|position)/);
    assert.match(source, /readSharedCryptoDailyRisk\([^\n]+\)/, `${label} must retain normal in-lock risk validation`);
  });
}
