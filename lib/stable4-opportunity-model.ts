/** Entry-time shadow scores only; this module never grants order permission. */
export interface Stable4OpportunityCandidate {
 strategy:string;symbol:string;side:"LONG"|"SHORT";route:string;entryTs:number;
 gross:number;expectedHoldHours:number;features:Record<string,number>;
}
export interface Stable4OpportunityLabel extends Stable4OpportunityCandidate {id:string;exitTs:number;net30:number;}
type Stats={mean:number;pwin:number;sd:number;neff:number;n:number};
const DAY=86400000;
const ALLOWED=new Set(["rank","strength","margin","score","sg","state_age_h","onset_momentum90","atr","atrRatio","volumeRatio","pengu72h","btc24h","btc24","rel24","rel12","rel6","rel72","h6","h12","h24","h72","b6","b12","b24","b72","er24","pos24","rv24","brv24","ret6","ret12","ret14","ret24","ret48","ret72","return24h","return48h","return72h","entry_basis_bps","capture_basis_bps"]);
const finite=(v:unknown):v is number=>typeof v==="number"&&Number.isFinite(v);
const mean=(v:number[])=>v.reduce((s,x)=>s+x,0)/v.length;
const median=(v:number[])=>{const a=[...v].sort((a,b)=>a-b),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
/** Reject hindsight fields even when their leaf suffix matches research rules. */
export function extractStable4EntryFeatures(snapshot:unknown):Record<string,number>{
 const out:Record<string,number>={};
 function visit(obj:unknown,prefix=""){
  if(!obj||typeof obj!=="object"||Array.isArray(obj))return;
  for(const [key,value]of Object.entries(obj)){
   if(/exit|realized|outcome|future|pnl/i.test(key))continue;
   const path=prefix?prefix+"."+key:key;
   if(value&&typeof value==="object"&&!Array.isArray(value)){visit(value,path);continue;}
   if(finite(value)&&(ALLOWED.has(key)||/^(?:ret|rel|btc|atr|volume|return)/.test(key)||key.endsWith("_bps")))out[path]=value;
  }
 }
 visit(snapshot);return out;
}
const ENTRY_SCHEMAS:Readonly<Record<string,readonly string[]>>=Object.freeze({
 V4:["rank","sg","state_age_h","onset_momentum90","atr","score"],
 PENGU:["pengu72h","btc24h"],FET:["volumeRatio","return72h"],Q102:["ret14","strength","margin"],
 IDLE:["features.ret12","features.ret24","features.btc24","features.rel24","features.atrRatio","features.volumeRatio"],
 V52:["capture_basis_bps","entry_basis_bps"],
 HYPE:["features.h6","features.h12","features.h24","features.h72","features.b24","features.rel24","features.er24","features.pos24","features.rv24"],
});
export function extractStable4StrategyEntryFeatures(strategy:string,snapshot:unknown):Record<string,number>{
 const schema=ENTRY_SCHEMAS[strategy];if(!schema)throw Error("STABLE4_OPPORTUNITY_STRATEGY_SCHEMA_UNKNOWN");
 const extracted=extractStable4EntryFeatures(snapshot);
 return Object.fromEntries(schema.filter(k=>finite(extracted[k])).map(k=>[k,extracted[k]]));
}
function validate(x:Stable4OpportunityCandidate){
 if(!x||![x.strategy,x.symbol,x.route].every(s=>typeof s==="string"&&s.length>0)||!["LONG","SHORT"].includes(x.side)||!Number.isSafeInteger(x.entryTs)||x.entryTs<=0||!finite(x.gross)||x.gross<=0||!finite(x.expectedHoldHours)||x.expectedHoldHours<=0)throw Error("STABLE4_OPPORTUNITY_CANDIDATE_INVALID");
 if(!x.features||typeof x.features!=="object"||Array.isArray(x.features)||Object.values(x.features).some(v=>!finite(v)))throw Error("STABLE4_OPPORTUNITY_FEATURE_INVALID");
}
function stats(values:{w:number;y:number}[]):Stats|undefined{
 if(!values.length)return;
 const sw=values.reduce((s,x)=>s+x.w,0),sw2=values.reduce((s,x)=>s+x.w*x.w,0);if(!(sw>0&&sw2>0))return;
 const m=values.reduce((s,x)=>s+x.w*x.y,0)/sw;
 return{mean:m,pwin:values.filter(x=>x.y>0).reduce((s,x)=>s+x.w,0)/sw,sd:Math.sqrt(Math.max(0,values.reduce((s,x)=>s+x.w*(x.y-m)**2,0)/sw)),neff:sw*sw/sw2,n:values.length};
}
const weight=(r:Stable4OpportunityLabel,t:number)=>.5**(Math.max(0,(t-r.exitTs)/DAY)/90);
const weighted=(rows:Stable4OpportunityLabel[],t:number)=>stats(rows.map(r=>({w:weight(r,t),y:r.net30})));
function shrink(s:Stats|undefined,b:Stats|undefined):Stats|undefined{
 if(!s||!b)return s;const n=Math.max(0,s.neff);return{...s,mean:(n*s.mean+8*b.mean)/(n+8),pwin:(n*s.pwin+8*b.pwin)/(n+8)};
}
function neighbors(c:Stable4OpportunityCandidate,pool:Stable4OpportunityLabel[]):Stats|undefined{
 const keys=Object.keys(c.features);if(!keys.length||pool.length<6)return;
 const scales:Record<string,number>={};
 for(const k of keys){const v=pool.flatMap(r=>finite(r.features[k])?[r.features[k]]:[]);if(v.length>=5){const m=median(v);scales[k]=Math.max(median(v.map(x=>Math.abs(x-m)))*1.4826,1e-6);}}
 const near=pool.flatMap(r=>{
  const common=keys.filter(k=>finite(r.features[k])&&scales[k]);if(!common.length)return[];
  const distance=Math.sqrt(mean(common.map(k=>((c.features[k]-r.features[k])/scales[k])**2)));
  return[{distance,w:weight(r,c.entryTs)/(.35+distance),y:r.net30}];
 }).sort((a,b)=>a.distance-b.distance);
 return near.length>=5?stats(near.slice(0,12)):undefined;
}
export function scoreStable4Opportunity(candidate:Stable4OpportunityCandidate,labels:readonly Stable4OpportunityLabel[]){
 validate(candidate);
 for(const r of labels){validate(r);if(!Number.isSafeInteger(r.exitTs)||r.exitTs<=r.entryTs||!finite(r.net30))throw Error("STABLE4_OPPORTUNITY_LABEL_CHRONOLOGY_OR_RETURN_INVALID");}
 const pool=labels.filter(r=>r.strategy===candidate.strategy&&r.side===candidate.side&&r.exitTs<candidate.entryTs).sort((a,b)=>a.entryTs-b.entryTs||(a.id<b.id?-1:a.id>b.id?1:0));
 const base=weighted(pool,candidate.entryTs),route=shrink(weighted(pool.filter(r=>r.route===candidate.route),candidate.entryTs),base),symbol=shrink(weighted(pool.filter(r=>r.symbol===candidate.symbol),candidate.entryTs),base),knn=shrink(neighbors(candidate,pool),base);
 const components:Record<string,Stats>={},used:{s:Stats;w:number}[]=[];
 for(const [name,s,mult]of [["strategy",base,.5],["route",route,2],["symbol",symbol,1],["knn",knn,2]] as const)if(s&&s.neff>=1.5){components[name]=s;used.push({s,w:mult*Math.min(12,s.neff)});}
 if(!used.length)return{predEV30:null,predWinProb:null,confidence:null,analogs:0,opportunityScore:null,layer2Promote:false,components};
 const sw=used.reduce((s,x)=>s+x.w,0),avg=(f:(s:Stats)=>number)=>used.reduce((s,x)=>s+f(x.s)*x.w,0)/sw;
 const predEV30=avg(s=>s.mean),predWinProb=avg(s=>s.pwin),sd=avg(s=>s.sd),positive=used.filter(x=>x.s.mean>0).length;
 const agree=Math.max(positive,used.length-positive)/used.length,mxne=Math.max(...used.map(x=>x.s.neff));
 const confidence=(1-Math.exp(-mxne/8))*(.5+.5*agree)*(.65+.35/(1+sd/.04)),analogs=Math.max(...used.map(x=>x.s.n));
 return{predEV30,predWinProb,confidence,analogs,opportunityScore:predEV30*confidence/Math.max(.25,candidate.gross)/Math.max(.25,candidate.expectedHoldHours/24),layer2Promote:predWinProb>=.60&&predEV30>.002&&confidence>=.45&&analogs>=6,components};
}
