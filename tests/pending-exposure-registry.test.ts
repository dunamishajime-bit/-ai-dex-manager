import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregatePendingExposure,
  normalizePendingExposureRegistry,
} from "../lib/disdex-pending-exposure-registry";
import { planStrictPortfolio } from "../lib/disdex-strict-portfolio-planner";

test("active pending exposure is included across runners and released rows are ignored", () => {
  const registry = normalizePendingExposureRegistry({
    schema: "disdex-pending-exposure/v1",
    accountScope: "ASTER_FUTURES",
    updatedAt: 10,
    entries: [
      {
        reservationId: "v12-pending",
        strategyId: "V12_X1.00_ALL",
        sleeve: "CRYPTO",
        symbol: "DOGEUSDT",
        side: "LONG",
        gross: 0.40,
        notionalUsd: 400,
        status: "PENDING",
        createdAt: 1,
        updatedAt: 10,
      },
      {
        reservationId: "old-released",
        strategyId: "PENGU_DUAL_LS_V2_FINAL",
        sleeve: "CRYPTO",
        symbol: "PENGUUSDT",
        side: "LONG",
        gross: 1.00,
        notionalUsd: 1000,
        status: "RELEASED",
        createdAt: 1,
        updatedAt: 10,
      },
    ],
  });

  assert.deepEqual(aggregatePendingExposure(registry), {
    cryptoGross: 0.40,
    stockGross: 0,
    byStrategyGross: { "V12_X1.00_ALL": 0.40 },
  });
});

test("malformed active pending exposure fails closed instead of being treated as zero", () => {
  assert.throws(
    () => normalizePendingExposureRegistry({
      schema: "disdex-pending-exposure/v1",
      accountScope: "ASTER_FUTURES",
      updatedAt: 10,
      entries: [{
        reservationId: "unknown-owner",
        strategyId: "UNKNOWN_RUNNER",
        sleeve: "CRYPTO",
        symbol: "DOGEUSDT",
        side: "LONG",
        gross: 0.2,
        notionalUsd: 200,
        status: "PENDING",
        createdAt: 1,
        updatedAt: 10,
      }],
    }),
    /PENDING_EXPOSURE_OWNER_UNKNOWN/,
  );
});

test("HYPE/ZEC pending reservations are classified as crypto sidecars", () => {
  const registry = normalizePendingExposureRegistry({
    schema: "disdex-pending-exposure/v1",
    accountScope: "ASTER_FUTURES",
    updatedAt: 10,
    entries: [{
      reservationId: "hype-entry",
      strategyId: "HYPE_LONG",
      sleeve: "CRYPTO",
      symbol: "HYPEUSDT",
      side: "LONG",
      gross: 0.25,
      notionalUsd: 250,
      status: "PENDING",
      createdAt: 1,
      updatedAt: 10,
    }],
  });
  assert.deepEqual(aggregatePendingExposure(registry), {
    cryptoGross: 0.25,
    stockGross: 0,
    byStrategyGross: { HYPE_LONG: 0.25 },
  });
});

test("strict planner caps a candidate against cross-runner pending gross", () => {
  const plan = planStrictPortfolio({
    equity: 1000,
    now: 1_000_000,
    active: [],
    pendingExposure: { cryptoGross: 2.8, stockGross: 0 },
    quality102CausalV1Ready: true,
    intents: [{
      idempotencyKey: "q102-pending-cross-runner",
      strategy: "QUALITY102_CAUSAL_V1",
      symbol: "SOLUSDT",
      side: "LONG",
      gross: 0.5,
      notionalUsd: 500,
      signalTs: 999_000,
    }],
  });

  assert.equal(plan.status, "planned");
  assert.equal(plan.accepted.length, 1);
  assert.ok((plan.accepted[0]?.gross || 0) <= 0.20 + 1e-9);
  assert.ok(plan.totals.cryptoGross <= 3.0 + 1e-9);
  assert.ok(plan.totals.totalGross <= 4.25 + 1e-9);
});

test("strict planner subtracts pending gross from strategy-specific residual caps", () => {
  const plan = planStrictPortfolio({
    equity: 1000,
    now: 1_000_000,
    active: [{
      id: "v12-existing-1",
      strategy: "V12",
      symbol: "DOGEUSDT",
      side: "LONG",
      quantity: 8.5,
      entryPrice: 100,
      markPrice: 100,
      entryTs: 1,
      updatedAt: 1_000_000,
      markSource: "LIVE_MARKET_QUOTE",
    }, {
      id: "v12-existing-2",
      strategy: "V12",
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 8.5,
      entryPrice: 100,
      markPrice: 100,
      entryTs: 1,
      updatedAt: 1_000_000,
      markSource: "LIVE_MARKET_QUOTE",
    }],
    pendingExposure: {
      cryptoGross: 0.2,
      stockGross: 0,
      byStrategyGross: { V12_X1_00_ALL: 0.2 },
    },
    quality102CausalV1Ready: true,
    intents: [{
      idempotencyKey: "v12-residual-cap",
      strategy: "V12",
      symbol: "BTCUSDT",
      side: "LONG",
      gross: 0.3,
      notionalUsd: 300,
      signalTs: 999_000,
    }],
  });

  assert.equal(plan.status, "planned");
  assert.equal(plan.accepted.length, 1);
  assert.ok((plan.accepted[0]?.gross || 0) <= 0.1 + 1e-9);
  assert.ok(plan.totals.cryptoGross <= 3.0 + 1e-9);
});

test("strict planner blocks PENGU strategy over-cap when pending reservation exists", () => {
  const plan = planStrictPortfolio({
    equity: 1000,
    now: 1_000_000,
    active: [],
    pendingExposure: {
      cryptoGross: 0.8,
      stockGross: 0,
      byStrategyGross: { PENGU_DUAL_LS_V2_FINAL: 0.8 },
    },
    quality102CausalV1Ready: true,
    intents: [{
      idempotencyKey: "pengu-residual-cap",
      strategy: "PENGU_DUAL_LS_V2",
      symbol: "PENGUUSDT",
      side: "LONG",
      gross: 0.5,
      notionalUsd: 500,
      signalTs: 999_000,
    }],
  });

  assert.equal(plan.status, "planned");
  assert.equal(plan.accepted.length, 1);
  assert.ok((plan.accepted[0]?.gross || 0) <= 0.2 + 1e-9);
});
