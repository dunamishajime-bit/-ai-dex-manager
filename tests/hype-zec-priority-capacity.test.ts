import assert from "node:assert/strict";
import test from "node:test";

import { isHypeZecSoleSharedCapacityCause } from "../lib/hype-zec-priority-capacity";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function position(symbol: string, notionalUsd: number) {
  return {
    symbol,
    quantity: 1,
    entryPrice: notionalUsd,
    markPrice: notionalUsd,
    unrealizedPnl: 0,
    pnlPct: 0,
    notionalUsd,
    positionSide: "BOTH" as const,
    leverage: 5,
    updatedAt: NOW,
  };
}

test("sidecars are the sole cause only when removing them makes the same candidate fit", () => {
  assert.equal(isHypeZecSoleSharedCapacityCause({
    positions: [position("HYPEUSDT", 1_000)],
    equityUsd: 1_000,
    pendingCryptoGross: 0,
    pendingTotalGross: 0,
    candidateGross: 2.5,
    candidateSymbol: "ETHUSDT",
    candidateStrategy: "V12",
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
  }), true);
});

test("a non-sidecar cap breach never authorizes sidecar reduction", () => {
  assert.equal(isHypeZecSoleSharedCapacityCause({
    positions: [position("ETHUSDT", 2_800), position("HYPEUSDT", 500)],
    equityUsd: 1_000,
    pendingCryptoGross: 0,
    pendingTotalGross: 0,
    candidateGross: 0.5,
    candidateSymbol: "ETHUSDT",
    candidateStrategy: "V12",
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
  }), false);
});

test("pending/reserved gross is part of the sole-cause proof", () => {
  assert.equal(isHypeZecSoleSharedCapacityCause({
    positions: [position("ZECUSDT", 500)],
    equityUsd: 1_000,
    pendingCryptoGross: 0.75,
    pendingTotalGross: 0.75,
    candidateGross: 2,
    candidateSymbol: "ETHUSDT",
    candidateStrategy: "V12",
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
  }), true);
});

test("a stock candidate uses total capacity without consuming crypto capacity", () => {
  assert.equal(isHypeZecSoleSharedCapacityCause({
    positions: [position("HYPEUSDT", 500)],
    equityUsd: 1_000,
    pendingCryptoGross: 0,
    pendingTotalGross: 0,
    candidateGross: 4,
    candidateSymbol: "NVDAUSDT",
    candidateStrategy: "V52",
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
  }), true);
});

test("an unknown active position never authorizes sidecar reduction", () => {
  assert.equal(isHypeZecSoleSharedCapacityCause({
    positions: [position("UNKNOWNUSDT", 500), position("HYPEUSDT", 500)],
    equityUsd: 1_000,
    pendingCryptoGross: 0,
    pendingTotalGross: 0,
    candidateGross: 4,
    candidateSymbol: "NVDAUSDT",
    candidateStrategy: "V52",
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
  }), false);
});
