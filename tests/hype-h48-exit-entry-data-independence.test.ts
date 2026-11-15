import test from "node:test";
import assert from "node:assert/strict";
import {HypeZecLongRunner} from "../lib/hype-zec-long-runner";
import {createHypeH48TimeOnlyContract} from "../lib/hype-stable4-time-only-contract";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {applyProductionEvent} from "../lib/v12-v4-production-lifecycle";
import {V4RunnerEngine} from "../lib/v12-v4-runner-engine";
import {evaluateV12V4Routes} from "../lib/v12-multilogic-v4-shadow";
import {MarketSlippageGuardError} from "../lib/market-slippage-guard-error";
const H=3600000,T=Date.UTC(2026,10,15,6),SHA="a".repeat(40);
function fixture(){
 const now=T+48*H+1000,contract=createHypeH48TimeOnlyContract({positionId:"h48-native",sourceSha:SHA,logicalEntryTs:T});
 const owned:any={strategy:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG",positionId:contract.positionId,quantity:2,entryPrice:100,entryTs:T+1000,signalTs:T,stopPrice:0,takeProfitPrice:0,nativeExitContract:contract,updatedAt:now};
 const state:any={schema:"disdex-hype-zec-long/v1",runtimeCommitSha:SHA,mode:"LIVE",updatedAt:now,positions:[owned],failures:[]};
 const positions:any[]=[{symbol:"HYPEUSDT",quantity:2,positionSide:"BOTH",entryPrice:100,markPrice:120,notionalUsd:240,updatedAt:now}],orders:any[]=[],sent:any[]=[];
 let marketReads=0,authorityInvalid=false;
 const lease={document:async()=>({accountScope:"ASTER_FUTURES",leaseId:"lease",ownerId:"owner",acquiredAt:now-1000,expiresAt:now+120000}),release:async()=>{}};
 const runner:any=new HypeZecLongRunner({runtime:{enabled:true,mode:"LIVE",signalMode:"STABLE4",stable4Mode:"LIVE",runtimeSha:SHA,maximumSlippageBps:20},now:()=>now,stateStore:{load:async()=>state,save:async()=>{}},lock:{acquire:async()=>lease},marketData:{load:async()=>{marketReads++;throw Error("BTC entry history unavailable");}},executor:{getAccountSnapshot:async()=>({walletBalance:100,availableBalance:100,asset:"USDT",updatedAt:now}),getPositions:async()=>positions,getOpenOrders:async()=>orders,getMarketQuote:async()=>({symbol:"HYPEUSDT",bidPrice:119,askPrice:120,midPrice:119.5,updatedAt:now}),executeMarket:async(input:any)=>{sent.push(input);positions.splice(0,1);return{status:"FILLED",executedQuantity:2,averagePrice:119};}},adapter:{client:{getKlines:async()=>[[contract.logicalExitTs,"118","120","117","119","1",contract.logicalExitTs+H-1]]},cancel:async()=>{throw Error("must not cancel");}},h48V4PriorityPolicy:{authorize:async()=>{}},h48TimeOnlyPolicy:{authorize:async(input:any)=>{if(authorityInvalid||positions[0]?.quantity!==input.quantity)throw Error("ownership/certificate invalid");return{policy:"H48_TIME_ONLY",runtimeSha:SHA,positionId:contract.positionId,logicalEntryTs:T,logicalExitTs:contract.logicalExitTs,quantity:input.quantity,certificateSha256:"b".repeat(64),validatedAt:now,expiresAt:now+60000};}},logger:{info(){},warn(){},error(){}}} as any);
 runner.liveGate=()=>{};
 return{runner,state,positions,orders,sent,lease,marketReads:()=>marketReads,failAuthority:()=>{authorityInvalid=true;}};
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
test("V4 preemption closes exactly the authorized H48 owner with native durable state",async()=>{
 const f=fixture(),out=await f.runner.preemptH48ForV4({lease:f.lease,expectedRuntimeSha:SHA,expectedPositionId:"h48-native",expectedQuantity:2,revalidate:async()=>{}});
 assert.equal(out.status,"completed");assert.equal(f.sent.length,1);assert.equal(f.sent[0].reduceOnly,true);assert.equal(f.sent[0].quantity,2);assert.equal(f.sent[0].reason,"HYPE_V4_FORMAL_PRIORITY");assert.equal(f.state.positions.length,0);assert.equal(f.state.pending,undefined);
});
test("V4 preemption never sends on owner/source/lease drift, existing pending, or invalid H48 policy",async()=>{
 for(const kind of ["id","source","quantity","lease","pending","policy","priority"]){const f=fixture();
  if(kind==="pending")f.state.pending={action:"EXIT",phase:"submitted"};if(kind==="policy")f.failAuthority();
  if(kind==="priority")f.runner.dependencies.h48V4PriorityPolicy=undefined;
  if(kind==="lease")f.lease.document=async()=>({accountScope:"ASTER_FUTURES",leaseId:"lease",ownerId:"owner",acquiredAt:1,expiresAt:1});
  const out=await f.runner.preemptH48ForV4({lease:f.lease,expectedRuntimeSha:kind==="source"?"f".repeat(40):SHA,expectedPositionId:kind==="id"?"different":"h48-native",expectedQuantity:kind==="quantity"?3:2,revalidate:async()=>{}});
  assert.notEqual(out.status,"completed",kind);assert.equal(f.sent.length,0,kind);assert.equal(f.state.positions.length,1,kind);
 }
});
test("unknown or partial V4 preemption requires reconciliation and never resends",async()=>{
 for(const kind of ["unknown","partial"]){const f=fixture();
  f.runner.dependencies.executor.executeMarket=async(input:any)=>{f.sent.push(input);return kind==="unknown"?{status:"UNKNOWN",executionUnknown:true}:{status:"PARTIALLY_FILLED",executedQuantity:1};};
  const input={lease:f.lease,expectedRuntimeSha:SHA,expectedPositionId:"h48-native",expectedQuantity:2,revalidate:async()=>{}};
  const first=await f.runner.preemptH48ForV4(input);assert.equal(first.status,"manual-review",kind);assert.equal(f.sent.length,1,kind);
  const next=await f.runner.preemptH48ForV4(input);assert.notEqual(next.status,"completed",kind);assert.equal(f.sent.length,1,kind);
 }
});
test("typed exact pre-send slippage defers H48 exit and preserves ability to retry",async()=>{
 const f=fixture(),executor=f.runner.dependencies.executor,original=executor.executeMarket;let first=true;
 executor.executeMarket=async(input:any)=>{if(first){first=false;throw new MarketSlippageGuardError(input.symbol,input.clientOrderId,true,30,20);}return original(input);};
 const input={lease:f.lease,expectedRuntimeSha:SHA,expectedPositionId:"h48-native",expectedQuantity:2,revalidate:async()=>{}};
 const held=await f.runner.preemptH48ForV4(input);assert.equal(held.message,"HYPE_H48_EXIT_SLIPPAGE_RETRY");assert.equal(f.state.pending,undefined);assert.equal(f.state.manualReview,undefined);assert.equal(f.sent.length,0);
 const resumed=await f.runner.preemptH48ForV4(input);assert.equal(resumed.status,"completed");assert.equal(f.sent.length,1);
});
test("actual V4 admission drives the real H48 coordinator under the same lease before any V4 entry",async()=>{
 const f=fixture(),dir=mkdtempSync(join(tmpdir(),"v4-h48-integrated-")),v4ts=T+48*H,now=v4ts+1000;
 try{
  const store=new V4ExecutionStore(join(dir,"orders.json"),SHA),foreign=[{owner:"HYPE_LONG",symbol:"HYPEUSDT",side:"LONG" as const,qty:2,gross:.2,crypto:true,pendingGross:0}];
  let doc=store.initialize({equityUsd:1000,foreign,holdProtected:false});
  doc=store.commit(doc.revision,{...doc,state:applyProductionEvent(doc.state,{type:"ACCOUNT_MARK",eventId:"account",ts:now,equityUsd:1000,prices:{HYPEUSDT:100}})});
  const candidate:any={...evaluateV12V4Routes({symbol:"ETHUSDT",sourceSide:"SHORT",sourceSignalTs:v4ts,age:2,volRatio:.5,er24:.5})[0],route:"REC_X01_TIME_24H",family:"RECOVERY_X",symbol:"ETHUSDT",requestedGross:.1,effectiveSide:"LONG",eligibleEntryTs:v4ts};
  let v4Orders=0,guards=0;
  const engine:any=new V4RunnerEngine({store,now:()=>now,assertEntrySafety:async()=>{guards++;},assertSourceParity:async()=>{},referencePrice:async()=>100,minimumVenueOrderNotional:async()=>5,requiredResidentStop:async()=>95,quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p,stepSize:.01})},assertAuthority:async()=>{},preemptH48ForV4:async(x:any)=>f.runner.preemptH48ForV4({...x,expectedRuntimeSha:SHA,expectedPositionId:"h48-native"})} as any);
  const decision:any={candidateCount:1,candidates:[candidate],entryAtrByCandidate:{[[candidate.symbol,candidate.route,candidate.effectiveSide,v4ts].join("|")]:1},nativeCoreEvents:[]};
  const result=await engine.tryCandidate(decision,{prepare:()=>{v4Orders++;return"cid";},submit:async()=>{v4Orders++;}}, {},f.lease);
  assert.equal(result.reason,"V4_H48_PREEMPTED_RECHECK_REQUIRED");assert.equal(f.sent.length,1);assert.equal(f.sent[0].reduceOnly,true);assert.equal(f.state.positions.length,0);assert.equal(v4Orders,0);assert.ok(guards>=3);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
