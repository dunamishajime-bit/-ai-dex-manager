import assert from "node:assert/strict";
import test from "node:test";

import { isQ102PreflightManagedProtectiveOrder } from "../scripts/disdex-quality102-causal-v1-live-runner";
import type { DirectOpenOrder, DirectPosition } from "../lib/direct-trade-executor";

const position: DirectPosition = {
  symbol: "PENGUUSDT",
  quantity: 4354,
  entryPrice: 0.006938,
  markPrice: 0.00698,
  unrealizedPnl: 0.18,
  pnlPct: 0.6,
  notionalUsd: 30.4,
  positionSide: "BOTH",
  leverage: 5,
  updatedAt: Date.now(),
};

const protectiveOrder: DirectOpenOrder = {
  symbol: "PENGUUSDT",
  clientOrderId: "recv8-68ad0b9cb5d4b8a4e85f3e3c178dfc",
  side: "SELL",
  status: "NEW",
  reduceOnly: true,
  quantity: 4354,
  executedQuantity: 0,
};

test("Q102 preflight recognizes the reconciled PENGU Recovery V8 protection order", () => {
  assert.equal(isQ102PreflightManagedProtectiveOrder(protectiveOrder, [position]), true);
});

test("Q102 preflight recognizes split PENGU Recovery V8 protection whose aggregate covers the position", () => {
  const splitPosition = { ...position, quantity: 4244 };
  const splitOrders: DirectOpenOrder[] = [
    { ...protectiveOrder, clientOrderId: "recv8-20b3c3a02e5a07d1d79c5f7761eff1", quantity: 2122 },
    { ...protectiveOrder, clientOrderId: "recv8-1b00e3de1d7092ef238ff60fe6eafa", quantity: 2122 },
  ];
  assert.equal(isQ102PreflightManagedProtectiveOrder(splitOrders[0], [splitPosition], splitOrders), true);
  assert.equal(isQ102PreflightManagedProtectiveOrder(splitOrders[1], [splitPosition], splitOrders), true);
});

test("Q102 preflight rejects split protection when the managed aggregate does not cover the position", () => {
  const splitPosition = { ...position, quantity: 4244 };
  const splitOrders: DirectOpenOrder[] = [
    { ...protectiveOrder, clientOrderId: "recv8-20b3c3a02e5a07d1d79c5f7761eff1", quantity: 2122 },
    { ...protectiveOrder, clientOrderId: "recv8-1b00e3de1d7092ef238ff60fe6eafa", quantity: 2000 },
  ];
  assert.equal(isQ102PreflightManagedProtectiveOrder(splitOrders[0], [splitPosition], splitOrders), false);
  assert.equal(isQ102PreflightManagedProtectiveOrder(splitOrders[1], [splitPosition], splitOrders), false);
});

test("Q102 preflight still rejects an unknown open order", () => {
  assert.equal(isQ102PreflightManagedProtectiveOrder({ ...protectiveOrder, clientOrderId: "manual-order" }, [position]), false);
  assert.equal(isQ102PreflightManagedProtectiveOrder({ ...protectiveOrder, quantity: 1 }, [position]), false);
  assert.equal(isQ102PreflightManagedProtectiveOrder({ ...protectiveOrder, reduceOnly: false }, [position]), false);
});
