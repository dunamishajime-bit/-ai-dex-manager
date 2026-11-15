import assert from "node:assert/strict";
import {listResearchReplays,readResearchReplay} from "../lib/server/bt-research-library";
import {replayCoverage} from "../lib/bt-verification/replay";

const native="STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NATIVE_HYPE_TREND_SOURCE_GROSS_20261115_V1";
const none="STABLE4_OPPORTUNITY_PROD_CAPS_20261114_NO_HYPE_SIDECAR_SOURCE_GROSS_20261115_V1";
const expected=[
 {caseName:native,bps:10,modelFills:1024,sourceFamilies:7,maxDd:-40.23879699734524},
 {caseName:native,bps:30,modelFills:1025,sourceFamilies:7,maxDd:-27.370750099842066},
 {caseName:none,bps:10,modelFills:1018,sourceFamilies:6,maxDd:-36.68991446964323},
 {caseName:none,bps:30,modelFills:1020,sourceFamilies:6,maxDd:-23.709304890543613},
] as const;
async function main(){
 assert.ok(process.env.DISDEX_BT_RESEARCH_LIBRARY_DIR,
   "Owner-private source-hashed research library path required");
 const entries=await listResearchReplays();
 assert.equal(entries.length,4,"Exactly 4 new private research replays required");
 for(const test of expected){
  const entry=entries.find(x=>x.sourceCase===test.caseName&&x.bps===test.bps);
  assert.ok(entry,"Missing indexed sensitivity case");
  assert.equal(entry.modeledFills,test.modelFills);
  assert.ok(Math.abs(entry.maxDdPct-test.maxDd)<1e-8,"Model DD has changed");
  assert.equal(entry.btcCandles,8928);
  assert.equal(entry.grossCaps.total,3.5);
  assert.equal(entry.grossCaps.crypto,3.0);
  assert.equal(entry.grossCaps.stock,1.5);
  assert.equal(entry.sourceMode,"RESEARCH_MODEL_NOT_VENUE_EXECUTION");
  assert.match(entry.sourceStatus,/NOT_FULL_PRODUCTION_PARITY/,
    "Never call research model production-ready");
  const result=await readResearchReplay(entry.id);
  assert.ok(result,"Private replay SHA/read/shape verification failed");
  assert.equal(result.entry.sha256,entry.sha256);
  assert.equal(result.replay.strategyCatalog?.length,test.sourceFamilies);
  assert.equal(result.replay.source?.kind,"RESEARCH_MODEL_RECONSTRUCTED");
  assert.equal(result.replay.engineSha,"UNVERIFIED_RESEARCH_BACKTEST");
  assert.equal(result.replay.btcCandles?.length,8928);
  const hasHype=result.replay.strategyCatalog?.some(x=>x.logic==="HYPE")??false;
  assert.equal(hasHype,test.caseName===native,
    "No-HYPE sidecar must not claim to trade native HYPE");
  const coverage=replayCoverage(result.replay);
  assert.ok(coverage.framesWithSourceGross>0);
  assert.ok(coverage.positionSnapshots>=test.modelFills);
  console.log(JSON.stringify({caseName:test.caseName,bps:test.bps,
      fills:test.modelFills,frames:entry.frames,sha:entry.sha256,status:"PRIVATE_HASHED_REPLAY_PASS"}));
 }
 console.log("Native HYPE vs no-HYPE private research library PASS (4 cases; no live orders)");
}
main().catch(error=>{console.error(error);process.exitCode=1});
