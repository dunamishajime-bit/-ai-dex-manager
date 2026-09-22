import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("current runtime wiring retargets Q102 ranking observer to the deployed SHA", async () => {
  const source = await readFile("scripts/ops/root/disdex-current-runtime-wiring", "utf8");

  assert.match(source, /Q102_RANKING_OBSERVER_SERVICE="disdex-quality102-ranking-observer@\$\{DEPLOYED_SHA\}\.service"/);
  assert.match(source, /Q102_RANKING_OBSERVER_TIMER="disdex-quality102-ranking-observer@\$\{DEPLOYED_SHA\}\.timer"/);
  assert.match(source, /scripts\/generated\/disdex-quality102-ranking-observer\.cjs/);
  assert.match(source, /retarget_quality102_ranking_observer\(\)/);
  assert.match(source, /systemctl list-unit-files 'disdex-quality102-ranking-observer@\*\.timer'/);
  assert.match(source, /systemctl disable --now "\$unit"/);
  assert.match(source, /systemctl enable --now "\$Q102_RANKING_OBSERVER_TIMER"/);
  assert.match(source, /systemctl start "\$Q102_RANKING_OBSERVER_SERVICE"/);
  assert.match(source, /retarget_quality102_ranking_observer\n\n  if operator_activation_all_trading_ready/);
});
