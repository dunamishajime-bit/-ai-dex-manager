/**
 * BT-481-I: immutable pre-Codex V4 source candidate replay, not LIVE parity.
 * Frozen upstream V2 contains documented hindsight/Y06 block.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {SyntheticMarket5m,type MarketCandle5m} from "../lib/bt-verification/synthetic-market";
import {inspectV4FullNativeSynthetic,inspectV4FullSourceBatch}
 from "../lib/bt-verification/pinned-native-v4-full/full-source-probe";
import {V12_X1_ALL} from "../lib/bt-verification/pinned-native-v4-full/v12X1AllRuntime";
import {V12_V4_V2_STATUS,V12_V4_V2_POLICY}
 from "../lib/bt-verification/pinned-native-v4-full/v12-v4-v2-shadow";
const pinned="9118eeaa6c209dc6e37887cf5be139b3baaa005d";
const seed=20261115,scenario="rotation" as const;
assert.equal(V12_V4_V2_STATUS,"BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06");
assert.equal(V12_V4_V2_POLICY,"V2_M150_D05_CORE_NATIVE");
assert.equal(V12_X1_ALL.universe.length,14);
const manifest=JSON.parse(readFileSync(
 "lib/bt-verification/pinned-native-v4-full/source-manifest.json","utf-8"));
assert.equal(manifest.gitRevision,pinned);
assert.equal(manifest.productionMutations,0);
assert.equal(manifest.economicParityCertified,false);
assert.equal(manifest.ordersAuthorized,false);
const feed=new SyntheticMarket5m(seed,scenario,{
 start:"2025-10-01T00:00:00Z",
 endExclusive:"2025-10-23T00:00:00Z",version:"v4"
});
const statusCount=new Map<string,number>();
const routeCount=new Map<string,number>();
const tested=new Set<string>();
let scheduled=0,sourceRows=0,filteredRows=0,nativeCore=0;
let eligible=0,firstEvaluation="";
const firstCandidates:Array<{at:string,symbol:string,route:string,side:string}>=[];
function assertInputFailClosed(
  at:string,normal:Record<string,readonly MarketCandle5m[]>
){
 const baseline=inspectV4FullSourceBatch(at,normal);
 assert.equal(baseline.status,"SOURCE_CANDIDATES_EVALUATED");
 assert.equal(baseline.currentProductionPinCertified,false);
 assert.equal(baseline.realOrderEnabledV4,0);
 assert.equal(baseline.orderEnabled,false);
 assert.equal(baseline.fills,0);
 assert.equal(baseline.gross,null);
 assert.equal(baseline.pnl,null);
 assert.deepEqual(baseline,inspectV4FullSourceBatch(at,normal));
 const short={...normal,BTC:normal.BTC.slice(-244)};
 assert.equal(inspectV4FullSourceBatch(at,short).status,"INSUFFICIENT_245H1");
 const missing={...normal};
 delete missing.BTC;
 assert.equal(inspectV4FullSourceBatch(at,missing).status,"MISSING_UNIVERSE");
 const future={...normal,BTC:[...normal.BTC]};
 future.BTC[future.BTC.length-1]={
  ...future.BTC.at(-1)!,closedAt:new Date(Date.parse(at)+3600000).toISOString()
 };
 assert.equal(inspectV4FullSourceBatch(at,future).status,"INVALID_OR_GAPPED_H1");
 const broken={...normal,BTC:[...normal.BTC]};
 broken.BTC[100]={
  ...broken.BTC[100],
  openTime:new Date(Date.parse(broken.BTC[100].openTime)+3600000).toISOString()
 };
 assert.equal(inspectV4FullSourceBatch(at,broken).status,"INVALID_OR_GAPPED_H1");
 const badClose={...normal,BTC:[...normal.BTC]};
 badClose.BTC[110]={...badClose.BTC[110],close:Number.NaN};
 assert.equal(inspectV4FullSourceBatch(at,badClose).status,"INVALID_OR_GAPPED_H1");
 assert.equal(inspectV4FullSourceBatch(
  new Date(Date.parse(at)+3600000).toISOString(),normal).status,"NOT_H2");
}
feed.runToEnd(step=>{
 const now=Date.parse(step.observedAt);
 if(now%(2*3600000)!==0||
    !step.completedH1.some(x=>x.symbol==="BTCUSDT"))return;
 const r=inspectV4FullNativeSynthetic(feed,step);
 scheduled++;
 statusCount.set(r.status,(statusCount.get(r.status)??0)+1);
 assert.equal(r.sourceGitRevision,pinned);
 assert.equal(r.currentProductionPinCertified,false);
 assert.equal(r.orderEnabled,false);
 assert.equal(r.realOrderEnabledV4,0);
 assert.equal(r.tradingMutation,0);
 assert.equal(r.fills,0);
 assert.equal(r.pnl,null);
 assert.equal(r.gross,null);
 if(r.status==="SOURCE_CANDIDATES_EVALUATED"){
   if(!firstEvaluation)firstEvaluation=r.asOf;
   if(!tested.has("replay")){
     const history:Record<string,readonly MarketCandle5m[]>={};
     for(const sym of V12_X1_ALL.universe)
       history[sym]=feed.historyH1((sym+"USDT") as
       Parameters<typeof feed.historyH1>[0],500);
     const direct=inspectV4FullSourceBatch(r.asOf,history);
     assert.deepEqual(r,direct,"Feed and explicitly supplied H1 source must agree");
     assertInputFailClosed(r.asOf,history);
     tested.add("replay");
   }
   sourceRows+=r.originalSourceCandidateCount;
   filteredRows+=r.filteredSourceCandidateCount;
   nativeCore+=r.nativeCoreEvents;
   eligible+=r.candidateRoutes.length;
   for(const candidate of r.candidateRoutes){
     assert.ok(candidate.sourceAvailableAtTs<=now);
     assert.ok(candidate.eligibleEntryTs>=candidate.sourceAvailableAtTs);
     assert.ok(V12_X1_ALL.universe.some(x=>x+"USDT"===candidate.symbol));
     assert.ok(candidate.side==="LONG"||candidate.side==="SHORT");
     assert.ok(candidate.route.trim().length>0);
     routeCount.set(candidate.route,(routeCount.get(candidate.route)??0)+1);
     if(firstCandidates.length<8)
       firstCandidates.push({at:r.asOf,symbol:candidate.symbol,
         route:candidate.route,side:candidate.side});
   }
 }else {
   assert.equal(r.candidateRoutes.length,0);
   assert.equal(r.sourceErrors.length,0);
 }
});
assert.equal(scheduled,264);
assert.equal(statusCount.get("INSUFFICIENT_245H1"),122);
assert.equal(statusCount.get("SOURCE_CANDIDATES_EVALUATED"),142);
assert.equal(statusCount.size,2);
assert.equal(firstEvaluation,"2025-10-11T06:00:00Z");
assert.equal(sourceRows,118);
assert.equal(eligible,118);
assert.equal(filteredRows,9);
assert.equal(nativeCore,2);
assert.ok(routeCount.size>=6);
assert.ok(tested.has("replay"));
const report={
 schema:"bt-pr481-v4-full-source-frozen-audit-v1",
 taskId:"BT-481-I_SOURCE_SUBTASK",
 gitRevision:pinned,originalV2Status:V12_V4_V2_STATUS,
 policy:V12_V4_V2_POLICY,seed,scenario,feedVersion:"v4",
 periodStart:"2025-10-01T00:00:00Z",
 periodEndExclusive:"2025-10-23T00:00:00Z",
 sourceManifestSha256:createHash("sha256").update(readFileSync(
   "lib/bt-verification/pinned-native-v4-full/source-manifest.json")).digest("hex"),
 scheduledH2:scheduled,
 warmupH2:statusCount.get("INSUFFICIENT_245H1"),
 sourceEvaluations:statusCount.get("SOURCE_CANDIDATES_EVALUATED"),
 firstEvaluation,sourceCandidateRows:sourceRows,
 originalReportedFilteredRows:filteredRows,
 sourceNativeCoreEvents:nativeCore,
 routeCounts:Object.fromEntries([...routeCount].sort((a,b)=>a[0].localeCompare(b[0]))),
 sampleCandidates:firstCandidates,
 currentProductionPinCertified:false,
 fullV4EconomicParity:false,
 researchHindsightY06IssueResolved:false,
 entryVerified:0,orderAuthority:false,orders:0,fills:0,gross:null,pnl:null,
 note:"This is source reconstruction from pre-Codex Git 9118eeaa. Frozen V2 route status is explicitly BLOCKED_HINDSIGHT_LEAKAGE_AND_EXTERNAL_Y06. 118 source-level candidates are not 118 fills, nor validated trading rules. No current LIVE or STABLE4 economic parity is claimed."
};
mkdirSync("reports/bt-verification",{recursive:true});
writeFileSync("reports/bt-verification/BT_PR481_I_V4_FULL_SOURCE_20261116.json",
 JSON.stringify(report,null,2)+"\n","utf-8");
console.log("PASS V4 full frozen source-only replay "+JSON.stringify({
 scheduled,sourceEvaluations:report.sourceEvaluations,
 sourceCandidateRows:sourceRows,routeKinds:routeCount.size,
 nativeCore,orderCount:report.orders,fills:report.fills,lookaheadRejected:true
}));
