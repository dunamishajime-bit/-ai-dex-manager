import test from "node:test";
import assert from "node:assert/strict";
import {
  RANKING_MOTION_MS,rankingMovementTiming,playRankingSequenceConcurrent,
  playRankingSequence,
} from "../lib/ranking-sequence";

test("all currency ranking movement completes within a 1.5-second timing budget",()=>{
 assert.equal(RANKING_MOTION_MS,1500);
 const durations=[0,1,2,3,4,8,20,80].map(rankingMovementTiming);
 assert.ok(durations.every(t=>t.duration>0 && t.delay>=0));
 assert.ok(durations.every(t=>t.delay+t.duration===1500));
});
test("concurrent ranking movement starts every currency without serial waiting",async()=>{
 const resolvers:Array<()=>void>=[];
 const started:number[]=[];
 let completeCount=0;
 const p=playRankingSequenceConcurrent([11,22,33],
  (v)=>{started.push(v);return new Promise<void>(resolve=>resolvers.push(resolve));},
  ()=>true,()=>{completeCount++;});
 assert.deepEqual(started,[11,22,33],"all groups begin together");
 assert.equal(completeCount,0);
 resolvers.forEach(resolve=>resolve());
 await p;
 assert.equal(completeCount,1);
});
test("canceled batch cannot call completion callback",async()=>{
 let current=true,finishes=0;
 await playRankingSequenceConcurrent([1,2],async()=>{current=false;},()=>current,()=>{finishes++;});
 assert.equal(finishes,0);
});
test("legacy serialized animation helper remains available for compatibility",async()=>{
 const started:number[]=[];
 await playRankingSequence([1,2],async v=>{started.push(v);},()=>true,()=>{});
 assert.deepEqual(started,[1,2]);
});
