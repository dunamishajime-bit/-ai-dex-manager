import assert from "node:assert/strict";
import {
  QUALITY102_CAUSAL_V4_DEVELOPMENT_PERIOD,
  QUALITY102_CAUSAL_V4_S34_KEYS,
  QUALITY102_CAUSAL_V4_S34_MODEL,
} from "../config/disdexQuality102CausalV4Model";

assert.deepEqual(QUALITY102_CAUSAL_V4_DEVELOPMENT_PERIOD, {
  startInclusive: "2025-03-01T00:00:00Z",
  endExclusive: "2025-08-01T00:00:00Z",
  source: "PRE_EVALUATION_DEVELOPMENT_ONLY",
});
assert.equal(QUALITY102_CAUSAL_V4_S34_MODEL.length, 31);
assert.equal(new Set(QUALITY102_CAUSAL_V4_S34_KEYS).size, 31);
assert.ok(QUALITY102_CAUSAL_V4_S34_MODEL.every((row) => row.key === `${row.symbol.replace(/USDT$/, "")}|${row.variant}`));
assert.ok(QUALITY102_CAUSAL_V4_S34_MODEL.every((row) => ["S3", "S4"].includes(row.layer)));
assert.ok(QUALITY102_CAUSAL_V4_S34_MODEL.every((row) => row.developmentN >= 0 && Number.isFinite(row.developmentSpf) && Number.isFinite(row.developmentAvg)));
assert.ok(!JSON.stringify(QUALITY102_CAUSAL_V4_S34_MODEL).includes("2025-08-10"));
assert.ok(!JSON.stringify(QUALITY102_CAUSAL_V4_S34_MODEL).includes("2026-"));
assert.ok(QUALITY102_CAUSAL_V4_S34_KEYS.includes("FET|BRK24_H48_V1.2"));
assert.ok(QUALITY102_CAUSAL_V4_S34_KEYS.includes("UNI|MR72_Z1.5_H24"));
console.log("QUALITY102_CAUSAL_V4_MODEL_SELFTEST_PASS", JSON.stringify({ keys: QUALITY102_CAUSAL_V4_S34_MODEL.length }));
