import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {FileV12X1AllRunnerStateStore} from "../lib/v12-x1-all-runner-state";
import {reconcileV12ExternalManualClose} from "../lib/v12-external-manual-close-reconcile";

const sha="c".repeat(40);
function baseState(){
 return {
  schema:"v12-x1-all-runner-state/v2",strategyId:"V12_X1.00_ALL",mode:"LIVE",updatedAt:1000,
  runtimeCommitSha:sha,reconciliationStatus:"MANUAL_REVIEW",lastReferenceTs:3600000,
  manualReview:"V12_POSITION_SIDE_OR_QTY_MISMATCH",
  killSwitch:{active:true,reason:"V12_POSITION_SIDE_OR_QTY_MISMATCH",trippedAt:2000},
  activePositions:[{
   symbol:"ETHUSDT",side:"SHORT",quantity:.028,gross:.9,baseQuantity:.028,dynamicQuantity:0,
   baseGross:.9,dynamicGross:0,entryRank:1,positionId:"v12-entry-test",entryPrice:2500,
   atrAtEntry:20,entrySignalTs:1000,holdingBars:0,peakPrice:2500,troughPrice:2500,
   protection:{strategyId:"V12_X1.00_ALL",symbol:"ETHUSDT",side:"SHORT",positionId:"v12-entry-test",
    quantity:.028,entryPrice:2500,atrAtEntry:20,initialStop:2550,lastAckStop:2550,takeProfit:2400,
    peakOrTrough:2500,stopClientOrderId:"stop-old",takeProfitClientOrderId:"tp-old"}
  }]
 } as any;
}
function client(options:{complete?:boolean;openStop?:boolean}={}){
 const complete=options.complete!==false;
 return {
  getPositions:async()=>[],
  getOpenOrders:async()=>options.openStop?[{symbol:"ETHUSDT",clientOrderId:"stop-old",status:"NEW"}]:[],
  getOrder:async()=>({symbol:"ETHUSDT",orderId:10,clientOrderId:"v12-entry-test",executedQty:"0.028"}),
  getUserTrades:async()=>[
   {symbol:"ETHUSDT",id:1,orderId:10,side:"SELL",qty:"0.028",price:"2500",realizedPnl:"0",commission:"0",commissionAsset:"USDT",time:1100},
   ...(complete?[{symbol:"ETHUSDT",id:2,orderId:11,side:"BUY",qty:"0.028",price:"2490",realizedPnl:"0.28",commission:"0",commissionAsset:"USDT",time:2200}]:[]),
  ],
  getIncomeHistory:async()=>[],
 } as any;
}

