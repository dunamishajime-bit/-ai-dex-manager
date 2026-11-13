import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { DISDEX_STABLE4_OPPORTUNITY, type DisDexStable4Mode } from "../config/disdexStable4Opportunity";
import type { Quality102Candle } from "./disdex-quality102-causal-pipeline";
import type { Quality102CausalV1History, Quality102CausalV1Signal } from "./disdex-quality102-causal-v1-signal";
import {
 generateQuality102CausalV4S34Candidates,
 generateQuality102CausalV4S34ShadowCandidates,
 type Quality102CausalV4S34Candidate,
} from "./disdex-quality102-causal-v4-s34";

const HOUR=3_600_000;
const DAY=24*HOUR;
const Q102_RECOVERY_ROUTE="UNI|MR72_Z1.5_H24";
const WEAK_AVAX_ROUTE="AVAX|MR24_Z1.5_H24";
const FEATURE_NAMES=["r6","r12","r24","r72","b24","rel24","rel72","rv24","er24","pos24","atr24","volratio"] as const;

type RecoverySeedRow={id:string;entryTs:number;exitTs:number;symbol:string;side:"LONG"|"SHORT";route:string;net30:number;features:Record<string,number>};
type AvaxSeedRow={entryTs:number;exitTs:number;raw:number;f:number[]};
type PendingRecovery={entryTs:number;exitTs:number;symbol:string;side:"LONG"|"SHORT";route:string;entryPrice:number;hardStop:number;features:Record<string,number>};
type PendingAvax={entryTs:number;exitTs:number;entryPrice:number;f:number[]};
type Stable4OnlineState={schemaVersion:1;updatedAt:number;recoveryRows:RecoverySeedRow[];recoveryPending:PendingRecovery[];avaxRows:AvaxSeedRow[];avaxPending:PendingAvax[];avaxLastSelectedEntryTs?:number};

export type Stable4Q102OnlineProposal={
 signal:Quality102CausalV1Signal;
 kind:"AVAX_KNN"|"UNI_RECOVERY";
 diagnostics:Record<string,number|string|boolean>;
};

export interface Stable4Q102OnlineOptions{
 mode:DisDexStable4Mode;
 recoverySeedPath:string;
 avaxSeedPath:string;
 statePath:string;
 logger?:(message:string,payload?:Record<string,unknown>)=>void;
}

function finite(v:unknown):v is number{return typeof v==="number"&&Number.isFinite(v);}
function mean(v:readonly number[]){return v.reduce((a,b)=>a+b,0)/v.length;}
function pstdev(v:readonly number[]){if(!v.length)return 0;const m=mean(v);return Math.sqrt(v.reduce((s,x)=>s+(x-m)**2,0)/v.length);}
function median(v:readonly number[]){const s=[...v].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}
function candleOpen(history:Quality102CausalV1History,symbol:string,ts:number):number|undefined{
 const current=history.entryOpenBySymbol?.[symbol];
 if(current?.timestampMs===ts&&current.open>0)return current.open;
 const row=history.candlesBySymbol[symbol]?.find((x)=>x.timestampMs===ts);
 return row?.open&&row.open>0?row.open:undefined;
}
function sideName(side:-1|1):"LONG"|"SHORT"{return side>0?"LONG":"SHORT";}

