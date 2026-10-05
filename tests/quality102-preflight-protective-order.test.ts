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

test("Q102 preflight still rejects an unknown open order", () => {
  assert.equal(isQ102PreflightManagedProtectiveOrder({ ...protectiveOrder, clientOrderId: "manual-order" }, [position]), false);
  assert.equal(isQ102PreflightManagedProtectiveOrder({ ...protectiveOrder, quantity: 1 }, [position]), false);
  assert.equal(isQ102PreflightManagedProtectiveOrder({ ...protectiveOrder, reduceOnly: false }, [position]), false);
});

test('Q102 startup preserves the existing FET profit-floor STOP and rejects malformed orders', async () => {
 const {findQ102PreflightAllManagedProtectiveOrders}=await import('../scripts/disdex-quality102-causal-v1-live-runner');
 const p:DirectPosition={...position,symbol:'FETUSDT',quantity:515,entryPrice:.2407,markPrice:.258};
 const stop:DirectOpenOrder={...protectiveOrder,symbol:'FETUSDT',quantity:515,type:'STOP_MARKET',clientOrderId:'fet-stop-6b4f4d99ff49833efe3b46'};
 assert.deepEqual(findQ102PreflightAllManagedProtectiveOrders([stop],[p]),[stop]);
 for(const bad of [{...stop,reduceOnly:false},{...stop,type:'LIMIT'},{...stop,quantity:1},{...stop,clientOrderId:'manual-stop'}])assert.deepEqual(findQ102PreflightAllManagedProtectiveOrders([bad],[p]),[]);
 assert.deepEqual(findQ102PreflightAllManagedProtectiveOrders([stop,{...stop,clientOrderId:'fet-stop-aaaaaaaaaaaaaaaaaaaaaa'}],[p]),[]);
});
