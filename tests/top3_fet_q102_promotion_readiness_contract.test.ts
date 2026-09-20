import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("promotion readiness runner is read-only and cannot reach trading/network APIs", async () => {
  const source = await readFile("scripts/disdex-top3-fet-q102-promotion-readiness.ts", "utf8");
  for (const forbidden of [
    "AsterV3Client",
    ".placeMarketOrder(",
    ".placeConditionalOrder(",
    ".cancelOrder(",
    ".cancelAllOpenOrders(",
    ".setLeverage(",
    ".setMarginType(",
    "fetch(",
  ]) {
    assert.equal(source.includes(forbidden), false, `promotion readiness must not call/use ${forbidden}`);
  }
  assert.match(source, /PROMOTION_READINESS_PASS/);
  assert.match(source, /tradingMutation/);
});

test("promotion readiness systemd unit is local-read-only and network isolated", async () => {
  const unit = await readFile("ops/systemd/disdex-top3-fet-q102-promotion-readiness@.service", "utf8");
  assert.match(unit, /Type=oneshot/);
  assert.match(unit, /RestrictAddressFamilies=AF_UNIX/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadOnlyPaths=\/home\/deploy\/disdex-trading \/var\/lib\/disdex\/top3-fet-q102-shadow/);
  assert.doesNotMatch(unit, /ReadWritePaths=/);
  assert.doesNotMatch(unit, /EnvironmentFile=/);
  assert.doesNotMatch(unit, /ExecStart=.*live-runner/);
});
