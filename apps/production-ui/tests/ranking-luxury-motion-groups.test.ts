import test from "node:test";
import assert from "node:assert/strict";
import {createRankingMovementPhases,classifyRankingMove} from "../lib/ranking-motion-groups";
import {RANKING_SOUNDS,loadRankingSoundSelections,DEFAULT_RANKING_SOUND_SELECTIONS} from "../lib/ranking-sounds";

const ranks=(...ids:string[])=>ids.map((id,i)=>({id,rank:i+1,score:70}));

test("Top3 pair exchanges together as a separate gold phase",()=>{
 const before=ranks("BTC","ETH","SOL","AVAX","LINK","DOGE","ADA");
 const after=ranks("ETH","BTC","SOL","LINK","AVAX","ADA","DOGE");
 const phases=createRankingMovementPhases(before,after);
 assert.deepEqual(phases.map(p=>p.role),["top3","rise","fall"]);
 assert.equal(phases[0].durationMs,1900);
 assert.deepEqual(phases[0].changes.map(c=>c.id),["ETH","BTC"]);
 assert.deepEqual(phases[1].changes.map(c=>c.id),["LINK","ADA"]);
 assert.deepEqual(phases[2].changes.map(c=>c.id),["AVAX","DOGE"]);
 assert.equal(phases[1].durationMs,1500);
 assert.equal(phases[2].durationMs,1500);
});
test("a Top3 entry from outside is in gold wave, not ordinary rise",()=>{
 const before=ranks("BTC","ETH","SOL","LINK","AVAX");
 const after=ranks("BTC","LINK","ETH","SOL","AVAX");
 const phases=createRankingMovementPhases(before,after);
 assert.equal(phases[0].role,"top3");
 assert.deepEqual(phases[0].changes.map(c=>c.id),["LINK","ETH","SOL"]);
 assert.equal(phases.some(p=>p.role==="rise"),false);
});
test("unchanged ranks do not animate and top3 exchange requires rank movement",()=>{
 const x=ranks("BTC","ETH","SOL","LINK");
 assert.deepEqual(createRankingMovementPhases(x,x),[]);
 assert.equal(classifyRankingMove(3,3),null);
 assert.equal(classifyRankingMove(undefined,2),null);
 assert.equal(classifyRankingMove(11,10),"rise");
 assert.equal(classifyRankingMove(10,11),"fall");
 assert.equal(classifyRankingMove(2,3),"top3");
});
test("previous one-sound storage safely migrates into three independent choices",()=>{
 const migrated=loadRankingSoundSelections(undefined,"gold");
 assert.equal(migrated.rise,"gold");
 assert.equal(migrated.fall,DEFAULT_RANKING_SOUND_SELECTIONS.fall);
 assert.equal(migrated.top3,DEFAULT_RANKING_SOUND_SELECTIONS.top3);
 const selected=loadRankingSoundSelections({rise:"piano",fall:"mist",top3:"diamond"},"crystal");
 assert.deepEqual(selected,{rise:"piano",fall:"mist",top3:"diamond"});
 assert.equal(RANKING_SOUNDS.length,20);
});
