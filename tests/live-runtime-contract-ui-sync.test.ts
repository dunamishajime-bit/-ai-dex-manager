import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const runtimeSha = "8a2d73f7ad46d234dda161d1471191b2b09fa2bd";
const oldRuntimeSha = "c9018e0fcddb1f68bc1aaa11226afd178021e9f8";
const read = (path: string) => readFileSync(path, "utf8");

test("HP config points all current LIVE lineages at the verified runtime SHA", () => {
  const config = read("lib/disterminal-live-config.ts");
  assert.equal(config.includes(oldRuntimeSha), false, "obsolete production SHA must not remain in current LIVE config");
  assert.ok((config.match(new RegExp(runtimeSha, "g")) || []).length >= 10, "all current runtime references should use the deployed SHA");
  assert.match(config, /Recovery V8/);
  assert.match(config, /Quality102 Causal V4/);
  assert.match(config, /1[- ]slot/i);
});

test("current HP strategy copy matches the deployed LIVE contract", () => {
  const decision = read("lib/server/disdex-decision-status.ts");
  const home = read("app/page.tsx");
  const positions = read("app/positions/page.tsx");
  const banner = read("components/layout/LiveProductionBanner.tsx");
  const combined = [decision, home, positions, banner].join("\n");
  assert.match(decision, /PENGU Dual LS V2 \/ Short V20 \+ Recovery V8/);
  assert.match(combined, /V12 X1\.00 ALL Top2/);
  assert.match(combined, /Quality102 Causal V4/);
  assert.equal(/Q102\s+0\.50x/i.test(combined), false, "current LIVE surfaces must not advertise Q102 0.50x");
});

test("historical frozen Q102 remains separate from LIVE Q102", () => {
  const config = read("lib/disterminal-live-config.ts");
  assert.match(config, /strictBt33404708902:[\s\S]*quality102PositionCap:\s*0\.5/);
  assert.match(config, /quality102Runtime:[\s\S]*strategyGrossCap:\s*1/);
  assert.match(config, /quality102Runtime:[\s\S]*selectorMode:\s*"CAUSAL_V4"/);
});
