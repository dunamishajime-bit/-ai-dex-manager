import test from 'node:test';import assert from 'node:assert/strict';
import {observeResidentProtection} from '../lib/resident-stop-observation';
const positions=[{symbol:'FETUSDT',positionAmt:'515'}];
const order={symbol:'FETUSDT',clientOrderId:'fet-stop-abc',orderId:55,type:'STOP_MARKET',side:'SELL',reduceOnly:true,status:'NEW',origQty:'515',executedQty:'0',stopPrice:'0.2419'};
const states={FET:{runtimeCommitSha:'new',updatedAt:10,position:{symbol:'FETUSDT',side:1,quantity:515,stopClientOrderId:order.clientOrderId,hardStop:.2419}}};
test('independent read-only observation verifies owned exact live FET stop',()=>{const s=observeResidentProtection(positions,[order],states,'new',10);assert.equal(s.positions[0].protected,true);assert.equal(s.ordersSent,0);assert.equal(s.positions[0].orders[0].orderId,55);});
for(const change of [{side:'BUY'},{origQty:'514'},{reduceOnly:false},{stopPrice:'.24'},{status:'UNKNOWN'}])test(`wrong venue shape is unprotected ${JSON.stringify(change)}`,()=>{assert.equal(observeResidentProtection(positions,[{...order,...change}],states,'new',10).unprotectedCount,1);});
test('duplicate, orphan and old state SHA are not silently protected',()=>{assert.equal(observeResidentProtection(positions,[order,order],states,'new',10).unprotectedCount,1);assert.equal(observeResidentProtection(positions,[order],states,'other',10).unprotectedCount,1);assert.equal(observeResidentProtection([],[order],states,'new',10).orphanStops.length,1);});
test('V52 fixed emergency stop remains disabled/dynamic only',()=>{assert.equal(observeResidentProtection([{symbol:'TSLAUSDT',positionAmt:'1'}],[],{},'new',10).positions[0].readBackStatus,'DYNAMIC_BASIS_ONLY');});
for(const field of ['symbol','side','quantity','price','freshness'] as const)test(`owner ${field} mismatch cannot be protected`,()=>{
 const owner:any={symbol:'FETUSDT',side:1,quantity:515,stopClientOrderId:order.clientOrderId,hardStop:.2419};
 if(field==='symbol')owner.symbol='OTHERUSDT';if(field==='side')owner.side=-1;if(field==='quantity')owner.quantity=1;if(field==='price')delete owner.hardStop;
 const s={FET:{runtimeCommitSha:'new',updatedAt:field==='freshness'?1:500000,position:owner}};
 assert.equal(observeResidentProtection(positions,[order],s,'new',500000).positions[0].protected,false);
});
