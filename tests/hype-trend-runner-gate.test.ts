import test from "node:test";
import assert from "node:assert/strict";

import { evaluateHypeTrendEntryGate } from "../lib/hype-trend-long-runner";
import { assertHypeZecLiveGate, resolveHypeZecLongRuntime } from "../config/hypeZecLongRuntime";

test("HYPE entry is blocked when core plus pending and candidate worst-case gross exceed capacity", () => {
  const result = evaluateHypeTrendEntryGate({
    equity: 100,
    availableBalance: 100,
    existingCryptoGross: 2.1,
    pendingCryptoGross: 0.2,
    reservedCryptoGross: 0.4,
    candidateGross: 1.5,
    cryptoGrossCap: 3,
    totalGrossBefore: 2.7,
    totalGrossCap: 4.25,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "CRYPTO_GROSS_CAP_BLOCK");
});

test("HYPE entry remains lowest-priority and does not alter a core reservation", () => {
  const result = evaluateHypeTrendEntryGate({
    equity: 100,
    availableBalance: 100,
    existingCryptoGross: 1.1,
    pendingCryptoGross: 0,
    reservedCryptoGross: 0,
    candidateGross: 1.5,
    cryptoGrossCap: 3,
    totalGrossBefore: 1.1,
    totalGrossCap: 4.25,
    coreReservationGross: 1.5,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "CORE_RESERVATION_PRIORITY");
});

test("TREND runtime is scoped to HYPE and enforces the 1.5x sleeve contract", () => {
  const runtime = resolveHypeZecLongRuntime({
    NODE_ENV: "production",
    DISDEX_HYPE_ZEC_MODE: "LIVE",
    DISDEX_HYPE_ZEC_ENABLED: "true",
    DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED: "true",
    DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED: "true",
    DISDEX_HYPE_ZEC_OPERATOR_ARMED: "true",
    DISDEX_HYPE_ZEC_RUNTIME_SHA: "a".repeat(40),
    DISDEX_HYPE_ZEC_SIGNAL_MODE: "TREND",
    DISDEX_HYPE_ZEC_SYMBOLS: "HYPEUSDT",
    DISDEX_HYPE_ZEC_MAX_GROSS: "1.5",
  });
  assert.doesNotThrow(() => assertHypeZecLiveGate(runtime));
  assert.equal(runtime.maximumGross, 1.5);
  assert.deepEqual(runtime.symbols, ["HYPEUSDT"]);
});

test("TREND runtime rejects a ZEC or mixed symbol scope", () => {
  const runtime = resolveHypeZecLongRuntime({
    NODE_ENV: "production",
    DISDEX_HYPE_ZEC_MODE: "LIVE",
    DISDEX_HYPE_ZEC_ENABLED: "true",
    DISDEX_HYPE_ZEC_LIVE_EXECUTION_ENABLED: "true",
    DISDEX_HYPE_ZEC_PRODUCTION_CONFIG_LIVE_ENABLED: "true",
    DISDEX_HYPE_ZEC_OPERATOR_ARMED: "true",
    DISDEX_HYPE_ZEC_RUNTIME_SHA: "a".repeat(40),
    DISDEX_HYPE_ZEC_SIGNAL_MODE: "TREND",
    DISDEX_HYPE_ZEC_SYMBOLS: "HYPEUSDT,ZECUSDT",
    DISDEX_HYPE_ZEC_MAX_GROSS: "1.5",
  });
  assert.throws(() => assertHypeZecLiveGate(runtime), /HYPE_TREND_SYMBOL_SCOPE_MISMATCH/);
});
