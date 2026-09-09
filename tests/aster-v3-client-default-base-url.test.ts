import assert from "node:assert/strict";
import test from "node:test";

import { AsterV3Client } from "../lib/aster-v3-client";

test("Aster V3 client defaults to the reachable futures API host", () => {
  const client = new AsterV3Client();
  assert.equal(client.baseUrl, "https://fapi.asterdex.com");
});
