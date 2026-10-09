import test from "node:test";
import assert from "node:assert/strict";
import { RANKING_MOTION_MS,playRankingSequence } from "../lib/ranking-sequence";

test("each currency runs a full 1500ms foreground journey",()=>{
 assert.equal(RANKING_MOTION_MS,1500);
});
test("three currencies are animated in sequence, never simultaneously",async()=>{
 const resolvers:Array<()=>void>=[];
 const started:number[]=[];
 let completed=0;
 const promise=playRankingSequence([11,22,33],v=>{
  started.push(v);
  return new Promise<void>(resolve=>resolvers.push(resolve));
 },()=>true,()=>{completed++;});
 assert.deepEqual(started,[11],"only the first currency starts");
 assert.equal(completed,0);
 resolvers[0]!();
 await Promise.resolve();await Promise.resolve();
 assert.deepEqual(started,[11,22]);
 resolvers[1]!();
 await Promise.resolve();await Promise.resolve();
 assert.deepEqual(started,[11,22,33]);
 resolvers[2]!();
 await promise;
 assert.equal(completed,1);
});
test("canceled ranking batch stops before the next currency",async()=>{
 const started:number[]=[];
 let valid=true,completed=0;
 await playRankingSequence([1,2,3],async item=>{
  started.push(item);
  if(item===1)valid=false;
 },()=>valid,()=>{completed++;});
 assert.deepEqual(started,[1]);
 assert.equal(completed,0);
});
test("empty batch completes without a delay",async()=>{
 let completed=0;
 await playRankingSequence([],async()=>{},()=>true,()=>{completed++;});
 assert.equal(completed,1);
});
