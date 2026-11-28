/** Isolated S34 source-native V4 rank/improvement/exhaustion + conditional one-slot model.
 * IMPORTANT: HIGH_VOL, base runner occupancy, signed ASTER quotes, fills,
 * profit-floor runtime flags, live stop readback, 181-day universe remain missing.
 * Never infer the final Q102 strategy from this intentionally conditional sleeve.
 */
import {readFileSync,writeFileSync} from "node:fs";
import {gunzipSync} from "node:zlib";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {evaluateQuality102CausalV4ImprovementGate} from "../lib/disdex-quality102-causal-selector";
import {causalReturn,q102ExhaustionReason} from "../lib/dd1296-entry-policy";
import {quality102GrossForFamily} from "../config/integratedProductionRiskPolicy";
import type {Quality102CausalV4S34Candidate} from "../lib/disdex-quality102-causal-v4-s34";
const H=3600000,M=300000;
const [marketRoot,out]=process.argv.slice(2);if(!marketRoot||!out)throw Error("ARGS_REQUIRED");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const rawName="docs/research/STABLE4_Q102_S34_ANNUAL_SOURCE_INVENTORY_20261128.json";
const m5Name="docs/research/STABLE4_Q102_S34_M5_DELAYED_CAUSAL_EXIT_V2_20261128.json";
const invName="docs/research/STABLE4_Q102_36MAIN_31EARLY_ASTERV3_H1_SOURCE_READINESS_20261128.json";
const expectedRaw="04209f9c8e49d8fcb781f6aa2afa7a16952dd9a3f2e876866ee1fa40bf73eeac";
const expectedM5="b3ceaad7cf64929b31dbbd4f81b02bc62f44fb238a60c9ae9c3cdadeb1facd98";
const rawBytes=readFileSync(rawName),m5Bytes=readFileSync(m5Name),invBytes=readFileSync(invName);
if(sha(rawBytes)!==expectedRaw||sha(m5Bytes)!==expectedM5)throw Error("PINNED_S34_EVIDENCE_CHANGED");
const raw=JSON.parse(rawBytes.toString("utf8")),m5=JSON.parse(m5Bytes.toString("utf8")),inv=JSON.parse(invBytes.toString("utf8"));
if(raw.schema!=="stable4-q102-s34-annual-source-inventory/v1"||raw.rawCandidates!==520||raw.orderAuthority!==false||raw.fullQ102AnnualReplay!==false
 ||m5.schema!=="stable4-q102-s34-m5-exit-observations/v2"||m5.orderAuthority!==false||m5.fullQ102AnnualReplay!==false
 ||m5.inputLedgerSha256!==expectedRaw||m5.rows.length!==520)throw Error("CANDIDATE_SOURCE_SCOPE_MISMATCH");
