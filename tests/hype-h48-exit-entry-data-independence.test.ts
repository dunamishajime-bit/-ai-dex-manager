import test from "node:test";
import assert from "node:assert/strict";
import {HypeZecLongRunner} from "../lib/hype-zec-long-runner";
import {createHypeH48TimeOnlyContract} from "../lib/hype-stable4-time-only-contract";
const H=3600000,T=Date.UTC(2026,10,15,6),SHA="a".repeat(40);
function fixture(){
 const now=T+48*H+1000,contract=createHypeH48TimeOnlyContract({positionId:"h48-native",sourceSha:SHA,logicalEntryTs:T});
 const owned:any={strategy:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",positionId:contract.positionId,quantity:2,entryPrice:100,entryTs:T+1000,signalTs:T,stopPrice:0,takeProfitPrice:0,nativeExitContract:contract,updatedAt:now};
 const state:any={schema:"disdex-hype-zec-long/v1",runtimeCommitSha:SHA,mode:"LIVE",updatedAt:now,positions:[owned],failures:[]};
 const positions:any[]=[{symbol:"HYPEUSDT",quantity:2,positionSide:"BOTH",entryPrice:100,markPrice:120,notionalUsd:240,updatedAt:now}],orders:any[]=[],sent:any[]=[];
 let marketReads=0,authorityInvalid=false;
 const lease={document:async()=>({accountScope:"ASTER_FUTURES",leaseId:"lease",ownerId:"owner",acquiredAt:now-1000,expiresAt:now+120000}),release:async()=>{}};
 const runner:any=new HypeZecLongRunner({runtime:{enabled:true,mode:"LIVE",signalMode:"STABLE4",stable4Mode:"LIVE",runtimeSha:SHA,maximumSlippageBps:20},now:()=>now,stateStore:{load:async()=>state,save:async()=>{}},lock:{acquire:async()=>lease},marketData:{load:async()=>{marketReads++;throw Error("BTC entry history unavailable");}},executor:{getAccountSnapshot:async()=>({walletBalance:100,availableBalance:100,asset:"USDT",updatedAt:now}),getPositions:async()=>positions,getOpenOrders:async()=>orders,getMarketQuote:async()=>({symbol:"HYPEUSDT",bidPrice:119,askPrice:120,midPrice:119.5,updatedAt:now}),executeMarket:async(input:any)=>{sent.push(input);positions.splice(0,1);return{status:"FILLED",executedQuantity:2,averagePrice:119};}},adapter:{client:{getKlines:async()=>[[contract.logicalExitTs,"118","120","117","119","1",contract.logicalExitTs+H-1]]},cancel:async()=>{throw Error("must not cancel");}},h48TimeOnlyPolicy:{authorize:async(input:any)=>{if(authorityInvalid||positions[0]?.quantity!==input.quantity)throw Error("ownership/certificate invalid");return{policy:"H48_TIME_ONLY",runtimeSha:SHA,positionId:contract.positionId,logicalEntryTs:T,logicalExitTs:contract.logicalExitTs,quantity:input.quantity,certificateSha256:"b".repeat(64),validatedAt:now,expiresAt:now+60000};}},logger:{info(){},warn(){},error(){}}} as any);
 runner.liveGate=()=>{};
 return{runner,state,positions,orders,sent,marketReads:()=>marketReads,failAuthority:()=>{authorityInvalid=true;}};
}
test("due H48 exits with actual boundary and fresh bid despite entry-history failure and foreign unmanaged orders",async()=>{
 const f=fixture();f.orders.push({symbol:"BTCUSDT",clientOrderId:"foreign-order",status:"NEW",type:"LIMIT"});
 const out=await f.runner.tick();assert.equal(out.status,"completed");assert.equal(f.marketReads(),0);assert.equal(f.sent.length,1);
 assert.equal(f.sent[0].symbol,"HYPEUSDT");assert.equal(f.sent[0].side,"SELL");assert.equal(f.sent[0].reduceOnly,true);assert.equal(f.sent[0].expectedPrice,119);assert.equal(f.sent[0].reason,"HYPE_REDESIGN_TIME48_NEXTOPEN");assert.equal(f.orders.length,1);assert.equal(f.state.positions.length,0);
});
test("own HYPE order, certificate failure and exact quantity mismatch remain fail-closed without flattening",async()=>{
 for(const kind of ["order","certificate","quantity"]){const f=fixture();if(kind==="order")f.orders.push({symbol:"HYPEUSDT",clientOrderId:"foreign-hype",status:"NEW",type:"LIMIT"});else if(kind==="certificate")f.failAuthority();else f.positions[0].quantity=2.001;const out=await f.runner.tick();assert.equal(out.status,"manual-review");assert.equal(f.sent.length,0);assert.equal(f.state.positions.length,1);}
});
test("existing manual review and unresolved submission are never auto-flattened or resent",async()=>{
 for(const kind of ["review","pending"]){const f=fixture();if(kind==="review")f.state.manualReview="operator review";else f.state.pending={action:"EXIT",phase:"submitted",clientOrderId:"prior-unknown"};const out=await f.runner.tick();assert.equal(out.status,"manual-review");assert.equal(f.sent.length,0);assert.equal(f.state.positions.length,1);}
});
test("temporary boundary and quote failures hold without latching review and retry after recovery",async()=>{
 for(const kind of ["boundary","quote","missing"]){
  const f=fixture(),dep=f.runner.dependencies;
  const key=kind==="quote"?"getMarketQuote":"getKlines",target=kind==="quote"?dep.executor:dep.adapter.client,original=target[key];
  let first=true;target[key]=async(...args:any[])=>{if(first){first=false;if(kind==="missing")return[];throw Error("ECONNRESET");}return original(...args);};
  const held=await f.runner.tick();assert.equal(held.status,"held");assert.equal(f.state.manualReview,undefined);assert.equal(f.sent.length,0);
  const resumed=await f.runner.tick();assert.equal(resumed.status,"completed");assert.equal(f.sent.length,1);
 }
});
test("malformed boundary or quote cannot submit an H48 exit",async()=>{
 for(const kind of ["boundary","quote"]){const f=fixture(),dep=f.runner.dependencies;
  if(kind==="boundary")dep.adapter.client.getKlines=async()=>[[T+48*H,"bad"]];
  else dep.executor.getMarketQuote=async()=>({symbol:"HYPEUSDT",bidPrice:NaN,updatedAt:NaN});
  const out=await f.runner.tick();assert.notEqual(out.status,"completed");assert.equal(f.sent.length,0);
 }
});
test("transient signed ownership GET failure retries with no order; invalid policy never does",async()=>{
 const f=fixture(),policy=f.runner.dependencies.h48TimeOnlyPolicy,original=policy.authorize;let first=true;
 policy.authorize=async(input:any)=>{if(first){first=false;throw Error("ECONNRESET");}return original(input);};
 const held=await f.runner.tick();assert.equal(held.status,"held");assert.equal(f.state.manualReview,undefined);assert.equal(f.sent.length,0);
 const resumed=await f.runner.tick();assert.equal(resumed.status,"completed");assert.equal(f.sent.length,1);
 const invalid=fixture();invalid.failAuthority();const blocked=await invalid.runner.tick();assert.equal(blocked.status,"manual-review");assert.equal(invalid.sent.length,0);
});
