import {test} from 'node:test';
import assert from 'node:assert/strict';
import {playRankingSequence} from '../lib/ranking-sequence';
test('one currency completes before the next starts; cleanup waits for the final currency',async()=>{
 const started:string[]=[],finished:string[]=[],releases:(()=>void)[]=[];
 let cleared=false;
 const work=playRankingSequence(['A','B','C'],async id=>{started.push(id);await new Promise<void>(r=>releases.push(r));finished.push(id);},()=>true,()=>{cleared=true;});
 assert.deepEqual(started,['A']);assert.equal(cleared,false);
 releases.shift()!();await new Promise(r=>setImmediate(r));
 assert.deepEqual(started,['A','B']);assert.deepEqual(finished,['A']);assert.equal(cleared,false);
 releases.shift()!();await new Promise(r=>setImmediate(r));
 assert.deepEqual(started,['A','B','C']);assert.deepEqual(finished,['A','B']);assert.equal(cleared,false);
 releases.shift()!();await work;
 assert.deepEqual(finished,['A','B','C']);assert.equal(cleared,true);
});
test('cancelled batch does not start another currency or clear a newer batch',async()=>{
 let current=true,cleared=false;const releases:(()=>void)[]=[],started:string[]=[];
 const work=playRankingSequence(['A','B'],async id=>{started.push(id);await new Promise<void>(r=>releases.push(r));},()=>current,()=>{cleared=true;});
 current=false;releases.forEach(r=>r());await work;assert.deepEqual(started,['A']);assert.equal(cleared,false);
});
