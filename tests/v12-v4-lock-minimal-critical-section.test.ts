import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileAccountOrderLock} from "../lib/disdex-account-order-lock";
import {V4ExecutionStore} from "../lib/v12-v4-execution-store";
import {V4RunnerEngine} from "../lib/v12-v4-runner-engine";

const sha="a".repeat(40);
const H2=7200000;
const families=["V12","PENGU","Q102","V52","FET","HYPE_LONG","IDLE","RESIDUAL"] as const;

function fixture(now:number,readMarket:(()=>Promise<any>)){
 const dir=mkdtempSync(join(tmpdir(),"v4-shortlock-"));
 const store=new V4ExecutionStore(join(dir,"orders.json"),sha);
 store.initialize({equityUsd:1000,foreign:[],holdProtected:false});
 const lock=new FileAccountOrderLock(join(dir,"account.lock"),120000,join(dir,"pending.json"));
 let reads=0,clock=now;
 const client:any={
  getBalances:async()=>{reads++;return [{asset:"USDT",balance:"1000",availableBalance:"1000"}];},
  getPositions:async()=>[],getOpenOrders:async()=>[],
  getUserTrades:async()=>[],getIncomeHistory:async()=>[],
 };
 const engine=new V4RunnerEngine({
  store,accountLock:lock,client,adapter:{} as any,
  pendingRegistryPath:join(dir,"pending.json"),
  fetchDecision:readMarket,
  fetchPeers:async()=>families.map(kind=>({kind,programSha:sha,raw:{
   updatedAt:clock,...(kind==="V12"?{schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",activePositions:[]}:
   kind==="V52"?{positions:{}}:kind==="IDLE"||kind==="HYPE_LONG"?{positions:[]}:
   kind==="PENGU"?{version:2,strategyId:"PENGU_DUAL_LS_V2_FINAL",mode:"LIVE",position:null}:{position:null}),
  }})),
  fetchExitFeed:async()=>({closed:[]}),
  assertAuthority:async()=>{throw Error("ORDERS_FORBIDDEN")},
  assertEntrySafety:async()=>{throw Error("ORDERS_FORBIDDEN")},
  assertSourceParity:async()=>{throw Error("ORDERS_FORBIDDEN")},
  requiredResidentStop:async()=>{throw Error("ORDERS_FORBIDDEN")},
  quantityNormalizer:{} as any,referencePrice:async()=>{throw Error("ORDERS_FORBIDDEN")},
  minimumVenueOrderNotional:async()=>{throw Error("ORDERS_FORBIDDEN")},
  now:()=>clock,
 });
 return {engine,store,client,clock:()=>clock,setClock:(ms:number)=>{clock=ms;},reads:()=>reads,cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}
function emptyDecision(now:number){
 return {schema:"v12-v4-live-decision/v1",policyId:"V2_M150_D05_CORE_NATIVE",
  decisionTs:now-5000,capturedAtMs:now,sourceFingerprint:"f".repeat(64),
  candidateCount:0,filteredCount:0,sourceCount:0,nativeCoreEvents:[],
  entryAtrByCandidate:{},errors:[],candidates:[],filtered:[],
  orderEnabled:false,realOrderEnabledV4:0,tradingMutation:0};
}
test("market-data prefetch completes while not holding shared account lock; signed account still reconciled under lease",async()=>{
 const initial=Math.floor(Date.now()/H2)*H2+10000;
 let marketReads=0;
 const f=fixture(initial,async()=>{marketReads++;return emptyDecision(f.clock());});
 try{
  const prepared=await f.engine.prepareFlatMarketDecision();
  assert.equal(prepared?.kind,"READY");
  assert.equal(marketReads,1);
  assert.equal(f.reads(),0,"no signed account reads before lock");
  assert.equal((await f.engine.tick(prepared)).status,"observing");
  assert.equal(marketReads,1,"same H2 decision reused under lease");
  assert.equal(f.reads(),1,"account reads still occur with lease");
  assert.equal(f.store.read().state.journal.length,1);
 }finally{f.cleanup();}
});
test("old pre-lock market data is rejected after H2 boundary, not traded or reused",async()=>{
 const initial=(Math.floor(Date.now()/H2)+1)*H2-1000;
 let marketReads=0;
 const f=fixture(initial,async()=>{marketReads++;return emptyDecision(f.clock());});
 try{
  const prepared=await f.engine.prepareFlatMarketDecision();
  assert.equal(prepared?.kind,"READY");
  f.setClock(initial+2000);
  const result=await f.engine.tick(prepared);
  assert.equal(result.status,"observing");
  assert.equal(marketReads,2,"fresh completed H2 bars fetched after crossing boundary");
  assert.equal(f.reads(),1);
 }finally{f.cleanup();}
});
test("failed market prefetch cannot skip signed account reconciliation or authorize an order",async()=>{
 const initial=Math.floor(Date.now()/H2)*H2+10000;
 let marketReads=0;
 const f=fixture(initial,async()=>{marketReads++;throw Error("MARKET_NETWORK_FAILURE");});
 try{
  const prepared=await f.engine.prepareFlatMarketDecision();
  assert.equal(prepared?.kind,"FAILED");
  assert.equal(f.reads(),0);
  await assert.rejects(f.engine.tick(prepared),/V4_MARKET_PREFETCH_FAILED_AFTER_PROTECTION_RECONCILIATION/);
  assert.equal(marketReads,1);
  assert.equal(f.reads(),1,"account mark and protection reconciliation precede market failure");
 }finally{f.cleanup();}
});
