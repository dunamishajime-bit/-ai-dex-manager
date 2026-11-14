/** Apply captured public evidence to historical model observations; no network or orders. */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {dirname,isAbsolute,join} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {Stable4Q102OnlineEngine} from "../lib/disdex-quality102-stable4-online";
import type {Stable4ShadowEvidenceRequest,Stable4ShadowEvidence} from "../lib/stable4-q102-shadow-evidence";
import {publicM5Nonnegative} from "../lib/stable4-q102-shadow-evidence";
import type {Quality102Candle} from "../lib/disdex-quality102-causal-pipeline";
const H=3600000,M=300000;
const arg=(k:string)=>{const i=process.argv.indexOf(k),v=i>=0?process.argv[i+1]:undefined;if(!v||v.startsWith("--"))throw Error("BOOTSTRAP_ARGUMENT_REQUIRED:"+k);return v;};
async function main(){
 const statePath=arg("--state-path"),rollingPath=arg("--rolling-h1"),observationsPath=arg("--observations-summary"),requestsPath=arg("--requests-path"),evidenceRoot=arg("--evidence-root"),summaryPath=arg("--summary-path");
 if(![statePath,rollingPath,observationsPath,requestsPath,evidenceRoot,summaryPath].every(isAbsolute))throw Error("BOOTSTRAP_ABSOLUTE_PATHS_REQUIRED");
 const root=process.env.DISDEX_STABLE4_RESEARCH_DATA_ROOT||"C:/tmp/disdex-bt-20251001-20261001";
 const sourceRaw=readFileSync(rollingPath),source=JSON.parse(sourceRaw.toString("utf8")),observations=JSON.parse(readFileSync(observationsPath,"utf8"));
 if(createHash("sha256").update(sourceRaw).digest("hex")!==observations.sourceCacheSha256)throw Error("BOOTSTRAP_H1_SNAPSHOT_CHANGED");
 const requestsRaw=readFileSync(requestsPath),plan=JSON.parse(requestsRaw.toString("utf8")),planHash=createHash("sha256").update(requestsRaw).digest("hex");
 if(plan.sourceCacheSha256!==observations.sourceCacheSha256)throw Error("BOOTSTRAP_REQUEST_SOURCE_CHANGED");
 const through=observations.lastObserved+H;
 const engine=new Stable4Q102OnlineEngine({mode:"LIVE",requireHourlyCoverage:true,highVolSymbols:observations.highVolSymbols,statePath,recoverySeedPath:"config/stable4/q102-online-recovery-seed-20261114.json",avaxSeedPath:"config/stable4/q102-avax-knn-seed-20261114.json"});
 if(engine.learningStatus().observedThrough!==observations.lastObserved)throw Error("BOOTSTRAP_OBSERVATION_FRONTIER_CHANGED");
 const evidenceHashes:Record<string,string>={};
 const provider={load:async(q:Stable4ShadowEvidenceRequest):Promise<Stable4ShadowEvidence>=>{
  const raw=readFileSync(join(evidenceRoot,q.symbol+".json")),captured=JSON.parse(raw.toString("utf8")),request=captured.request;
  if(captured.schema!=="disdex-stable4-public-bootstrap-evidence/v1"||captured.requestPlanSha256!==planHash||request.symbol!==q.symbol||request.from!==q.from||request.through!==q.through||request.includeM5!==q.includeM5||!Number.isSafeInteger(captured.capturedAt)||captured.capturedAt<q.through||captured.capturedAt>Date.now())throw Error("BOOTSTRAP_CAPTURED_EVIDENCE_BINDING_INVALID:"+q.symbol);
  evidenceHashes[q.symbol]=createHash("sha256").update(raw).digest("hex");
  const map=new Map<number,Quality102Candle&{tradeCount:number}>();
  const add=(z:any)=>{
   const t=Number(z[0]);if(t<q.from||t>q.through)return;
   const b={timestampMs:t,open:Number(z[1]),high:Number(z[2]),low:Number(z[3]),close:Number(z[4]),baseVolume:publicM5Nonnegative(z[5]),quoteVolume:publicM5Nonnegative(z[7]),tradeCount:publicM5Nonnegative(z[8],true)};
   if(!Number.isSafeInteger(t)||t%M!==0||!Number.isFinite(b.open)||b.open<=0)throw Error("BOOTSTRAP_M5_TIMESTAMP_OR_OPEN_INVALID");
   if(t+M>q.through){map.set(t,{...b,high:b.open,low:b.open,close:b.open,quoteVolume:0});return;}
   if(![b.high,b.low,b.close,b.quoteVolume].every(Number.isFinite)||b.low<=0||b.quoteVolume<0||b.high<Math.max(b.open,b.close)||b.low>Math.min(b.open,b.close))throw Error("BOOTSTRAP_M5_OHLC_INVALID:"+q.symbol+":"+t);
   const old=map.get(t);if(old&&JSON.stringify(old)!==JSON.stringify(b))throw Error("BOOTSTRAP_M5_CONFLICTING_DUPLICATE");map.set(t,b);
  };
  if(q.includeM5){
   const archive=join(root,`FORWARD_HOLDOUT_20261001_20261108/aster-m5/${q.symbol}-5m-20261001-20261108T20.jsonl.gz`);
   for(const line of gunzipSync(readFileSync(archive)).toString("utf8").trim().split(/\r?\n/))add(JSON.parse(line));
   for(const row of captured.m5)add(row);
  }
  const completed=[...map.values()].filter(b=>b.timestampMs+M<=q.through).sort((a,b)=>a.timestampMs-b.timestampMs);
  if(q.includeM5&&(completed.length!==Math.floor((q.through-q.from)/M)||completed.some((b,i)=>b.timestampMs!==q.from+i*M)))throw Error("BOOTSTRAP_M5_GAP:"+q.symbol);
  const seen=new Set<number>(),funding=captured.funding.map((r:any)=>{
   const t=Number(r.fundingTime),rate=Number(r.fundingRate);
   if(r.symbol!==q.symbol||!Number.isSafeInteger(t)||t<=q.from||t>=q.through||!Number.isFinite(rate)||seen.has(t))throw Error("BOOTSTRAP_FUNDING_ROW_INVALID");seen.add(t);return{fundingTime:t,fundingRate:rate};
  });
  const boundary=map.get(Math.floor(q.through/M)*M);
  return{fiveMinute:completed,hourly:source.candlesBySymbol[q.symbol].filter((b:Quality102Candle)=>b.timestampMs+H<=q.through),...(boundary&&boundary.timestampMs+M>q.through?{boundaryOpen:{timestampMs:boundary.timestampMs,open:boundary.open}}:{}),funding:{from:q.from,through:q.through,capturedAt:captured.capturedAt,rows:funding}};
 }};
 await engine.refreshOutcomes({candlesBySymbol:source.candlesBySymbol},through,provider);
 const state=JSON.parse(readFileSync(statePath,"utf8")),matured=state.recoveryPending.filter((q:any)=>q.exitTs<=through).length;
 if(matured)throw Error("BOOTSTRAP_MATURE_OUTCOMES_UNRESOLVED:"+matured);
 const result={schema:"disdex-stable4-outcome-bootstrap/v1",status:state.recoveryUnresolved.length?"OBSERVATIONS_CAUGHT_UP_WITH_EXPLICIT_UNRESOLVED_LABELS":"CAUSAL_OBSERVATIONS_AND_OUTCOMES_BOOTSTRAPPED",ordersEnabled:false,ordersSent:0,through,sourceCacheSha256:observations.sourceCacheSha256,requestPlanSha256:planHash,evidenceSha256:evidenceHashes,stateSha256:createHash("sha256").update(readFileSync(statePath)).digest("hex"),model:engine.learningStatus(),avaxCompletedContinuationRows:state.avaxRows.length,maturedPendingOutcomes:matured,unresolvedLabelsExcludedFromTraining:state.recoveryUnresolved};
 mkdirSync(dirname(summaryPath),{recursive:true});writeFileSync(summaryPath,JSON.stringify(result,null,2)+"\n",{mode:0o600});console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:String(e));process.exitCode=1;});
