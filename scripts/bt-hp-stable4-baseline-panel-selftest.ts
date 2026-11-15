import assert from "node:assert/strict";
import fs from "node:fs";
import {buildStable4BaselineComparison,STABLE4_BASELINE_CASES} from "../lib/bt-verification/stable4-baseline-comparison";
import type {ResearchLibraryEntry} from "../lib/server/bt-research-library";
const hash="0123456789abcdef".repeat(4);
function fixture(sourceCase:string,bps:10|30,capped=false):ResearchLibraryEntry{
 return {
   id:sourceCase+"_"+bps+"BPS_REPLAY.json",sourceCase,bps,frames:8978,modeledFills:1000,
   btcCandles:8928,bytes:20000,sha256:hash,sourceStatus:"RESEARCH_ONLY",
   sourceMode:"RESEARCH_MODEL_NOT_VENUE_EXECUTION",
   grossCaps:capped?{total:3.5,crypto:3,stock:1.5}:{total:4.25,crypto:3,stock:4},
   initialJpy:10000,finalEquityJpy:capped?12442421:13541227,
   maxDdPct:capped?-22.60:-21.57,winRatePct:63
 };
}
const four=[
 fixture(STABLE4_BASELINE_CASES.research,10),
 fixture(STABLE4_BASELINE_CASES.capped,10,true),
 fixture(STABLE4_BASELINE_CASES.research,30),
 fixture(STABLE4_BASELINE_CASES.capped,30,true)
];
const pairs=buildStable4BaselineComparison(four);
assert.equal(pairs?.length,2);
assert.equal(pairs?.[0].finalDifferenceJpy,1098806);
assert.ok(pairs?.[0].ddDifferencePoints!==undefined);
assert.equal(buildStable4BaselineComparison(four.slice(1)),null,"Require both bps and both sources");
assert.equal(buildStable4BaselineComparison([...four,four[0]]),null,"Reject duplicates");
const wrong=structuredClone(four);wrong[1].grossCaps.total=4.25;
assert.equal(buildStable4BaselineComparison(wrong),null,"Do not mislabel Gross caps");
const fake=structuredClone(four);fake[0].sha256="fake";
assert.equal(buildStable4BaselineComparison(fake),null,"Reject missing provenance");
const rebase=structuredClone(four);rebase[0].initialJpy=9000;
assert.equal(buildStable4BaselineComparison(rebase),null,"Do not compare different initial balances");
if(process.argv[2]){
 const idx=JSON.parse(fs.readFileSync(process.argv[2],"utf8")) as Array<{
  file:string;sourceCase:string;bps:10|30;frames:number;modeledFills:number;btcCandles:number;
  bytes:number;sha256:string;sourceStatus:string;sourceMode:string;
  sourceGrossCaps:ResearchLibraryEntry["grossCaps"];
  modelSummary:{initialJpy:number;finalEquityJpy:number;maxDdPct:number;winRatePct:number}
 }>;
 const converted:ResearchLibraryEntry[]=idx.map(x=>({
  id:x.file,sourceCase:x.sourceCase,bps:x.bps,frames:x.frames,modeledFills:x.modeledFills,
  btcCandles:x.btcCandles,bytes:x.bytes,sha256:x.sha256,sourceStatus:x.sourceStatus,
  sourceMode:x.sourceMode as ResearchLibraryEntry["sourceMode"],grossCaps:x.sourceGrossCaps,
  initialJpy:x.modelSummary.initialJpy,finalEquityJpy:x.modelSummary.finalEquityJpy,
  maxDdPct:x.modelSummary.maxDdPct,winRatePct:x.modelSummary.winRatePct
 }));
 const r=buildStable4BaselineComparison(converted);
 assert.equal(r?.length,2,"Real four-case owner INDEX must be available");
 assert.ok(Math.abs(r![0].research.finalEquityJpy-13541227.4169)<.1);
 assert.ok(Math.abs(r![0].capped.finalEquityJpy-12442421.055)<.1);
 assert.ok(Math.abs(r![1].research.finalEquityJpy-4923412)<2);
 assert.ok(Math.abs(r![1].capped.finalEquityJpy-4660538)<2);
 console.log("OWNER PRIVATE INDEX PASS: 13.54m / 12.44m research comparison recognized");
}
console.log("PASS STABLE4 research/prod-cap panel strict source pairing and fail-closed checks");
