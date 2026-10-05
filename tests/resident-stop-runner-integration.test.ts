import test from 'node:test';
import assert from 'node:assert/strict';
import { PenguDualLsV2PortfolioRunner } from '../lib/pengu-dual-ls-v2-portfolio-runner';
import { Quality102CausalV1Runner } from '../lib/disdex-quality102-causal-v1-runner';
import { QUALITY102_CAUSAL_V1 } from '../config/disdexQuality102CausalV1Runtime';
import { createPenguRiskOverlayState } from '../lib/pengu-route-quarantine-dd-governor';
import { type ResidentStopGateway, type ResidentStopOrder } from '../lib/venue-resident-stop';
// Exercise real fill-materialization/state/protection methods without constructing market signals.
function fixture(strategy:'PENGU'|'Q102'){
 const symbol=strategy==='PENGU'?'PENGUUSDT':'FETUSDT';let actual:any[]=[{symbol,quantity:2,entryPrice:11,positionSide:'LONG',updatedAt:2000}];const orders:ResidentStopOrder[]=[];let placed=0,saved:any,fill:any;
 const gateway:ResidentStopGateway={normalize:async p=>p,openOrders:async()=>orders,place:async p=>{placed++;const o={...p,status:'NEW',orderId:55,executedQuantity:0,averagePrice:0};orders.push(o);return o;},getOrder:async(_,id)=>orders.find(o=>o.clientOrderId===id)!,cancel:async()=>{orders[0].status='CANCELED';}};
 const store={save:async(s:any)=>{saved=structuredClone(s);},load:async()=>structuredClone(saved)};
 const executor={getPositions:async()=>actual,reconcileOrder:async(_:string,id:string)=>fill?.clientOrderId===id?fill:orders.find(o=>o.clientOrderId===id)};const config:any={mode:'LIVE',residentStopRequired:true,symbols:[symbol],maximumGross:QUALITY102_CAUSAL_V1.maximumGross,cryptoGrossCap:QUALITY102_CAUSAL_V1.cryptoGrossCap,totalGrossCap:QUALITY102_CAUSAL_V1.totalGrossCap,maximumPositions:1};
 const deps:any={executor,stateStore:store,residentStopGateway:gateway,config,now:()=>3000,logger:{info:()=>{},error:()=>{},warn:()=>{}}};
 const runner:any=strategy==='PENGU'?new PenguDualLsV2PortfolioRunner(deps):new Quality102CausalV1Runner(deps);
 const state:any=strategy==='PENGU'?{version:2,strategyId:'PENGU_DUAL_LS_V2_FINAL',mode:'LIVE',updatedAt:1,riskOverlay:createPenguRiskOverlayState(),failures:[]}:{version:1,strategyId:'QUALITY102_CAUSAL_V1',mode:'LIVE',runtimeCommitSha:'a'.repeat(40),updatedAt:1,failures:[]};
 const pending:any={idempotencyKey:'entry',clientOrderId:'entry',phase:'submitted',symbol,side:'BUY',quantity:2,reduceOnly:false,referenceTs:1000,createdAt:1000,updatedAt:1000,targetGross:1,hardStop:.05,entryVersion:'LONG_V2_FINAL'};
 const entryFill:any={symbol,clientOrderId:'entry',side:'BUY',status:'FILLED',executedQuantity:2,averagePrice:10,executionUnknown:false};
 return{runner,state,pending,entryFill,gateway,orders,store,get saved(){return saved;},get placed(){return placed;},remaining:(qty:number)=>{actual=[{...actual[0],quantity:qty}];},flat:()=>{actual=[];},setFill:(f:any)=>{fill=f;}};
}
for(const strategy of ['PENGU','Q102'] as const){
 test(`${strategy}: filled entry uses venue position average and actual qty, persists verified protection`,async()=>{const f=fixture(strategy);const result=await f.runner[strategy==='PENGU'?'applyResult':'applyFilledEntry'](f.state,f.pending,f.entryFill);assert.equal(result.status,'completed');assert.equal(f.saved.position.entryPrice,11);assert.equal(f.saved.position.residentStop.quantity,2);assert.equal(f.saved.position.residentStop.stopPrice,11*(strategy==='PENGU'?.92:.95));assert.equal(f.saved.position.residentStop.protected,true);assert.equal(f.saved.pending,undefined);if(strategy==='Q102')assert.equal(f.saved.position.acceptedEntryGross,1);});
 test(`${strategy}: read-back failure retains filled position and blocks completion`,async()=>{const f=fixture(strategy);f.gateway.openOrders=async()=>[];const result=await f.runner[strategy==='PENGU'?'applyResult':'applyFilledEntry'](f.state,f.pending,f.entryFill);assert.equal(result.status,'manual-review');assert.equal(f.saved.position.quantity,2);assert.equal(f.saved.position.residentStop,undefined);});
 test(`${strategy}: resident fill clears once, no repeated loss/governor update`,async()=>{const f=fixture(strategy);await f.runner[strategy==='PENGU'?'applyResult':'applyFilledEntry'](f.state,f.pending,f.entryFill);const p=f.state.position.residentStop;f.orders[0].status='FILLED';f.orders[0].executedQuantity=2;f.orders[0].averagePrice=9;f.flat();f.setFill({symbol:p.symbol,clientOrderId:p.clientOrderId,side:'SELL',status:'FILLED',executedQuantity:2,averagePrice:9,executionUnknown:false,reduceOnly:true,updatedAt:4000});const method=strategy==='PENGU'?'reconcileOrdinaryStopFill':'reconcileStopFill';assert.equal((await f.runner[method](f.state)).status,'completed');assert.equal(f.saved.position,undefined);const after=JSON.stringify(f.saved);assert.equal(await f.runner[method](f.state),undefined);assert.equal(JSON.stringify(f.saved),after);});
}

