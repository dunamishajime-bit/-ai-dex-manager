import assert from "node:assert/strict";

import { QUALITY102_CAUSAL_V4_S34_MODEL } from "@/config/disdexQuality102CausalV4Model";
import {
    buildSharedCryptoDailyRiskState,
    validateSharedCryptoDailyRisk,
} from "@/lib/disdex-shared-crypto-daily-risk";
import {
    QUALITY102_CAUSAL_V1_SHARED_SYMBOLS,
    SHARED_CRYPTO_SYMBOLS,
} from "@/lib/disdex-shared-crypto-risk-writer";

const now = Date.now();
const state = buildSharedCryptoDailyRiskState({
    accountScope: "ASTER_FUTURES",
    utcDay: new Date(now).toISOString().slice(0, 10),
    strategyIds: ["V12_X1.00_ALL", "PENGU_DUAL_LS_V2_FINAL", "QUALITY102_CAUSAL_V1"],
    lossPct: 0,
    maximumLossPct: 5,
    tripped: false,
    updatedAt: now,
    realizedPnl: 0,
    unrealizedPnl: 0,
    fees: 0,
    funding: 0,
    netDailyPnl: 0,
    referenceEquity: 100,
    sourceComplete: true,
});

assert.equal(validateSharedCryptoDailyRisk(state, now).ok, true);
assert.ok(QUALITY102_CAUSAL_V1_SHARED_SYMBOLS.every((symbol) => SHARED_CRYPTO_SYMBOLS.has(symbol)));
const v4S34Symbols = [...new Set(QUALITY102_CAUSAL_V4_S34_MODEL.map((row) => row.symbol))];
assert.ok(v4S34Symbols.every((symbol) => SHARED_CRYPTO_SYMBOLS.has(symbol)), "all V4 S34 symbols must participate in shared crypto risk");
const tampered = { ...state, lossPct: 1 };
assert.equal(validateSharedCryptoDailyRisk(tampered, now).reason, "HASH_MISMATCH");
console.log("SHARED_CRYPTO_RISK_SELFTEST_PASS", JSON.stringify({
    strategyIds: state.strategyIds,
    q102Symbols: QUALITY102_CAUSAL_V1_SHARED_SYMBOLS.length,
    v4S34Symbols: v4S34Symbols.length,
}));
