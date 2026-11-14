import {createHash} from "node:crypto";
import {isStable4StrategyEntryFeature,type Stable4OpportunityLabel} from "./stable4-opportunity-model";

export const STABLE4_CORPUS_SEED_SHA256="2b2a9e0e9f3a5b24c816c28827ad19e40d9ad638425e9c4827eca120938f3008";
export const STABLE4_OPPORTUNITY_MODEL_VERSION="STABLE4_CAUSAL_ENTRY_FEATURES_V1";
const STRATEGIES=new Set(["V4","PENGU","FET","Q102","IDLE","V52","HYPE"]);
const object=(x:unknown):x is Record<string,any>=>!!x&&typeof x==="object"&&!Array.isArray(x);
const finite=(x:unknown):x is number=>typeof x==="number"&&Number.isFinite(x);
const text=(x:unknown):x is string=>typeof x==="string"&&x.length>0&&x===x.trim();
const hash=(x:unknown)=>typeof x==="string"&&/^[a-f0-9]{64}$/.test(x);
function validateLabel(value:unknown):Stable4OpportunityLabel{
 const x=value as Stable4OpportunityLabel;
 if(!object(x)||!STRATEGIES.has(x.strategy)||![x.id,x.symbol,x.route].every(text)||!['LONG','SHORT'].includes(x.side)||
  !Number.isSafeInteger(x.entryTs)||x.entryTs<=0||!Number.isSafeInteger(x.exitTs)||x.exitTs<=x.entryTs||!finite(x.net30))throw Error("STABLE4_CORPUS_LABEL_INVALID");
 if(!object(x.features)||Object.entries(x.features).some(([k,v])=>!isStable4StrategyEntryFeature(x.strategy,k)||!finite(v)))throw Error("STABLE4_CORPUS_ENTRY_FEATURE_INVALID");
 return{id:x.id,strategy:x.strategy,symbol:x.symbol,side:x.side,route:x.route,entryTs:x.entryTs,exitTs:x.exitTs,net30:x.net30,features:{...x.features}};
}
const identity=(r:Stable4OpportunityLabel)=>JSON.stringify([r.strategy,r.symbol,r.side,r.route,r.entryTs]);
const canonical=(r:Stable4OpportunityLabel)=>JSON.stringify({...r,features:Object.fromEntries(Object.entries(r.features).sort(([a],[b])=>a.localeCompare(b)))});
/** Continuation rows cannot silently revise a frozen historical opportunity. */
export function mergeStable4OpportunityLabels(seed:readonly Stable4OpportunityLabel[],continuation:readonly Stable4OpportunityLabel[]):Stable4OpportunityLabel[]{
 const byIdentity=new Map<string,Stable4OpportunityLabel>(),byId=new Map<string,string>();
 for(const raw of [...seed,...continuation]){
  const r=validateLabel(raw),key=identity(r),id=JSON.stringify([r.strategy,r.id]),prior=byIdentity.get(key);
  if((prior&&canonical(prior)!==canonical(r))||(byId.has(id)&&byId.get(id)!==key))throw Error("STABLE4_CORPUS_LABEL_CONFLICT");
  byIdentity.set(key,r);byId.set(id,key);
 }
 return [...byIdentity.values()];
}
/** The deployed source pins reviewed bytes; an arbitrary manifest hash is insufficient. */
export function loadStable4OpportunityCorpus(raw:Uint8Array,expectedSha256:string){
 if(!hash(expectedSha256)||createHash("sha256").update(raw).digest("hex")!==expectedSha256)throw Error("STABLE4_CORPUS_HASH_MISMATCH");
 let value:Record<string,any>;try{value=JSON.parse(Buffer.from(raw).toString("utf8"));}catch{throw Error("STABLE4_CORPUS_JSON_INVALID");}
 if(!object(value)||value.schema!=="disdex-stable4-opportunity-corpus/v1"||value.kind!=="RESEARCH_SHADOW_LABELS_NOT_LIVE_FILLS"||value.modelVersion!==STABLE4_OPPORTUNITY_MODEL_VERSION||
  !Number.isSafeInteger(value.candidateCoverageThrough)||value.candidateCoverageThrough<=0||!hash(value.sourceSha256)||!hash(value.q102SeedSha256)||!Array.isArray(value.rows))throw Error("STABLE4_CORPUS_MANIFEST_INVALID");
 const rows=mergeStable4OpportunityLabels(value.rows,[]);
 if(rows.length!==value.rows.length||rows.length!==2892||rows.some(r=>r.entryTs>=value.candidateCoverageThrough))throw Error("STABLE4_CORPUS_POPULATION_INVALID");
 const expected:Record<string,number>={V4:1443,PENGU:116,FET:11,Q102:278,IDLE:849,V52:90,HYPE:105};
 for(const [strategy,count]of Object.entries(expected))if(rows.filter(r=>r.strategy===strategy).length!==count)throw Error("STABLE4_CORPUS_STRATEGY_POPULATION_INVALID");
 return{rows,candidateCoverageThrough:value.candidateCoverageThrough as number,modelVersion:STABLE4_OPPORTUNITY_MODEL_VERSION,sha256:expectedSha256};
}
