import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
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

test("PENGU uses the FET and Q102 pins separately at the FET reduction boundary", () => {
  const source = readFileSync(new URL("../lib/pengu-dual-ls-v2-portfolio-runner.ts", import.meta.url), "utf8");
  const boundary = source.match(/if \(fetReduction\) \{([\s\S]*?)if \(reduced.status/);
  assert.ok(boundary);
  assert.match(boundary[1], /const owners = await readFetCoreOwnerPins\(\);/);
  assert.match(boundary[1], /expectedRuntimeSha:\s*owners\.fet,/);
  assert.match(boundary[1], /expectedQ102RuntimeSha:\s*owners\.q102,/);
});
