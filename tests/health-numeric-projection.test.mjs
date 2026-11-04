import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

async function projection(){
 const source=await readFile('scripts/ops/root/disdex-runner-health-snapshot-current.mjs','utf8');
 const number=source.slice(source.indexOf('function finiteOrNull('),source.indexOf('\nasync function pendingExposureStatus('));
 const project=source.slice(source.indexOf('function stopProjection('),source.indexOf('\nfunction json('));
 return runInNewContext(number+'\n'+project+'\n({finiteOrNull,runnerObservability})');
}
test('HP numerical evidence preserves missing and malformed values as unknown',async()=>{
 const {finiteOrNull}=await projection();
 for(const value of [null,undefined,'',false,true,'5',NaN,Infinity,-Infinity])assert.equal(finiteOrNull(value),null,String(value));
 for(const value of [0,1,0.75])assert.equal(finiteOrNull(value),value);
});
test('an actual Q102 score of zero is not replaced by a different fallback score',async()=>{
 const {runnerObservability}=await projection();
 const row=runnerObservability({key:'QUALITY102_CAUSAL_V1'},{position:{family:'BRK',layer:'S2',score:0,quality102Score:78}},{});
 assert.equal(row.q102.score,0);assert.equal(row.q102.family,'BRK');assert.equal(row.q102.layer,'S2');
});
test('unavailable STOP quantities and ranking scores are not presented as measured zero',async()=>{
 const {runnerObservability}=await projection();
 const row=runnerObservability({key:'QUALITY102_CAUSAL_V1'},{residentStop:{quantity:null},ranking:[{symbol:'FETUSDT',score:''}]},{});
 assert.equal(row.stop.quantity,null);assert.equal(row.stop.protected,false);assert.equal(row.ranking.items[0].score,null);
});
