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
 updatedAt:now,...(kind==="V12"?{activePositions:[]}:
 kind==="V52"?{positions:{}}:kind==="IDLE"||kind==="HYPE_LONG"?{positions:[]}:{position:null})
}}));}
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
test("mock Aster dispatch reaches signed entry fill, STOP, and shared reservation retirement",async()=>{
 const fixture=(await import("./fixtures/v12-v4-native-route-20261009.json")).default;
 const {adaptProductionCandidates}=await import("../lib/v12-v4-production-features");
 const {readPendingExposureRegistry}=await import("../lib/disdex-pending-exposure-registry");
 const candidate=adaptProductionCandidates({...fixture,source:{...fixture.source,side:"SHORT",sourceEngine:"buildV12Signals"}}).candidates[0];
 const time=candidate.eligibleEntryTs+5000,dir=mkdtempSync(join(tmpdir(),"v4-fullcycle-"));
 try{
  const store=new V4ExecutionStore(join(dir,"state.json"),sha);
  store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
  const lock=new FileAccountOrderLock(join(dir,"account.lock"),120000,join(dir,"pending.json"));
  let submitted=0,stops=0;const orders=new Map<string,any>(),fills:any[]=[];
  const adapter:any={client:{getOrder:async(_s:string,cid:string)=>orders.get(cid)},
   executor:{},cancel:async()=>{},
   executeEntry:async(x:any)=>{
    submitted++;const qty=x.quantity,id=51;
    orders.set(x.clientOrderId,{symbol:x.symbol,clientOrderId:x.clientOrderId,orderId:id,
     status:"FILLED",side:x.side==="LONG"?"BUY":"SELL",origQty:String(qty),
     executedQty:String(qty),avgPrice:"100",cumQuote:String(qty*100)});
    fills.push({symbol:x.symbol,id:91,orderId:id,side:x.side==="LONG"?"BUY":"SELL",
     price:"100",qty:String(qty),commission:"0",commissionAsset:"USDT",time});
    return {status:"FILLED",executionUnknown:false};
   },
   placeStopMarket:async(x:any)=>{
    stops++;orders.set(x.clientOrderId,{...x,orderId:52,status:"NEW",type:"STOP_MARKET",
     origQty:String(x.quantity),executedQty:"0",avgPrice:"0",cumQuote:"0"});
    return {acknowledged:true,orderId:"52"};
   },
  };
  const client:any={getBalances:async()=>[{asset:"USDT",balance:"1000",availableBalance:"1000"}],
   getPositions:async()=>[],getOpenOrders:async()=>[],
   getUserTrades:async()=>fills,getIncomeHistory:async()=>[]};
  const atrKey=[candidate.symbol,candidate.route,candidate.effectiveSide,candidate.eligibleEntryTs].join("|");
  const runner=new V4RunnerEngine({store,accountLock:lock,adapter,client,
   pendingRegistryPath:join(dir,"pending.json"),fetchPeers:async()=>peers(time),
   fetchExitFeed:async()=>({closed:[]}),fetchDecision:async()=>({
    schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",
    decisionTs:candidate.eligibleEntryTs,capturedAtMs:time,sourceFingerprint:"mock-signed-fixture",
    candidateCount:1,filteredCount:0,sourceCount:1,nativeCoreEvents:[],
    entryAtrByCandidate:{[atrKey]:1},errors:[],candidates:[candidate],filtered:[],
    orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0,
   }),
   assertAuthority:async()=>{},assertSourceParity:async()=>{},
   requiredResidentStop:async()=>candidate.effectiveSide==="LONG"?90:110,
   quantityNormalizer:{normalizeMarketQuantity:async(_s:string,q:number,p:number)=>({quantity:q,notional:q*p})} as any,
   referencePrice:async()=>100,minimumVenueOrderNotional:async()=>5,now:()=>time,
  });
  const result=await runner.tick();
  assert.equal(result.status,"submitted");
  assert.equal(submitted,1);assert.equal(stops,1);
  const leg=Object.values(store.read().state.legs)[0];
  assert.equal(leg.status,"OPEN");assert.ok(leg.qty>0);
  const registry=await readPendingExposureRegistry(join(dir,"pending.json"));
  assert.equal(registry.entries.filter(x=>x.status!=="RELEASED").length,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