for(const strategy of ['PENGU','Q102'] as const){
 test(`${strategy}: accepted-timeout partial STOP survives restart and final STOP closes once`,async()=>{
  const f=fixture(strategy),place=f.gateway.place;f.gateway.place=async p=>{await place(p);throw Error('timeout');};
  assert.equal((await f.runner[strategy==='PENGU'?'applyResult':'applyFilledEntry'](f.state,f.pending,f.entryFill)).status,'manual-review');
  Object.assign(f.state,structuredClone(f.saved));f.orders[0].status='PARTIALLY_FILLED';f.orders[0].executedQuantity=1;f.orders[0].averagePrice=9;f.remaining(1);
  const method=strategy==='PENGU'?'reconcileOrdinaryStopFill':'reconcileStopFill';assert.equal(await f.runner[method](f.state),undefined);assert.equal(f.saved.position.quantity,1);assert.equal(f.saved.position.residentStop.originalQuantity,2);
  Object.assign(f.state,structuredClone(f.saved));f.orders[0].status='FILLED';f.orders[0].executedQuantity=2;f.orders[0].averagePrice=9.5;f.flat();
  assert.equal((await f.runner[method](f.state)).status,'completed');assert.equal(f.saved.position,undefined);assert.equal(await f.runner[method](f.state),undefined);
 });
 test(`${strategy}: partial STOP plus normal exit books both legs after restart`,async()=>{
  const f=fixture(strategy);await f.runner[strategy==='PENGU'?'applyResult':'applyFilledEntry'](f.state,f.pending,f.entryFill);
  f.orders[0].status='PARTIALLY_FILLED';f.orders[0].executedQuantity=1;f.orders[0].averagePrice=9;f.remaining(1);
  const method=strategy==='PENGU'?'reconcileOrdinaryStopFill':'reconcileStopFill';await f.runner[method](f.state);Object.assign(f.state,structuredClone(f.saved));
  const p:any={...f.pending,idempotencyKey:'normal-exit',clientOrderId:'normal-exit',side:'SELL',quantity:1,reduceOnly:true,referenceTs:5000,exitReason:'LONG_MAX_HOLD',reason:'max_hold'};
  f.state.pending=p;f.flat();const fill:any={symbol:f.pending.symbol,clientOrderId:p.clientOrderId,side:'SELL',status:'FILLED',executedQuantity:1,averagePrice:12,reduceOnly:true,executionUnknown:false,updatedAt:5000};f.setFill(fill);
  const out=await f.runner[strategy==='PENGU'?'applyResult':'applyFilledExit'](f.state,p,fill);assert.equal(out.status,'completed');assert.equal(f.saved.position,undefined);
  if(strategy==='PENGU')assert.ok(Math.abs(f.saved.riskOverlay.realizedEquity-(1+(10.5/11-1)-.0012))<1e-9);
 });
 test(`${strategy}: full STOP before planned market submission never queries that unposted market`,async()=>{
  const f=fixture(strategy);await f.runner[strategy==='PENGU'?'applyResult':'applyFilledEntry'](f.state,f.pending,f.entryFill);
  f.state.pending={...f.pending,clientOrderId:'never-posted',phase:'planned',reduceOnly:true,side:'SELL'};f.orders[0].status='FILLED';f.orders[0].executedQuantity=2;f.orders[0].averagePrice=9;f.flat();
  assert.equal((await f.runner[strategy==='PENGU'?'reconcileOrdinaryStopFill':'reconcileStopFill'](f.state)).status,'completed');assert.equal(f.saved.pending,undefined);
 });
}

