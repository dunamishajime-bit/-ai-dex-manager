import assert from 'node:assert/strict';import test from 'node:test';
import {hypeRankingFresh} from '../lib/realtime-ranking';
const now=1800000000000,sha='a'.repeat(40);
const row={status:'LIVE',stateSha:sha,lastDecision:{at:now-3600000},gates:[{key:'RUNTIME_H1',status:'PASS'}]};
test('fresh H1 HYPE remains fresh without legacy 15m DATA_FRESHNESS gate',()=>assert.equal(hypeRankingFresh(row,sha,now),true));
test('H1 decision expiry, missing observation, future time and SHA mismatch remain stale',()=>{
 for(const change of [{lastDecision:undefined},{lastDecision:{at:now-3*3600000-1}},{lastDecision:{at:now+60001}},{stateSha:'b'.repeat(40)},{status:'STALE'}])assert.equal(hypeRankingFresh({...row,...change},sha,now),false);
});
