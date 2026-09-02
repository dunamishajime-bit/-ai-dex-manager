import assert from "node:assert/strict";

import { alignV12H1ForH2 } from "../lib/v12-aster-market-data-provider";

const result = alignV12H1ForH2([
  { ts: 3_600_000 },
  { ts: 7_200_000 },
  { ts: 10_800_000 },
  { ts: 14_400_000 },
] as never);

assert.deepEqual(result.map((row) => row.ts), [7_200_000, 10_800_000, 14_400_000]);
assert.deepEqual(alignV12H1ForH2([{ ts: 3_600_000 }] as never), []);

console.log("V12_MARKET_DATA_PROVIDER_SELFTEST_PASS");
