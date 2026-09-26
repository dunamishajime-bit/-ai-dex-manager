import assert from "node:assert/strict";
import test from "node:test";

import { planHypeZecPreemption } from "../lib/hype-zec-preemption";
import { planStrictPortfolio, type StrictPortfolioIntent, type StrictPortfolioPosition } from "../lib/disdex-strict-portfolio-planner";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function sidecar(strategy: "HYPE_LONG" | "ZEC_LONG", id: string, entryTs = NOW - 60 * 60_000): StrictPortfolioPosition {
  return {
    id,
    strategy,
    symbol: strategy === "HYPE_LONG" ? "HYPEUSDT" : "ZECUSDT",
    side: "LONG",
    quantity: 10,
    entryPrice: 100,
    markPrice: 100,
    entryTs,
    updatedAt: NOW,
    markSource: "LIVE_MARKET_QUOTE",
    markSourceEvidence: { source: "LIVE_MARKET_QUOTE", timestamp: NOW, price: 100, crossChecked: true },
  };
}

function priorityIntent(strategy: "V12" | "PENGU_DUAL_LS_V2" | "FET_RESIDUAL" | "V52", gross = 1): StrictPortfolioIntent {
  return {
    idempotencyKey: `${strategy}-priority-test`,
    strategy,
    symbol: strategy === "V52" ? "NVDAUSDT" : strategy === "V12" ? "ETHUSDT" : strategy === "PENGU_DUAL_LS_V2" ? "PENGUUSDT" : "FETUSDT",
    side: "LONG",
    gross,
    requestedGross: gross,
    notionalUsd: gross * 1_000,
    signalTs: NOW - 1_000,
  };
}

test("sidecar preemption is not planned without an accepted higher-priority candidate", () => {
  const result = planHypeZecPreemption({
    equityUsd: 1_000,
    now: NOW,
    currentCryptoGross: 3,
    currentTotalGross: 3,
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
    active: [sidecar("HYPE_LONG", "hype-1"), sidecar("ZEC_LONG", "zec-1")],
    candidate: undefined,
  });
  assert.equal(result.status, "not-needed");
  assert.equal(result.reductions.length, 0);
});

test("priority entry releases only the required capacity and never more than half of either sidecar", () => {
  const result = planHypeZecPreemption({
    equityUsd: 1_000,
    now: NOW,
    currentCryptoGross: 3,
    currentTotalGross: 3,
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
    active: [sidecar("HYPE_LONG", "hype-1"), sidecar("ZEC_LONG", "zec-1")],
    candidate: priorityIntent("V12", 1),
  });
  assert.equal(result.status, "planned");
  assert.equal(result.reductions.length, 2);
  assert.deepEqual(result.reductions.map((row) => row.reducedQuantity), [5, 5]);
  assert.equal(result.releasedGross, 1);
  assert.equal(result.requiredGross, 1);
  assert.ok(result.reductions.every((row) => row.reducedFraction <= 0.5));
});

test("pending and reserved Gross are included in the capacity deficit", () => {
  const result = planHypeZecPreemption({
    equityUsd: 1_000,
    now: NOW,
    currentCryptoGross: 2.25,
    currentTotalGross: 2.25,
    pendingCryptoGross: 0.5,
    pendingTotalGross: 0.5,
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
    active: [sidecar("HYPE_LONG", "hype-1"), sidecar("ZEC_LONG", "zec-1")],
    candidate: priorityIntent("FET_RESIDUAL", 0.5),
  });
  assert.equal(result.status, "planned");
  assert.equal(result.requiredGross, 0.25);
  assert.equal(result.releasedGross, 0.25);
  assert.deepEqual(result.reductions.map((row) => row.reducedQuantity), [1.25, 1.25]);
});

test("a stock priority entry consumes total capacity but not crypto capacity", () => {
  const result = planHypeZecPreemption({
    equityUsd: 1_000,
    now: NOW,
    currentCryptoGross: 1,
    currentTotalGross: 2,
    pendingCryptoGross: 0,
    pendingTotalGross: 0,
    cryptoEntryCap: 3,
    totalEntryCap: 4.25,
    active: [sidecar("HYPE_LONG", "hype-1"), sidecar("ZEC_LONG", "zec-1")],
    candidate: priorityIntent("V52", 3),
  });
  assert.equal(result.status, "planned");
  assert.equal(result.requiredGross, 0.75);
});

test("strict planner accepts sidecars only with explicit preemption support and preserves hard caps", () => {
  const result = planStrictPortfolio({
    equity: 1_000,
    now: NOW,
    active: [sidecar("HYPE_LONG", "hype-1")],
    intents: [priorityIntent("V12")],
    pendingExposure: { cryptoGross: 0, stockGross: 0 },
    availableBalanceUsd: 1_000,
    allowHypeZecPreemption: true,
  });
  assert.equal(result.status, "planned");
  assert.ok(result.totals.cryptoGross <= 3 + 1e-9);
});
