import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {V4RunnerEngine} from "../lib/v12-v4-runner-engine";
const sha="a".repeat(40);
const families=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"] as const;
function peers(now:number){return families.map(kind=>({kind,programSha:sha,raw:{
 updatedAt:now,...(kind==="V12"?{schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",activePositions:[]}:
 kind==="V52"?{positions:{}}:kind==="IDLE"||kind==="HYPE_LONG"?{positions:[]}:kind==="PENGU"?{version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE",position:null}:{position:null})
}}));}
function attestedPeers(observedAt:number,updatedAt:number){return families.map(kind=>({kind,programSha:sha,raw:{
 updatedAt,...(kind==="V12"?{schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",activePositions:[]}:
 kind==="V52"?{positions:{}}:kind==="HYPE_LONG"?{schema:"disdex-hype-zec-long/v1",mode:"LIVE",positions:[]}:kind==="IDLE"?{positions:[]}:
 kind==="RESIDUAL"?{schema:"disdex-idle-residual-long-state/v1",position:null,pending:null,manualReview:null}:
 kind==="PENGU"?{version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE",position:null}:
 kind==="Q102"?{version:1,strategyId:"QUALITY102_CAUSAL_V1",position:null}:
 {schema:"fet-brk48-residual-state/v1",strategyId:"FET_BRK48_RESIDUAL",position:null})},
 service:{unit:`peer@${sha}.service`,active:true,retiredV12:false,observedAt,mainPid:123}
 }));}
test("runner takes real shared lock and signed account mark, then stays non-ordering with no signals",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-engine-"));const now=Date.now();
 try{
  const store=new V4ExecutionStore(join(dir,"orders.json"),sha);
  store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
  const lock=new FileAccountOrderLock(join(dir,"account.lock"),120000,join(dir,"pending.json"));
  let apiReads=0,mutationCalls=0;
  const client:any={getBalances:async()=>{apiReads++;return [{asset:"USDT",balance:"1000",availableBalance:"1000"}]},
   getPositions:async()=>[],getOpenOrders:async()=>[],
   getUserTrades:async()=>[],getIncomeHistory:async()=>[]};
  let time=now;
  const engine=new V4RunnerEngine({store,accountLock:lock,adapter:{} as any,client,
   pendingRegistryPath:join(dir,"pending.json"),fetchPeers:async()=>peers(time),
   fetchExitFeed:async()=>({closed:[]}),
   fetchDecision:async()=>({schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",
    decisionTs:time-5000,capturedAtMs:time,sourceFingerprint:"1",candidateCount:0,filteredCount:0,
    sourceCount:0,nativeCoreEvents:[],entryAtrByCandidate:{},errors:[],candidates:[],filtered:[],
    orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0}),
   assertAuthority:async()=>{mutationCalls++;throw Error("AUTHORITY_FORBIDDEN")},
   assertEntrySafety:async()=>{},
   assertSourceParity:async()=>{throw Error("SOURCE_PARITY_NOT_PROVEN")},
   requiredResidentStop:async()=>{throw Error("STOP_NOT_CERTIFIED")},
   quantityNormalizer:{} as any,referencePrice:async()=>{throw Error("NO_PRICE")},
   minimumVenueOrderNotional:async()=>{throw Error("NO_FILTER")},
   now:()=>time,
  });
  assert.equal((await engine.tick()).status,"observing");
  assert.equal(apiReads,1);assert.equal(mutationCalls,0);
  assert.equal(store.read().state.journal.length,1);
  time+=1000;
  assert.equal((await engine.tick()).status,"observing");
  assert.equal(store.read().state.journal.length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("market-data prefetch failure stays fail-closed without terminating the V4 tick loop",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-prefetch-failure-"));let time=Date.now();let mutationCalls=0,fetchAttempts=0;
 try{
  const store=new V4ExecutionStore(join(dir,"orders.json"),sha);
  store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
  const lock=new FileAccountOrderLock(join(dir,"account.lock"),120000,join(dir,"pending.json"));
  const client:any={getBalances:async()=>[{asset:"USDT",balance:"1000",availableBalance:"1000"}],
   getPositions:async()=>[],getOpenOrders:async()=>[],getUserTrades:async()=>[],getIncomeHistory:async()=>[]};
  const engine=new V4RunnerEngine({store,accountLock:lock,adapter:{} as any,client,
   pendingRegistryPath:join(dir,"pending.json"),fetchPeers:async()=>peers(time),
   fetchExitFeed:async()=>({closed:[]}),
   fetchDecision:async()=>{fetchAttempts++;throw Error("V4_H1_WARMUP_INSUFFICIENT:APTUSDT")},
   assertAuthority:async()=>{mutationCalls++;throw Error("AUTHORITY_FORBIDDEN")},
   assertEntrySafety:async()=>{},assertSourceParity:async()=>{},
   requiredResidentStop:async()=>{throw Error("STOP_NOT_CERTIFIED")},
   quantityNormalizer:{} as any,referencePrice:async()=>{throw Error("NO_PRICE")},
   minimumVenueOrderNotional:async()=>{throw Error("NO_FILTER")},now:()=>time,
  });
  const prepared=await engine.prepareFlatMarketDecision();
  assert.equal(prepared?.kind,"FAILED");
  const result=await engine.tick(prepared);
  assert.equal(result.status,"observing");
  assert.equal(result.reason,"V4_MARKET_DATA_UNAVAILABLE:V4_H1_WARMUP_INSUFFICIENT:APTUSDT");
  assert.equal(result.orderEnabled,false);
  assert.equal(mutationCalls,0);
  assert.equal(store.read().state.journal.length,1,"signed account reconciliation completes before fail-closed observation");
  time+=60_000;
  const retryPrepared=await engine.prepareFlatMarketDecision();
  const retry=await engine.tick(retryPrepared);
  assert.equal(retry.status,"observing","a later failed source read remains a tick result, not a process-fatal throw");
  assert.equal(retry.orderEnabled,false);
  assert.equal(fetchAttempts,2);
  assert.equal(mutationCalls,0);
  assert.equal(store.read().state.journal.length,2);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("refreshes peer attestation after slow signed account reads",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v4-peer-refresh-"));let time=Date.now(),peerCalls=0;
 try{
  const store=new V4ExecutionStore(join(dir,"orders.json"),sha);
  store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
  const lock=new FileAccountOrderLock(join(dir,"account.lock"),120000,join(dir,"pending.json"));
  const client:any={
   getBalances:async()=>{await Promise.resolve();time+=16_000;return [{asset:"USDT",balance:"1000",availableBalance:"1000"}]},
   getPositions:async()=>[],getOpenOrders:async()=>[],getUserTrades:async()=>[],getIncomeHistory:async()=>[],
  };
  const engine=new V4RunnerEngine({store,accountLock:lock,adapter:{} as any,client,
   pendingRegistryPath:join(dir,"pending.json"),
   fetchPeers:async()=>{peerCalls++;return attestedPeers(time,time-121_000)},
   fetchExitFeed:async()=>({closed:[]}),fetchDecision:async()=>({
    schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",decisionTs:time-5_000,
    capturedAtMs:time,sourceFingerprint:"peer-refresh",candidateCount:0,filteredCount:0,sourceCount:0,
    nativeCoreEvents:[],entryAtrByCandidate:{},errors:[],candidates:[],filtered:[],orderEnabled:false,
    realOrderEnabledV4:0,tradingMutation:0,
   }),
   assertAuthority:async()=>{throw Error("AUTHORITY_FORBIDDEN")},assertEntrySafety:async()=>{},assertSourceParity:async()=>{},
   requiredResidentStop:async()=>{throw Error("STOP_NOT_CERTIFIED")},quantityNormalizer:{} as any,
   referencePrice:async()=>{throw Error("NO_PRICE")},minimumVenueOrderNotional:async()=>{throw Error("NO_FILTER")},now:()=>time,
  });
  const result=await engine.tick();
  assert.equal(result.status,"observing");
  assert.equal(result.orderEnabled,false);
  assert.equal(peerCalls,2,"peer service/state attestation must be refreshed after slow account reads");
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("candidate source errors and stale data remain fail-closed observations",async()=>{
 const now=Date.now(),dir=mkdtempSync(join(tmpdir(),"v4-invalid-decision-"));
 try{
  for(const scenario of [
   {name:"partial source errors",capturedAtMs:now,errors:["APTUSDT:INVALID_SIGNED_H1_CANDLE"],reason:"V4_MARKET_DATA_UNAVAILABLE:APTUSDT:INVALID_SIGNED_H1_CANDLE"},
   {name:"stale snapshot",capturedAtMs:now-136*60_000,errors:[],reason:"V4_MARKET_DATA_UNAVAILABLE:V4_DECISION_SNAPSHOT_STALE"},
  ]){
   const caseDir=join(dir,scenario.name.replaceAll(" ","-"));const store=new V4ExecutionStore(join(caseDir,"orders.json"),sha);
   store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
   const lock=new FileAccountOrderLock(join(caseDir,"account.lock"),120000,join(caseDir,"pending.json"));
   const client:any={getBalances:async()=>[{asset:"USDT",balance:"1000",availableBalance:"1000"}],
    getPositions:async()=>[],getOpenOrders:async()=>[],getUserTrades:async()=>[],getIncomeHistory:async()=>[]};
   const decision={schema:"v12-v4-live-decision/v1" as const,policyId:"V2_M150_D05_CORE_NATIVE" as const,
    decisionTs:now-5000,capturedAtMs:scenario.capturedAtMs,sourceFingerprint:"test",candidateCount:0,
    filteredCount:0,sourceCount:0,nativeCoreEvents:[],entryAtrByCandidate:{},errors:scenario.errors,
    candidates:[],filtered:[],orderEnabled:false as const,realOrderEnabledV4:0 as const,tradingMutation:0 as const};
   const engine=new V4RunnerEngine({store,accountLock:lock,adapter:{} as any,client,
    pendingRegistryPath:join(caseDir,"pending.json"),fetchPeers:async()=>peers(now),fetchExitFeed:async()=>({closed:[]}),
    fetchDecision:async()=>decision,assertAuthority:async()=>{throw Error("AUTHORITY_FORBIDDEN")},
    assertEntrySafety:async()=>{},assertSourceParity:async()=>{},requiredResidentStop:async()=>{throw Error("STOP_NOT_CERTIFIED")},
    quantityNormalizer:{} as any,referencePrice:async()=>{throw Error("NO_PRICE")},minimumVenueOrderNotional:async()=>{throw Error("NO_FILTER")},now:()=>now});
   const result=await engine.tick();
   assert.equal(result.status,"observing",scenario.name);
   assert.equal(result.reason,scenario.reason,scenario.name);
   assert.equal(result.orderEnabled,false,scenario.name);
   assert.equal(store.read().state.journal.length,1,scenario.name);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test("mock Aster dispatch reaches signed entry fill, STOP, and shared reservation retirement",async()=>{
 const fixture=(await import("./fixtures/v12-v4-native-route-20261009.json")).default;
 const {adaptProductionCandidates}=await import("../lib/v12-v4-production-features");
 const {readPendingExposureRegistry}=await import("../lib/disdex-pending-exposure-registry");
 const {productionExitSpec}=await import("../lib/v12-v4-production-lifecycle");
 const candidate=adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0];
 let time=candidate.eligibleEntryTs+5000;const dir=mkdtempSync(join(tmpdir(),"v4-fullcycle-"));
 try{
  const store=new V4ExecutionStore(join(dir,"state.json"),sha);
  store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
  const lock=new FileAccountOrderLock(join(dir,"account.lock"),120000,join(dir,"pending.json"));
  let submitted=0,stops=0,exits=0,positionQty=0,exitFeed:any={closed:[]};
  let venueExitDrift=false,cancelCount=0;const orders=new Map<string,any>(),fills:any[]=[];
  const adapter:any={client:{getOrder:async(_s:string,cid:string)=>orders.get(cid)},
   executor:{},normalizeStopPrice:async(_s:string,p:number)=>({price:Math.round(p*100)/100,text:p.toFixed(2)}),
   cancel:async(cid:string)=>{cancelCount++;orders.delete(cid);},
   executeEntry:async(x:any)=>{
    submitted++;const qty=x.quantity,id=51;positionQty=qty*(x.side==="LONG"?1:-1);
    orders.set(x.clientOrderId,{symbol:x.symbol,clientOrderId:x.clientOrderId,orderId:id,
     status:"FILLED",side:x.side==="LONG"?"BUY":"SELL",origQty:String(qty),
     executedQty:String(qty),avgPrice:"99",cumQuote:String(qty*99)});
    fills.push({symbol:x.symbol,id:91,orderId:id,side:x.side==="LONG"?"BUY":"SELL",
     price:"99",qty:String(qty),commission:"0",commissionAsset:"USDT",time});
    return {status:"FILLED",executionUnknown:false};
   },
   placeStopMarket:async(x:any)=>{
    stops++;orders.set(x.clientOrderId,{...x,orderId:52,status:"NEW",type:"STOP_MARKET",
     origQty:String(x.quantity),executedQty:"0",avgPrice:"0",cumQuote:"0"});
    return {acknowledged:true,orderId:"52"};
   },
   executeExit:async(x:any)=>{
    exits++;const qty=x.quantity,id=53;positionQty=0;
    const side=x.positionSide==="LONG"?"SELL":"BUY";
    orders.set(x.clientOrderId,{symbol:x.symbol,clientOrderId:x.clientOrderId,
     orderId:id,status:"FILLED",side,reduceOnly:true,origQty:String(qty),
     executedQty:String(qty),avgPrice:"100",cumQuote:String(qty*100)});
    fills.push({symbol:x.symbol,id:92,orderId:id,side,price:"100",qty:String(qty),
     commission:"0",commissionAsset:"USDT",time});
    return {status:"FILLED",executionUnknown:false};
   },
  };
  const client:any={getBalances:async()=>[{asset:"USDT",balance:"1000",availableBalance:"1000"}],
   getPositions:async()=>{
    const signedQty=exits>0&&venueExitDrift?0.25:positionQty;
    return signedQty?[{symbol:candidate.symbol,positionAmt:String(signedQty),markPrice:"100",unRealizedProfit:"0"}]:[];
   },
   getOpenOrders:async()=>[...orders.values()].filter(o=>o.status==="NEW"),
   getUserTrades:async()=>fills,getIncomeHistory:async()=>[]};
  const atrKey=[candidate.symbol,candidate.route,candidate.effectiveSide,candidate.eligibleEntryTs].join("|");
  const runner=new V4RunnerEngine({store,accountLock:lock,adapter,client,
   pendingRegistryPath:join(dir,"pending.json"),fetchPeers:async()=>peers(time),
   fetchExitFeed:async()=>exitFeed,fetchDecision:async()=>({
    schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",
    decisionTs:candidate.eligibleEntryTs,capturedAtMs:time,sourceFingerprint:"mock-signed-fixture",
    candidateCount:1,filteredCount:0,sourceCount:1,nativeCoreEvents:[],
    entryAtrByCandidate:{[atrKey]:1},errors:[],candidates:[candidate],filtered:[],
    orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0,
   }),
   assertAuthority:async()=>{},assertEntrySafety:async()=>{},assertSourceParity:async()=>{},
   requiredResidentStop:async({entryPrice}:any)=>candidate.effectiveSide==="LONG"?entryPrice*.92:entryPrice*1.08,
   quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any,
   referencePrice:async()=>100,minimumVenueOrderNotional:async()=>5,now:()=>time,
  });
  const result=await runner.tick();
  assert.equal(result.status,"submitted");
  assert.equal(submitted,1);assert.equal(stops,1);
  const activeStop=[...orders.values()].find(o=>o.type==="STOP_MARKET");
  assert.ok(activeStop);
  const expectedStop=candidate.effectiveSide==="LONG"?99*.92:99*1.08;
  assert.ok(Math.abs(Number(activeStop.stopPrice)-expectedStop)<1e-7);
  const leg=Object.values(store.read().state.legs)[0];
  assert.equal(leg.status,"OPEN");assert.ok(leg.qty>0);
  const registry=await readPendingExposureRegistry(join(dir,"pending.json"));
  assert.equal(registry.entries.filter(x=>x.status!=="RELEASED").length,0);
  const spec=productionExitSpec(candidate.route);
  const end=candidate.eligibleEntryTs+spec.hours*3600000;
  exitFeed={closed:Array.from({length:spec.hours},(_,i)=>({openTs:candidate.eligibleEntryTs+i*3600000,
   open:100,high:100.1,low:99.9,close:100})),nextOpens:[{ts:end,price:100}]};
  time=end+5000;
  venueExitDrift=true;
  await assert.rejects(runner.tick(),/V4_SHARED_SYMBOL_EXIT_VENUE_QTY_DRIFT/);
  assert.equal(exits,1);
  assert.equal(cancelCount,0,"unreconciled broker net quantity must not retire the STOP");
  assert.equal(store.read().state.legs[leg.id].status,"CLOSED");
  assert.equal([...orders.values()].filter(o=>o.status==="NEW").length,1);
  // Once the signed venue inventory is reconciled, restart retirement safely
  // cancels the orphan STOP without a second EXIT mutation.
  venueExitDrift=false;
  time+=1000; // A restart receives a fresh signed account-mark event ID.
  const recovered=await runner.tick();
  assert.equal(recovered.status,"observing");
  assert.equal(exits,1);
  assert.equal(cancelCount,1);
  assert.equal([...orders.values()].filter(o=>o.status==="NEW").length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

async function protectionRecoveryHarness(mode:"UNKNOWN_STOP_ACK"|"PARTIAL_GROWTH"){
 const fixture=(await import("./fixtures/v12-v4-native-route-20261009.json")).default;
 const {adaptProductionCandidates}=await import("../lib/v12-v4-production-features");
 const candidate=adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0];
 let time=candidate.eligibleEntryTs+5000;
 const dir=mkdtempSync(join(tmpdir(),"v4-protection-recovery-"));
 const store=new V4ExecutionStore(join(dir,"state.json"),sha);
 store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
 const lock=new FileAccountOrderLock(join(dir,"account.lock"),120000,join(dir,"pending.json"));
 const orders=new Map<string,any>(),fills:any[]=[];
 let entrySends=0,stopSends=0,cancels=0,positionQty=0,firstStop=true;
 const adapter:any={
  client:{getOrder:async(_s:string,cid:string)=>orders.get(cid)},
  executor:{},
  normalizeStopPrice:async(_s:string,p:number)=>({price:Math.round(p*100)/100,text:p.toFixed(2)}),
  cancel:async(cid:string)=>{cancels++;const o=orders.get(cid);if(o)o.status="CANCELED";},
  executeEntry:async(x:any)=>{
   entrySends++;const full=x.quantity,qty=mode==="PARTIAL_GROWTH"?full/2:full,id=701;
   positionQty=qty*(x.side==="LONG"?1:-1);
   orders.set(x.clientOrderId,{symbol:x.symbol,clientOrderId:x.clientOrderId,orderId:id,
    status:mode==="PARTIAL_GROWTH"?"PARTIALLY_FILLED":"FILLED",side:x.side==="LONG"?"BUY":"SELL",
    reduceOnly:false,origQty:String(full),executedQty:String(qty),avgPrice:"99",cumQuote:String(qty*99)});
   fills.push({symbol:x.symbol,id:801,orderId:id,side:x.side==="LONG"?"BUY":"SELL",
    price:"99",qty:String(qty),commission:"0",commissionAsset:"USDT",time});
   return {status:mode==="PARTIAL_GROWTH"?"PARTIALLY_FILLED":"FILLED",executionUnknown:false};
  },
  placeStopMarket:async(x:any)=>{
   stopSends++;const id=710+stopSends;
   orders.set(x.clientOrderId,{...x,orderId:id,status:"NEW",type:"STOP_MARKET",
    side:x.side,reduceOnly:true,origQty:String(x.quantity),executedQty:"0",
    avgPrice:"0",cumQuote:"0",stopPrice:String(x.stopPrice)});
   if(mode==="UNKNOWN_STOP_ACK"&&firstStop){firstStop=false;throw Error("simulated response loss after venue accept");}
   return {acknowledged:true,orderId:String(id)};
  },
  executeExit:async()=>{throw Error("UNEXPECTED_EXIT")},
 };
 const client:any={
  getBalances:async()=>[{asset:"USDT",balance:"1000",availableBalance:"1000"}],
  getPositions:async()=>positionQty?[{symbol:candidate.symbol,positionAmt:String(positionQty),markPrice:"100",unRealizedProfit:"0"}]:[],
  getOpenOrders:async()=>[...orders.values()].filter(o=>o.status==="NEW"),
  getUserTrades:async()=>fills,
  getIncomeHistory:async()=>[],
 };
 const atrKey=[candidate.symbol,candidate.route,candidate.effectiveSide,candidate.eligibleEntryTs].join("|");
 const engine=new V4RunnerEngine({store,accountLock:lock,adapter,client,
  pendingRegistryPath:join(dir,"pending.json"),fetchPeers:async()=>peers(time),
  fetchExitFeed:async()=>({closed:[]}),
  fetchDecision:async()=>({schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",
   decisionTs:candidate.eligibleEntryTs,capturedAtMs:time,sourceFingerprint:"recovery-fixture",
   candidateCount:1,filteredCount:0,sourceCount:1,nativeCoreEvents:[],
   entryAtrByCandidate:{[atrKey]:1},errors:[],candidates:[candidate],filtered:[],
   orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0}),
  assertAuthority:async()=>{},assertEntrySafety:async()=>{},assertSourceParity:async()=>{},
  requiredResidentStop:async({entryPrice}:any)=>candidate.effectiveSide==="LONG"?entryPrice*.92:entryPrice*1.08,
  quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any,
  referencePrice:async()=>100,minimumVenueOrderNotional:async()=>5,now:()=>time,
 });
 return {dir,store,engine,orders,fills,candidate,
  get time(){return time},set time(v:number){time=v},
  get entrySends(){return entrySends},get stopSends(){return stopSends},get cancels(){return cancels},
  get positionQty(){return positionQty},set positionQty(v:number){positionQty=v}};
}

test("restart recovers venue-accepted STOP after response loss without duplicate ENTRY or STOP",async()=>{
 const h=await protectionRecoveryHarness("UNKNOWN_STOP_ACK");
 try{
  await assert.rejects(h.engine.tick(),/simulated response loss after venue accept/);
  assert.equal(h.entrySends,1);assert.equal(h.stopSends,1);
  const before=Object.values(h.store.read().protections)[0];
  assert.equal(before.phase,"STOP_SENT_UNKNOWN");
  h.time+=1000;
  const recovered=await h.engine.tick();
  assert.equal(recovered.status,"observing");
  assert.equal(h.entrySends,1,"restart must not resend ENTRY");
  assert.equal(h.stopSends,1,"readback of accepted STOP must prevent duplicate STOP send");
  const doc=h.store.read(),leg=Object.values(doc.state.legs)[0];
  assert.equal(doc.protections[leg.id].phase,"STOP_CONFIRMED");
  assert.equal(doc.protections[leg.id].protectedQty,leg.qty);
  assert.equal([...h.orders.values()].filter((o:any)=>o.status==="NEW"&&o.type==="STOP_MARKET").length,1);
 }finally{rmSync(h.dir,{recursive:true,force:true});}
});

test("additional cumulative ENTRY fill re-arms larger STOP before retiring smaller STOP",async()=>{
 const h=await protectionRecoveryHarness("PARTIAL_GROWTH");
 try{
  const first=await h.engine.tick();
  assert.equal(first.status,"submitted");
  assert.equal(h.entrySends,1);assert.equal(h.stopSends,1);
  let doc=h.store.read(),leg=Object.values(doc.state.legs)[0];
  const half=leg.qty,requested=leg.requestedQty;
  assert.ok(half>0&&half<requested);
  const oldStop=Object.values(doc.intents).find(i=>i.legId===leg.id&&i.action==="STOP")!;
  assert.equal(doc.protections[leg.id].phase,"STOP_CONFIRMED");
  const entry=Object.values(doc.intents).find(i=>i.legId===leg.id&&i.action==="ENTRY")!;
  const entryOrder=h.orders.get(entry.clientOrderId);
  const extra=requested-half;
  entryOrder.status="FILLED";entryOrder.executedQty=String(requested);
  entryOrder.cumQuote=String(requested*99);entryOrder.avgPrice="99";
  h.fills.push({symbol:h.candidate.symbol,id:802,orderId:entryOrder.orderId,side:entryOrder.side,
   price:"99",qty:String(extra),commission:"0",commissionAsset:"USDT",time:h.time+500});
  h.positionQty=requested*(h.candidate.effectiveSide==="LONG"?1:-1);
  h.time+=1000;
  const second=await h.engine.tick();
  assert.equal(second.status,"observing");
  assert.equal(h.entrySends,1);
  assert.equal(h.stopSends,2,"larger cumulative fill requires a new deterministic STOP generation");
  assert.equal(h.cancels,1,"old smaller STOP retires only after replacement confirmation");
  doc=h.store.read();leg=doc.state.legs[leg.id];
  assert.equal(leg.qty,requested);
  assert.equal(doc.protections[leg.id].phase,"STOP_CONFIRMED");
  assert.equal(doc.protections[leg.id].protectedQty,requested);
  const active=[...h.orders.values()].filter((o:any)=>o.status==="NEW"&&o.type==="STOP_MARKET");
  assert.equal(active.length,1);
  assert.equal(Number(active[0].origQty),requested);
  assert.notEqual(active[0].clientOrderId,oldStop.clientOrderId);
 }finally{rmSync(h.dir,{recursive:true,force:true});}
});
