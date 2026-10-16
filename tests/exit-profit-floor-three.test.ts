import test from "node:test";
import assert from "node:assert/strict";
import {
 THREE_EXIT_FLOOR_POLICY_ID,EXIT_FLOOR_HOUR_MS as H,
 THREE_EXIT_FLOOR_POLICIES,selectThreeExitFloorPolicy,threeExitFloorStopPrice,
 observeThreeExitFloorH1,previewThreeExitFloorReplacement,
 type ExitFloorIdentity,type ClosedH1ExitBar,type ExitFloorH1State,
} from "../lib/exit-profit-floor-three";

const before=100*H;
function position(owner:"Q102"|"V12_V4"="Q102",
 route?:string,side:"LONG"|"SHORT"="LONG"):ExitFloorIdentity{
 return {owner,symbol:"ETHUSDT",side,entryTs:before,entryPrice:100,entryQuantity:5,
   family:owner==="Q102"?"MR":"RECOVERY_G",route,legId:"leg-1"};
}
function bar(i:number,close:number):ClosedH1ExitBar{
 return {openTs:before+i*H,open:close,high:close+1,low:close-1,close};
}
function arm(leg=position(),firstClose=104){
 const obs=observeThreeExitFloorH1(leg,bar(0,firstClose),before+H);
 assert.equal(obs.kind,"ARMED");
 assert.ok(obs.state);
 return obs.state!;
}
function proof(s:ExitFloorH1State,partial=false){
 const at=s.effectiveFromTs!+10_000;
 return {
  state:s,
  observedAt:at,
  normalizedRequestedStopPrice:s.floorStopPrice!,
  signedPosition:{symbol:s.symbol,side:s.side,quantity:5,markPrice:s.side==="LONG"?107:93,capturedAt:at},
  signedStop:{symbol:s.symbol,side:s.side==="LONG"?"SELL" as const:"BUY" as const,
   clientOrderId:"old-stop-id",orderId:42,type:"STOP_MARKET" as const,
   status:partial?"PARTIALLY_FILLED":"NEW",reduceOnly:true,quantity:5,executedQuantity:partial?1:0,
   stopPrice:s.side==="LONG"?90:110,capturedAt:at},
 };
}
test("exact 3 floor policies and immutable expected ratios",()=>{
 assert.equal(THREE_EXIT_FLOOR_POLICIES.length,3);
 assert.deepEqual(THREE_EXIT_FLOOR_POLICIES.map(x=>[x.owner,x.route,x.triggerReturn,x.securedReturn]),[
  ["Q102","Q102_MR",.03,.01],["V12_V4","REC_G5_SLOW_TREND",.02,.005],
  ["V12_V4","REC_X05_TIME_36H",.025,.01]]);
 assert.equal(THREE_EXIT_FLOOR_POLICY_ID.includes("20261016"),true);
});
test("PENGU, other Q102 families, other V4 routes and Idle remain untouched",()=>{
 for(const id of [
  {owner:"PENGU",family:"MR"},{owner:"IDLE",route:"REC_G5_SLOW_TREND"},
  {owner:"Q102",family:"HIGH_VOL"},{owner:"Q102",family:"REV"},
  {owner:"Q102",family:"BRK"},{owner:"Q102",family:"PB"},
  {owner:"V12_V4",route:"REC_Y06_REV_D0_T72"},
  {owner:"V12_V4",route:"REC_X01_TIME_24H"},
 ]){
  assert.equal(selectThreeExitFloorPolicy(id),undefined);
  assert.equal(observeThreeExitFloorH1({...position(),...id},bar(0,110),before+H).kind,"NOT_TARGETED");
 }
});
test("Q102 MR LONG arms only on completed H1 favorable 3%, not candle high",()=>{
 const x=position();
 let t=observeThreeExitFloorH1(x,{...bar(0,102),high:112},before+H);
 assert.equal(t.kind,"OBSERVING");assert.equal(t.state?.armed,false);
 const next=observeThreeExitFloorH1(x,bar(1,103),before+2*H,t.state);
 assert.equal(next.kind,"ARMED");
 assert.equal(next.state?.floorStopPrice,101);
 assert.equal(next.state?.effectiveFromTs,before+2*H);
 assert.equal(next.ordersSent,0);assert.equal(next.orderEnabled,false);
});
test("Q102 MR SHORT favorable condition and protected STOP are direction-correct",()=>{
 const s=arm(position("Q102",undefined,"SHORT"),96.5);
 assert.equal(s.floorStopPrice,99);
 const p=proof(s);
 assert.equal(previewThreeExitFloorReplacement(p).kind,"SHADOW_READY");
});
test("G5 and X05 have correct independent thresholds, sides",()=>{
 const g=position("V12_V4","REC_G5_SLOW_TREND");
 assert.equal(observeThreeExitFloorH1(g,bar(0,101.9),before+H).kind,"OBSERVING");
 const gs=arm(g,102.1);
 assert.ok(Math.abs(gs.floorStopPrice!-100.5)<1e-9);
 const x=position("V12_V4","REC_X05_TIME_36H");
 assert.equal(observeThreeExitFloorH1(x,bar(0,102.4),before+H).kind,"OBSERVING");
 assert.equal(arm(x,102.6).floorStopPrice,101);
});
test("unclosed/future H1 is rejected fail closed",()=>{
 const x=position();
 assert.throws(()=>observeThreeExitFloorH1(x,bar(0,105),before+H-1),/UNCLOSED/);
 assert.throws(()=>observeThreeExitFloorH1(x,{...bar(0,105),openTs:before+1},before+2*H),/UNCLOSED/);
});
test("bar inside late entry H1 cannot use pre-entry return",()=>{
 const x={...position(),entryTs:before+30_000};
 assert.throws(()=>observeThreeExitFloorH1(x,bar(0,105),before+H),/PAST_ENTRY_H1/);
 assert.equal(observeThreeExitFloorH1(x,bar(1,105),before+2*H).kind,"ARMED");
});
test("H1 price range cannot be malformed",()=>{
 const x=position();
 assert.throws(()=>observeThreeExitFloorH1(x,{...bar(0,105),high:103},before+H),/INVALID_H1_BAR/);
});
test("duplicate latest H1 is idempotent; missing/reversed H1 fails closed",()=>{
 const x=position();const s=arm(x);
 const v=observeThreeExitFloorH1(x,bar(0,104),before+H,s);
 assert.equal(v.kind,"UNCHANGED");assert.strictEqual(v.state,s);
 assert.throws(()=>observeThreeExitFloorH1(x,bar(2,107),before+3*H,s),/GAP_OR_REVERSE/);
});
test("restart owner/entry policy lineage tampering rejected",()=>{
 const s=arm();
 assert.throws(()=>observeThreeExitFloorH1({...position(),entryPrice:101},bar(1,105),before+2*H,s),/LINEAGE_MISMATCH/);
 assert.throws(()=>observeThreeExitFloorH1({...position(),legId:"alien"},bar(1,105),before+2*H,s),/LINEAGE_MISMATCH/);
});
test("stop activation stays at first arming H1 after restart",()=>{
 const x=position();const s=arm(x);
 const n=observeThreeExitFloorH1(x,bar(1,109),before+2*H,s);
 assert.equal(n.state?.effectiveFromTs,s.effectiveFromTs);
 assert.equal(n.state?.floorStopPrice,s.floorStopPrice);
 assert.ok(Math.abs((n.state?.highWaterCloseReturn??0)-.09)<1e-12);
});
test("unarmed state cannot suggest an order, even with signed proof",()=>{
 const obs=observeThreeExitFloorH1(position(),bar(0,101),before+H);
 assert.ok(obs.state);
 const p=previewThreeExitFloorReplacement(proof(obs.state!));
 assert.equal(p.kind,"BLOCKED");assert.equal(p.ordersSent,0);
});
test("valid signed Q102 stop replacement gives only a shadow plan",()=>{
 const s=arm(),p=previewThreeExitFloorReplacement(proof(s));
 assert.equal(p.kind,"SHADOW_READY");
 assert.equal(p.newStopPrice,101);
 assert.equal(p.quantity,5);
 assert.equal(p.orderEnabled,false);
 assert.equal(p.ordersSent,0);
});
test("prior resident STOP at tighter level means no replacement",()=>{
 const s=arm();const f=proof(s);
 assert.equal(previewThreeExitFloorReplacement({...f,signedStop:{...f.signedStop,stopPrice:102}}).kind,"NO_IMPROVEMENT");
});
test("partial fills, unknown status, non-reduceOnly and quantity mismatches are blocked",()=>{
 const s=arm();const f=proof(s);
 assert.equal(previewThreeExitFloorReplacement(proof(s,true)).kind,"BLOCKED");
 for(const mod of [
  {status:"UNKNOWN"},{reduceOnly:false},{quantity:6},{symbol:"BTCUSDT"},{executedQuantity:1},
 ]){
  assert.equal(previewThreeExitFloorReplacement({...f,signedStop:{...f.signedStop,...mod}}).kind,"BLOCKED");
 }
});
test("normalized price cannot weaken selected profit floor",()=>{
 const s=arm();const f=proof(s);
 assert.equal(previewThreeExitFloorReplacement({...f,normalizedRequestedStopPrice:100.99}).kind,"BLOCKED");
});
test("signed position and STOP snapshots stale by >30 seconds block preflight",()=>{
 const s=arm(),f=proof(s);
 assert.equal(previewThreeExitFloorReplacement({...f,observedAt:f.observedAt+31_000}).kind,"BLOCKED");
 assert.equal(previewThreeExitFloorReplacement({...f,
   signedStop:{...f.signedStop,capturedAt:f.observedAt-31_000}}).kind,"BLOCKED");
});
test("signed evidence cannot precede completed H1 activation",()=>{
 const s=arm(),f=proof(s);
 assert.equal(previewThreeExitFloorReplacement({...f,signedStop:{...f.signedStop,capturedAt:s.effectiveFromTs!-1}}).kind,"BLOCKED");
 assert.equal(previewThreeExitFloorReplacement({...f,observedAt:s.effectiveFromTs!-1}).kind,"BLOCKED");
});
test("mark already past desired stop is never permitted for new resident placement",()=>{
 const s=arm();const f=proof(s);
 assert.equal(previewThreeExitFloorReplacement({...f,signedPosition:{...f.signedPosition,markPrice:100.7}}).kind,"BLOCKED");
 const short=arm(position("Q102",undefined,"SHORT"),96);const sf=proof(short);
 assert.equal(previewThreeExitFloorReplacement({...sf,signedPosition:{...sf.signedPosition,markPrice:100}}).kind,"BLOCKED");
});
