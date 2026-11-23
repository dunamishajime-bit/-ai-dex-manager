import assert from "node:assert/strict";
import test from "node:test";
import { parseFetCoreOwnerPins } from "../lib/fet-preempt-owner-pins.ts";

test("a V52 caller cannot substitute its release for missing FET or Q102 ownership", () => {
  const caller = "a".repeat(40);
  const fet = "b".repeat(40);
  const q102 = "c".repeat(40);
  const pin = (sha, unit) => ({ sha, serviceUnit: unit + "@" + sha + ".service",
    releaseRoot: "/home/deploy/disdex-trading/releases/" + sha });
  const runners = { V52: pin(caller, "disdex-v52-aster-only") };
  const manifest = { schema: "disdex-runner-pin-manifest/v1", runners };
  assert.throws(() => parseFetCoreOwnerPins(manifest), /FET_OWNER_SHA_PIN_REQUIRED/);
  runners.FET_BRK48_RESIDUAL = pin(fet, "disdex-fet-brk48");
  assert.throws(() => parseFetCoreOwnerPins(manifest), /Q102_OWNER_SHA_PIN_REQUIRED/);
  runners.QUALITY102_CAUSAL_V1 = pin(q102, "disdex-quality102-causal-v1");
  assert.deepEqual(parseFetCoreOwnerPins(manifest), { fet, q102 });
  runners.FET_BRK48_RESIDUAL.releaseRoot = runners.V52.releaseRoot;
  assert.throws(() => parseFetCoreOwnerPins(manifest), /FET_OWNER_SHA_PIN_REQUIRED/);
});
