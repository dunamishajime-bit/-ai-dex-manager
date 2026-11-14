/** Offline formula parity and explicit hindsight-feature correction; no API/order I/O. */
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {extractStable4StrategyEntryFeatures,scoreStable4Opportunity,type Stable4OpportunityCandidate,type Stable4OpportunityLabel} from "../lib/stable4-opportunity-model";
const root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001";
const sourcePath=join(root,"DIRECTION_RESEARCH_20261109/three_layer_layer1_all_candidates_20261114.jsonl"),referencePath=join(root,"DIRECTION_RESEARCH_20261109/three_layer_layer2_online_ensemble_20261114.jsonl");
const raw=readFileSync(sourcePath),referenceRaw=readFileSync(referencePath),source=raw.toString("utf8").trim().split(/\r?\n/).map(x=>JSON.parse(x)),reference=referenceRaw.toString("utf8").trim().split(/\r?\n/).map(x=>JSON.parse(x));
const refs=new Map<string,any>(reference.map(x=>[x.id,x]));
function candidate(x:any,legacy=false):Stable4OpportunityCandidate{
 const r=refs.get(x.id);if(!r||r.entryTs!==x.entryTs||r.strategy!==x.strategy)throw Error("PARITY_REFERENCE_IDENTITY_MISMATCH");
 const features=extractStable4StrategyEntryFeatures(x.strategy,x.v);
 // Diagnostic branch only: reproduce the identified old leakage to prove the
 // arithmetic port, then separately report corrected causal feature results.
 if(legacy&&x.strategy==="V52"&&typeof x.v?.exit_basis_bps==="number")features.exit_basis_bps=x.v.exit_basis_bps;
 return{strategy:x.strategy,symbol:x.symbol,side:x.side,route:x.route,entryTs:x.entryTs,gross:x.gross,expectedHoldHours:r.expectedHoldHours,features};
}
const labels=(legacy:boolean):Stable4OpportunityLabel[]=>source.map(x=>({...candidate(x,legacy),id:x.id,exitTs:refs.get(x.id).exitTs,net30:refs.get(x.id).realizedNet30}));
const oldLabels=labels(true),cleanLabels=labels(false),failures:any[]=[],corrections:any[]=[],selected:Record<string,unknown>={};
let flips=0,maxError=0;
for(const x of source){
 const old=scoreStable4Opportunity(candidate(x,true),oldLabels),clean=scoreStable4Opportunity(candidate(x),cleanLabels),ref=refs.get(x.id);
 for(const key of ["predEV30","predWinProb","confidence","analogs","opportunityScore"] as const){
  const a=old[key],b=ref[key];if(a===null||b===null){if(a!==b)failures.push({id:x.id,key,actual:a,expected:b});}
  else{const error=Math.abs(a-b);maxError=Math.max(maxError,error);if(error>1e-10)failures.push({id:x.id,key,actual:a,expected:b});}
 }
 if(old.layer2Promote!==ref.layer2Promote)failures.push({id:x.id,key:"layer2Promote"});
 if(clean.layer2Promote!==old.layer2Promote)flips++;
 if(old.opportunityScore!==null&&clean.opportunityScore!==null&&Math.abs(old.opportunityScore-clean.opportunityScore)>1e-12)corrections.push({id:x.id,strategy:x.strategy,originalScore:old.opportunityScore,causalScore:clean.opportunityScore});
 if(["Q102P_00089","V52_00037"].includes(x.id))selected[x.id]={entryTs:x.entryTs,layer1ModelExitTs:ref.exitTs,original:old,causal:clean};
}
console.log(JSON.stringify({status:failures.length?"OPPORTUNITY_FORMULA_PARITY_FAILED":"OPPORTUNITY_FORMULA_PARITY_WITH_EXPLICIT_CAUSAL_FEATURE_CORRECTION",ordersSent:0,sourcePath,sourceSha256:createHash("sha256").update(raw).digest("hex"),referencePath,referenceSha256:createHash("sha256").update(referenceRaw).digest("hex"),samples:source.length,formulaFailures:failures.length,maxFormulaAbsoluteError:maxError,changedScores:corrections.length,changedStrategies:[...new Set(corrections.map(x=>x.strategy))],promotionFlips:flips,causalCorrection:"Exclude future exit_basis_bps from every V52 entry feature vector; retain entry_basis_bps and capture_basis_bps.",lifecycleCaveat:"Layer1 shadow model exits are not integrated portfolio fill lifecycle. Derive live active baselines from signed ownership and actual durable fills.",selected,largestCorrections:corrections.sort((a,b)=>Math.abs(b.originalScore-b.causalScore)-Math.abs(a.originalScore-a.causalScore)).slice(0,5),firstFailures:failures.slice(0,5)},null,2));
if(failures.length)process.exitCode=1;
