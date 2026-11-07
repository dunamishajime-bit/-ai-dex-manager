import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { acceptsV1ReadOnlyEvidenceMode } =
  require("../lib/server/read-only-pin-evidence-mode.ts") as typeof import("../lib/server/read-only-pin-evidence-mode");

test("accept installed production v1 evidence labels for display identity", () => {
  for (const value of ["tick-v1", "heartbeat-v1", "legacy", "tick_v1", "heartbeat_v1"]) {
    assert.equal(acceptsV1ReadOnlyEvidenceMode(value), true, value);
  }
});

test("unknown or malformed v1 evidence labels remain rejected", () => {
  for (const value of ["tick-v2", "tickV1", "", null, undefined, 1, {}, "legacy "]) {
    assert.equal(acceptsV1ReadOnlyEvidenceMode(value), false, String(value));
  }
});
