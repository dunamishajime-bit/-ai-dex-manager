import test from 'node:test';import assert from 'node:assert/strict';
import { reconcileStopLedger, appendStopIntent } from '../lib/resident-stop-ledger';
const plan={symbol:'PENGUUSDT',side:'SELL' as const,quantity:2,stopPrice:9.2,reduceOnly:true as const,clientOrderId:'pengu-stop-aaaaaaaaaaaaaaaaaaaaaa'};
const fill=(id:string,qty:number,price:number,status='FILLED')=>({symbol:'PENGUUSDT',clientOrderId:id,side:'SELL',reduceOnly:true,status,executedQuantity:qty,averagePrice:price,executionUnknown:false,updatedAt:5000});
for(const restart of [false,true])test(`partial STOP + normal remainder has weighted economics, restart=${restart}`,async()=>{
 let l=appendStopIntent(undefined,plan,2,1);const read=async(id:string)=>fill(id,1,id===plan.clientOrderId?9:12,id===plan.clientOrderId?'PARTIALLY_FILLED':'FILLED');
 const partial=await reconcileStopLedger(l,1,read);assert.equal(partial.closedQuantity,1);
 if(restart)l=JSON.parse(JSON.stringify(l));const full=await reconcileStopLedger(l,0,read,{clientOrderId:'normal',phase:'submitted'});assert.equal(full.averagePrice,10.5);assert.equal(full.hardStop,true);assert.equal(full.originalGross,1);
});
test('replacement fill after old cancellation is recovered from durable intent',async()=>{
 let l=appendStopIntent(undefined,plan,2,1);l=appendStopIntent(l,{...plan,quantity:1,clientOrderId:'pengu-stop-bbbbbbbbbbbbbbbbbbbbbb'},2,1);
 const out=await reconcileStopLedger(l,0,async(id:string)=>fill(id,id===plan.clientOrderId?1:1,id===plan.clientOrderId?10:9,id===plan.clientOrderId?'CANCELED':'FILLED'));assert.equal(out.closedQuantity,2);assert.equal(out.averagePrice,9.5);
});
test('never-submitted planned normal exit does not query nonexistent market order',async()=>{
 const l=appendStopIntent(undefined,plan,2,1);const ids:string[]=[];const out=await reconcileStopLedger(l,0,async(id:string)=>{ids.push(id);return fill(id,2,9);},{clientOrderId:'never-posted',phase:'planned'});assert.deepEqual(ids,[plan.clientOrderId]);assert.equal(out.closedQuantity,2);
});
test('identity mismatch and unexplained quantity fail closed',async()=>{
 const l=appendStopIntent(undefined,plan,2,1);await assert.rejects(reconcileStopLedger(l,0,async id=>({...fill(id,2,9),side:'BUY'})),/IDENTITY/);await assert.rejects(reconcileStopLedger(l,0,async id=>fill(id,1,9)),/QUANTITY/);
});
