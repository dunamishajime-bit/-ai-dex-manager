/** Offline raw S34 candidate delayed-M5-confirmation exit scenarios; no next-bar lookahead. Never a fill or portfolio replay. */
import {readFileSync,writeFileSync,readdirSync} from "node:fs";
import {resolve} from "node:path";
import {gunzipSync} from "node:zlib";
import {createHash} from "node:crypto";
import {applyQ102ProfitFloorBar,type Q102ProfitFloorState} from "../lib/disdex-exit-overlay-contract";
import type {Quality102CausalV4S34Candidate} from "../lib/disdex-quality102-causal-v4-s34";
const M=300000,H=3600000,END=Date.UTC(2026,9,1);
const [root,output]=process.argv.slice(2);if(!root||!output)throw Error("INPUT_REQUIRED");
const sha=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const ledgerPath="docs/research/STABLE4_Q102_S34_ANNUAL_SOURCE_INVENTORY_20261128.json";
const rawLedger=readFileSync(ledgerPath);
if(sha(rawLedger)!=="04209f9c8e49d8fcb781f6aa2afa7a16952dd9a3f2e876866ee1fa40bf73eeac")throw Error("S34_LEDGER_PIN_MISMATCH");
const ledger=JSON.parse(rawLedger.toString("utf8"));
if(ledger.orderAuthority!==false||ledger.fullQ102AnnualReplay!==false||ledger.events.length!==520)throw Error("S34_SCOPE");
for(const [p,d] of Object.entries(ledger.sourcePins)){if(sha(readFileSync(p))!==d)throw Error("S34_SOURCE_PIN_MISMATCH:"+p);}
const events:Quality102CausalV4S34Candidate[]=ledger.events;
type Bar={timestampMs:number;open:number;high:number;low:number;close:number;volume:number};
const tapes=new Map<string,Map<number,Bar|null>>();
const files:unknown[]=[];
for(const symbol of [...new Set(events.map(c=>c.symbol))].sort()){
 const tape=new Map<number,Bar|null>();tapes.set(symbol,tape);
 for(const folder of ["aster-public-v3-5m-prefix","aster-public-v3-5m-suffix"]){
  const names=readdirSync(resolve(root,folder)).filter(n=>n.startsWith(symbol+"-5m-")&&n.endsWith(".jsonl.gz"));
  if(names.length!==1)throw Error("M5_ARCHIVE_COUNT:"+symbol+":"+folder);
  const raw=readFileSync(resolve(root,folder,names[0]));let n=0;
  for(const line of gunzipSync(raw).toString("utf8").split(/\r?\n/).filter(Boolean)){
   const r=JSON.parse(line);const [timestampMs,open,high,low,close,volume,closeTs,quoteVolume,trades]=r.slice(0,9).map(Number);
   const valid=Number.isSafeInteger(timestampMs)&&timestampMs%M===0&&closeTs===timestampMs+M-1&&[open,high,low,close,volume,quoteVolume,trades].every(Number.isFinite)&&low>0&&open>0&&close>0&&low<=Math.min(open,close)&&high>=Math.max(open,close)&&volume>=0&&quoteVolume>=0&&Number.isSafeInteger(trades)&&trades>=0&&(volume===0)===(trades===0);
   tape.set(timestampMs,tape.has(timestampMs)||!valid?null:{timestampMs,open,high,low,close,volume});n++;
  }
  files.push({symbol,folder,file:names[0],sha256:sha(raw),rows:n});
 }
}
type Outcome={status:string;exitTs?:number;entryPrice?:number;exitPrice?:number;reason?:string;zeroVolumeBars?:number;modelEntryTs?:number;followingM5VolumePositiveExPost?:boolean};
function scenario(c:Quality102CausalV4S34Candidate,overlay:boolean):Outcome{
 const tape=tapes.get(c.symbol)!;const t=c.entryTs;
 if(c.exitPolicy!=="FIXED_HOLD_STOP"||![1,-1].includes(c.side)||!(c.hardStop>0&&c.hardStop<1)||!Number.isSafeInteger(c.maxHoldHours) )return {status:"BOUNDARY_OR_POLICY_UNAVAILABLE"};
 // At t, the M5 OHLCV bar is UNFINISHED. The t+5m open is only an
 // observed model price AFTER the t-bar closes, with no venue fill proof.
 const confirm=tape.get(t);if(!confirm)return {status:"ENTRY_CONFIRMATION_M5_MISSING_OR_INVALID"};
 if(confirm.volume<=0)return {status:"ENTRY_CONFIRMED_M5_ZERO_VOLUME"};
 const modelEntryTs=t+M;
 const entryBar=tape.get(modelEntryTs);
 if(!entryBar)return {status:"FOLLOWING_M5_OPEN_MISSING_OR_INVALID"};
 const entryPrice=entryBar.open,side=c.side===1?"LONG":"SHORT",base=entryPrice*(1-c.side*c.hardStop);
 const until=modelEntryTs+c.maxHoldHours*H;
 if(until>=END)return {status:"BOUNDARY_OR_POLICY_UNAVAILABLE"};
 const followingM5VolumePositiveExPost=entryBar.volume>0;
 let state:Q102ProfitFloorState|undefined,zero=0;
 const result=(exitTs:number,exitPrice:number,reason:string):Outcome=>({status:"MODELED_EXIT_NOT_FILL",exitTs,entryPrice,exitPrice,reason,zeroVolumeBars:zero,modelEntryTs,followingM5VolumePositiveExPost});
 for(let k=modelEntryTs;k<until;k+=M){
  const b=tape.get(k);if(!b)return {status:"HOLD_M5_MISSING_OR_INVALID",entryPrice,zeroVolumeBars:zero};
  if(b.volume===0)zero++;
  const active=state?.stopPrice===undefined?base:c.side===1?Math.max(base,state.stopPrice):Math.min(base,state.stopPrice);
  const hit=c.side===1?b.low<=active:b.high>=active;
  if(hit){if(b.volume===0)return {status:"ZERO_VOLUME_STOP_TOUCH_UNPROVEN",entryPrice,zeroVolumeBars:zero};return result(k+M,c.side===1?Math.min(b.open,active):Math.max(b.open,active),active===base?"HARD_STOP":"PROFIT_FLOOR");}
  if(overlay){const transition=applyQ102ProfitFloorBar({side,entryPrice,state,bar:{...b,timestampMs:k+M}});if(transition.stopHit){if(b.volume===0)return {status:"ZERO_VOLUME_STOP_TOUCH_UNPROVEN",entryPrice,zeroVolumeBars:zero};return result(k+M,transition.triggerPrice!,"PROFIT_FLOOR");}state=transition.state;}
 }
 const last=tape.get(until);if(!last)return {status:"TIME_EXIT_M5_MISSING_OR_INVALID",entryPrice,zeroVolumeBars:zero,modelEntryTs,followingM5VolumePositiveExPost};
 return result(until,last.open,"TIME");
}
const rows=events.map(c=>({id:c.id,key:c.key,symbol:c.symbol,entryTs:c.entryTs,side:c.side,base:scenario(c,false),profitFloor:scenario(c,true)}));
const aggregate=(arm:"base"|"profitFloor")=>{const status:Record<string,number>={},reasons:Record<string,number>={};for(const row of rows){const r=row[arm];status[r.status]=(status[r.status]??0)+1;if(r.reason)reasons[r.reason]=(reasons[r.reason]??0)+1;}return {status,reasons};};
const summary={base:aggregate("base"),profitFloor:aggregate("profitFloor")};
const sourcePins=Object.fromEntries(["scripts/stable4-q102-s34-m5-exit-observations-v2.ts","lib/disdex-exit-overlay-contract.ts","lib/disdex-quality102-causal-v1-runner.ts"].map(p=>[p,sha(readFileSync(p))]));
writeFileSync(output,JSON.stringify({schema:"stable4-q102-s34-m5-exit-observations/v2",status:"PARTIAL_DELAYED_M5_ENTRY_NO_NEXT_BAR_VOLUME_LOOKAHEAD",sourcePins,inputLedgerSha256:sha(rawLedger),files,summary,rows,orderAuthority:false,fullQ102AnnualReplay:false,limitations:["Raw candidate events overlap; no HIGH_VOL priority, final selection or one-slot admission","Both arms are counterfactual, not confirmed runtime flags. Uses native M5 profit-floor state transition in on arm; assumed immediate readback after close, no PB adverse/adopted overlays, funding, quote/order/lot/slippage or signed fill proof","Q102 native entry itself is not certified as an H1->M5 confirmation rule: this v2 is explicitly a DELAYED-M5 hypothetical arm. The first completed M5 OHLCV bar is known at t+5m, only then can a next-bar open price at t+5m be modeled.", "The new entry M5 bar volume is recorded EX-POST and is never used to authorize entry at its open; the v1 same-bar-open plus full-bar-volume gate was a lookahead error and v1 is superseded for this comparison.", "STOP touches on zero-volume candles remain unresolved; TIME exit price is a model open even if the volume of that new candle is unknown at the open (actual execution not proven).","No trading PnL/DD or portfolio certification"]},null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(summary));
