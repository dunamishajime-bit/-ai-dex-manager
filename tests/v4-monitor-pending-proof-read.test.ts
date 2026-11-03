import test from 'node:test';
import assert from 'node:assert/strict';
import {readV4StalePendingProofIfNeeded} from '../lib/v12-v4-monitor-only';

test('a genuinely fresh pending registry does not depend on an obsolete fallback proof file',async()=>{
 let reads=0;const now=1793718800000;
 const result=await readV4StalePendingProofIfNeeded({updatedAt:now-90000},now,async()=>{reads++;throw Error('ENOENT');});
 assert.equal(reads,0);assert.equal(result,undefined);
});

test('a stale registry still requires the actual root proof and never stamps a missing proof as fresh',async()=>{
 const now=1793718800000;const proof={schema:'fixture'};
 assert.equal(await readV4StalePendingProofIfNeeded({updatedAt:now-16*60000},now,async()=>proof),proof);
 await assert.rejects(()=>readV4StalePendingProofIfNeeded({updatedAt:now-16*60000},now,async()=>{throw Error('ENOENT');}));
 for(const value of [null,true,NaN,Infinity,now+1001]){
  await assert.rejects(()=>readV4StalePendingProofIfNeeded({updatedAt:value},now,async()=>proof));
 }
});