function validateRecoverySeed(value:unknown):RecoverySeedRow[]{
 const root=value as any;if(!root||root.schemaVersion!==1||!Array.isArray(root.rows))throw new Error("STABLE4_Q102_RECOVERY_SEED_INVALID");
 return root.rows.map((z:any)=>{
  if(!z||!finite(z.entryTs)||!finite(z.exitTs)||typeof z.symbol!=="string"||typeof z.route!=="string"||!["LONG","SHORT"].includes(z.side)||!finite(z.net30)||!z.features||typeof z.features!=="object")throw new Error("STABLE4_Q102_RECOVERY_SEED_ROW_INVALID");
  const features:Record<string,number>={};for(const [k,v] of Object.entries(z.features)){if(finite(v))features[k]=v;}
  return {id:String(z.id||""),entryTs:z.entryTs,exitTs:z.exitTs,symbol:z.symbol,side:z.side,route:z.route,net30:z.net30,features};
 });
}
function validateAvaxSeed(value:unknown):AvaxSeedRow[]{
 const root=value as any;if(!root||root.schemaVersion!==1||!Array.isArray(root.rows))throw new Error("STABLE4_Q102_AVAX_SEED_INVALID");
 return root.rows.map((z:any)=>{
  if(!z||!finite(z.entryTs)||!finite(z.exitTs)||!finite(z.raw)||!Array.isArray(z.f)||z.f.length!==FEATURE_NAMES.length||!z.f.every(finite))throw new Error("STABLE4_Q102_AVAX_SEED_ROW_INVALID");
  return {entryTs:z.entryTs,exitTs:z.exitTs,raw:z.raw,f:z.f.map(Number)};
 });
}
function defaultState():Stable4OnlineState{return {schemaVersion:1,updatedAt:0,recoveryRows:[],recoveryPending:[],avaxRows:[],avaxPending:[]};}
function loadState(path:string):Stable4OnlineState{
 if(!existsSync(path))return defaultState();
 const v=JSON.parse(readFileSync(path,"utf8")) as any;
 if(!v||v.schemaVersion!==1||!Array.isArray(v.recoveryRows)||!Array.isArray(v.recoveryPending)||!Array.isArray(v.avaxRows)||!Array.isArray(v.avaxPending))throw new Error("STABLE4_Q102_ONLINE_STATE_INVALID");
 return v as Stable4OnlineState;
}
function saveState(path:string,state:Stable4OnlineState){
 mkdirSync(dirname(path),{recursive:true});
 const tmp=path+"."+process.pid+".tmp";
 writeFileSync(tmp,JSON.stringify(state,null,2)+"\n",{encoding:"utf8",mode:0o600});
 renameSync(tmp,path);
}

function sampleStdev(values:readonly number[]){if(values.length<2)return 0;const m=mean(values);return Math.sqrt(values.reduce((s,x)=>s+(x-m)**2,0)/(values.length-1));}
function avaxFeatures(history:Quality102CausalV1History):{entryTs:number;entryPrice:number;f:number[]}|undefined{
 const a=[...(history.candlesBySymbol.AVAXUSDT||[])].sort((x,y)=>x.timestampMs-y.timestampMs);
 const b=[...(history.candlesBySymbol.BTCUSDT||[])].sort((x,y)=>x.timestampMs-y.timestampMs);
 if(a.length<169||b.length<169)return undefined;
 const last=a.at(-1)!;const entry=history.entryOpenBySymbol?.AVAXUSDT;
 if(!entry||entry.timestampMs!==last.timestampMs+HOUR||!(entry.open>0))return undefined;
 if(last.timestampMs%(6*HOUR)!==0)return undefined;
 const bm=new Map(b.map(x=>[x.timestampMs,x]));
 const i=a.length-1;
 for(let j=i-168;j<=i;j++){if(j>0&&a[j].timestampMs-a[j-1].timestampMs!==HOUR)return undefined;if(!bm.get(a[j].timestampMs))return undefined;}
 const c=a.map(x=>x.close),hi=a.map(x=>x.high),lo=a.map(x=>x.low),vol=a.map(x=>x.quoteVolume);
 const bc=a.map(x=>bm.get(x.timestampMs)?.close??NaN);
 const ret=(arr:number[],n:number)=>arr[i]/arr[i-n]-1;
 const rr=Array.from({length:24},(_,k)=>c[i-23+k]/c[i-24+k]-1);
 const tr=Array.from({length:24},(_,k)=>{const j=i-23+k;return Math.max(hi[j]-lo[j],Math.abs(hi[j]-c[j-1]),Math.abs(lo[j]-c[j-1]))/c[j];});
 const net=Math.abs(ret(c,24));const path=rr.reduce((s,x)=>s+Math.abs(x),0);
 const low=Math.min(...lo.slice(i-23,i+1)),high=Math.max(...hi.slice(i-23,i+1));
 const v6=vol.slice(i-5,i+1).reduce((s,x)=>s+x,0),v36=vol.slice(i-41,i-5).reduce((s,x)=>s+x,0);
 const f=[ret(c,6),ret(c,12),ret(c,24),ret(c,72),ret(bc,24),ret(c,24)-ret(bc,24),ret(c,72)-ret(bc,72),pstdev(rr),path?net/path:0,high>low?(c[i]-low)/(high-low):0.5,mean(tr),v36>0?v6/v36*6:1];
 if(!f.every(finite))return undefined;
 return {entryTs:entry.timestampMs,entryPrice:entry.open,f};
}

