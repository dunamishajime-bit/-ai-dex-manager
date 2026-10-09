import {test} from 'node:test';import assert from 'node:assert/strict';
import {prepareAbsentPendingReconciliation} from './disdex-v12-absent-pending-policy.mjs';
const now=1791521000000,sha='c'.repeat(40);
const state={schema:'v12-x1-all-runner-state/v2',strategyId:'V12_X1.00_ALL',mode:'LIVE',runtimeCommitSha:sha,updatedAt:now-100000,pending:{action:'ENTRY',symbol:'XRPUSDT',clientOrderId:'v12-old',idempotencyKey:'v12-old',quantity:42,side:'SHORT',createdAt:now-3600000},activePositions:[],manualReview:'SHARED_KILL_SWITCH_ACTIVE:feed-stale',killSwitch:{active:true,reason:'SHARED_KILL_SWITCH_ACTIVE:feed-stale',trippedAt:now-100000}};
const round=(at)=>({observedAt:at,serverTime:at,lookup:{status:400,code:-2013,symbol:'XRPUSDT',clientOrderId:'v12-old'},tradeStartMs:state.pending.createdAt-120000,tradeEndMs:at,positions:[{symbol:'TSLAUSDT',positionAmt:.38,entryPrice:372.64},{symbol:'PENGUUSDT',positionAmt:-7718,entryPrice:.008574}],orders:[{symbol:'PENGUUSDT',clientOrderId:'protect',status:'NEW',side:'BUY',type:'STOP_MARKET',reduceOnly:true,origQty:'7718',stopPrice:'.009259'}],trades:[]});
const rounds=()=>[round(now-2000),round(now-1000),round(now)];
test('absent entry resolves idempotency without clearing local or shared protection',()=>{const result=prepareAbsentPendingReconciliation(state,rounds(),sha,now);assert.equal(result.pending,undefined);assert.equal(result.lastCompletedIdempotencyKey,'v12-old');assert.deepEqual(result.killSwitch,state.killSwitch);assert.equal(result.manualReview,state.manualReview);assert.equal(result.reconciliationStatus,'MANUAL_REVIEW');assert.ok(state.pending);});
for(const [name,mutate] of [
 ['ambiguous lookup',r=>{r[1].lookup.code=429;}],
 ['historical fill',r=>{r[1].trades=[{symbol:'XRPUSDT',qty:42}];}],
 ['current XRP exposure',r=>{r[2].positions.push({symbol:'XRPUSDT',positionAmt:-42,entryPrice:1.38});}],
 ['XRP open order',r=>{r[2].orders.push({symbol:'XRPUSDT',clientOrderId:'other',origQty:'42'});}],
 ['foreign position quantity changed',r=>{r[2].positions[0].positionAmt=.39;}],
 ['protective order changed',r=>{r[2].orders[0].origQty='1';}],
 ['incomplete trade interval',r=>{r[0].tradeStartMs=now;}],
 ['stale evidence',r=>{r[2].observedAt=now-600000;}],
 ['unvalidated numeric position',r=>{r[1].positions[0].positionAmt='bad';}],
 ])test('refuses '+name,()=>{const r=rounds();mutate(r);assert.throws(()=>prepareAbsentPendingReconciliation(state,r,sha,now));});
test('refuses runtime mismatch, V12 exposure and exit pending',()=>{for(const s of [{...state,runtimeCommitSha:'a'.repeat(40)},{...state,active:{symbol:'BTCUSDT'}},{...state,pending:{...state.pending,action:'EXIT'}}])assert.throws(()=>prepareAbsentPendingReconciliation(s,rounds(),sha,now));});

import {matchingPendingExposure} from './disdex-v12-absent-pending-policy.mjs';
test('release only one exactly bound durable pending reservation',()=>{
 const p={...state.pending,requestedGross:.8,expectedPrice:1.38};
 const e={reservationId:'exact',strategyId:'V12_X1.00_ALL',symbol:p.symbol,status:'PENDING',runtimeSha:sha,side:p.side,createdAt:p.createdAt-1,gross:.8,notionalUsd:42*1.38};
 assert.equal(matchingPendingExposure([e,{...e,symbol:'BTCUSDT'}],p,sha),'exact');
 for(const entries of [[],[e,e],[{...e,gross:.9}],[{...e,runtimeSha:'b'.repeat(40)}],[{...e,createdAt:p.createdAt-2001}],[{...e,notionalUsd:0}]]){
 assert.throws(()=>matchingPendingExposure(entries,p,sha));
 }
});

test('controller temporary state serialization roundtrips before CAS rename',async()=>{
 const {readFile}=await import('node:fs/promises');
 const {runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('./disdex-v12-absent-pending-reconcile.mjs',import.meta.url),'utf8');
 const expression=source.match(/writeFile\(temporary,([\s\S]*?),\{mode:attributes\.mode/);
 assert.ok(expression,'controller temporary serialization expression is present');
 const recovered=prepareAbsentPendingReconciliation(state,rounds(),sha,now);
 const serialized=runInNewContext(expression[1],{recovered,JSON});
 const decoded=JSON.parse(serialized);
 assert.deepEqual(decoded,JSON.parse(JSON.stringify(recovered)));
 assert.equal(decoded.pending,undefined);
 assert.deepEqual(decoded.killSwitch,state.killSwitch);
 assert.equal(decoded.manualReview,state.manualReview);
 assert.ok(serialized.endsWith('\n')&&!serialized.endsWith('\\n'));
 const parseAt=source.indexOf("JSON.parse(await readFile(temporary,'utf8'))");
 assert.ok(parseAt>0&&parseAt<source.indexOf('await rename(temporary,statePath)'),'parse validation precedes state replacement');
});
