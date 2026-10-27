import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNearState, assertNearVenue, installNearOnlyGuards} from '../lib/v12-v4-near-only-guard.mjs';

const legId='NEARUSDT:REC_X02_TIME_36H:SHORT:1792980000000';
const stopId='v12-v4-50ef46933e7018db365535fa70fd';
const makeDoc=()=>({releaseSha:'53a0be396719f0284af4e11b35c66a4ac7d58f79',state:{legs:{[legId]:{id:legId,status:'OPEN',qty:2,candidate:{symbol:'NEARUSDT',route:'REC_X02_TIME_36H',effectiveSide:'SHORT'},plannedExit:{reason:'TIME',exitTs:1793109600000,price:4.512,priceModelOnly:true}}}},protections:{[legId]:{phase:'STOP_CONFIRMED',protectedQty:2,stopClientOrderId:stopId}},intents:{[stopId]:{legId,action:'STOP',stage:'ACKNOWLEDGED',command:{quantity:2,price:4.874}}}});
test('signed position and exact resident STOP must match before any order',()=>{
 const p=[{symbol:'NEARUSDT',positionAmt:'-2'},{symbol:'AAVEUSDT',positionAmt:'0'}];
 const o=[{symbol:'NEARUSDT',clientOrderId:stopId,side:'BUY',type:'STOP_MARKET',reduceOnly:true,status:'NEW',origQty:'2',executedQty:'0',stopPrice:'4.874'}];
 assert.doesNotThrow(()=>assertNearVenue(p,o));
 for(const [positions,orders] of [[[{symbol:'NEARUSDT',positionAmt:'-1'}],o],[p,[]],[p,[{...o[0],reduceOnly:false}]],[p,[{...o[0],stopPrice:'4.8'}]],[p,[...o,{...o[0],clientOrderId:'other'}]]]) assert.throws(()=>assertNearVenue(positions,orders));
});
test('only the exact NEAR leg, stop and stale decision are accepted',()=>{
 const good=makeDoc(); assert.doesNotThrow(()=>assertNearState(good));
 for(const mutate of [d=>d.state.legs[legId].qty=1,d=>d.state.legs[legId].plannedExit.price=4.5,d=>d.protections[legId].stopClientOrderId='wrong',d=>d.intents[stopId].command.price=4.8,d=>d.state.legs.other={status:'OPEN',qty:1},d=>d.intents.other={action:'EXIT',stage:'PREPARED'}]){
  const doc=makeDoc(); mutate(doc); assert.throws(()=>assertNearState(doc));
 }
});
test('lock acquisition rechecks state and releases on drift',async()=>{
 let doc=makeDoc(),released=0;
 const engine={deps:{store:{read:()=>doc},accountLock:{acquire:async()=>({release:async()=>released++})},adapter:{cancel:async()=>{}},client:{getPositions:async()=>[]},assertAuthority:async()=>{},fetchDecision:async()=>({})}};
 installNearOnlyGuards(engine);
 doc.state.legs[legId].qty=1;
 await assert.rejects(engine.deps.accountLock.acquire('test'));
 assert.equal(released,1);
});
test('signed preflight runs under the acquired account lease and failure releases it',async()=>{
 let released=0,preflights=0;
 const engine={deps:{store:{read:makeDoc},accountLock:{acquire:async()=>({release:async()=>released++})},adapter:{cancel:async()=>{}},client:{getPositions:async()=>[]},assertAuthority:async()=>{},fetchDecision:async()=>({})}};
 installNearOnlyGuards(engine,async()=>{preflights++;throw Error('signed mismatch')});
 await assert.rejects(engine.deps.accountLock.acquire('test'),/signed mismatch/);
 assert.equal(preflights,1);assert.equal(released,1);
});
test('order authority permits only the exact reduce-only NEAR exit and denies entries',async()=>{
 const doc=makeDoc(); let approved=0;
 const engine={deps:{store:{read:()=>doc},accountLock:{acquire:async()=>null},adapter:{cancel:async()=>{}},client:{getPositions:async()=>[]},assertAuthority:async()=>approved++,fetchDecision:async()=>({})}};
 installNearOnlyGuards(engine);
 const cmd={legId,action:'EXIT',sequence:0,symbol:'NEARUSDT',positionSide:'SHORT',quantity:2};
 await engine.deps.assertAuthority(cmd); assert.equal(approved,1);
 for(const bad of [{...cmd,action:'ENTRY'},{...cmd,symbol:'BTCUSDT'},{...cmd,quantity:3},{...cmd,legId:'other'}]) await assert.rejects(engine.deps.assertAuthority(bad));
 await assert.rejects(engine.deps.fetchDecision());
});
test('STOP cancellation is restricted to the NEAR stop after signed flat confirmation',async()=>{
 let positions=[{symbol:'NEARUSDT',positionAmt:'-2'}], canceled=[];
 const engine={deps:{store:{read:makeDoc},accountLock:{acquire:async()=>null},adapter:{cancel:async id=>canceled.push(id)},client:{getPositions:async()=>positions},assertAuthority:async()=>{},fetchDecision:async()=>({})}};
 installNearOnlyGuards(engine);
 await assert.rejects(engine.deps.adapter.cancel(stopId));
 positions=[{symbol:'NEARUSDT',positionAmt:'0'}];
 await assert.rejects(engine.deps.adapter.cancel('other'));
 await engine.deps.adapter.cancel(stopId); assert.deepEqual(canceled,[stopId]);
});