function s34Candidates(history:Quality102CausalV1History):Quality102CausalV4S34Candidate[]{
 const out:Quality102CausalV4S34Candidate[]=[];
 for(const [symbol,rows] of Object.entries(history.candlesBySymbol)){
  const entry=history.entryOpenBySymbol?.[symbol];if(!entry||!rows?.length)continue;
  try{out.push(...generateQuality102CausalV4S34Candidates({symbol,rows,entryOpen:entry}));}catch{}
 }
 const layerRank={S3:0,S4:1} as const;const familyRank={PB:0,MR:1,BRK:2,REV:3} as const;
 return out.sort((a,b)=>(layerRank[a.layer]-layerRank[b.layer])||(familyRank[a.family]-familyRank[b.family])||(b.margin-a.margin)||a.key.localeCompare(b.key));
}
function shadowS34Candidates(history:Quality102CausalV1History):Quality102CausalV4S34Candidate[]{
 const out:Quality102CausalV4S34Candidate[]=[];
 for(const [symbol,rows] of Object.entries(history.candlesBySymbol)){
  if(symbol==="BTCUSDT")continue;
  const entryOpen=history.entryOpenBySymbol?.[symbol];if(!entryOpen||!rows?.length)continue;
  try{out.push(...generateQuality102CausalV4S34ShadowCandidates({symbol,rows,entryOpen}));}catch{}
 }
 return out;
}
function currentUniCandidate(history:Quality102CausalV1History){return shadowS34Candidates(history).find(x=>x.key===Q102_RECOVERY_ROUTE);}
function featureMap(c:Quality102CausalV4S34Candidate):Record<string,number>{return {ret14:c.ret14,strength:c.strength,margin:c.margin};}

