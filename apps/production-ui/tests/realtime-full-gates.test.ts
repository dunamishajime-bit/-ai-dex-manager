import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gateScore,currentRankRow,type Gate,type RankRow} from '../lib/realtime-ranking';
const ok:Gate={key:'signal',label:'Signal',state:'OK',detail:''};
test('AVAX accepted route with unconfirmed residual capacity is below 100',()=>{
 assert.equal(gateScore([ok,{...ok,key:'holding',kind:'execution'},{...ok,key:'capacity',kind:'execution',state:'UNKNOWN'}],true),67);
});
test('100 requires every signal and execution condition to pass',()=>{
 const clock:Gate={...ok,key:'clock',kind:'execution'};
 assert.equal(gateScore([ok,clock],true),100);
 assert.equal(gateScore([ok,{...clock,state:'NO',progress:1}],true),50);
 assert.equal(gateScore([ok,{...clock,state:'UNKNOWN',progress:1}],true),50);
 assert.equal(gateScore([ok,clock],false),null);
 assert.equal(gateScore([{...ok,state:'UNKNOWN'},clock],true),null);
});
test('a shared stop appended after initial scoring invalidates 100',()=>{
 const row:RankRow={id:'AVAX',symbol:'AVAXUSDT',logic:'Idle Long',side:'LONG',score:100,gates:[ok,{...ok,key:'shared-kill',state:'NO',kind:'execution'}],reason:'',fresh:true,checkedAt:Date.now()};
 assert.equal(currentRankRow(row,Date.now()).score,50);
});
test('FET cached 100 expires when its current entry clock closes',()=>{
 const at=Date.UTC(2026,9,6,5,2);
 const row:RankRow={id:'FET',symbol:'FETUSDT',logic:'FET',side:'LONG',score:100,gates:[ok,{...ok,key:'clock',kind:'execution'}],reason:'',fresh:true,checkedAt:at};
 assert.equal(currentRankRow(row,Date.UTC(2026,9,6,5,6)).score,50);
});
