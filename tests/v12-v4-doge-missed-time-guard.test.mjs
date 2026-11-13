import test from 'node:test';
import assert from 'node:assert/strict';
import {
 DOGE_LEG,DOGE_STOP,V4_SHA,DOGE_QTY,DOGE_ENTRY,DOGE_EXIT_TS,DOGE_EXIT_PRICE,
 assertDogeVenueOpen,assertDogeVenueFlatWithResidentStop,assertDogeVenueClosed,
 assertDogeState,installDogeOnlyGuards,
} from '../lib/v12-v4-doge-missed-time-guard.mjs';

const makeDoc=()=>({
 releaseSha:V4_SHA,
 state:{legs:{[DOGE_LEG]:{
  id:DOGE_LEG,status:'OPEN',qty:DOGE_QTY,
  candidate:{symbol:'DOGEUSDT',route:'REC_Y06_REV_D0_T72',effectiveSide:'SHORT'},
  plannedExit:{reason:'TIME',exitTs:DOGE_EXIT_TS,price:DOGE_EXIT_PRICE,priceModelOnly:true},
 }}},
 protections:{[DOGE_LEG]:{phase:'STOP_CONFIRMED',protectedQty:DOGE_QTY,stopClientOrderId:DOGE_STOP}},
 intents:{[DOGE_STOP]:{legId:DOGE_LEG,action:'STOP',stage:'ACKNOWLEDGED',command:{quantity:DOGE_QTY}}},
});

const openVenue=()=>({
 positions:[{symbol:'DOGEUSDT',positionAmt:String(-DOGE_QTY),entryPrice:String(DOGE_ENTRY)}],
 orders:[{symbol:'DOGEUSDT',clientOrderId:DOGE_STOP,side:'BUY',type:'STOP_MARKET',reduceOnly:true,status:'NEW',origQty:String(DOGE_QTY),executedQty:'0'}],
});

test('exact DOGE open venue state and resident STOP are required',()=>{
 const {positions,orders}=openVenue();
 assert.doesNotThrow(()=>assertDogeVenueOpen(positions,orders));
 for(const [p,o] of [
  [[{...positions[0],positionAmt:'-225'}],orders],
  [positions,[{...orders[0],reduceOnly:false}]],
  [positions,[{...orders[0],clientOrderId:'other'}]],
  [positions,[]],
  [positions,[...orders,{...orders[0],clientOrderId:'other'}]],
 ]) assert.throws(()=>assertDogeVenueOpen(p,o));
});

test('flat proof is distinct from STOP retirement proof',()=>{
 const {orders}=openVenue();
 const flat=[{symbol:'DOGEUSDT',positionAmt:'0',entryPrice:'0'}];
 assert.doesNotThrow(()=>assertDogeVenueFlatWithResidentStop(flat,orders));
 assert.throws(()=>assertDogeVenueFlatWithResidentStop(flat,[]));
 assert.doesNotThrow(()=>assertDogeVenueClosed(flat,[]));
 assert.throws(()=>assertDogeVenueClosed(flat,orders));
});

test('only exact DOGE durable leg, plan and STOP are accepted',()=>{
 assert.doesNotThrow(()=>assertDogeState(makeDoc()));
 for(const mutate of [
  d=>d.state.legs[DOGE_LEG].qty=225,
  d=>d.state.legs[DOGE_LEG].candidate.route='OTHER',
  d=>d.state.legs[DOGE_LEG].plannedExit.exitTs+=1,
  d=>d.state.legs[DOGE_LEG].plannedExit.price=0.075,
  d=>d.protections[DOGE_LEG].stopClientOrderId='wrong',
  d=>d.intents[DOGE_STOP].command.quantity=225,
  d=>d.state.legs.other={id:'other',status:'OPEN',qty:1,candidate:{}},
 ]){
  const doc=makeDoc(); mutate(doc); assert.throws(()=>assertDogeState(doc));
 }
});

test('guard denies entries, other symbols, wrong quantity and unrelated cancels',async()=>{
 const doc=makeDoc();
 let approved=0,canceled=[];
 const venue=openVenue();
 const engine={deps:{
  store:{read:()=>doc},
  accountLock:{acquire:async()=>null},
  adapter:{cancel:async id=>canceled.push(id)},
  client:{getPositions:async()=>venue.positions,getOpenOrders:async()=>venue.orders},
  assertAuthority:async()=>approved++,
  fetchDecision:async()=>({}),
 }};
 installDogeOnlyGuards(engine);
 const exact={legId:DOGE_LEG,action:'EXIT',sequence:0,symbol:'DOGEUSDT',positionSide:'SHORT',quantity:DOGE_QTY};
 await engine.deps.assertAuthority(exact);
 assert.equal(approved,1);
 for(const bad of [
  {...exact,action:'ENTRY'},
  {...exact,symbol:'BTCUSDT'},
  {...exact,quantity:225},
  {...exact,legId:'other'},
  {...exact,positionSide:'LONG'},
 ]) await assert.rejects(engine.deps.assertAuthority(bad));
 await assert.rejects(engine.deps.fetchDecision());
 await assert.rejects(engine.deps.adapter.cancel('other'));
 assert.deepEqual(canceled,[]);
});

test('resident STOP cannot be canceled before signed flat proof',async()=>{
 const doc=makeDoc();
 let canceled=[];
 let positions=openVenue().positions;
 let orders=openVenue().orders;
 const engine={deps:{
  store:{read:()=>doc},
  accountLock:{acquire:async()=>null},
  adapter:{cancel:async id=>canceled.push(id)},
  client:{getPositions:async()=>positions,getOpenOrders:async()=>orders},
  assertAuthority:async()=>{},
  fetchDecision:async()=>({}),
 }};
 installDogeOnlyGuards(engine);
 await assert.rejects(engine.deps.adapter.cancel(DOGE_STOP));
 positions=[{symbol:'DOGEUSDT',positionAmt:'0',entryPrice:'0'}];
 await engine.deps.adapter.cancel(DOGE_STOP);
 assert.deepEqual(canceled,[DOGE_STOP]);
});

test('account lease rechecks exact state and releases on drift',async()=>{
 let doc=makeDoc(),released=0,preflights=0;
 const engine={deps:{
  store:{read:()=>doc},
  accountLock:{acquire:async()=>({release:async()=>released++})},
  adapter:{cancel:async()=>{}},
  client:{getPositions:async()=>[],getOpenOrders:async()=>[]},
  assertAuthority:async()=>{},
  fetchDecision:async()=>({}),
 }};
 installDogeOnlyGuards(engine,async()=>{preflights++;});
 const lease=await engine.deps.accountLock.acquire('test');
 assert.equal(preflights,1);
 await lease.release();
 assert.equal(released,1);

 doc=makeDoc();
 doc.state.legs[DOGE_LEG].qty=225;
 await assert.rejects(engine.deps.accountLock.acquire('test'));
 assert.equal(released,2);
});