for(const [p,d] of Object.entries(raw.sourcePins))if(sha(readFileSync(p))!==d)throw Error("RAW_NATIVE_SOURCE_SHA_CHANGED:"+p);
for(const [p,d] of Object.entries(m5.sourcePins))if(sha(readFileSync(p))!==d)throw Error("M5_SOURCE_SHA_CHANGED:"+p);
const events=raw.events as Quality102CausalV4S34Candidate[];
const byClock=new Map<number,Quality102CausalV4S34Candidate[]>();
for(const e of events){const group=byClock.get(e.entryTs)??[];group.push(e);byClock.set(e.entryTs,group);}
if(byClock.size!==326)throw Error("RAW_CLOCKS_CHANGED");
const sourceRows=new Map<string,any>();
for(const r of m5.rows){if(sourceRows.has(r.id))throw Error("DUPLICATE_M5_RESULT");sourceRows.set(r.id,r);}
if(sourceRows.size!==events.length||events.some(e=>!sourceRows.has(e.id)))throw Error("M5_RESULT_LINEAGE_MISSING");
const FET=inv.perTicker.FET;
if(!FET?.main?.file)throw Error("FET_MAIN_H1_SOURCE_METADATA_MISSING");
const fet=new Map<number,{timestampMs:number;open:number}>(),sourceFet=[];
for(const [folder,meta] of [["aster-public-v3-h1",FET.main]] as const){
 const rawH1=readFileSync(resolve(marketRoot,folder,meta.file));
 if(sha(rawH1)!==meta.sha256)throw Error("FET_H1_SHA_CHANGED");
 let n=0;
 for(const line of gunzipSync(rawH1).toString("utf8").split(/\r?\n/).filter(Boolean)){
  const a=JSON.parse(line),[timestampMs,open,high,low,close,volume,closeTs,quoteVolume]=a.slice(0,8).map(Number);
  if(!Number.isSafeInteger(timestampMs)||timestampMs%H!==0||closeTs!==timestampMs+H-1
   ||![open,high,low,close,volume,quoteVolume].every(Number.isFinite)||Math.min(open,low,close)<=0
   ||high<Math.max(open,close)||low>Math.min(open,close)||volume<0||quoteVolume<0||fet.has(timestampMs))throw Error("FET_H1_INVALID_OR_DUPLICATED");
  fet.set(timestampMs,{timestampMs,open});n++;
 }
 if(n!==meta.rows)throw Error("FET_H1_ROW_COUNT_CHANGED");
 sourceFet.push({folder,file:meta.file,sha256:meta.sha256,rows:n,sourceBeginsAtMs:meta.firstOpenMs,earlyHistoryAvailable:false});
}
const layerRank={S3:1,S4:2} as const;
const familyRank={BRK:1,PB:2,MR:3,REV:4} as const;
function topCandidate(group:Quality102CausalV4S34Candidate[]){return [...group].sort((a,b)=>layerRank[a.layer]-layerRank[b.layer]||familyRank[a.family]-familyRank[b.family]||b.margin-a.margin||a.key.localeCompare(b.key))[0];}
const chosen=[...byClock.entries()].sort((a,b)=>a[0]-b[0]).map(([ts,group])=>{
 const top=topCandidate(group);
 let veto:string|undefined,ret72:number|undefined;
 if(top.symbol==="FETUSDT"&&top.family==="BRK"&&top.side===-1){
  const prev=fet.get(top.entryTs-72*H),now=fet.get(top.entryTs);
  if(prev&&now){try{ret72=causalReturn([prev],{timestampMs:top.entryTs,open:now.open},72);}catch{ret72=undefined;}}
  veto=q102ExhaustionReason(top.symbol,top.family,top.side,ret72);
 }
 const improvement=evaluateQuality102CausalV4ImprovementGate({family:top.family,side:top.side,ret14:top.ret14});
 if(!veto&&!improvement.accepted)veto="QUALITY102_CAUSAL_V4_REV_LONG_RET14_BELOW_24PCT_NO_BACKFILL";
 const selectedM5=sourceRows.get(top.id);
 if(!selectedM5||selectedM5.key!==top.key||selectedM5.entryTs!==ts||selectedM5.side!==top.side||selectedM5.symbol!==top.symbol)throw Error("SELECTED_M5_SOURCE_LINEAGE_MISMATCH");
 return {entryTs:ts,selectedId:top.id,selectedKey:top.key,symbol:top.symbol,side:top.side,
  layer:top.layer,family:top.family,margin:top.margin,ret14:top.ret14,rawSameClock:group.length,
  grossRequestHypothetical:quality102GrossForFamily(top.family,top.side),ret72:ret72??null,
  sourceSelectionGate:veto??"SOURCE_S34_QUALITY_PASS_CONDITIONAL_HIGH_VOL_ABSENT",
  nativeImprovementGateReason:improvement.reason,
  base:selectedM5.base,profitFloor:selectedM5.profitFloor};
});
function replay(arm:"base"|"profitFloor"){
 let until=0;const decisions:any[]=[];
 for(const e of chosen){
  const row:any={entryTs:e.entryTs,selectedId:e.selectedId,key:e.selectedKey,symbol:e.symbol,side:e.side,
   sourceSelectionGate:e.sourceSelectionGate,orderAuthority:false};
  if(e.entryTs<until){row.status="BLOCKED_CONDITIONAL_ONE_SLOT_OCCUPIED";row.occupiedUntilTs=until;}
  else if(e.sourceSelectionGate!=="SOURCE_S34_QUALITY_PASS_CONDITIONAL_HIGH_VOL_ABSENT")row.status="BLOCKED_SOURCE_IMPROVEMENT_OR_EXHAUSTION_NO_BACKFILL";
  else if(e[arm].status!=="MODELED_EXIT_NOT_FILL")row.status="BLOCKED_DELAYED_M5_PRICE_OR_CONFIRMATION_UNAVAILABLE";
  else{
   const x=e[arm];
   if(!Number.isSafeInteger(x.modelEntryTs)||x.modelEntryTs!==e.entryTs+M||!Number.isSafeInteger(x.exitTs)||x.exitTs<=x.modelEntryTs)throw Error("EXIT_MODEL_CLOCK_OR_CAUSAL_M5_INVALID");
   until=x.exitTs;
   row.status="ADMITTED_CONDITIONAL_S34_ONE_SLOT_NOT_FILL";
   row.modelEntryTs=x.modelEntryTs;row.modelExitTs=x.exitTs;
   row.modelEntryPrice=x.entryPrice;row.modelExitPrice=x.exitPrice;row.exitReason=x.reason;
   row.grossRequestHypothetical=e.grossRequestHypothetical;
  }
  decisions.push(row);
 }
 const status:Record<string,number>={},routes:Record<string,number>={};
 for(const r of decisions){status[r.status]=(status[r.status]??0)+1;if(r.status==="ADMITTED_CONDITIONAL_S34_ONE_SLOT_NOT_FILL")routes[r.key]=(routes[r.key]??0)+1;}
 return {summary:{sameClockSelected:decisions.length,status,admittedByRoute:routes},decisions};
}
const passes={base:replay("base"),profitFloor:replay("profitFloor")};
const veto:Record<string,number>={},families:Record<string,number>={};
for(const e of chosen){veto[e.sourceSelectionGate]=(veto[e.sourceSelectionGate]??0)+1;families[e.family]=(families[e.family]??0)+1;}
const pins=Object.fromEntries(["scripts/stable4-q102-s34-conditional-selection-one-slot.ts","lib/disdex-quality102-causal-v4-signal.ts","lib/dd1296-entry-policy.ts","lib/disdex-quality102-causal-selector.ts","config/integratedProductionRiskPolicy.ts"].map(p=>[p,sha(readFileSync(p))]));
const report={schema:"stable4-q102-s34-conditional-source-ranked-one-slot/v1",
 status:"ISOLATED_S34_ONLY_NO_HIGH_VOL_OR_BASE_OCCUPANCY_NO_FILL",
 sourcePins:pins,rawCandidateLedgerSha256:expectedRaw,delayedM5LedgerSha256:expectedM5,fetH1:sourceFet,
 summary:{rawCandidates:events.length,distinctCandidateClocks:chosen.length,sourceRankedPerClockFamily:families,gateDecisionCounts:veto,
   base:passes.base.summary,profitFloor:passes.profitFloor.summary},selected:chosen,passes,
 orderAuthority:false,fullQ102AnnualReplay:false,fullSevenRunnerWalletReplay:false,productionEligible:false,
 limitations:["Exact native S34 candidate ranking order and final FET 72h exhaustion / REV long 14d +24% improvement gate on previously pinned raw candidates; source HIGH_VOL has priority but is NOT calculated here. All S34 admissions are conditional on no HIGH_VOL signal and base runner idle, neither proven.",
 "No candidate backfill after the selected route is rejected. The 520 events are raw overlapping candidates, not 520 trades. Only 326 clocks have at least one S34 candidate; unknown additional decisions in the other 1864 clocks remain out of this audit.",
 "M5 is an explicit optional delayed-confirmation MODEL: wait for first M5 to finish before a t+5m next-open price proxy; this is not a signed Q102 production M5 entry flag or executable venue fill. Zero-volume first M5 blocks in this hypothetical arm only.",
 "ProfitFloor arm is counterfactual and not proven enabled in pinned runner; even source-native profit-floor helper cannot certify real conditional order changes, actual STOP readback or intrabar fill.",
 "Source FET H1 72h lookback required only for FET BRK SHORT selected; any missing data rejects selected clock, no backfill. Native HIGH_VOL 181d/monthly selection, one-slot real exchange/portfolio state, actual venue MTM, fees/funding, 10/30bps, DD, seven-runner artificial stress and owner certificate remain unproven."]};
writeFileSync(out,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log("SUMMARY",JSON.stringify(report.summary));
