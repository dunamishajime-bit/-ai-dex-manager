import assert from "node:assert/strict";

import { classifyV52PreflightFailure, containsDataFailure, isUsRegularEquitySession, shouldStartV52Worker } from "./disdex-v13d-v11eq-v96-strategy-preflight";

assert.equal(containsDataFailure('{"error":"iex_quote_unavailable","symbol":"AMZN"}'), true);
assert.equal(classifyV52PreflightFailure("iex_quote_unavailable", new Date("2026-08-03T20:01:00.000Z")), "WAITING_MARKET_CLOSED");
assert.equal(classifyV52PreflightFailure("cross_source_divergence", new Date("2026-08-03T15:00:00.000Z")), "BLOCKED_DATA_UNAVAILABLE");
assert.equal(classifyV52PreflightFailure("Aster authentication failed", new Date("2026-08-03T20:01:00.000Z")), undefined);
assert.equal(isUsRegularEquitySession(new Date("2026-08-03T20:01:00.000Z")), false);
assert.equal(isUsRegularEquitySession(new Date("2026-08-03T15:00:00.000Z")), true);
assert.equal(shouldStartV52Worker("ACTIVE"), true);
assert.equal(shouldStartV52Worker("WAITING_MARKET_CLOSED"), false);
assert.equal(shouldStartV52Worker("BLOCKED_DATA_UNAVAILABLE"), false);
console.log("V96 + V52 strategy-specific preflight self-test: PASS");
