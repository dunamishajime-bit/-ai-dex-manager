import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Top3/FET/Q102 shadow runner has no trading mutation or direct Aster network calls", async () => {
  const source = await readFile("scripts/disdex-top3-fet-q102-shadow.ts", "utf8");
  for (const forbidden of [
    "AsterV3Client",
    ".placeMarketOrder(",
    ".placeConditionalOrder(",
    ".cancelOrder(",
    ".cancelAllOpenOrders(",
    ".setLeverage(",
    ".setMarginType(",
    ".getIncomeHistory(",
    ".getKlines(",
    "fetch(",
  ]) {
    assert.equal(source.includes(forbidden), false, `shadow runner must not call/use ${forbidden}`);
  }
  assert.match(source, /networkRequests:\s*0/);
  assert.match(source, /ordersSent:\s*0/);
  assert.match(source, /cancelsSent:\s*0/);
  assert.match(source, /positionChangesSent:\s*0/);
  assert.match(source, /tradingMutation:\s*0/);
});

test("shadow systemd unit reads production state but only writes to its dedicated state directory", async () => {
  const unit = await readFile("ops/systemd/disdex-top3-fet-q102-shadow@.service", "utf8");
  assert.match(unit, /ReadOnlyPaths=.*\/var\/lib\/disdex\/v12-x1-all/);
  assert.match(unit, /ReadOnlyPaths=.*\/var\/lib\/disdex\/quality102-causal-v1/);
  assert.match(unit, /ReadOnlyPaths=.*\/var\/lib\/disdex\/shared/);
  assert.match(unit, /StateDirectory=disdex\/top3-fet-q102-shadow/);
  assert.match(unit, /StateDirectoryMode=0700/);
  assert.doesNotMatch(unit, /ReadWritePaths=/);
  assert.doesNotMatch(unit, /EnvironmentFile=/);
});