type WStats={mean:number;pwin:number;sd:number;neff:number;n:number};
function weightedStats(rows:readonly RecoverySeedRow[],t:number):WStats|undefined{
 if(!rows.length)return undefined;const vals=rows.map(r=>{const age=Math.max(0,(t-r.exitTs)/DAY);return {w:0.5**(age/90),y:r.net30};});
 const sw=vals.reduce((s,x)=>s+x.w,0),sw2=vals.reduce((s,x)=>s+x.w*x.w,0);if(!(sw>0))return undefined;
 const m=vals.reduce((s,x)=>s+x.w*x.y,0)/sw,p=vals.filter(x=>x.y>0).reduce((s,x)=>s+x.w,0)/sw;
 const sd=Math.sqrt(vals.reduce((s,x)=>s+x.w*(x.y-m)**2,0)/sw);return {mean:m,pwin:p,sd,neff:sw2?sw*sw/sw2:0,n:vals.length};
}
function shrink(st:WStats|undefined,base:WStats|undefined,prior=8):WStats|undefined{
 if(!st)return undefined;if(!base)return st;const n=Math.max(0,st.neff);
 return {mean:(n*st.mean+prior*base.mean)/(n+prior),pwin:(n*st.pwin+prior*base.pwin)/(n+prior),sd:st.sd,neff:n,n:st.n};
}
function knnStats(candidate:Quality102CausalV4S34Candidate,rows:readonly RecoverySeedRow[],t:number):WStats|undefined{
 const fx=featureMap(candidate);const pool=rows.filter(r=>r.side===sideName(candidate.side));if(pool.length<6)return undefined;
 const scales:Record<string,{med:number;scale:number}>={};
 for(const k of Object.keys(fx)){const vals=pool.flatMap(r=>finite(r.features[k])?[r.features[k]]:[]);if(vals.length>=5){const med=median(vals);const mad=median(vals.map(v=>Math.abs(v-med)));scales[k]={med,scale:Math.max(mad*1.4826,1e-6)};}}
 const c=pool.flatMap(r=>{const common=Object.keys(fx).filter(k=>finite(r.features[k])&&scales[k]);if(!common.length)return[];const d=Math.sqrt(mean(common.map(k=>((fx[k]-r.features[k])/scales[k].scale)**2)));const age=Math.max(0,(t-r.exitTs)/DAY);return[{d,w:(0.5**(age/90))/(0.35+d),y:r.net30}];}).sort((a,b)=>a.d-b.d).slice(0,12);
 if(c.length<5)return undefined;const sw=c.reduce((s,x)=>s+x.w,0),sw2=c.reduce((s,x)=>s+x.w*x.w,0);const m=c.reduce((s,x)=>s+x.w*x.y,0)/sw,p=c.filter(x=>x.y>0).reduce((s,x)=>s+x.w,0)/sw;const sd=Math.sqrt(c.reduce((s,x)=>s+x.w*(x.y-m)**2,0)/sw);return{mean:m,pwin:p,sd,neff:sw2?sw*sw/sw2:0,n:c.length};
}

