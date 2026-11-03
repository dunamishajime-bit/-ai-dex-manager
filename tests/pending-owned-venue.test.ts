import assert from 'node:assert/strict';
import test from 'node:test';
import {validateOwnedPendingVenue} from '../lib/disdex-pending-owned-venue';

const now=1793713277031,sha='a'.repeat(40),fet='7'.repeat(40),stock='4'.repeat(40);
const pins={V12:'1'.repeat(40),Q102:'2'.repeat(40),PENGU:fet,V52:stock,FET:fet,HYPE:fet,IDLE:fet,RESIDUAL:fet};
function crypto(){
 return {now,runtimeSha:sha,ownerPins:pins,
  positions:[{symbol:'FETUSDT',positionAmt:'10',notional:'100'}],
  orders:[{symbol:'FETUSDT',type:'STOP_MARKET',side:'SELL',reduceOnly:true,status:'NEW',origQty:'10',executedQty:'0',stopPrice:'9',clientOrderId:'fet-stop-owned',orderId:1}],
  states:{FET:{updatedAt:now,runtimeCommitSha:fet,position:{symbol:'FETUSDT',side:'LONG',quantity:10,stopClientOrderId:'fet-stop-owned',stopPrice:9}}}};
}

test('released pending can be reconciled with independently owned fully protected crypto exposure',()=>{
 const result=validateOwnedPendingVenue(crypto());
 assert.equal(result.positionCount,1);assert.equal(result.openOrderCount,1);
 assert.equal(result.ownershipVerified,true);
});

test('unknown STOP, partial fill, uncovered quantity, bad notional and stale owner fail closed',()=>{
 for(const patch of [{clientOrderId:'unknown'},{executedQty:'1'},{status:'PARTIALLY_FILLED'},
   {origQty:'9'},{reduceOnly:false},{type:'LIMIT'},{stopPrice:NaN}]){
  const data=crypto();Object.assign(data.orders[0],patch);
  assert.throws(()=>validateOwnedPendingVenue(data),/PENDING_OWNER_/);
 }
 for(const value of [undefined,null,'',Infinity,'NaN']){
  const data:any=crypto();data.positions[0].notional=value;
  assert.throws(()=>validateOwnedPendingVenue(data),/PENDING_OWNER_/);
 }
 const data=crypto();data.states.FET.updatedAt=now-300001;
 assert.throws(()=>validateOwnedPendingVenue(data),/PENDING_OWNER_/);
});

test('a stock-like symbol alone cannot become a V52 ownership proof',()=>{
 const data:any={now,runtimeSha:sha,ownerPins:pins,positions:[{symbol:'AMZNUSDT',positionAmt:'2',notional:'200'}],orders:[],states:{}};
 assert.throws(()=>validateOwnedPendingVenue(data),/PENDING_OWNER_/);
 data.v52State={schemaVersion:3,strategyId:'DISDEX_V52_V11EQ_V50_ASTER_ONLY_PLUS_CRYPTO_V96',runtimeCommitSha:stock,updatedAt:now,pendingOrder:null,
  positions:{V11_EQ:{strategy:'V11_EQ',positionId:'stock-v11eq-aster-only-owned',entryClientOrderId:'stock-v11eq-aster-only-owned',symbol:'AMZN',asterQty:2,asterOpenSide:'BUY'}}};
 data.margin={stage:'HEALTHY',ordersAllowed:true,checkedAt:now};
 assert.equal(validateOwnedPendingVenue(data).ownershipVerified,true);
 for(const patch of [{runtimeCommitSha:sha},{pendingOrder:{}},{updatedAt:now-300001},{positions:{}}]){
  assert.throws(()=>validateOwnedPendingVenue({...data,v52State:{...data.v52State,...patch}}),/PENDING_OWNER_/);
 }
 assert.throws(()=>validateOwnedPendingVenue({...data,margin:{...data.margin,checkedAt:now-120001}}),/PENDING_OWNER_/);
});

test('orphan STOPs and conflicting owner states are not accepted as an empty pending proof',()=>{
 const data:any=crypto();data.orders.push({...data.orders[0],symbol:'DOGEUSDT',clientOrderId:'orphan'});
 assert.throws(()=>validateOwnedPendingVenue(data),/PENDING_OWNER_/);
 const mixed:any=crypto();mixed.states.HYPE={...mixed.states.FET};
 assert.throws(()=>validateOwnedPendingVenue(mixed),/PENDING_OWNER_/);
});

test('missing canonical pins cannot fall back to a hardcoded legacy owner SHA',()=>{
 const data:any=crypto();data.ownerPins={};
 data.states.FET.runtimeCommitSha='7688ed7c93a1918d8b44837339b7da5584a868f5';
 assert.throws(()=>validateOwnedPendingVenue(data),/PENDING_OWNER_PIN_INVALID/);
});
