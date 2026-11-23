import { test } from 'node:test';
import assert from 'node:assert/strict';
const helper=await import('../ops/disdex-quality102-ranking-refresh.mjs').catch(()=>({}));
const current='4'.repeat(40),old='9'.repeat(40);
test('Q102 detail refresh uses only the current release after its new decision is published',()=>{
 assert.equal(typeof helper.rankingRefreshUnit,'function');
 assert.equal(helper.rankingRefreshUnit(current,{runtimeCommitSha:current,strategyId:'QUALITY102_CAUSAL_V1',selectorMode:'CAUSAL_V4'}),'disdex-quality102-ranking-observer@'+current+'.service');
 assert.equal(helper.rankingRefreshUnit(current,{runtimeCommitSha:old,strategyId:'QUALITY102_CAUSAL_V1',selectorMode:'CAUSAL_V4'}),null);
});
test('Q102 detail refresh rejects malformed releases and unrelated decision files',()=>{
 assert.equal(typeof helper.rankingRefreshUnit,'function');
 assert.throws(()=>helper.rankingRefreshUnit('bad',{}));
 assert.equal(helper.rankingRefreshUnit(current,{runtimeCommitSha:current,strategyId:'OTHER',selectorMode:'CAUSAL_V4'}),null);
});