export class Stable4Q102OnlineEngine{
 private readonly mode:DisDexStable4Mode;
 private readonly logger:(m:string,p?:Record<string,unknown>)=>void;
 private readonly recoverySeed:RecoverySeedRow[];
 private readonly avaxSeed:AvaxSeedRow[];
 private state:Stable4OnlineState;
 private healthy=true;
 constructor(private readonly options:Stable4Q102OnlineOptions){
  this.mode=options.mode;this.logger=options.logger||(()=>undefined);
  this.recoverySeed=validateRecoverySeed(JSON.parse(readFileSync(options.recoverySeedPath,"utf8")));
  this.avaxSeed=validateAvaxSeed(JSON.parse(readFileSync(options.avaxSeedPath,"utf8")));
  this.state=loadState(options.statePath);
 }
 isHealthy(){return this.healthy;}
 private allRecoveryRows(t:number){const m=new Map<number,RecoverySeedRow>();for(const r of [...this.recoverySeed,...this.state.recoveryRows])if(r.exitTs<t)m.set(r.entryTs,r);return[...m.values()].sort((a,b)=>a.entryTs-b.entryTs);}
 private allAvaxRows(t:number){const m=new Map<number,AvaxSeedRow>();for(const r of [...this.avaxSeed,...this.state.avaxRows])if(r.exitTs<=t)m.set(r.entryTs,r);return[...m.values()].sort((a,b)=>a.entryTs-b.entryTs);}
 private persist(){this.state.updatedAt=Date.now();saveState(this.options.statePath,this.state);}
 observe(history:Quality102CausalV1History,decisionTs:number){
  if(this.mode==="OFF"||!this.healthy)return;
  try{
   let changed=false;
   const remainingRecovery:PendingRecovery[]=[];
   for(const q of this.state.recoveryPending){
    const xp=candleOpen(history,q.symbol,q.exitTs);
    if(xp===undefined){remainingRecovery.push(q);continue;}
    let raw=q.side==="LONG"?xp/q.entryPrice-1:1-xp/q.entryPrice;
    const rows=history.candlesBySymbol[q.symbol]||[];
    const stop=q.side==="LONG"?q.entryPrice*(1-q.hardStop):q.entryPrice*(1+q.hardStop);
    const between=rows.filter(x=>x.timestampMs>=q.entryTs&&x.timestampMs<q.exitTs);
    if(q.side==="LONG"&&between.some(x=>x.low<=stop))raw=-q.hardStop;
    if(q.side==="SHORT"&&between.some(x=>x.high>=stop))raw=-q.hardStop;
    this.state.recoveryRows.push({id:"LIVE:"+q.route+":"+q.entryTs,entryTs:q.entryTs,exitTs:q.exitTs,symbol:q.symbol,side:q.side,route:q.route,net30:raw-.003,features:q.features});changed=true;
   }
   this.state.recoveryPending=remainingRecovery;
   const remainingAvax:PendingAvax[]=[];
   for(const q of this.state.avaxPending){const xp=candleOpen(history,"AVAXUSDT",q.exitTs);if(xp===undefined){remainingAvax.push(q);continue;}this.state.avaxRows.push({entryTs:q.entryTs,exitTs:q.exitTs,raw:xp/q.entryPrice-1,f:q.f});changed=true;}
   this.state.avaxPending=remainingAvax;

   const recoveryShadow=currentUniCandidate(history);
   if(recoveryShadow&&recoveryShadow.maxHoldHours===24&&!this.state.recoveryPending.some(x=>x.entryTs===recoveryShadow.entryTs)&&!this.state.recoveryRows.some(x=>x.entryTs===recoveryShadow.entryTs)){
    const entry=history.entryOpenBySymbol?.[recoveryShadow.symbol];
    if(entry?.timestampMs===recoveryShadow.entryTs&&entry.open>0){this.state.recoveryPending.push({entryTs:recoveryShadow.entryTs,exitTs:recoveryShadow.entryTs+24*HOUR,symbol:recoveryShadow.symbol,side:sideName(recoveryShadow.side),route:recoveryShadow.key,entryPrice:entry.open,hardStop:recoveryShadow.hardStop,features:featureMap(recoveryShadow)});changed=true;}
   }
   const av=avaxFeatures(history);
   if(av&&!this.state.avaxPending.some(x=>x.entryTs===av.entryTs)&&!this.state.avaxRows.some(x=>x.entryTs===av.entryTs)){
    this.state.avaxPending.push({entryTs:av.entryTs,exitTs:av.entryTs+24*HOUR,entryPrice:av.entryPrice,f:av.f});changed=true;
   }
   if(changed)this.persist();
  }catch(error){this.healthy=false;this.logger("STABLE4 Q102 online observer fail-closed",{message:error instanceof Error?error.message:String(error)});throw error;}
 }
 private avaxProposal(history:Quality102CausalV1History):Stable4Q102OnlineProposal|undefined{
  const av=avaxFeatures(history);if(!av)return undefined;
  if(this.state.avaxLastSelectedEntryTs&&av.entryTs<this.state.avaxLastSelectedEntryTs+24*HOUR)return undefined;
  const hist=this.allAvaxRows(av.entryTs);if(hist.length<40)return undefined;
  const means=FEATURE_NAMES.map((_,j)=>mean(hist.map(r=>r.f[j]))),std=FEATURE_NAMES.map((_,j)=>{const s=pstdev(hist.map(r=>r.f[j]));return s<1e-8?1:s;});
  const near=hist.map(r=>({r,d:Math.sqrt(mean(r.f.map((v,j)=>((v-means[j])/std[j]-(av.f[j]-means[j])/std[j])**2)))})).sort((a,b)=>a.d-b.d).slice(0,DISDEX_STABLE4_OPPORTUNITY.q102.avaxK);
  const pred=mean(near.map(x=>x.r.raw));if(Math.abs(pred)<DISDEX_STABLE4_OPPORTUNITY.q102.avaxPredThreshold)return undefined;
  const side:1|-1=pred>0?1:-1;const agree=near.filter(x=>(x.r.raw>0?1:-1)===side).length/near.length;if(agree<DISDEX_STABLE4_OPPORTUNITY.q102.avaxAgreementMin)return undefined;
  return {kind:"AVAX_KNN",diagnostics:{pred,agree,n:hist.length},signal:{strategyId:"QUALITY102_CAUSAL_V1",referenceTs:av.entryTs,side,symbol:"AVAXUSDT",family:"MR",variant:"STABLE4_ONLINE_KNN_Q01365",layer:"S3",requestedGross:DISDEX_STABLE4_OPPORTUNITY.q102.avaxGross,reason:"STABLE4_Q102_AVAX_ONLINE_KNN",dataCutoffTs:av.entryTs-HOUR,hardStop:DISDEX_STABLE4_OPPORTUNITY.q102.avaxHardStop,maxHoldHours:24,exitPolicy:"STABLE4_STOP5_TP3_H24",brkEnabled:false}};
 }
 private recoveryProposal(history:Quality102CausalV1History,blocked?:Quality102CausalV4S34Candidate):Stable4Q102OnlineProposal|undefined{
  const c=blocked?.key===Q102_RECOVERY_ROUTE?blocked:currentUniCandidate(history);if(!c||c.key!==Q102_RECOVERY_ROUTE||c.side!==-1)return undefined;
  const t=c.entryTs,rows=this.allRecoveryRows(t);const sameSide=rows.filter(r=>r.side==="SHORT");const base=weightedStats(sameSide,t);if(!base)return undefined;
  const route=shrink(weightedStats(sameSide.filter(r=>r.route===c.key),t),base);const symbol=shrink(weightedStats(sameSide.filter(r=>r.symbol===c.symbol),t),base);const knn=shrink(knnStats(c,rows,t),base);
  const comps:[string,WStats|undefined,number][]=[["strategy",base,.5],["route",route,2],["symbol",symbol,1],["knn",knn,2]];
  const used=comps.filter(([,st])=>st&&st.neff>=1.5) as [string,WStats,number][];if(!used.length)return undefined;
  const weighted=used.map(([name,st,mult])=>({name,st,w:mult*Math.min(12,st.neff)})),sw=weighted.reduce((s,x)=>s+x.w,0);
  const ev=weighted.reduce((s,x)=>s+x.st.mean*x.w,0)/sw,pwin=weighted.reduce((s,x)=>s+x.st.pwin*x.w,0)/sw,sd=weighted.reduce((s,x)=>s+x.st.sd*x.w,0)/sw;
  const positives=weighted.filter(x=>x.st.mean>0).length,agree=Math.max(positives,weighted.length-positives)/weighted.length,mxne=Math.max(...weighted.map(x=>x.st.neff));
  const conf=(1-Math.exp(-mxne/8))*(.5+.5*agree)*(.65+.35/(1+sd/.04));const analogs=Math.max(...weighted.map(x=>x.st.n));
  const opportunityScore=ev*conf/Math.min(DISDEX_STABLE4_OPPORTUNITY.q102.recoveryGrossCap,.75);
  if(pwin<DISDEX_STABLE4_OPPORTUNITY.q102.recoveryPredWinMin||ev<=DISDEX_STABLE4_OPPORTUNITY.q102.recoveryPredEv30Min||conf<DISDEX_STABLE4_OPPORTUNITY.q102.recoveryConfidenceMin||analogs<DISDEX_STABLE4_OPPORTUNITY.q102.recoveryAnalogsMin)return undefined;
  const exactRoute=rows.filter(r=>r.route===c.key&&r.side==="SHORT").sort((a,b)=>a.entryTs-b.entryTs);if(exactRoute.length<DISDEX_STABLE4_OPPORTUNITY.q102.recoveryRouteCompletedMin)return undefined;
  const routeMean=mean(exactRoute.map(r=>r.net30)),routeP=exactRoute.filter(r=>r.net30>0).length/exactRoute.length;if(routeMean<=0||routeP<DISDEX_STABLE4_OPPORTUNITY.q102.recoveryRouteWinMin)return undefined;
  const r5=exactRoute.slice(-5),r6=exactRoute.slice(-6);if(r5.length<5||r6.length<6||mean(r5.map(r=>r.net30))<=DISDEX_STABLE4_OPPORTUNITY.q102.recoveryRecentMeanMin||mean(r6.map(r=>r.net30))<=DISDEX_STABLE4_OPPORTUNITY.q102.recoveryRecentMeanMin)return undefined;
  return {kind:"UNI_RECOVERY",diagnostics:{ev,pwin,confidence:conf,analogs,opportunityScore,routeN:exactRoute.length,routeMean,routeP,recent5:mean(r5.map(r=>r.net30)),recent6:mean(r6.map(r=>r.net30))},signal:{strategyId:"QUALITY102_CAUSAL_V1",referenceTs:c.entryTs,side:c.side,symbol:c.symbol,family:c.family,variant:c.variant,layer:c.layer,requestedGross:Math.min(DISDEX_STABLE4_OPPORTUNITY.q102.recoveryGrossCap,.75),reason:"STABLE4_Q102_UNI_ONLINE_RECOVERY",dataCutoffTs:c.dataCutoffTs,hardStop:c.hardStop,maxHoldHours:c.maxHoldHours,exitPolicy:c.exitPolicy,brkEnabled:false}};
 }
 select(nativeSignal:Quality102CausalV1Signal,history:Quality102CausalV1History,decisionTs:number):{signal:Quality102CausalV1Signal;proposal?:Stable4Q102OnlineProposal}{
  if(this.mode==="OFF")return{signal:nativeSignal};
  try{
   this.observe(history,decisionTs);
   const proposal=this.propose(history);
   this.logger("STABLE4 Q102 online decision",{mode:this.mode,nativeReason:nativeSignal.reason,nativeSymbol:nativeSignal.symbol,nativeVariant:nativeSignal.variant,proposalKind:proposal?.kind,proposalDiagnostics:proposal?.diagnostics});
   if(this.mode==="SHADOW")return{signal:nativeSignal,proposal};
   const nativeKey=nativeSignal.symbol&&nativeSignal.variant?(nativeSignal.symbol.replace(/USDT$/,"")+"|"+nativeSignal.variant):undefined;
   const weakNative=Boolean(nativeKey&&STABLE4_Q102_WEAK_ROUTES.has(nativeKey));
   if(nativeSignal.side!==0&&!weakNative)return{signal:nativeSignal,proposal};
   if(proposal)return{signal:proposal.signal,proposal};
   if(weakNative)return{signal:{strategyId:"QUALITY102_CAUSAL_V1",referenceTs:nativeSignal.referenceTs,side:0,requestedGross:0,reason:"STABLE4_Q102_WEAK_ROUTE_WAIT",dataCutoffTs:nativeSignal.dataCutoffTs,brkEnabled:true}};
   return{signal:nativeSignal};
  }catch(error){
   if(this.mode==="SHADOW"){
    this.logger("STABLE4 Q102 shadow observer degraded; native signal preserved",{message:error instanceof Error?error.message:String(error)});
    return{signal:nativeSignal};
   }
   throw error;
  }
 }
 propose(history:Quality102CausalV1History,blocked?:Quality102CausalV4S34Candidate):Stable4Q102OnlineProposal|undefined{
  if(this.mode==="OFF"||!this.healthy)return undefined;
  const recovery=this.recoveryProposal(history,blocked);if(recovery)return recovery;
  return this.avaxProposal(history);
 }
}

export const STABLE4_Q102_WEAK_ROUTES=Object.freeze(new Set([WEAK_AVAX_ROUTE,Q102_RECOVERY_ROUTE]));