test('Recovery full hard-stop is reconciled before missing-position check and once',async()=>{
 const f=fixture('PENGU');const id='recovery-v8-full';f.state.position={side:1,entryTs:1000,entryPrice:11,quantity:2,gross:1,highWaterMark:11,entryVersion:'RECOVERY_V8',recoveryV8:{originalQuantity:2,originalGross:1,fullHardStopClientOrderId:id,protectionLifecycle:'FULL_HARD_STOP'}};f.flat();f.setFill({symbol:'PENGUUSDT',clientOrderId:id,side:'SELL',status:'FILLED',executedQuantity:2,averagePrice:9,reduceOnly:true,executionUnknown:false,updatedAt:5000});
 f.runner.dependencies.recoveryV8Protection={getOpenOrders:async()=>[],getOrder:async()=>({symbol:'PENGUUSDT',clientOrderId:id,side:'SELL',quantity:2,executedQuantity:2,averagePrice:9,status:'FILLED',reduceOnly:true}),cancel:async()=>{throw Error('no active order should cancel');}};
 const out=await f.runner.reconcileRecoveryV8StopFill(f.state);assert.equal(out.status,'completed');assert.equal(f.saved.position,undefined);assert.equal(await f.runner.reconcileRecoveryV8StopFill(f.state),undefined);
});

for(const strategy of ['PENGU','Q102'] as const)for(const duringCancel of [false,true])test(`${strategy}: replacement full fill ${duringCancel?'during cancel':'before readback'} is owned after restart`,async()=>{
 const {ensureResidentStop}=await import('../lib/venue-resident-stop');const {appendStopIntent}=await import('../lib/resident-stop-ledger');const f=fixture(strategy);
 await f.runner[strategy==='PENGU'?'applyResult':'applyFilledEntry'](f.state,f.pending,f.entryFill);const p=f.state.position;
 const market:any={symbol:f.pending.symbol,clientOrderId:'market-reduce',side:'SELL',status:'FILLED',executedQuantity:1,averagePrice:12,reduceOnly:true,executionUnknown:false,updatedAt:4500};f.setFill(market);f.state.pending={...f.pending,clientOrderId:market.clientOrderId,phase:'submitted',reduceOnly:true,side:'SELL'};
 p.stopLedger.fills.push({clientOrderId:market.clientOrderId,quantity:1,averagePrice:12,hardStop:false,updatedAt:4500});f.remaining(1);
 const place=f.gateway.place;f.gateway.place=async plan=>{const o=await place(plan);if(!duringCancel){o.status='FILLED';o.executedQuantity=1;o.averagePrice=10;f.flat();}return o;};
 f.gateway.cancel=async(_,id)=>{const old=f.orders.find(o=>o.clientOrderId===id)!;old.status='CANCELED';if(duringCancel){const o=f.orders.find(o=>o.clientOrderId!==id)!;o.status='FILLED';o.executedQuantity=1;o.averagePrice=10;f.flat();}};
 await assert.rejects(ensureResidentStop(f.gateway,{strategy,symbol:f.pending.symbol,side:1,entryTs:p.entryTs,entryPrice:p.entryPrice,quantity:1,stopFraction:strategy==='PENGU'?.08:.05},p.residentStop,4500,async plan=>{p.stopLedger=appendStopIntent(p.stopLedger,plan,2,1);await f.store.save(f.state);}));
 Object.assign(f.state,structuredClone(f.saved));assert.equal((await f.runner[strategy==='PENGU'?'reconcileOrdinaryStopFill':'reconcileStopFill'](f.state)).status,'completed');assert.equal(f.saved.position,undefined);
});

test('Recovery split stop fills reconcile original quantity and weighted proceeds once',async()=>{
 const f=fixture('PENGU');f.state.position={side:1,entryTs:1000,entryPrice:10,quantity:1,gross:.5,highWaterMark:10,entryVersion:'RECOVERY_V8',recoveryV8:{originalQuantity:2,originalGross:1,partialStopClientOrderId:'partial',remainingHardStopClientOrderId:'hard',protectionLifecycle:'SPLIT_PROTECTION',actualPartialFill:{executedQuantity:1,averagePrice:9.6}}};f.flat();
 const fills:any={partial:{symbol:'PENGUUSDT',clientOrderId:'partial',side:'SELL',status:'FILLED',executedQuantity:1,averagePrice:9.6,reduceOnly:true,executionUnknown:false},hard:{symbol:'PENGUUSDT',clientOrderId:'hard',side:'SELL',status:'FILLED',executedQuantity:1,averagePrice:9.4,reduceOnly:true,executionUnknown:false}};
 f.runner.dependencies.executor.reconcileOrder=async(_:string,id:string)=>fills[id];f.runner.dependencies.recoveryV8Protection={getOpenOrders:async()=>[],getOrder:async(_:string,id:string)=>fills[id],cancel:async()=>{throw Error('filled');}};
 assert.equal((await f.runner.reconcileRecoveryV8StopFill(f.state)).status,'completed');assert.ok(Math.abs(f.saved.riskOverlay.realizedEquity-.9488)<1e-9);assert.equal(await f.runner.reconcileRecoveryV8StopFill(f.state),undefined);
});
