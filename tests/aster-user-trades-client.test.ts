import test from "node:test";
import assert from "node:assert/strict";
import { AsterV3Client, asterFuturesRequestWeight } from "../lib/aster-v3-client";

test("getUserTrades is a signed read-only GET with bounded request weight", async () => {
  let observedUrl = "";
  let observedMethod = "";
  const client = new AsterV3Client({
    userAddress: "0x0000000000000000000000000000000000000001",
    privateKey: `0x${"1".repeat(64)}`,
    readOnlyRateLimitMaxRetries: 0,
    fetchImpl: async (input, init) => {
      observedUrl = String(input);
      observedMethod = String(init?.method || "");
      return new Response(JSON.stringify([{ symbol: "BTCUSDT", id: 7, time: 1000 }]), { status: 200 });
    },
  });
  const rows = await client.getUserTrades("btcusdt", { limit: 10 });
  assert.equal(observedMethod, "GET");
  assert.match(observedUrl, /\/fapi\/v3\/userTrades\?/);
  assert.match(observedUrl, /symbol=BTCUSDT/);
  assert.match(observedUrl, /signature=0x[0-9a-f]+/i);
  assert.equal(rows[0]?.id, 7);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/userTrades", { symbol: "BTCUSDT" }), 5);
});
