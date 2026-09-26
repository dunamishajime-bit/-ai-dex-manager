import assert from "node:assert/strict";
import test from "node:test";

import {
  HYPE_ZEC_LONG_POLICY,
  HYPE_ZEC_STRATEGIES,
  isHypeZecStrategy,
} from "../config/hypeZecLongPolicy";
import { classifyAsterSymbol } from "../lib/disdex-aster-portfolio-classifier";

test("HYPE/ZEC production contract pins independent risk and gross ceilings", () => {
  assert.deepEqual(HYPE_ZEC_STRATEGIES, ["HYPE_LONG", "ZEC_LONG"]);
  assert.equal(HYPE_ZEC_LONG_POLICY.HYPE_LONG.riskPct, 5.0);
  assert.equal(HYPE_ZEC_LONG_POLICY.ZEC_LONG.riskPct, 4.5);
  assert.equal(HYPE_ZEC_LONG_POLICY.HYPE_LONG.maximumGross, 1.0);
  assert.equal(HYPE_ZEC_LONG_POLICY.ZEC_LONG.maximumGross, 1.0);
  assert.equal(HYPE_ZEC_LONG_POLICY.HYPE_LONG.leverage, 5);
  assert.equal(HYPE_ZEC_LONG_POLICY.ZEC_LONG.leverage, 5);
  assert.equal(HYPE_ZEC_LONG_POLICY.HYPE_LONG.marginType, "cross");
  assert.equal(HYPE_ZEC_LONG_POLICY.ZEC_LONG.marginType, "cross");
  assert.equal(isHypeZecStrategy("HYPE_LONG"), true);
  assert.equal(isHypeZecStrategy("ZEC_LONG"), true);
  assert.equal(isHypeZecStrategy("V12"), false);
});

test("HYPE and ZEC are explicit long-only sidecar owners", () => {
  const hype = classifyAsterSymbol("HYPEUSDT", "HYPE_LONG" as never);
  const zec = classifyAsterSymbol("ZECUSDT", "ZEC_LONG" as never);
  assert.equal(hype.tradable, true);
  assert.equal(hype.sleeve, "HYPE_LONG");
  assert.equal(zec.tradable, true);
  assert.equal(zec.sleeve, "ZEC_LONG");
  assert.equal(classifyAsterSymbol("HYPEUSDT", "ZEC_LONG" as never).tradable, false);
  assert.equal(classifyAsterSymbol("ZECUSDT", "HYPE_LONG" as never).tradable, false);
});