test("operator external manual close reconciles only after signed venue fill history proves exact flat",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v12-external-close-"));
 try{
  const path=join(dir,"state.json"),store=new FileV12X1AllRunnerStateStore(path,"LIVE");
  await store.save(baseState());
  const result=await reconcileV12ExternalManualClose({stateStore:store,client:client(),
   pendingRegistryPath:join(dir,"pending.json"),expectedStateSha:sha,now:3000});
  assert.equal(result.status,"V12_EXTERNAL_MANUAL_CLOSE_RECONCILED");
  assert.equal(result.tradingMutation,0);
  const after=await store.load();
  assert.equal(after.active,undefined);assert.equal(after.activePositions,undefined);
  assert.equal(after.pending,undefined);assert.equal(after.manualReview,undefined);
  assert.equal(after.killSwitch,undefined);assert.equal(after.reconciliationStatus,"PASS");
  assert.ok(after.sideLossLedger?.completed?.includes("v12-entry-test"));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("external manual close reconciliation blocks when net closing fill evidence is incomplete",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v12-external-close-"));
 try{
  const path=join(dir,"state.json"),store=new FileV12X1AllRunnerStateStore(path,"LIVE");
  await store.save(baseState());
  await assert.rejects(reconcileV12ExternalManualClose({stateStore:store,client:client({complete:false}),
   pendingRegistryPath:join(dir,"pending.json"),expectedStateSha:sha,now:3000}),
   /V12_EXTERNAL_CLOSE_NET_FLAT_UNPROVEN/);
  const after=await store.load();
  assert.equal(after.active?.symbol,"ETHUSDT");
  assert.equal(after.manualReview,"V12_POSITION_SIDE_OR_QTY_MISMATCH");
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("external manual close reconciliation blocks while an owned protection order remains open",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v12-external-close-"));
 try{
  const path=join(dir,"state.json"),store=new FileV12X1AllRunnerStateStore(path,"LIVE");
  await store.save(baseState());
  await assert.rejects(reconcileV12ExternalManualClose({stateStore:store,client:client({openStop:true}),
   pendingRegistryPath:join(dir,"pending.json"),expectedStateSha:sha,now:3000}),
   /V12_EXTERNAL_CLOSE_PROTECTION_ORDER_REMAINS/);
  assert.equal((await store.load()).active?.symbol,"ETHUSDT");
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test("external manual close accepts a bounded transient reversal that returns signed net exactly flat",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v12-external-close-reversal-"));
 try{
  const path=join(dir,"state.json"),store=new FileV12X1AllRunnerStateStore(path,"LIVE");
  await store.save(baseState());
  const c=client() as any;
  c.getUserTrades=async()=>[
   {symbol:"ETHUSDT",id:1,orderId:10,side:"SELL",qty:"0.028",price:"2500",realizedPnl:"0",commission:"0.028",commissionAsset:"USDT",time:1100},
   {symbol:"ETHUSDT",id:2,orderId:11,side:"BUY",qty:"0.036",price:"2490",realizedPnl:"0.28",commission:"0.036",commissionAsset:"USDT",time:2200},
   {symbol:"ETHUSDT",id:3,orderId:12,side:"SELL",qty:"0.008",price:"2491",realizedPnl:"0.008",commission:"0.008",commissionAsset:"USDT",time:2300},
  ];
  const result=await reconcileV12ExternalManualClose({stateStore:store,client:c,
   pendingRegistryPath:join(dir,"pending.json"),expectedStateSha:sha,now:3000});
  assert.equal(result.status,"V12_EXTERNAL_MANUAL_CLOSE_RECONCILED");
  const after=await store.load();
  assert.equal(after.active,undefined);assert.equal(after.activePositions,undefined);
  assert.equal(after.manualReview,undefined);assert.equal(after.reconciliationStatus,"PASS");
  assert.ok(after.sideLossLedger?.completed?.includes("v12-entry-test"));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("external manual close rejects a transient reversal larger than the owned entry",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"v12-external-close-overreversal-"));
 try{
  const path=join(dir,"state.json"),store=new FileV12X1AllRunnerStateStore(path,"LIVE");
  await store.save(baseState());
  const c=client() as any;
  c.getUserTrades=async()=>[
   {symbol:"ETHUSDT",id:1,orderId:10,side:"SELL",qty:"0.028",price:"2500",realizedPnl:"0",commission:"0",commissionAsset:"USDT",time:1100},
   {symbol:"ETHUSDT",id:2,orderId:11,side:"BUY",qty:"0.060",price:"2490",realizedPnl:"0.28",commission:"0",commissionAsset:"USDT",time:2200},
  ];
  await assert.rejects(reconcileV12ExternalManualClose({stateStore:store,client:c,
   pendingRegistryPath:join(dir,"pending.json"),expectedStateSha:sha,now:3000}),
   /V12_EXTERNAL_CLOSE_REVERSAL_EXCEEDS_ENTRY/);
  const after=await store.load();
  assert.equal(after.active?.symbol,"ETHUSDT");
  assert.equal(after.manualReview,"V12_POSITION_SIDE_OR_QTY_MISMATCH");
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test("manual-close CLI restores canonical deploy ownership after root state replacement",()=>{
 const source=readFileSync(join(process.cwd(),"scripts/v12-external-manual-close-reconcile.ts"),"utf8");
 assert.match(source,/normalizeLiveStateOwnership/);
 assert.match(source,/V12_EXTERNAL_CLOSE_STATE/);
 assert.match(source,/stateOwnership:"deploy:deploy:600"/);
 assert.ok((source.match(/await normalizeStateOwnership\(\)/g)||[]).length>=2);
 assert.match(source,/catch\(error\)\{\s*try\{await normalizeStateOwnership\(\);\}catch\{\}/s);
});
