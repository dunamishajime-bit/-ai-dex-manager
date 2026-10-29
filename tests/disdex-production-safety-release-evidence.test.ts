import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical production target keeps dynamic Gross allocation disabled", async () => {
  const target = JSON.parse(await readFile("docs/production/current-live-target.json", "utf8"));
  assert.equal(target.strategy.portfolio.cryptoGrossCap, 3);
  assert.equal(target.strategy.portfolio.totalGrossCap, 4.25);
  assert.equal(target.strategy.portfolio.sharedCryptoDailyLossPct, 7.5);
  assert.equal(target.strategy.portfolio.grossGovernor.mode, "FIXED_BASE_CAPS_ONLY");
  assert.equal(target.strategy.portfolio.grossGovernor.dynamicAllocationEnabled, false);
  assert.deepEqual(target.strategy.portfolio.grossGovernor.researchTiersDisabled, ["PROFIT_1", "PROFIT_2", "PROFIT_3", "PROFIT_4"]);
  assert.equal("tiers" in target.strategy.portfolio.grossGovernor, false);
});

test("release evidence generator is immutable-source/read-only and preserves external blockers", async () => {
  const source = await readFile("scripts/ops/root/disdex-multisha-release-evidence.mjs", "utf8");
  assert.match(source, /sha256/i);
  assert.match(source, /BLOCKED_OPERATOR_AUTH/);
  assert.match(source, /BLOCKED_NATIVE_HISTORY/);
  assert.match(source, /BLOCKED_VENUE_EVIDENCE/);
  assert.match(source, /DISDEX_SIGNED_VENUE_EVIDENCE_PATH/);
  assert.match(source, /SIGNED_READONLY_GET_VERIFIED/);
  assert.match(source, /ordersSent:\s*0/);
  assert.match(source, /OPERATOR_LIVE_ACTIVATION_REQUIRED/);
  assert.doesNotMatch(source, /ASTER_API_SECRET|DISDEX_API_KEY|private[_-]?key|Vercel/i);
  assert.match(source, /\.disdex-release-sha/);
});
