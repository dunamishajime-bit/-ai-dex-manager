import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { AccountLockHandle,AccountLockDocument } from "../lib/disdex-account-order-lock";
import type { DirectTradeExecutor,DirectPosition,DirectOpenOrder } from "../lib/direct-trade-executor";
import { readAuthenticatedH48Inventory } from "../lib/hype-h48-authenticated-readback";

const NOW=Date.UTC(2026,10,25,14,30);
function lease():AccountLockHandle {
  const doc:AccountLockDocument={
    schema:"disdex-account-lock/v1",accountScope:"ASTER_FUTURES",
    ownerId:"h48-test",leaseId:"one-writer",acquiredAt:NOW-10000,
    expiresAt:NOW+30000,reservations:[],
  };
  return {ownerId:doc.ownerId,leaseId:doc.leaseId,acquiredAt:doc.acquiredAt,
    renewalIntervalMs:1000,document:async()=>({...doc}),
    renew:async()=>({...doc}),reserve:async()=>{throw Error("TEST_REJECTED")},
    releaseReservation:async()=>{},release:async()=>{}};
}
const position:DirectPosition={
  symbol:"HYPEUSDT",quantity:0,entryPrice:0,markPrice:1,unrealizedPnl:0,pnlPct:0,
  notionalUsd:0,positionSide:"BOTH",leverage:5,updatedAt:NOW,
};
function executor():Pick<DirectTradeExecutor,"getPositions"|"getOpenOrders"|"getAccountSnapshot">{
  return {
    getPositions:async()=>[{...position}],
    getOpenOrders:async():Promise<DirectOpenOrder[]>=>[],
    getAccountSnapshot:async()=>({
      asset:"USDT",availableBalance:100,walletBalance:150,updatedAt:NOW,
    }),
  };
}

test("lease-bound authenticated ASTER GET reads positions, orders and venue-clock account",async()=>{
  const venue=await readAuthenticatedH48Inventory({executor:executor(),lease:lease(),now:()=>NOW});
  assert.equal(venue.source,"ASTER_SIGNED_READ_ONLY");
  assert.equal(venue.observedAt,NOW);
  assert.equal(venue.positions.length,1);
  assert.equal(venue.openOrders.length,0);
  assert.ok(Object.isFrozen(venue.positions[0]));
});

test("missing lease, expired lease and changed writer deny fresh H48 snapshot",async()=>{
  await assert.rejects(readAuthenticatedH48Inventory({
    executor:executor(),lease:{} as AccountLockHandle,now:()=>NOW,
  }),/NO_ACCOUNT_LEASE/);
  const old=lease();
  old.document=async()=>({...await lease().document(),expiresAt:NOW-1});
  await assert.rejects(readAuthenticatedH48Inventory({
    executor:executor(),lease:old,now:()=>NOW,
  }),/LEASE_UNVERIFIED/);
  let n=0;
  const changed=lease();
  changed.document=async()=>({...await lease().document(),leaseId:++n===1?"one-writer":"other-writer"});
  await assert.rejects(readAuthenticatedH48Inventory({
    executor:executor(),lease:changed,now:()=>NOW,
  }),/LEASE_CHANGED/);
});

test("stale account read, malformed rows and missing GET errors fail closed",async()=>{
  for(const bad of [
    {getAccountSnapshot:async()=>({asset:"USDT",availableBalance:100,walletBalance:150,updatedAt:NOW-30001})},
    {getPositions:async()=>[{...position,quantity:NaN}]},
    {getOpenOrders:async()=>[{symbol:"HYPEUSDT",clientOrderId:"X",quantity:1,executedQuantity:2}]},
    {getPositions:async()=>{throw Error("ASTER_HTTP_502")}},
  ]) {
    await assert.rejects(readAuthenticatedH48Inventory({
      executor:{...executor(),...bad},lease:lease(),now:()=>NOW,
    }));
  }
});

test("venue GET taking more than 120s fails closed",async()=>{
  let calls=0;
  await assert.rejects(readAuthenticatedH48Inventory({
    executor:executor(),lease:lease(),
    now:()=>NOW+(++calls>1?121000:0),
  }),/READ_TOO_SLOW/);
});

test("readback does not accept or call any order/cancel API",async()=>{
  let orders=0;
  const fake={...executor(),executeMarket:async()=>{orders++;throw Error("unexpected order")}};
  await readAuthenticatedH48Inventory({executor:fake,lease:lease(),now:()=>NOW});
  assert.equal(orders,0);
});
