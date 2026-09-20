import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Top3/FET/Q102 shadow runner has no trading mutation calls", async () => {
  const source = await readFile("scripts/disdex-top3-fet-q102-shadow.ts", "utf8");
  for (const forbidden of [
    ".placeMarketOrder(",
    ".placeConditionalOrder(",
    ".cancelOrder(",
    ".cancelAllOpenOrders(",
    ".setLeverage(",
    ".setMarginType(",
  ]) {
    assert.equal(source.includes(forbidden), false, `shadow runner must not call ${forbidden}`);
  }
  assert.match(source, /ordersSent:\s*0/);
  assert.match(source, /cancelsSent:\s*0/);
  assert.match(source, /positionChangesSent:\s*0/);
  assert.match(source, /tradingMutation:\s*0/);
});

test("shadow systemd unit only writes to its dedicated state directory", async () => {
  const unit = await readFile("ops/systemd/disdex-top3-fet-q102-shadow@.service", "utf8");
  assert.match(unit, /ReadOnlyPaths=.*\/var\/lib\/disdex\/v12-x1-all/);
  assert.match(unit, /ReadWritePaths=\/var\/lib\/disdex\/top3-fet-q102-shadow/);
  assert.doesNotMatch(unit, /ReadWritePaths=.*\/var\/lib\/disdex\/shared/);
});
