import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync,copyFileSync,unlinkSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {listResearchReplays,readResearchReplay} from "../lib/server/bt-research-library";
import {replayCoverage} from "../lib/bt-verification/replay";
async function main(){
const root=process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR;
assert.ok(root,"Test requires an explicit read-only research library path");
const items=await listResearchReplays();
assert.ok(items.length>0&&items.length<=50);
const seen=new Set<string>();
for(const item of items){
 assert.equal(seen.has(item.id),false);seen.add(item.id);
 const result=await readResearchReplay(item.id);
 assert.ok(result,"Every indexed replay must exist, hash-match and validate its source");
 assert.equal(result.entry.sha256,item.sha256);
 assert.equal(result.replay.frames.length,item.frames);
 assert.equal(result.replay.btcCandles?.length,item.btcCandles);
 assert.equal(result.replay.researchSummary?.modelFills,item.modeledFills);
 assert.equal(result.replay.researchSummary?.costBps,item.bps);
 assert.equal(result.replay.mode,"EXTERNAL");
 assert.equal(result.replay.source?.kind,"RESEARCH_MODEL_RECONSTRUCTED");
 const coverage=replayCoverage(result.replay);
 assert.equal(coverage.frames,item.frames);
 assert.ok(coverage.framesWithSourceGross>0);
 assert.ok(coverage.positionSnapshots>=item.modeledFills,"Position timeline should contain indexed model fills");
 assert.ok(coverage.currentGrossKnown<=coverage.positionSnapshots);
 assert.ok(coverage.markKnown<=coverage.positionSnapshots);
 assert.ok(coverage.quantityKnown<=coverage.positionSnapshots);
 console.log(JSON.stringify({id:item.id,bps:item.bps,frames:item.frames,modelFills:item.modeledFills,sourceStatus:item.sourceStatus,
   sourceGrossSnapshots:coverage.framesWithSourceGross,positionGrossKnown:coverage.currentGrossKnown,
   positionSnapshots:coverage.positionSnapshots,status:"HASHED_READONLY_PASS"}));
}
await assert.rejects(readResearchReplay("../fake_REPLAY.json"),/BT_RESEARCH_INVALID_ID/);
await assert.rejects(readResearchReplay("other\\fake_REPLAY.json"),/BT_RESEARCH_INVALID_ID/);
assert.equal(await readResearchReplay("ABSENT_CASE_10BPS_REPLAY.json"),null);
const earlier=process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR;
try{
 delete process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR;
 await assert.rejects(listResearchReplays(),/BT_RESEARCH_LIBRARY_NOT_CONFIGURED/);
}finally{process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR=earlier}
const sandbox=mkdtempSync(join(tmpdir(),"bt481-research-sha-negative-"));
try{
 const item=items[0];
 const raw=readFileSync(join(root!,item.id));
 writeFileSync(join(sandbox,"INDEX.json"),JSON.stringify([{
   file:item.id,bytes:item.bytes,sha256:item.sha256,sourceCase:item.sourceCase,bps:item.bps,
   frames:item.frames,modeledFills:item.modeledFills,btcCandles:item.btcCandles,
   sourceStatus:item.sourceStatus,sourceMode:item.sourceMode,sourceGrossCaps:item.grossCaps,
   modelSummary:{costBps:item.bps,initialJpy:item.initialJpy,finalEquityJpy:item.finalEquityJpy,
     maxDdPct:item.maxDdPct,winRatePct:item.winRatePct,modelFills:item.modeledFills}
 }]));
 const tampered=Buffer.from(raw);
 tampered[tampered.length-60]^=1;
 writeFileSync(join(sandbox,item.id),tampered);
 process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR=sandbox;
 await assert.rejects(readResearchReplay(item.id),/BT_RESEARCH_SHA256_MISMATCH/);
}finally{
 process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR=earlier;rmSync(sandbox,{recursive:true,force:true});
}
console.log(JSON.stringify({status:"PASS",count:items.length,hashVerification:true,negativeTests:4,liveOrders:"UNTOUCHED"}));

}
main().catch(error=>{console.error(error);process.exitCode=1});
