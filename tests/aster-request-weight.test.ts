import { strict as assert } from "node:assert";
import test from "node:test";
import { asterFuturesRequestWeight } from "../lib/aster-v3-client";

test("Aster request weights cover heavy user-data endpoints", () => {
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/balance", {}), 5);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/positionRisk", {}), 5);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/openOrders", {}), 40);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/openOrders", { symbol: "BTCUSDT" }), 1);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/income", {}), 30);
});

test("Aster market-data request weights follow documented parameter tiers", () => {
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/klines", { limit: 99 }), 1);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/klines", { limit: 200 }), 2);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/klines", { limit: 500 }), 5);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/ticker/24hr", {}), 40);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/ticker/price", {}), 2);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/fundingRate", { symbol: "PENGUUSDT" }), 1);
  assert.equal(asterFuturesRequestWeight("GET", "/fapi/v3/unknown-future-endpoint", {}), 100);
});
