/** Isolated causal M5 price model for selected Q102 signals. No venue or order authority. */
import {readFileSync,writeFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {applyQ102ProfitFloorBar,type Q102ProfitFloorState} from "../lib/disdex-exit-overlay-contract";
import {advanceQ102HighVolShortProfitFloor,evaluateQ102HighVolLongH1Loss,evaluateQ102PbLongInitialAdverse,favorableGainPct,type Q102ProfitFloorStageState} from "../lib/disdex-quality102-adopted-exit-policy";
import {QUALITY102_HIGH_VOL_TRAIL_TRIGGER,QUALITY102_HIGH_VOL_TRAIL_DISTANCE,type Quality102Candle} from "../lib/disdex-quality102-causal-pipeline";
import type {Quality102CausalV1Signal} from "../lib/disdex-quality102-causal-v1-signal";
const M=300000,H=3600000,END=Date.UTC(2026,9,1);
const [root,output]=process.argv.slice(2);if(!root||!output)throw Error("INPUT_REQUIRED");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const path="docs/research/STABLE4_Q102_FULL_UNIVERSE_ALL_READY_CLOCK_SCREEN_20261128.json";
const raw=readFileSync(path);
if(sha(raw)!=="8bcaa800393b4cd920c3524f0ba242bc482c54fa05564ed4c8b53276a49864f0")throw Error("LEDGER_SHA");
const ledger=JSON.parse(raw.toString("utf8"));
if(ledger.orderAuthority!==false||ledger.fullQ102AnnualReplay!==false||ledger.readyClocks!==942||ledger.observations.length!==96)throw Error("LEDGER_SCOPE");
for(const [p,d] of Object.entries(ledger.sourcePins))if(sha(readFileSync(p))!==d)throw Error("SOURCE_SHA:"+p);
const events:{decisionTs:number;signal:Quality102CausalV1Signal}[]=ledger.observations.filter((x:any)=>x.signal.side!==0);
if(events.length!==38||events.filter(x=>x.signal.family==="HIGH_VOL").length!==9)throw Error("COUNT");
type Bar={timestampMs:number;open:number;high:number;low:number;close:number;volume:number};
const tapes=new Map<string,Map<number,Bar|null>>(),h1=new Map<string,Map<number,Quality102Candle|null>>();
const files:unknown[]=[];
for(const symbol of [...new Set(events.map(x=>x.signal.symbol!))].sort()){
 const tape=new Map<number,Bar|null>();tapes.set(symbol,tape);
 for(const folder of ["aster-public-v3-5m-prefix","aster-public-v3-5m-suffix"]){
  const names=readdirSync(resolve(root,folder)).filter(n=>n.startsWith(symbol+"-5m-")&&n.endsWith(".jsonl.gz"));
  if(names.length>1)throw Error("M5_ARCHIVE_AMBIGUOUS");if(!names.length)continue;
  const b=readFileSync(resolve(root,folder,names[0]));let n=0;
  for(const line of gunzipSync(b).toString("utf8").split(/\r?\n/).filter(Boolean)){
   const r=JSON.parse(line);const [timestampMs,open,high,low,close,volume,closeTs,quoteVolume,trades]=r.slice(0,9).map(Number);
   const valid=Number.isSafeInteger(timestampMs)&&timestampMs%M===0&&closeTs===timestampMs+M-1&&[open,high,low,close,volume,quoteVolume,trades].every(Number.isFinite)&&Math.min(open,low,close)>0&&low<=Math.min(open,close)&&high>=Math.max(open,close)&&volume>=0&&quoteVolume>=0&&Number.isSafeInteger(trades)&&trades>=0&&(volume===0)===(trades===0);
   tape.set(timestampMs,tape.has(timestampMs)||!valid?null:{timestampMs,open,high,low,close,volume});n++;
  }
  files.push({symbol,folder,file:names[0],sha256:sha(b),rows:n});
 }
 if(!events.some(e=>e.signal.symbol===symbol&&e.signal.family==="HIGH_VOL"&&e.signal.side===1))continue;
 const hour=new Map<number,Quality102Candle|null>();h1.set(symbol,hour);
 for(const meta of ledger.files.filter((x:any)=>x.symbol===symbol)){
  const b=readFileSync(resolve(root,meta.folder,meta.file));if(sha(b)!==meta.sha256)throw Error("H1_INPUT_SHA");
  for(const line of gunzipSync(b).toString("utf8").split(/\r?\n/).filter(Boolean)){
   const r=JSON.parse(line);const [timestampMs,open,high,low,close,baseVolume,closeTs,quoteVolume]=r.slice(0,8).map(Number);
   const ok=Number.isSafeInteger(timestampMs)&&timestampMs%H===0&&closeTs===timestampMs+H-1&&[open,high,low,close,baseVolume,quoteVolume].every(Number.isFinite)&&Math.min(open,low,close)>0&&low<=Math.min(open,close)&&high>=Math.max(open,close)&&baseVolume>=0&&quoteVolume>=0;
   hour.set(timestampMs,hour.has(timestampMs)||!ok?null:{timestampMs,open,high,low,close,baseVolume,quoteVolume});
  }
  files.push({...meta,kind:"H1_FOR_ADOPTED_EXIT"});
 }
}
type Outcome={status:string;entryPrice?:number;exitPrice?:number;exitTs?:number;reason?:string;zeroVolumeBars?:number;floorStage?:number;maxFavorablePct?:number;observedThrough?:number};
function model(e:typeof events[number]):Outcome{
 const s=e.signal,t=e.decisionTs,side=s.side===1?"LONG":"SHORT",long=s.side===1;
 if(!s.symbol||s.dataCutoffTs!==t-H||s.referenceTs!==t||![1,-1].includes(s.side)||!(s.hardStop!>0&&s.hardStop!<1)||!(s.maxHoldHours!>0)||!["FIXED_HOLD_STOP","HIGH_VOL_TRAIL72"].includes(s.exitPolicy!))throw Error("SIGNAL_CONTRACT");
 const tape=tapes.get(s.symbol)!,first=tape.get(t),until=t+s.maxHoldHours!*H;
 if(!first)return {status:"ENTRY_M5_MISSING_OR_INVALID"};
 if(first.volume===0)return {status:"ENTRY_M5_ZERO_VOLUME"};
 const entryPrice=first.open,base=entryPrice*(1-s.side*s.hardStop!);
 let ordinary:Q102ProfitFloorState|undefined,staged:Q102ProfitFloorStageState|undefined,best=entryPrice,zero=0,trail=false;
 const closedH1:Quality102Candle[]=[];
 const mfe=()=>favorableGainPct(side,entryPrice,best);
 const result=(exitTs:number,exitPrice:number,reason:string):Outcome=>({status:"MODELED_EXIT_NOT_FILL",entryPrice,exitPrice,exitTs,reason,zeroVolumeBars:zero,floorStage:staged?.stage??(ordinary?.armed?1:0),maxFavorablePct:mfe()});
 const unresolved=(status:string,k:number):Outcome=>({status,entryPrice,zeroVolumeBars:zero,observedThrough:k,floorStage:staged?.stage??(ordinary?.armed?1:0),maxFavorablePct:mfe()});
 for(let k=t;k<until&&k<END;k+=M){
  const b=tape.get(k);if(!b)return unresolved("HOLD_M5_MISSING_OR_INVALID",k);
  if(!b.volume)zero++;
  const activeFloor=staged?.stopPrice??ordinary?.stopPrice;
  const stop=activeFloor===undefined?base:long?Math.max(base,activeFloor):Math.min(base,activeFloor);
  if(long?b.low<=stop:b.high>=stop){
   if(!b.volume)return unresolved("ZERO_VOLUME_STOP_TOUCH_UNPROVEN",k);
   return result(k+M,long?Math.min(b.open,stop):Math.max(b.open,stop),stop===base?"HARD_STOP":staged?.stage===2?"PROFIT_FLOOR_1P0":"PROFIT_FLOOR_0P5");
  }
  // A confirmed close arms protection only for subsequent bars.
  if(s.family==="HIGH_VOL"&&!long){
   const a=advanceQ102HighVolShortProfitFloor({family:s.family,side,entryPrice,state:staged,bar:{...b,timestampMs:k+M}});
   if(a.stopHit){if(!b.volume)return unresolved("ZERO_VOLUME_STOP_TOUCH_UNPROVEN",k);return result(k+M,a.triggerPrice!,a.state.stage===2?"PROFIT_FLOOR_1P0":"PROFIT_FLOOR_0P5");}staged=a.state;
  }else{
   const a=applyQ102ProfitFloorBar({side,entryPrice,state:ordinary,bar:{...b,timestampMs:k+M}});
   if(a.stopHit){if(!b.volume)return unresolved("ZERO_VOLUME_STOP_TOUCH_UNPROVEN",k);return result(k+M,a.triggerPrice!,"PROFIT_FLOOR_0P5");}ordinary=a.state;
  }
  const now=k+M;
  if(s.family==="HIGH_VOL"&&long&&now%H===0){
   const h=h1.get(s.symbol)?.get(now-H);if(!h)return unresolved("H1_ADOPTED_EXIT_HISTORY_UNAVAILABLE",now);closedH1.push(h);
  }
  if(!b.volume)continue;
  // Model observed mid quote by positive-volume M5 close only, not intrabar best.
  best=long?Math.max(best,b.close):Math.min(best,b.close);
  if(s.exitPolicy==="HIGH_VOL_TRAIL72"){
   trail=trail||mfe()>=QUALITY102_HIGH_VOL_TRAIL_TRIGGER-1e-15;
   const trailPx=long?best*(1-QUALITY102_HIGH_VOL_TRAIL_DISTANCE):best*(1+QUALITY102_HIGH_VOL_TRAIL_DISTANCE);
   if(trail&&(long?b.close<=trailPx:b.close>=trailPx))return result(now,b.close,"TRAIL_5P_AFTER_12P");
  }
  if(now>=until)return result(now,b.close,"TIME");
  const pb=evaluateQ102PbLongInitialAdverse({family:s.family,side,entryPrice,entryTs:t,now,markPrice:b.close,maxFavorablePct:mfe()});
  if(pb)return result(now,b.close,pb);
  const hv=evaluateQ102HighVolLongH1Loss({family:s.family,side,entryPrice,entryTs:t,now,candles:closedH1});
  if(hv.reason)return result(now,b.close,hv.reason);
 }
 return unresolved(until>=END?"STUDY_END_OPEN_POSITION":"TIME_EXIT_PRICE_UNAVAILABLE",Math.min(until,END));
}
const rows=events.map(e=>({entryTs:e.decisionTs,signal:e.signal,...model(e)}));
const aggregate=(r:typeof rows)=>{const status:Record<string,number>={},reasons:Record<string,number>={};for(const x of r){status[x.status]=(status[x.status]??0)+1;if(x.reason)reasons[x.reason]=(reasons[x.reason]??0)+1;}return {count:r.length,status,reasons};};
const summary={all:aggregate(rows),highVol:aggregate(rows.filter(r=>r.signal.family==="HIGH_VOL")),s34:aggregate(rows.filter(r=>r.signal.family!=="HIGH_VOL"))};
const pins=Object.fromEntries(["scripts/stable4-q102-selected-native-exit-model.ts","lib/disdex-quality102-causal-v1-runner.ts","lib/disdex-quality102-adopted-exit-policy.ts","lib/disdex-exit-overlay-contract.ts","lib/disdex-quality102-causal-pipeline.ts"].map(p=>[p,sha(readFileSync(p))]));
writeFileSync(output,JSON.stringify({schema:"stable4-q102-selected-native-exit-model/v1",status:"PARTIAL_SELECTED_NATIVE_EXIT_PRICE_MODEL_ONLY",sourcePins:pins,inputLedgerSha256:sha(raw),files,summary,rows,orderAuthority:false,fullQ102AnnualReplay:false,limitations:["Assumed selected signals with other sleeves idle; adopted overlays enabled according to repository wiring, not attested LIVE config","Confirmed M5 profit-floor and H1 loss/PB adverse helpers used directly; quote-based trail, MFE and timed exits approximated with positive-volume M5 close. Resident stops modeled from OHLC touches, gap-aware open, with next-bar floor activation; zero-volume touch unresolved. No intrabar quote path or venue read-back proof","Entry M5 open with retrospective positive volume is a hypothetical price; no actual quote/lot/order/fill, no funding or shared risk. Time uses close proxy at deadline. Zero-volume or missing time price unresolved, no invented exit","No one-slot portfolio or PnL certification"]},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(summary));
