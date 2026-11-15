import test from "node:test";
import assert from "node:assert/strict";
import {inspectPendingH48CompositeFacts,partitionPendingH48Ownership,validatePendingH48ManifestBinding,pendingH48AuthorityPositionRows,pendingModuleExports} from "./disdex-pending-h48-composite";
import {validateH48SignedInventory} from "../../../lib/hype-stable4-time-only-authority";
const SHA="a".repeat(40),HASH="b".repeat(64),T=Date.UTC(2026,10,15,6);
test("dynamic source imports support native and CommonJS module exports",async()=>{
 const source=await import("../../../lib/hype-stable4-time-only-authority");
 assert.equal(typeof pendingModuleExports(source).validateH48SignedInventory,"function");
 assert.equal(pendingModuleExports({default:{target:1}}).target,1);
 assert.equal(pendingModuleExports({default:{target:1},target:2}).target,2);
 assert.throws(()=>pendingModuleExports(null as any));
});
test("signed H48 venue side survives the worker to authority boundary",()=>{
 const row={symbol:"HYPEUSDT",positionSide:"BOTH",positionAmt:"2"};
 const positions=pendingH48AuthorityPositionRows([row]);
 assert.equal(positions[0].positionSide,"BOTH");
 validateH48SignedInventory(positions as any,[],"POSITION",2);
 const short=pendingH48AuthorityPositionRows([{...row,positionSide:"SHORT"}]);
 assert.throws(()=>validateH48SignedInventory(short as any,[],"POSITION",2));
 assert.throws(()=>pendingH48AuthorityPositionRows([{...row,positionSide:"bad"}]));
});
function fixture(){const contract={schemaVersion:1,kind:"H48_TIME_ONLY",route:"HYPE_REDESIGN_CAUSAL_H48R4_WSIG",positionId:"hz-entry-native",sourceSha:SHA,logicalEntryTs:T,logicalExitTs:T+48*3600000};return{now:T+10000,hypeSha:SHA,hypeState:{schema:"disdex-hype-zec-long/v1",runtimeCommitSha:SHA,mode:"LIVE",updatedAt:T+5000,positions:[{strategy:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",positionId:contract.positionId,quantity:2,signalTs:T,entryTs:T+1000,nativeExitContract:contract}]},positions:[{symbol:"HYPEUSDT",positionSide:"BOTH",positionAmt:"2",notional:"100",markPrice:"50"},{symbol:"BNBUSDT",positionSide:"BOTH",positionAmt:"-0.02",notional:"-13",markPrice:"650"}],orders:[{symbol:"BNBUSDT",clientOrderId:"native-v4-stop",type:"STOP_MARKET",status:"NEW",reduceOnly:true,origQty:"0.02",executedQty:"0",stopPrice:"660"}]};}
test("pure facts split only the exact H48 row and retain every foreign position/order and original counts",()=>{
 const f=fixture(),before=structuredClone(f),r=inspectPendingH48CompositeFacts(f);
 assert.equal(r.h48PositionCount,1);assert.equal(r.positionCount,2);assert.equal(r.openOrderCount,1);
 assert.deepEqual(r.residualPositions,[f.positions[1]]);assert.deepEqual(r.orders,f.orders);assert.deepEqual(f,before);
 f.positions=[f.positions[0]];f.orders=[];const sole=inspectPendingH48CompositeFacts(f);assert.equal(sole.positionCount,1);assert.equal(sole.h48PositionCount,1);assert.deepEqual(sole.residualPositions,[]);
});
test("uncertified plain data cannot become an opaque composite authorization",()=>{
 const f=fixture();assert.throws(()=>partitionPendingH48Ownership(f,{policy:"H48_TIME_ONLY"} as any),/CAPABILITY/);
 const ordinary=partitionPendingH48Ownership(f,undefined);assert.deepEqual(ordinary.positions,f.positions);assert.equal(ordinary.h48PositionCount,0);
});
test("signed quantity, side, freshness, source and H48-only contract mismatches fail closed",()=>{
 for(const mutate of [(f:any)=>f.positions[0].positionAmt="1.999",(f:any)=>f.positions[0].positionAmt="-2",(f:any)=>f.positions[0].positionSide="LONG",(f:any)=>f.hypeState.runtimeCommitSha="c".repeat(40),(f:any)=>f.hypeState.updatedAt=f.now-300001,(f:any)=>f.hypeState.pending={action:"ENTRY"},(f:any)=>f.hypeState.manualReview="review",(f:any)=>f.hypeState.positions[0].nativeExitContract.kind="OTHER",(f:any)=>f.hypeState.positions[0].nativeExitContract.logicalExitTs=T+47*3600000,(f:any)=>f.hypeState.positions[0].stopClientOrderId="unexpected-stop"]){const f=fixture();mutate(f);assert.throws(()=>inspectPendingH48CompositeFacts(f));}
});
test("any HYPE order, duplicate owner or unknown residual exposure cannot be hidden",()=>{
 const order=fixture();order.orders.push({...order.orders[0],symbol:"HYPEUSDT"});assert.throws(()=>inspectPendingH48CompositeFacts(order));
 const duplicate=fixture();duplicate.positions.push({...duplicate.positions[0]});assert.throws(()=>inspectPendingH48CompositeFacts(duplicate));
 const foreign=fixture();foreign.positions.push({symbol:"UNKNOWNUSDT",positionAmt:"1",positionSide:"BOTH",notional:"1",markPrice:"1"});assert.equal(inspectPendingH48CompositeFacts(foreign).residualPositions.length,2);
 const dust=fixture();dust.positions[1].positionAmt="1e-100";assert.throws(()=>inspectPendingH48CompositeFacts(dust));
});
test("missing, coercing, boolean, blank and nonfinite position quantities never count as flat",()=>{
 for(const q of [null,true,"", " ","nan","inf",{},[]]){const f=fixture();f.positions[0].positionAmt=q as any;assert.throws(()=>inspectPendingH48CompositeFacts(f));}
});
test("root pin extension binds exact HYPE source and both immutable validator files plus root certificate",()=>{
 const manifest:any={runners:{HYPE_TREND_LONG:{sha:SHA,h48TimeOnly:{schema:"disdex-pending-h48-authority-binding/v1",sourceSha:SHA,authoritySha256:HASH,contractSha256:HASH,certificateSha256:HASH}}}};
 assert.equal(validatePendingH48ManifestBinding(manifest,SHA).sourceSha,SHA);
 for(const field of ["authoritySha256","contractSha256","certificateSha256"]){const changed=structuredClone(manifest);changed.runners.HYPE_TREND_LONG.h48TimeOnly[field]="";assert.throws(()=>validatePendingH48ManifestBinding(changed,SHA));}
 const other=structuredClone(manifest);other.runners.HYPE_TREND_LONG.h48TimeOnly.sourceSha="c".repeat(40);assert.throws(()=>validatePendingH48ManifestBinding(other,SHA));
});
