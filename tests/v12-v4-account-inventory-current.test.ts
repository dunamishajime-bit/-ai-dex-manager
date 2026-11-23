import test from "node:test";
import assert from "node:assert/strict";
import {verifyV4Inventory,readV4SignedInventory} from "../lib/v12-v4-account-inventory";
import {certifyV4Production,V4_RANKING_CUTOFF_EXCLUSIVE_MS as cutoff} from "../lib/v12-v4-production-certification";
test("signed flat account with no owner or open orders is valid",async()=>{
 const result=verifyV4Inventory([],[],[],cutoff+500);
 assert.equal(result.verified,true);
 assert.equal(result.positions,0);
 assert.equal(result.openOrders,0);
 const signed=await readV4SignedInventory({getPositions:async()=>[],getOpenOrders:async()=>[]},[],()=>cutoff+501);
 assert.equal(signed.verified,true);
 const verdict=certifyV4Production({
   policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cutoff+501,signalEntryTimesMs:[cutoff],
   account:{capturedAtMs:signed.capturedAtMs,holdProtected:false,pendingReconciled:true,
    ownerInventoryVerified:true,inventory:signed,releaseCoherent:true,quoteFresh:true}});
 assert.ok(!verdict.blockers.includes("CURRENT_SIGNED_ACCOUNT_OWNERSHIP_NOT_VERIFIED"));
 assert.equal(verdict.orderEnabled,false);
 assert.ok(verdict.blockers.includes("OBSERVED_EXTERNAL_Y06_PF_FAILED"));
});
test("any unowned venue position or pending order blocks certification",()=>{
 const pos:any=[{symbol:"PENGUUSDT",positionAmt:"-7718",markPrice:".01"}];
 assert.ok(verifyV4Inventory(pos,[],[],cutoff).blockers.includes("UNOWNED_LIVE_POSITION:PENGUUSDT"));
 const order:any=[{symbol:"DOGEUSDT",status:"NEW",type:"LIMIT",side:"BUY"}];
 assert.ok(verifyV4Inventory([],order,[],cutoff).blockers.includes("UNRECONCILED_OPEN_ORDER:DOGEUSDT"));
});
test("current owners are checked by exact live quantity, not fixed historical values",()=>{
 const pos:any=[{symbol:"PENGUUSDT",positionAmt:"-123",markPrice:".01"}];
 const stop:any=[{symbol:"PENGUUSDT",side:"BUY",reduceOnly:true,type:"STOP_MARKET",status:"NEW",origQty:"123"}];
 const claim=[{owner:"PENGU",symbol:"PENGUUSDT",side:"SHORT" as const,qty:123,protectedByStop:true}];
 assert.equal(verifyV4Inventory(pos,stop,claim,cutoff).verified,true);
 assert.equal(verifyV4Inventory(pos,stop,[{...claim[0],qty:7718}],cutoff).verified,false);
 assert.throws(()=>verifyV4Inventory(pos,stop,[...claim,...claim],cutoff),/DUPLICATE_POSITION_OWNER/);
});
test("stale or absent proof cannot be bypassed by old hardcoded quantities",()=>{
 const c=certifyV4Production({policyId:"V2_M150_D05_CORE_NATIVE",evaluatedAtMs:cutoff+100,
  signalEntryTimesMs:[cutoff],account:{capturedAtMs:cutoff+100,holdProtected:false,pendingReconciled:true,
   ownerInventoryVerified:true,protectedPenguQty:7718,protectedTslaQty:.38,releaseCoherent:true,quoteFresh:true}});
 assert.ok(c.blockers.includes("CURRENT_SIGNED_ACCOUNT_OWNERSHIP_NOT_VERIFIED"));
});
